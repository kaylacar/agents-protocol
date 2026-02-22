import { AgentDoor } from '../src/server';
import { search, browse, detail, cart, checkout, contact } from '../src/capabilities';
import type { Request, Response } from 'express';

// Minimal mock helpers
function mockReq(method: string, path: string, opts?: { body?: any; query?: Record<string, string>; headers?: Record<string, string>; ip?: string }): Request {
  return {
    method,
    path,
    body: opts?.body ?? {},
    query: opts?.query ?? {},
    params: {},
    headers: opts?.headers ?? {},
    ip: opts?.ip ?? '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  } as any;
}

function mockRes(): Response & { _status: number; _body: any; _headers: Record<string, any>; headersSent: boolean } {
  const res: any = {
    _status: 200,
    _body: null,
    _headers: {},
    headersSent: false,
    status(code: number) { res._status = code; return res; },
    json(body: any) { res._body = body; res.headersSent = true; return res; },
    send(body: any) { res._body = body; res.headersSent = true; return res; },
    type(t: string) { res._headers['content-type'] = t; return res; },
    setHeader(k: string, v: any) { res._headers[k] = v; return res; },
  };
  return res;
}

describe('AgentDoor', () => {
  let door: AgentDoor;

  afterEach(() => {
    door?.destroy();
  });

  function createDoor() {
    door = new AgentDoor({
      site: { name: 'Test', url: 'https://test.com', description: 'Test site' },
      capabilities: [
        search({ handler: async (q) => [{ id: '1', name: `Result for ${q}` }] }),
        browse({ handler: async () => ({ items: [{ id: '1' }], total: 1 }) }),
        detail({ handler: async (id) => ({ id, name: 'Item' }) }),
        cart(),
        checkout({ onCheckout: async () => ({ checkout_url: 'https://test.com/pay' }) }),
        contact({ handler: async () => {} }),
      ],
      rateLimit: 100,
      sessionTtl: 3600,
    });
    return door.middleware();
  }

  it('serves agents.txt', () => {
    const mw = createDoor();
    const req = mockReq('GET', '/.well-known/agents.txt');
    const res = mockRes();
    const next = jest.fn();

    mw(req, res, next);

    expect(res._headers['content-type']).toBe('text/plain');
    expect(res._body).toContain('Site: Test');
    expect(next).not.toHaveBeenCalled();
  });

  it('serves agents.json', () => {
    const mw = createDoor();
    const req = mockReq('GET', '/.well-known/agents.json');
    const res = mockRes();
    const next = jest.fn();

    mw(req, res, next);

    expect(res._body).toBeDefined();
    expect(res._body.schema_version).toBe('1.0');
    expect(res._body.site.name).toBe('Test');
    expect(res._body.capabilities.length).toBeGreaterThan(0);
  });

  it('creates a session', () => {
    const mw = createDoor();
    const req = mockReq('POST', '/.well-known/agents/api/session');
    const res = mockRes();
    const next = jest.fn();

    mw(req, res, next);

    expect(res._body.ok).toBe(true);
    expect(res._body.data.session_token).toBeDefined();
    expect(res._body.data.expires_at).toBeDefined();
    expect(res._body.data.capabilities).toBeInstanceOf(Array);
  });

  it('handles search', async () => {
    const mw = createDoor();
    const req = mockReq('GET', '/.well-known/agents/api/search', { query: { q: 'mug' } });
    const res = mockRes();
    const next = jest.fn();

    mw(req, res, next);
    // Wait for async handler
    await new Promise(r => setTimeout(r, 50));

    expect(res._body.ok).toBe(true);
    expect(res._body.data[0].name).toContain('mug');
  });

  it('rejects session-required endpoints without token', async () => {
    const mw = createDoor();
    const req = mockReq('POST', '/.well-known/agents/api/cart/add', { body: { item_id: '1', quantity: 1 } });
    const res = mockRes();
    const next = jest.fn();

    mw(req, res, next);
    await new Promise(r => setTimeout(r, 50));

    expect(res._status).toBe(401);
    expect(res._body.ok).toBe(false);
  });

  it('full flow: session → cart → checkout', async () => {
    const mw = createDoor();

    // Create session
    const sessionReq = mockReq('POST', '/.well-known/agents/api/session');
    const sessionRes = mockRes();
    mw(sessionReq, sessionRes, jest.fn());
    const token = sessionRes._body.data.session_token;

    // Add to cart
    const addReq = mockReq('POST', '/.well-known/agents/api/cart/add', {
      body: { item_id: '1', quantity: 2, name: 'Blue Mug', price: 28 },
      headers: { authorization: `Bearer ${token}` },
    });
    const addRes = mockRes();
    mw(addReq, addRes, jest.fn());
    await new Promise(r => setTimeout(r, 50));
    expect(addRes._body.ok).toBe(true);
    expect(addRes._body.data.cart_size).toBe(1);

    // View cart
    const viewReq = mockReq('GET', '/.well-known/agents/api/cart/view', {
      headers: { authorization: `Bearer ${token}` },
    });
    const viewRes = mockRes();
    mw(viewReq, viewRes, jest.fn());
    await new Promise(r => setTimeout(r, 50));
    expect(viewRes._body.ok).toBe(true);
    expect(viewRes._body.data.items).toHaveLength(1);
    expect(viewRes._body.data.subtotal).toBe(56);

    // Checkout
    const checkoutReq = mockReq('POST', '/.well-known/agents/api/checkout', {
      headers: { authorization: `Bearer ${token}` },
    });
    const checkoutRes = mockRes();
    mw(checkoutReq, checkoutRes, jest.fn());
    await new Promise(r => setTimeout(r, 50));
    expect(checkoutRes._body.ok).toBe(true);
    expect(checkoutRes._body.data.checkout_url).toContain('https://test.com/pay');
    expect(checkoutRes._body.data.human_handoff).toBe(true);
  });

  it('passes to next() for unmatched routes', () => {
    const mw = createDoor();
    const req = mockReq('GET', '/some/other/path');
    const res = mockRes();
    const next = jest.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('handles detail with route params', async () => {
    const mw = createDoor();
    const req = mockReq('GET', '/.well-known/agents/api/detail/42');
    const res = mockRes();
    const next = jest.fn();

    mw(req, res, next);
    await new Promise(r => setTimeout(r, 50));

    expect(res._body.ok).toBe(true);
    expect(res._body.data.id).toBe('42');
  });

  it('deletes a session', () => {
    const mw = createDoor();

    // Create session
    const createReq = mockReq('POST', '/.well-known/agents/api/session');
    const createRes = mockRes();
    mw(createReq, createRes, jest.fn());
    const token = createRes._body.data.session_token;

    // Delete session
    const deleteReq = mockReq('DELETE', '/.well-known/agents/api/session', {
      headers: { authorization: `Bearer ${token}` },
    });
    const deleteRes = mockRes();
    mw(deleteReq, deleteRes, jest.fn());
    expect(deleteRes._body.ok).toBe(true);
  });
});
