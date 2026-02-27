import { randomBytes } from 'node:crypto';
import { SessionData, CapabilityDefinition } from './types';

export class SessionManager {
  private sessions = new Map<string, SessionData>();
  private cleanupInterval: ReturnType<typeof setInterval>;
  private ttl: number;
  private maxSessions: number;
  /** Maps IP → Set of active session tokens for that IP. */
  private sessionsByIp = new Map<string, Set<string>>();

  constructor(ttlSeconds: number = 1800, capabilities: CapabilityDefinition[] = [], maxSessions: number = 0) {
    this.ttl = ttlSeconds;
    this.maxSessions = maxSessions;
    this.capabilityNames = capabilities.map(c => c.name);
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  private capabilityNames: string[];

  createSession(siteId: string, ip?: string): { sessionToken: string; expiresAt: Date; capabilities: string[] } {
    // Enforce max_sessions per IP
    if (this.maxSessions > 0 && ip) {
      const ipSessions = this.sessionsByIp.get(ip);
      if (ipSessions && ipSessions.size >= this.maxSessions) {
        throw new MaxSessionsError(this.maxSessions);
      }
    }

    const sessionToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.ttl * 1000);
    const session: SessionData = {
      sessionToken,
      siteId,
      capabilities: this.capabilityNames,
      cartItems: [],
      expiresAt,
      createdAt: new Date(),
      ip,
    };
    this.sessions.set(sessionToken, session);

    // Track session by IP
    if (ip) {
      let ipSet = this.sessionsByIp.get(ip);
      if (!ipSet) {
        ipSet = new Set();
        this.sessionsByIp.set(ip, ipSet);
      }
      ipSet.add(sessionToken);
    }

    return { sessionToken, expiresAt, capabilities: session.capabilities };
  }

  validateSession(token: string): SessionData | null {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() >= session.expiresAt.getTime()) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  endSession(token: string): void {
    const session = this.sessions.get(token);
    if (session?.ip) {
      const ipSet = this.sessionsByIp.get(session.ip);
      if (ipSet) {
        ipSet.delete(token);
        if (ipSet.size === 0) this.sessionsByIp.delete(session.ip);
      }
    }
    this.sessions.delete(token);
  }

  private cleanup(): void {
    const now = new Date();
    for (const [token, session] of this.sessions) {
      if (now > session.expiresAt) {
        if (session.ip) {
          const ipSet = this.sessionsByIp.get(session.ip);
          if (ipSet) {
            ipSet.delete(token);
            if (ipSet.size === 0) this.sessionsByIp.delete(session.ip);
          }
        }
        this.sessions.delete(token);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.sessions.clear();
    this.sessionsByIp.clear();
  }
}

export class MaxSessionsError extends Error {
  constructor(limit: number) {
    super(`Maximum concurrent sessions (${limit}) exceeded`);
    this.name = 'MaxSessionsError';
  }
}
