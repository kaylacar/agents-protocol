import { AgentDoor } from '../src/server';
import { search, browse, detail, cart, checkout, contact } from '../src/capabilities';
import { mockReq, mockRes } from './helpers';

describe('Input validation', () => {
  let door: AgentDoor;
  let mw: any;

  beforeAll(() => {
    door = new AgentDoor({
      site: { name: 'Test', url: 'https://test.com' },
      capabilities: [
        search({ handler: async (q) => [{ id: '1', name: q }] }),
        browse({ handler: async () => ({ items: [], total: 0 }) }),
        detail({ handler: async (id) => ({ id }) }),
        cart(),
        checkout({ onCheckout: async () => ({ checkout_url: 'https://test.com/pay' }) }),
        contact({ handler: async () => {} }),
      ],
      rateLimit: 1000,
      sessionTtl: 3600,
    });
    mw = door.middleware();
  });

  afterAll(() => door.destroy());

  // Helper to create a session and get a token
  async function getToken(): Promise<string> {
    const req = mockReq('POST', '/.well-known/agents/api/session');
    const res = mockRes();
    await mw(req, res, jest.fn());
    return res._body.data.session_token;
  }

  describe('cart quantity validation', () => {
    it('rejects negative quantity on cart.add', async () => {
      const token = await getToken();
      const req = mockReq('POST', '/.well-known/agents/api/cart/add', {
        body: { item_id: 'x', quantity: -1 },
        headers: { 'x-agent-session': token },
      });
      const res = mockRes();
      await mw(req, res, jest.fn());
      expect(res._status).toBe(400);
      expect(res._body.error).toContain('positive integer');
    });

    it('rejects zero quantity on cart.add', async () => {
      const token = await getToken();
      const req = mockReq('POST', '/.well-known/agents/api/cart/add', {
        body: { item_id: 'x', quantity: 0 },
        headers: { 'x-agent-session': token },
      });
      const res = mockRes();
      await mw(req, res, jest.fn());
      expect(res._status).toBe(400);
    });

    it('rejects fractional quantity on cart.add', async () => {
      const token = await getToken();
      const req = mockReq('POST', '/.well-known/agents/api/cart/add', {
        body: { item_id: 'x', quantity: 1.5 },
        headers: { 'x-agent-session': token },
      });
      const res = mockRes();
      await mw(req, res, jest.fn());
      expect(res._status).toBe(400);
    });

    it('rejects negative quantity on cart.update', async () => {
      const token = await getToken();
      // First add an item
      const addReq = mockReq('POST', '/.well-known/agents/api/cart/add', {
        body: { item_id: '1', quantity: 1 },
        headers: { 'x-agent-session': token },
      });
      await mw(addReq, mockRes(), jest.fn());
      // Then try to update with negative
      const req = mockReq('PATCH', '/.well-known/agents/api/cart/update', {
        body: { item_id: '1', quantity: -5 },
        headers: { 'x-agent-session': token },
      });
      const res = mockRes();
      await mw(req, res, jest.fn());
      expect(res._status).toBe(400);
      expect(res._body.error).toContain('non-negative integer');
    });
  });

  describe('search validation', () => {
    it('rejects missing query parameter', async () => {
      const req = mockReq('GET', '/.well-known/agents/api/search', { query: {} });
      const res = mockRes();
      await mw(req, res, jest.fn());
      expect(res._status).toBe(400);
    });

    it('rejects query exceeding max length', async () => {
      const longQuery = 'a'.repeat(501);
      const req = mockReq('GET', '/.well-known/agents/api/search', { query: { q: longQuery } });
      const res = mockRes();
      await mw(req, res, jest.fn());
      expect(res._status).toBe(400);
      expect(res._body.error).toContain('500 characters');
    });

    it('accepts query at max length', async () => {
      const maxQuery = 'a'.repeat(500);
      const req = mockReq('GET', '/.well-known/agents/api/search', { query: { q: maxQuery } });
      const res = mockRes();
      await mw(req, res, jest.fn());
      expect(res._status).toBe(200);
    });

    it('rejects out-of-range search limit', async () => {
      const req = mockReq('GET', '/.well-known/agents/api/search', { query: { q: 'test', limit: '200' } });
      const res = mockRes();
      await mw(req, res, jest.fn());
      expect(res._status).toBe(400);
      expect(res._body.error).toContain('between 1 and 100');
    });
  });

  describe('browse validation', () => {
    it('rejects page < 1', async () => {
      const req = mockReq('GET', '/.well-known/agents/api/browse', { query: { page: '0' } });
      const res = mockRes();
      await mw(req, res, jest.fn());
      expect(res._status).toBe(400);
      expect(res._body.error).toContain('positive number');
    });

    it('rejects limit > 100', async () => {
      const req = mockReq('GET', '/.well-known/agents/api/browse', { query: { limit: '101' } });
      const res = mockRes();
      await mw(req, res, jest.fn());
      expect(res._status).toBe(400);
      expect(res._body.error).toContain('between 1 and 100');
    });

    it('accepts valid page and limit', async () => {
      const req = mockReq('GET', '/.well-known/agents/api/browse', { query: { page: '1', limit: '50' } });
      const res = mockRes();
      await mw(req, res, jest.fn());
      expect(res._status).toBe(200);
    });
  });

  describe('contact validation', () => {
    it('rejects invalid email format', async () => {
      const req = mockReq('POST', '/.well-known/agents/api/contact', {
        body: { name: 'Test', email: 'not-an-email', message: 'Hello' },
      });
      const res = mockRes();
      await mw(req, res, jest.fn());
      expect(res._status).toBe(400);
      expect(res._body.error).toContain('Invalid email');
    });

    it('accepts valid email', async () => {
      const req = mockReq('POST', '/.well-known/agents/api/contact', {
        body: { name: 'Test', email: 'test@example.com', message: 'Hello' },
      });
      const res = mockRes();
      await mw(req, res, jest.fn());
      expect(res._status).toBe(201);
    });
  });

  describe('session header support', () => {
    it('accepts X-Agent-Session header', async () => {
      const token = await getToken();
      const req = mockReq('GET', '/.well-known/agents/api/cart/view', {
        headers: { 'x-agent-session': token },
      });
      const res = mockRes();
      await mw(req, res, jest.fn());
      expect(res._status).toBe(200);
    });

    it('accepts Authorization: Bearer header', async () => {
      const token = await getToken();
      const req = mockReq('GET', '/.well-known/agents/api/cart/view', {
        headers: { authorization: `Bearer ${token}` },
      });
      const res = mockRes();
      await mw(req, res, jest.fn());
      expect(res._status).toBe(200);
    });

    it('rejects empty Bearer token', async () => {
      const req = mockReq('GET', '/.well-known/agents/api/cart/view', {
        headers: { authorization: 'Bearer ' },
      });
      const res = mockRes();
      await mw(req, res, jest.fn());
      expect(res._status).toBe(401);
    });
  });

  describe('integer cents cart subtotal', () => {
    it('returns subtotal_cents instead of subtotal', async () => {
      const token = await getToken();
      // Add item with price in cents
      const addReq = mockReq('POST', '/.well-known/agents/api/cart/add', {
        body: { item_id: 'mug', quantity: 3, price: 999 },
        headers: { 'x-agent-session': token },
      });
      await mw(addReq, mockRes(), jest.fn());

      const viewReq = mockReq('GET', '/.well-known/agents/api/cart/view', {
        headers: { 'x-agent-session': token },
      });
      const viewRes = mockRes();
      await mw(viewReq, viewRes, jest.fn());
      expect(viewRes._body.data.subtotal_cents).toBe(2997);
      expect(viewRes._body.data.subtotal).toBeUndefined();
    });
  });
});

describe('trustProxy config', () => {
  it('ignores X-Forwarded-For when trustProxy is false', async () => {
    const door = new AgentDoor({
      site: { name: 'Test', url: 'https://test.com' },
      capabilities: [search({ handler: async () => [] })],
      trustProxy: false,
      rateLimit: 1000,
    });
    // The Fetch handler is easier to test for IP
    const handler = door.handler();
    const req = new Request('https://test.com/.well-known/agents/api/search?q=test', {
      headers: { 'X-Forwarded-For': '1.2.3.4' },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    door.destroy();
  });
});
