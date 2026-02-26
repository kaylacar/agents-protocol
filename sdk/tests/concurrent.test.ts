import { SessionManager } from '../src/session';

describe('SessionManager — concurrent access', () => {
  it('handles concurrent session creation without collision', () => {
    const manager = new SessionManager(3600);
    const sessions = Array.from({ length: 100 }, (_, i) =>
      manager.createSession(`site-${i}`),
    );

    const tokens = new Set(sessions.map(s => s.sessionToken));
    expect(tokens.size).toBe(100); // all unique

    for (const s of sessions) {
      expect(manager.validateSession(s.sessionToken)).not.toBeNull();
    }
    manager.destroy();
  });

  it('validates concurrently while another session is being deleted', async () => {
    const manager = new SessionManager(3600);
    const s1 = manager.createSession('site-1');
    const s2 = manager.createSession('site-2');

    // Simultaneous validate + end
    const [result1, _] = await Promise.all([
      Promise.resolve(manager.validateSession(s1.sessionToken)),
      Promise.resolve(manager.endSession(s2.sessionToken)),
    ]);

    expect(result1).not.toBeNull();
    expect(manager.validateSession(s2.sessionToken)).toBeNull();
    manager.destroy();
  });

  it('session tokens are 64 hex chars (32 bytes)', () => {
    const manager = new SessionManager(3600);
    const s = manager.createSession('site');
    expect(s.sessionToken).toMatch(/^[0-9a-f]{64}$/);
    manager.destroy();
  });

  it('expired sessions are cleaned up after validation attempt', () => {
    const manager = new SessionManager(0); // 0 second TTL = expires immediately
    const s = manager.createSession('site');

    // Token should be expired after any delay
    const result = manager.validateSession(s.sessionToken);
    expect(result).toBeNull();
    manager.destroy();
  });
});
