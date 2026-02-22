import type { Request, Response, NextFunction } from 'express';
import { AgentDoorConfig, CapabilityDefinition, SessionData } from './types';
import { generateAgentsTxt } from './agents-txt';
import { generateAgentsJson } from './agents-json';
import { SessionManager } from './session';
import { RateLimiter } from './rate-limiter';
import { AuditManager } from './audit';

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

  constructor(config: AgentDoorConfig) {
    this.config = config;
    this.basePath = config.basePath ?? '/.well-known';
    this.capabilities = config.capabilities.flat();
    this.rateLimit = config.rateLimit ?? 60;
    this.sessionManager = new SessionManager(config.sessionTtl ?? 3600, this.capabilities);
    this.rateLimiter = new RateLimiter();
    this.auditManager = config.audit
      ? new AuditManager(config.sessionTtl ?? 3600)
      : null;
    this.agentsTxt = generateAgentsTxt(config);
    this.agentsJson = generateAgentsJson(config);
  }

  middleware(): (req: Request, res: Response, next: NextFunction) => void {
    const routes = this.buildRoutes();

    return (req: Request, res: Response, next: NextFunction) => {
      // CORS headers for agent access
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Token');

      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }

      const path = req.path;
      const method = req.method.toUpperCase();

      for (const route of routes) {
        const match = this.matchRoute(route.pattern, path);
        if (match && route.method === method) {
          req.params = { ...req.params, ...match.params };
          route.handler(req, res);
          return;
        }
      }

      next();
    };
  }

  private buildRoutes(): RouteEntry[] {
    const routes: RouteEntry[] = [];
    const apiBase = `${this.basePath}/agents/api`;

    // Discovery endpoints
    routes.push({
      method: 'GET',
      pattern: `${this.basePath}/agents.txt`,
      handler: (_req, res) => {
        res.type('text/plain').send(this.agentsTxt);
      },
    });

    routes.push({
      method: 'GET',
      pattern: `${this.basePath}/agents.json`,
      handler: (_req, res) => {
        res.json(this.agentsJson);
      },
    });

    // Session creation — also starts RER runtime when audit is enabled
    routes.push({
      method: 'POST',
      pattern: `${apiBase}/session`,
      handler: (req, res) => {
        if (!this.applyRateLimit(req, res)) return;
        const siteId = this.config.site.url;
        const result = this.sessionManager.createSession(siteId);

        if (this.auditManager) {
          this.auditManager.startSession(
            result.sessionToken,
            siteId,
            result.capabilities,
          );
        }

        res.json({
          ok: true,
          data: {
            session_token: result.sessionToken,
            expires_at: result.expiresAt.toISOString(),
            capabilities: result.capabilities,
            ...(this.auditManager && { audit: true }),
          },
        });
      },
    });

    // Session deletion — seals RER artifact when audit is enabled
    routes.push({
      method: 'DELETE',
      pattern: `${apiBase}/session`,
      handler: (req, res) => {
        if (!this.applyRateLimit(req, res)) return;
        const token = this.extractToken(req);
        if (!token) {
          res.status(401).json({ ok: false, error: 'Missing session token' });
          return;
        }

        if (this.auditManager) {
          this.auditManager.endSession(token);
        }

        this.sessionManager.endSession(token);
        res.json({ ok: true, data: { ended: true } });
      },
    });

    // Audit endpoint — retrieve signed artifact for a session
    if (this.auditManager) {
      routes.push({
        method: 'GET',
        pattern: `${apiBase}/audit/:session_id`,
        handler: (req, res) => {
          if (!this.applyRateLimit(req, res)) return;
          const sessionId = req.params.session_id;
          const artifact = this.auditManager!.getArtifact(sessionId);
          if (!artifact) {
            res.status(404).json({ ok: false, error: 'Audit artifact not found' });
            return;
          }
          res.json({ ok: true, data: artifact });
        },
      });
    }

    // Capability routes — wrapped through RER when audit is enabled
    for (const cap of this.capabilities) {
      const pattern = this.capabilityRoute(cap, apiBase);
      routes.push({
        method: cap.method,
        pattern,
        handler: async (req, res) => {
          if (!this.applyRateLimit(req, res)) return;

          let session: SessionData | null = null;
          if (cap.requiresSession) {
            const token = this.extractToken(req);
            if (!token) {
              res.status(401).json({ ok: false, error: 'Missing session token' });
              return;
            }
            session = this.sessionManager.validateSession(token);
            if (!session) {
              res.status(401).json({ ok: false, error: 'Invalid or expired session' });
              return;
            }
          }

          try {
            let data: any;

            if (this.auditManager && session) {
              // Execute through RER runtime — logs ToolCalled + ToolReturned events
              const requestData = cap.method === 'GET'
                ? { ...(req.query as Record<string, unknown>), ...req.params }
                : { ...(req.body as Record<string, unknown>), ...req.params };

              data = await this.auditManager.callCapability(
                session.sessionToken,
                cap.name,
                requestData,
                () => cap.handler(req, res, session),
              );
            } else {
              data = await cap.handler(req, res, session);
            }

            if (!res.headersSent) {
              res.json({ ok: true, data });
            }
          } catch (err: any) {
            if (!res.headersSent) {
              res.status(400).json({ ok: false, error: err.message ?? 'Unknown error' });
            }
          }
        },
      });
    }

    return routes;
  }

  private capabilityRoute(cap: CapabilityDefinition, apiBase: string): string {
    const parts = cap.name.split('.');
    if (cap.name === 'detail') {
      return `${apiBase}/detail/:id`;
    }
    if (parts.length > 1) {
      return `${apiBase}/${parts.join('/')}`;
    }
    return `${apiBase}/${cap.name}`;
  }

  private matchRoute(pattern: string, path: string): { params: Record<string, string> } | null {
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

  private extractToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    return (req.headers['x-session-token'] as string) ?? null;
  }

  private applyRateLimit(req: Request, res: Response): boolean {
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const result = this.rateLimiter.checkRateLimit(key, this.rateLimit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));
    if (!result.allowed) {
      res.status(429).json({ ok: false, error: 'Rate limit exceeded' });
      return false;
    }
    return true;
  }

  destroy(): void {
    this.sessionManager.destroy();
    this.rateLimiter.destroy();
    this.auditManager?.destroy();
  }
}

interface RouteEntry {
  method: string;
  pattern: string;
  handler: (req: Request, res: Response) => void;
}
