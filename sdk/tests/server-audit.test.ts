import { AgentDoor } from '../src/server';
import { search, cart, checkout } from '../src/capabilities';

let rerAvailable = false;
try {
  require('../src/audit');
  rerAvailable = true;
} catch {
  // @rer/* not installed
}

function mockReq(method: string, path: string, opts?: { body?: any; query?: Record<string, string>; headers?: Record<string, string>; ip?: string }): any {
  return {
    method,
    path,
    body: opts?.body ?? {},
    query: opts?.query ?? {},
    params: {},
    headers: opts?.headers ?? {},
    ip: opts?.ip ?? '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  };
}

function mockRes(): any {
  const res: any = {
    _status: 200,
    _body: null,
    _headers: {} as Record<string, any>,
    headersSent: false,
    status(code: number) { res._status = code; return res; },
    json(body: any) { res._body = body; res.headersSent = true; return res; },
    send(body: any) { res._body = body; res.headersSent = true; return res; },
    type(t: string) { res._headers['content-type'] = t; return res; },
    setHeader(k: string, v: any) { res._headers[k.toLowerCase()] = v; return res; },
    getHeader(k: string) { return res._headers[k.toLowerCase()]; },
    end() { res.headersSent = true; return res; },
  };
  return res;
}

function createDoor() {
  return new AgentDoor({
    site: { name: 'Test', url: 'https://test.com' },
    capabilities: [
      search({ handler: async (q) => [{ id: '1', name: `Result for ${q}` }] }),
      cart(),
      checkout({ onCheckout: async () => ({ checkout_url: 'https://test.com/pay' }) }),
    ],
    rateLimit: 100,
    sessionTtl: 3600,
    audit: true,
  });
}

describe('AgentDoor with audit: true (graceful degradation)', () => {
  let door: AgentDoor;

  afterEach(() => {
    door?.destroy();
  });

  it('constructs without error even when @rer/* is missing', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    door = createDoor();
    if (!rerAvailable) {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('not installed'),
      );
    }
    warnSpy.mockRestore();
  });

  it('session creation works (audit field depends on RER availability)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    door = createDoor();
    warnSpy.mockRestore();
    const mw = door.middleware();

    const req = mockReq('POST', '/.well-known/agents/api/session');
    const res = mockRes();
    await mw(req, res, jest.fn());

    expect(res._body.ok).toBe(true);
    expect(res._body.data.session_token).toBeDefined();
    if (rerAvailable) {
      expect(res._body.data.audit).toBe(true);
    } else {
      expect(res._body.data.audit).toBeUndefined();
    }
  });

  it('capabilities work without audit trail when @rer/* is missing', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    door = createDoor();
    warnSpy.mockRestore();
    const mw = door.middleware();

    // Search works without session
    const searchReq = mockReq('GET', '/.well-known/agents/api/search', { query: { q: 'mugs' } });
    const searchRes = mockRes();
    await mw(searchReq, searchRes, jest.fn());
    expect(searchRes._body.ok).toBe(true);
    expect(searchRes._body.data).toHaveLength(1);
  });

  it('audit endpoint returns 404 when RER is not available', async () => {
    if (rerAvailable) return; // only relevant when RER is missing

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    door = createDoor();
    warnSpy.mockRestore();
    const mw = door.middleware();

    const req = mockReq('GET', '/.well-known/agents/api/audit/some-token');
    const res = mockRes();
    await mw(req, res, jest.fn());

    expect(res._status).toBe(404);
  });

  it('CORS headers are set on responses', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    door = createDoor();
    warnSpy.mockRestore();
    const mw = door.middleware();

    const req = mockReq('GET', '/.well-known/agents.txt');
    const res = mockRes();
    await mw(req, res, jest.fn());

    expect(res._headers['access-control-allow-origin']).toBe('*');
    expect(res._headers['access-control-allow-methods']).toContain('GET');
    expect(res._headers['access-control-allow-headers']).toContain('Authorization');
  });

  it('OPTIONS requests get 204 (CORS preflight)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    door = createDoor();
    warnSpy.mockRestore();
    const mw = door.middleware();

    const req = mockReq('OPTIONS', '/.well-known/agents/api/search');
    const res = mockRes();
    await mw(req, res, jest.fn());

    expect(res._status).toBe(204);
  });
});

// Full audit flow tests — only run when @rer/* is available
const describeIfRer = rerAvailable ? describe : describe.skip;

describeIfRer('AgentDoor with audit: true (full RER integration)', () => {
  let door: AgentDoor;

  afterEach(() => {
    door?.destroy();
  });

  it('session creation response includes audit: true', async () => {
    door = createDoor();
    const mw = door.middleware();
    const req = mockReq('POST', '/.well-known/agents/api/session');
    const res = mockRes();
    await mw(req, res, jest.fn());

    expect(res._body.ok).toBe(true);
    expect(res._body.data.audit).toBe(true);
  });

  it('full audit flow: session → search → end → retrieve artifact', async () => {
    door = createDoor();
    const mw = door.middleware();

    // Create session
    const sessionReq = mockReq('POST', '/.well-known/agents/api/session');
    const sessionRes = mockRes();
    await mw(sessionReq, sessionRes, jest.fn());
    const token = sessionRes._body.data.session_token;

    // Search (logged by RER)
    const searchReq = mockReq('GET', '/.well-known/agents/api/search', {
      query: { q: 'mugs' },
      headers: { authorization: `Bearer ${token}` },
    });
    const searchRes = mockRes();
    await mw(searchReq, searchRes, jest.fn());
    expect(searchRes._body.ok).toBe(true);

    // End session (seals artifact)
    const endReq = mockReq('DELETE', '/.well-known/agents/api/session', {
      headers: { authorization: `Bearer ${token}` },
    });
    const endRes = mockRes();
    await mw(endReq, endRes, jest.fn());
    expect(endRes._body.ok).toBe(true);

    // Retrieve audit artifact
    const auditReq = mockReq('GET', `/.well-known/agents/api/audit/${token}`);
    const auditRes = mockRes();
    await mw(auditReq, auditRes, jest.fn());

    expect(auditRes._body.ok).toBe(true);
    expect(auditRes._body.data.run_id).toBeDefined();
    expect(auditRes._body.data.events).toBeInstanceOf(Array);
    expect(auditRes._body.data.runtime_signature).toBeDefined();
    expect(auditRes._body.data.envelope).toBeDefined();
  });

  it('cart operations are logged in the audit trail', async () => {
    door = createDoor();
    const mw = door.middleware();

    // Create session
    const sessionReq = mockReq('POST', '/.well-known/agents/api/session');
    const sessionRes = mockRes();
    await mw(sessionReq, sessionRes, jest.fn());
    const token = sessionRes._body.data.session_token;

    // Add to cart
    const addReq = mockReq('POST', '/.well-known/agents/api/cart/add', {
      body: { item_id: '1', quantity: 2, name: 'Mug', price: 28 },
      headers: { authorization: `Bearer ${token}` },
    });
    const addRes = mockRes();
    await mw(addReq, addRes, jest.fn());

    // End and check artifact
    const endReq = mockReq('DELETE', '/.well-known/agents/api/session', {
      headers: { authorization: `Bearer ${token}` },
    });
    const endRes = mockRes();
    await mw(endReq, endRes, jest.fn());

    const auditReq = mockReq('GET', `/.well-known/agents/api/audit/${token}`);
    const auditRes = mockRes();
    await mw(auditReq, auditRes, jest.fn());

    const events = auditRes._body.data.events;
    const toolCalledEvents = events.filter((e: any) => e.header.event_type === 'ToolCalled');
    expect(toolCalledEvents.length).toBeGreaterThan(0);
    expect(toolCalledEvents[0].payload.tool).toBe('cart.add');
  });
});
