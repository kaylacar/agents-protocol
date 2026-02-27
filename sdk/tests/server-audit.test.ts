import { AgentDoor } from '../src/server';
import { search, cart, checkout } from '../src/capabilities';
import { mockReq, mockRes } from './helpers';

// Skip the entire suite when @rer packages are not available
let hasRer = false;
try {
  require('@rer/core');
  require('@rer/runtime');
  hasRer = true;
} catch { /* not installed */ }

const describeIfRer = hasRer ? describe : describe.skip;

describeIfRer('AgentDoor with audit: true', () => {
  let door: AgentDoor;

  afterEach(() => {
    door?.destroy();
  });

  function createDoor() {
    door = new AgentDoor({
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
    return door.middleware();
  }

  it('session creation response includes audit: true', async () => {
    const mw = createDoor();
    const req = mockReq('POST', '/.well-known/agents/api/session');
    const res = mockRes();
    await mw(req, res, jest.fn());

    expect(res._body.ok).toBe(true);
    expect(res._body.data.audit).toBe(true);
  });

  it('full audit flow: session → search → end → retrieve artifact', async () => {
    const mw = createDoor();

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

  it('audit endpoint returns 404 for unknown session', async () => {
    const mw = createDoor();
    const req = mockReq('GET', '/.well-known/agents/api/audit/nonexistent');
    const res = mockRes();
    await mw(req, res, jest.fn());

    expect(res._status).toBe(404);
    expect(res._body.ok).toBe(false);
  });

  it('CORS headers are set on responses', async () => {
    const mw = createDoor();
    const req = mockReq('GET', '/.well-known/agents.txt');
    const res = mockRes();
    await mw(req, res, jest.fn());

    expect(res._headers['access-control-allow-origin']).toBe('*');
    expect(res._headers['access-control-allow-methods']).toContain('GET');
    expect(res._headers['access-control-allow-headers']).toContain('Authorization');
  });

  it('OPTIONS requests get 204 (CORS preflight)', async () => {
    const mw = createDoor();
    const req = mockReq('OPTIONS', '/.well-known/agents/api/search');
    const res = mockRes();
    await mw(req, res, jest.fn());

    expect(res._status).toBe(204);
  });

  it('cart operations are logged in the audit trail', async () => {
    const mw = createDoor();

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
