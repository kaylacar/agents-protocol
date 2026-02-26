// Skip the entire suite when @rer packages are not available
let hasRer = false;
try {
  require('@rer/core');
  require('@rer/runtime');
  hasRer = true;
} catch { /* not installed */ }

const describeIfRer = hasRer ? describe : describe.skip;

// Dynamic import to avoid compile errors when @rer is missing
const AuditManagerModule = hasRer ? require('../src/audit') : null;
type AuditManager = import('../src/audit').AuditManager;

describeIfRer('AuditManager', () => {
  let audit: AuditManager;

  afterEach(() => {
    audit?.destroy();
  });

  it('generates a key pair on construction', () => {
    audit = new AuditManagerModule.AuditManager();
    // DER form: 44-byte Buffer (12-byte ASN.1 prefix + 32 raw bytes)
    expect(audit.getPublicKeyDER()).toBeInstanceOf(Buffer);
    expect(audit.getPublicKeyDER().length).toBe(44);
    // Raw form: 32-byte Uint8Array for @rer/evidence safeVerify()
    expect(audit.getPublicKeyRaw()).toBeInstanceOf(Uint8Array);
    expect(audit.getPublicKeyRaw().length).toBe(32);
  });

  it('starts a session and creates a runtime', () => {
    audit = new AuditManagerModule.AuditManager(3600);
    // Should not throw
    audit.startSession('token-1', 'https://test.com', ['search', 'browse']);
  });

  it('logs capability calls through the runtime', async () => {
    audit = new AuditManagerModule.AuditManager(3600);
    audit.startSession('token-1', 'https://test.com', ['search']);

    const result = await audit.callCapability(
      'token-1',
      'search',
      { q: 'mugs' },
      async () => [{ id: '1', name: 'Blue Mug' }],
    );

    expect(result).toEqual([{ id: '1', name: 'Blue Mug' }]);
  });

  it('produces a signed artifact when session ends', async () => {
    audit = new AuditManagerModule.AuditManager(3600);
    audit.startSession('token-1', 'https://test.com', ['search']);

    await audit.callCapability(
      'token-1',
      'search',
      { q: 'test' },
      async () => [{ id: '1' }],
    );

    const artifact = audit.endSession('token-1');
    expect(artifact).not.toBeNull();
    expect(artifact!.run_id).toBeDefined();
    expect(artifact!.envelope).toBeDefined();
    expect(artifact!.events).toBeInstanceOf(Array);
    expect(artifact!.events.length).toBeGreaterThan(0);
    expect(artifact!.runtime_signature).toBeDefined();
    expect(artifact!.runtime_signature.length).toBeGreaterThan(0);
  });

  it('stores artifact for retrieval after session ends', async () => {
    audit = new AuditManagerModule.AuditManager(3600);
    audit.startSession('token-1', 'https://test.com', ['search']);

    await audit.callCapability('token-1', 'search', { q: 'x' }, async () => []);
    audit.endSession('token-1');

    const artifact = audit.getArtifact('token-1');
    expect(artifact).not.toBeNull();
    expect(artifact!.events.length).toBeGreaterThan(0);
  });

  it('returns null for unknown session artifacts', () => {
    audit = new AuditManagerModule.AuditManager();
    expect(audit.getArtifact('nonexistent')).toBeNull();
  });

  it('falls through to handler when no runtime exists', async () => {
    audit = new AuditManagerModule.AuditManager();
    // Don't start a session — callCapability should just run the handler
    const result = await audit.callCapability(
      'no-session',
      'search',
      {},
      async () => 'direct-result',
    );
    expect(result).toBe('direct-result');
  });

  it('logs multiple capability calls in sequence', async () => {
    audit = new AuditManagerModule.AuditManager(3600);
    audit.startSession('token-1', 'https://test.com', ['search', 'browse']);

    await audit.callCapability('token-1', 'search', { q: 'a' }, async () => [1]);
    await audit.callCapability('token-1', 'browse', {}, async () => ({ items: [2], total: 1 }));
    await audit.callCapability('token-1', 'search', { q: 'b' }, async () => [3]);

    const artifact = audit.endSession('token-1');
    expect(artifact).not.toBeNull();

    // RunStarted + 3x (PolicyEvaluated + ToolCalled + ToolReturned) + RunEnded
    // = 1 + 3*3 + 1 = 11 events
    expect(artifact!.events.length).toBe(11);
  });

  it('propagates PolicyDeniedError and does not run the handler', async () => {
    audit = new AuditManagerModule.AuditManager(3600);
    // Start session with no capabilities allowed so any callTool triggers a denial
    audit.startSession('token-deny', 'https://test.com', []);

    let handlerRan = false;
    await expect(
      audit.callCapability('token-deny', 'blocked-tool', {}, async () => {
        handlerRan = true;
        return 'should-not-reach';
      }),
    ).rejects.toThrow();

    expect(handlerRan).toBe(false);
  });

  it('artifact events form a valid hash chain', async () => {
    audit = new AuditManagerModule.AuditManager(3600);
    audit.startSession('token-1', 'https://test.com', ['search']);

    await audit.callCapability('token-1', 'search', { q: 'test' }, async () => []);
    const artifact = audit.endSession('token-1');

    // Verify hash chain: each event's parent_event_hash points to previous event's event_hash
    const events = artifact!.events;
    expect(events[0].header.parent_event_hash).toBeNull(); // First event has no parent
    for (let i = 1; i < events.length; i++) {
      expect(events[i].header.parent_event_hash).toBe(events[i - 1].header.event_hash);
    }
  });
});
