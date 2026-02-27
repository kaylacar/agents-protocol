import { SessionManager } from '../src/session';

describe('SessionManager', () => {
  let manager: SessionManager;

  afterEach(() => {
    manager?.destroy();
  });

  it('creates a session with a token and expiry', () => {
    manager = new SessionManager(3600);
    const result = manager.createSession('https://test.com');
    expect(result.sessionToken).toBeDefined();
    expect(result.sessionToken.length).toBeGreaterThan(0);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('validates an active session', () => {
    manager = new SessionManager(3600);
    const { sessionToken } = manager.createSession('https://test.com');
    const session = manager.validateSession(sessionToken);
    expect(session).not.toBeNull();
    expect(session!.sessionToken).toBe(sessionToken);
    expect(session!.siteId).toBe('https://test.com');
    expect(session!.cartItems).toEqual([]);
  });

  it('returns null for unknown tokens', () => {
    manager = new SessionManager(3600);
    expect(manager.validateSession('bogus-token')).toBeNull();
  });

  it('rejects expired sessions', () => {
    manager = new SessionManager(0); // 0 second TTL = expired immediately
    const { sessionToken } = manager.createSession('https://test.com');
    // The session expires at Date.now() + 0 * 1000 = now, so it should be expired
    const session = manager.validateSession(sessionToken);
    expect(session).toBeNull();
  });

  it('ends a session', () => {
    manager = new SessionManager(3600);
    const { sessionToken } = manager.createSession('https://test.com');
    manager.endSession(sessionToken);
    expect(manager.validateSession(sessionToken)).toBeNull();
  });

  it('includes capability names from constructor', () => {
    const caps = [
      { name: 'search', description: 'Search', method: 'GET' as const, handler: async () => [] },
      { name: 'cart.add', description: 'Add', method: 'POST' as const, handler: async () => {} },
    ];
    manager = new SessionManager(3600, caps);
    const { capabilities } = manager.createSession('https://test.com');
    expect(capabilities).toContain('search');
    expect(capabilities).toContain('cart.add');
  });

  it('each session gets a unique token', () => {
    manager = new SessionManager(3600);
    const a = manager.createSession('https://test.com');
    const b = manager.createSession('https://test.com');
    expect(a.sessionToken).not.toBe(b.sessionToken);
  });
});
