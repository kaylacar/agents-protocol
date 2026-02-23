import type { Request, Response, NextFunction } from 'express';
import {
  AgentDoorConfig,
  AgentRequest,
  CapabilityDefinition,
  OpenAPISpec,
  SessionData,
} from './types';
import { generateAgentsTxt } from './agents-txt';
import { generateAgentsJson } from './agents-json';
import { SessionManager } from './session';
import { RateLimiter } from './rate-limiter';
import { AuditManager } from './audit';
import { PolicyDeniedError } from '@rer/core';

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

export class AgentDoor {
  private config: AgentDoorConfig;
  private basePath: string;
  private capabilities: CapabilityDefinition[];
  private sessionManager: SessionManager;
  private rateLimiter: RateLimiter;
  private auditManager: AuditManager | null;
  private rateLimit: number;
  private agentsTxt: string;
  private agentsJson: object;
  private agentsJsonPath: string;
  private routes: RouteEntry[];

  constructor(config: AgentDoorConfig) {
    this.config = config;
    this.basePath = config.basePath ?? '/.well-known';
    this.capabilities = config.capabilities.flat();
    this.rateLimit = config.rateLimit ?? 60;
    this.sessionManager = new SessionManager(config.sessionTtl ?? 3600, this.capabilities);
    this.rateLimiter = new RateLimiter();
    this.auditManager = config.audit ? new AuditManager(config.sessionTtl ?? 3600) : null;
    this.agentsTxt = generateAgentsTxt(config);
    this.agentsJson = generateAgentsJson(config);
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

        const name = operation.operationId
          ?? `${httpMethod}_${path.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}`;

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
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Token');

      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }

      const agentReq = expressToAgentRequest(req);
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
    return async (request: globalThis.Request): Promise<globalThis.Response> => {
      // CORS preflight
      if (request.method === 'OPTIONS') {
        return new globalThis.Response(null, {
          status: 204,
          headers: corsHeaders(agentsJsonPath),
        });
      }

      const agentReq = await webRequestToAgentRequest(request);
      const result = await this.dispatch(agentReq);

      if (result === null) {
        return new globalThis.Response(JSON.stringify({ ok: false, error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(agentsJsonPath) },
        });
      }

      const headers: Record<string, string> = {
        ...corsHeaders(agentsJsonPath),
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
        const result = this.sessionManager.createSession(this.config.site.url);
        if (this.auditManager) {
          this.auditManager.startSession(result.sessionToken, this.config.site.url, result.capabilities);
        }
        return {
          status: 200,
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
        return { status: 200, body: { ok: true, data: { ended: true } } };
      },
    });

    if (this.auditManager) {
      routes.push({
        method: 'GET',
        pattern: `${apiBase}/audit/:session_id`,
        handler: async (req) => {
          const rate = this.checkRate(req);
        if (!rate.allowed) return rateLimitResponse(rate.resetAt);
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
            return { status: 200, body: { ok: true, data } };
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            const status = err instanceof PolicyDeniedError ? 403 : 400;
            return { status, body: { ok: false, error: message } };
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

function corsHeaders(agentsJsonPath: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Session-Token',
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

function expressToAgentRequest(req: Request): AgentRequest {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === 'string') query[k] = v;
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers[k] = v;
  }
  return {
    method: req.method.toUpperCase(),
    path: req.path,
    query,
    body: (req.body as Record<string, unknown>) ?? {},
    params: (req.params as Record<string, string>) ?? {},
    headers,
    ip: req.ip ?? req.socket?.remoteAddress,
  };
}

async function webRequestToAgentRequest(request: globalThis.Request): Promise<AgentRequest> {
  const url = new URL(request.url);
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { query[k] = v; });

  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => { headers[k] = v; });

  let body: Record<string, unknown> = {};
  const ct = request.headers.get('content-type') ?? '';
  if (ct.includes('application/json') && request.body) {
    try { body = await request.json() as Record<string, unknown>; } catch { /* empty body */ }
  } else if (ct.includes('application/x-www-form-urlencoded') && request.body) {
    try {
      const text = await request.text();
      new URLSearchParams(text).forEach((v, k) => { body[k] = v; });
    } catch { /* empty body */ }
  }

  return {
    method: request.method.toUpperCase(),
    path: url.pathname,
    query,
    body,
    params: {},
    headers,
    ip: headers['x-forwarded-for']?.split(',')[0]?.trim(),
  };
}

function extractToken(req: AgentRequest): string | null {
  const auth = req.headers['authorization'];
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return req.headers['x-session-token'] ?? null;
}

function capabilityRoute(cap: CapabilityDefinition, apiBase: string): string {
  const parts = cap.name.split('.');
  if (cap.name === 'detail') return `${apiBase}/detail/:id`;
  if (parts.length > 1) return `${apiBase}/${parts.join('/')}`;
  return `${apiBase}/${cap.name}`;
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
