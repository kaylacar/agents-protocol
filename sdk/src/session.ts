import { randomBytes } from 'node:crypto';
import { SessionData, CapabilityDefinition } from './types';

export class SessionManager {
  private sessions = new Map<string, SessionData>();
  private cleanupInterval: ReturnType<typeof setInterval>;
  private ttl: number;

  constructor(ttlSeconds: number = 3600, capabilities: CapabilityDefinition[] = []) {
    this.ttl = ttlSeconds;
    this.capabilityNames = capabilities.map(c => c.name);
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  private capabilityNames: string[];

  createSession(siteId: string): { sessionToken: string; expiresAt: Date; capabilities: string[] } {
    const sessionToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.ttl * 1000);
    const session: SessionData = {
      sessionToken,
      siteId,
      capabilities: this.capabilityNames,
      cartItems: [],
      expiresAt,
      createdAt: new Date(),
    };
    this.sessions.set(sessionToken, session);
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

  getSession(token: string): SessionData | null {
    return this.validateSession(token);
  }

  endSession(token: string): void {
    this.sessions.delete(token);
  }

  private cleanup(): void {
    const now = new Date();
    for (const [token, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(token);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.sessions.clear();
  }
}
