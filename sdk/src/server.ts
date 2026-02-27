import type { Request, Response, NextFunction } from 'express';
import {
  AgentDoorConfig,
  AgentRequest,
  AgentsJsonManifest,
  CapabilityDefinition,
  OpenAPISpec,
  SessionData,
} from './types';
import { generateAgentsTxt } from './agents-txt';
import { generateAgentsJson } from './agents-json';
import { flattenCapabilities, capabilityRoute } from './utils';
import { SessionManager, MaxSessionsError } from './session';
import { RateLimiter } from './rate-limiter';

// AuditManager depends on @rer/core and @rer/runtime which are optional peer
// dependencies. We lazily require it so the SDK works without @rer installed.
type AuditManager = import('./audit').AuditManager;
let AuditManagerClass: (new (ttlSeconds?: number) => AuditManager) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  AuditManagerClass = require('./audit').AuditManager;
} catch {
  // @rer packages not installed — audit feature unavailable
}
// PolicyDeniedError from @rer/core is optional — define a local fallback
// so the SDK compiles and runs without @rer packages installed.
let PolicyDeniedError: new (...args: any[]) => Error;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PolicyDeniedError = require('@rer/core').PolicyDeniedError;
} catch {
  // @rer/core not installed — define a class that will never match
  PolicyDeniedError = class PolicyDeniedError extends Error {
    constructor(message?: string) { super(message); this.name = 'PolicyDeniedError'; }
  };
}

interface RouteEntry {
  method: string;
  pattern: string;
  handler: (req: AgentRequest) => Promise<InternalResponse>;
}

interface InternalResponse {
  status: number;
  body: unknown;
  contentType?: string;
  headers?: Record<string, string>;
}

const AGENTS_REL = 'agents';
/** Maximum request body size in bytes (1 MB). */
const MAX_BODY_BYTES = 1024 * 1024;

export class AgentDoor {
  private config: AgentDoorConfig;
  private basePath: string;
  private capabilities: CapabilityDefinition[];
  private sessionManager: SessionManager;
  private rateLimiter: RateLimiter;
  private auditManager: AuditManager | null;
  private rateLimit: number;
  private corsOrigin: string;
  private trustProxy: boolean;
  private agentsTxt: string;
  private agentsJson: AgentsJsonManifest;
  private agentsJsonPath: string;
  private routes: RouteEntry[];

  constructor(config: AgentDoorConfig) {
    this.config = config;
    this.basePath = config.basePath ?? '/.well-known';
    this.capabilities = flattenCapabilities(config);

    if (this.capabilities.length === 0) {
      throw new Error('At least one capability is required');
    }

    // Validate capability names against the schema pattern
    const NAME_PATTERN = /^[a-z][a-z0-9_.]*$/;
    for (const cap of this.capabilities) {
      if (!NAME_PATTERN.test(cap.name)) {
        throw new Error(
          `Invalid capability name "${cap.name}": must match pattern ^[a-z][a-z0-9_.]*$`,
        );
      }
    }

    const sessionTtl = config.sessionTtl ?? 1800;
    if (sessionTtl < 60) {
      throw new Error('sessionTtl must be at least 60 seconds');
    }

    this.rateLimit = config.rateLimit ?? 60;
    this.corsOrigin = config.corsOrigin ?? '*';
    this.trustProxy = config.trustProxy ?? false;
    this.sessionManager = new SessionManager(sessionTtl, this.capabilities, config.maxSessions ?? 0);
    this.rateLimiter = new RateLimiter();
    if (config.audit && AuditManagerClass) {
      this.auditManager = new AuditManagerClass(sessionTtl);
    } else if (config.audit && !AuditManagerClass) {
      console.warn('[AgentDoor] audit: true but @rer/core and @rer/runtime are not installed. Audit disabled.');
      this.auditManager = null;
    } else {
      this.auditManager = null;
    }
    this.agentsTxt = generateAgentsTxt(config);
    const auditPublicKey = this.auditManager
      ? Buffer.from(this.auditManager.getPublicKeyRaw()).toString('base64')
      : undefined;
    this.agentsJson = generateAgentsJson(config, auditPublicKey);
    this.agentsJsonPath = `${this.basePath}/agents.json`;
    this.routes = this.buildRoutes();
  }

  // ─── Static factory: build from OpenAPI spec ────────────────────────────────

  /**
   * Create an AgentDoor that proxies requests to an existing API described by
   * an OpenAPI 3.x spec. The site owner provides no handler code — capabilities
   * are inferred from the spec and calls are forwarded to baseUrl.
   */
  static fromOpenAPI(
    spec: OpenAPISpec,
    baseUrl: string,
    overrides: Partial<AgentDoorConfig> = {},
  ): AgentDoor {
    const capabilities: CapabilityDefinition[] = [];
    const methodMap: Record<string, CapabilityDefinition['method']> = {
      get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', delete: 'DELETE',
    };

    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [httpMethod, operation] of Object.entries(methods)) {
        const method = methodMap[httpMethod.toLowerCase()];
        if (!method) continue;

        const rawName = operation.operationId
          ?? `${httpMethod}_${path.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}`;
        // Normalize to snake_case so names satisfy ^[a-z][a-z0-9_.]*$
        const name = rawName
          .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
          .replace(/[^a-z0-9_.]/gi, '_')
          .toLowerCase()
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '');

        const params: NonNullable<CapabilityDefinition['params']> = {};

        for (const p of operation.parameters ?? []) {
          if (p.in === 'query' || p.in === 'path') {
            params[p.name] = {
              type: p.schema?.type ?? 'string',
              required: p.required ?? false,
              description: p.description,
              ...(p.schema?.enum && { enum: p.schema.enum }),
              ...(p.schema?.default != null && { default: p.schema.default }),
            };
          }
        }

        const bodySchema = operation.requestBody?.content?.['application/json']?.schema;
        if (bodySchema?.properties) {
          const required = new Set(bodySchema.required ?? []);
          for (const [propName, prop] of Object.entries(bodySchema.properties)) {
            params[propName] = {
              type: prop.type ?? 'string',
              required: required.has(propName),
              description: prop.description,
            };
          }
        }

        const targetPath = path;

        capabilities.push({
          name,
          description: operation.summary ?? `${httpMethod.toUpperCase()} ${path}`,
          method,
          params: Object.keys(params).length > 0 ? params : undefined,
          handler: async (req) => {
            let resolvedPath = targetPath;
            for (const [k, v] of Object.entries(req.params)) {
              resolvedPath = resolvedPath.replace(`{${k}}`, encodeURIComponent(v));
            }

            const url = new URL(`${baseUrl}${resolvedPath}`);
            if (method === 'GET' || method === 'DELETE') {
              for (const [k, v] of Object.entries(req.query)) {
                url.searchParams.set(k, v);
              }
            }

            const init: RequestInit = { method };
            if (method !== 'GET' && method !== 'DELETE' && Object.keys(req.body).length > 0) {
              init.body = JSON.stringify(req.body);
              init.headers = { 'Content-Type': 'application/json' };
            }

            const response = await fetch(url.toString(), init);
            if (!response.ok) {
              const text = await response.text().catch(() => response.statusText);
              throw new Error(`Upstream ${response.status}: ${text}`);
            }
            return response.json();
          },
        });
      }
    }

    const serverUrl = spec.servers?.[0]?.url ?? baseUrl;
    return new AgentDoor({
      site: {
        name: spec.info?.title ?? 'API',
        url: serverUrl,
        description: spec.info?.description,
      },
      capabilities,
      ...overrides,
    });
  }

  // ─── Express middleware ──────────────────────────────────────────────────────

  middleware(): (req: Request, res: Response, next: NextFunction) => void {
    return async (req: Request, res: Response, next: NextFunction) => {
      // Auto-discovery + CORS on every response
      res.setHeader('Link', `<${this.agentsJsonPath}>; rel="${AGENTS_REL}"`);
      res.setHeader('Access-Control-Allow-Origin', this.corsOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Agent-Session, X-Session-Token');

      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }

      const agentReq = expressToAgentRequest(req, this.trustProxy);
      const result = await this.dispatch(agentReq);

      if (result === null) {
        // Not our route — intercept send() to inject <link> into HTML pages
        this.injectHtmlLink(res);
        next();
        return;
      }

      res.status(result.status);
      if (result.headers) {
        for (const [k, v] of Object.entries(result.headers)) {
          res.setHeader(k, v);
        }
      }
      if (result.contentType) {
        res.type(result.contentType).send(result.body as string);
      } else {
        res.json(result.body);
      }
    };
  }

  // ─── Fetch-compatible handler (Next.js App Router, Cloudflare Workers, Deno) ─

  handler(): (request: globalThis.Request) => Promise<globalThis.Response> {
    const agentsJsonPath = this.agentsJsonPath;
    const origin = this.corsOrigin;
    return async (request: globalThis.Request): Promise<globalThis.Response> => {
      // CORS preflight
      if (request.method === 'OPTIONS') {
        return new globalThis.Response(null, {
          status: 204,
          headers: corsHeaders(agentsJsonPath, origin),
        });
      }

      let agentReq: AgentRequest;
      try {
        agentReq = await webRequestToAgentRequest(request, this.trustProxy);
      } catch (err) {
        if (err instanceof BodyTooLargeError) {
          return new globalThis.Response(JSON.stringify({ ok: false, error: 'Request body too large' }), {
            status: 413,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(agentsJsonPath, origin) },
          });
        }
        throw err;
      }
      const result = await this.dispatch(agentReq);

      if (result === null) {
        return new globalThis.Response(JSON.stringify({ ok: false, error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(agentsJsonPath, origin) },
        });
      }

      const headers: Record<string, string> = {
        ...corsHeaders(agentsJsonPath, origin),
        'Content-Type': result.contentType ?? 'application/json',
        ...(result.headers ?? {}),
      };

      const body = result.contentType
        ? String(result.body)
        : JSON.stringify(result.body);

      return new globalThis.Response(body, { status: result.status, headers });
    };
  }

  // ─── Core dispatcher ─────────────────────────────────────────────────────────

  private async dispatch(req: AgentRequest): Promise<InternalResponse | null> {
    for (const route of this.routes) {
      const match = matchRoute(route.pattern, req.path);
      if (match && route.method === req.method) {
        req.params = { ...req.params, ...match.params };
        return route.handler(req);
      }
    }
    return null;
  }

  // ─── Route table ─────────────────────────────────────────────────────────────

  private buildRoutes(): RouteEntry[] {
    const routes: RouteEntry[] = [];
    const apiBase = `${this.basePath}/agents/api`;

    routes.push({
      method: 'GET',
      pattern: `${this.basePath}/agents.txt`,
      handler: async () => ({ status: 200, body: this.agentsTxt, contentType: 'text/plain' }),
    });

    routes.push({
      method: 'GET',
      pattern: `${this.basePath}/agents.json`,
      handler: async () => ({ status: 200, body: this.agentsJson }),
    });

    routes.push({
      method: 'POST',
      pattern: `${apiBase}/session`,
      handler: async (req) => {
        const rate = this.checkRate(req);
        if (!rate.allowed) return rateLimitResponse(rate.resetAt);
        let result;
        try {
          result = this.sessionManager.createSession(this.config.site.url, req.ip);
        } catch (err) {
          if (err instanceof MaxSessionsError) {
            return { status: 429, body: { ok: false, error: err.message } };
          }
          throw err;
        }
        if (this.auditManager) {
          this.auditManager.startSession(result.sessionToken, this.config.site.url, result.capabilities);
        }
        return {
          status: 201,
          body: {
            ok: true,
            data: {
              session_token: result.sessionToken,
              expires_at: result.expiresAt.toISOString(),
              capabilities: result.capabilities,
              ...(this.auditManager && { audit: true }),
            },
          },
        };
      },
    });

    routes.push({
      method: 'DELETE',
      pattern: `${apiBase}/session`,
      handler: async (req) => {
        const rate = this.checkRate(req);
        if (!rate.allowed) return rateLimitResponse(rate.resetAt);
        const token = extractToken(req);
        if (!token) return { status: 401, body: { ok: false, error: 'Missing session token' } };
        if (this.auditManager) this.auditManager.endSession(token);
        this.sessionManager.endSession(token);
        const deleteData: Record<string, unknown> = {
          session_token: token,
          ended_at: new Date().toISOString(),
        };
        if (this.auditManager) {
          deleteData.audit_artifact_url = `${apiBase}/audit/${token}`;
        }
        return { status: 200, body: { ok: true, data: deleteData } };
      },
    });

    if (this.auditManager) {
      routes.push({
        method: 'GET',
        pattern: `${apiBase}/audit/:session_id`,
        handler: async (req) => {
          const rate = this.checkRate(req);
          if (!rate.allowed) return rateLimitResponse(rate.resetAt);
          const token = extractToken(req);
          if (!token) return { status: 401, body: { ok: false, error: 'Missing session token' } };
          if (token !== req.params.session_id) {
            return { status: 403, body: { ok: false, error: 'Token does not match requested session' } };
          }
          const artifact = this.auditManager!.getArtifact(req.params.session_id);
          if (!artifact) return { status: 404, body: { ok: false, error: 'Audit artifact not found' } };
          return { status: 200, body: { ok: true, data: artifact } };
        },
      });
    }

    for (const cap of this.capabilities) {
      const pattern = capabilityRoute(cap, apiBase);
      routes.push({
        method: cap.method,
        pattern,
        handler: async (req) => {
          const rate = this.checkRate(req);
          if (!rate.allowed) return rateLimitResponse(rate.resetAt);

          let session: SessionData | null = null;
          if (cap.requiresSession) {
            const token = extractToken(req);
            if (!token) return { status: 401, body: { ok: false, error: 'Missing session token' } };
            session = this.sessionManager.validateSession(token);
            if (!session) return { status: 401, body: { ok: false, error: 'Invalid or expired session' } };
          }

          try {
            let data: unknown;
            if (this.auditManager && session) {
              const requestData = cap.method === 'GET'
                ? { ...req.query, ...req.params }
                : { ...req.body, ...req.params };
              data = await this.auditManager.callCapability(
                session.sessionToken,
                cap.name,
                requestData,
                () => cap.handler(req, session),
              );
            } else {
              data = await cap.handler(req, session);
            }
            const successStatus = cap.method === 'POST' ? 201 : 200;
            return { status: successStatus, body: { ok: true, data } };
          } catch (err: unknown) {
            if (err instanceof PolicyDeniedError) {
              return { status: 403, body: { ok: false, error: err.message } };
            }
            // Known validation errors from handlers (throw new Error(...)) → 400
            // Unexpected errors (TypeError, ReferenceError, etc.) → 500
            const isValidationError = err instanceof Error
              && !(err instanceof TypeError)
              && !(err instanceof RangeError)
              && !(err instanceof ReferenceError)
              && !(err instanceof SyntaxError);
            const message = err instanceof Error ? err.message : 'Internal server error';
            const status = isValidationError ? 400 : 500;
            return { status, body: { ok: false, error: status === 500 ? 'Internal server error' : message } };
          }
        },
      });
    }

    return routes;
  }

  // ─── HTML link injection (Express) ───────────────────────────────────────────

  private injectHtmlLink(res: Response): void {
    const linkTag = `<link rel="${AGENTS_REL}" href="${this.agentsJsonPath}">`;
    const originalSend = res.send.bind(res);

    (res as unknown as { send: (body?: unknown) => Response }).send = (body?: unknown): Response => {
      const ct = res.getHeader('Content-Type') as string | undefined;
      if (typeof body === 'string' && ct?.includes('text/html')) {
        body = body.replace(/<\/head>/i, `  ${linkTag}\n</head>`);
      }
      return originalSend(body as Parameters<typeof originalSend>[0]);
    };
  }

  private checkRate(req: AgentRequest): { allowed: boolean; remaining: number; resetAt: number } {
    return this.rateLimiter.checkRateLimit(req.ip ?? 'unknown', this.rateLimit);
  }

  destroy(): void {
    this.sessionManager.destroy();
    this.rateLimiter.destroy();
    this.auditManager?.destroy();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function corsHeaders(agentsJsonPath: string, origin: string = '*'): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agent-Session, X-Session-Token',
    'Link': `<${agentsJsonPath}>; rel="agents"`,
  };
}

function rateLimitResponse(resetAt: number): InternalResponse {
  const retryAfter = String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)));
  return {
    status: 429,
    body: { ok: false, error: 'Rate limit exceeded' },
    headers: {
      'Retry-After': retryAfter,
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
    },
  };
}

function expressToAgentRequest(req: Request, trustProxy: boolean): AgentRequest {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === 'string') query[k] = v;
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers[k] = v;
  }
  let ip = req.socket?.remoteAddress;
  if (trustProxy) {
    ip = req.ip ?? ip;
  }
  return {
    method: req.method.toUpperCase(),
    path: req.path,
    query,
    body: (req.body as Record<string, unknown>) ?? {},
    params: (req.params as Record<string, string>) ?? {},
    headers,
    ip,
  };
}

async function webRequestToAgentRequest(request: globalThis.Request, trustProxy: boolean): Promise<AgentRequest> {
  const url = new URL(request.url);
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { query[k] = v; });

  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => { headers[k] = v; });

  let body: Record<string, unknown> = {};
  const ct = request.headers.get('content-type') ?? '';
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    throw new BodyTooLargeError();
  }
  if (ct.includes('application/json') && request.body) {
    const text = await readBodyWithLimit(request);
    try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* malformed JSON — treat as empty body */ }
  } else if (ct.includes('application/x-www-form-urlencoded') && request.body) {
    const text = await readBodyWithLimit(request);
    new URLSearchParams(text).forEach((v, k) => { body[k] = v; });
  }

  // Only trust X-Forwarded-For when trustProxy is enabled
  const ip = trustProxy
    ? headers['x-forwarded-for']?.split(',')[0]?.trim()
    : undefined;

  return {
    method: request.method.toUpperCase(),
    path: url.pathname,
    query,
    body,
    params: {},
    headers,
    ip,
  };
}

function extractToken(req: AgentRequest): string | null {
  // Spec-defined header (preferred)
  const agentSession = req.headers['x-agent-session'];
  if (agentSession && agentSession.trim().length > 0) return agentSession.trim();
  // Also accept Authorization: Bearer for compatibility
  const auth = req.headers['authorization'];
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token.length > 0) return token;
  }
  // Legacy header
  const legacy = req.headers['x-session-token'];
  if (legacy && legacy.trim().length > 0) return legacy.trim();
  return null;
}

class BodyTooLargeError extends Error {
  constructor() { super('Request body too large'); this.name = 'BodyTooLargeError'; }
}

async function readBodyWithLimit(request: globalThis.Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      reader.cancel();
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(chunks.length === 1 ? chunks[0] : concatUint8Arrays(chunks, totalBytes));
}

function concatUint8Arrays(arrays: Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.byteLength;
  }
  return result;
}

function matchRoute(pattern: string, path: string): { params: Record<string, string> } | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return { params };
}
