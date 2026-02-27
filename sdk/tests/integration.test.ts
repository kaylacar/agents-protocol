/**
 * Integration test — uses the AgentDoor Fetch handler as a mock server
 * and exercises the full discovery → session → capability flow.
 */
import { AgentDoor } from '../src/server';
import { search, browse, detail, cart, checkout, contact } from '../src/capabilities';

function createTestDoor(): AgentDoor {
  return new AgentDoor({
    site: { name: 'Integration Test', url: 'https://int-test.example' },
    capabilities: [
      search({ handler: async (q) => [{ id: '1', name: `Result for ${q}` }] }),
      browse({ handler: async (opts) => ({ items: [{ id: '1' }], total: 1 }) }),
      detail({ handler: async (id) => ({ id, name: 'Widget' }) }),
      cart(),
      checkout({ onCheckout: async () => ({ checkout_url: 'https://int-test.example/pay/123' }) }),
      contact({ handler: async () => {} }),
    ],
    flows: [{ name: 'buy', description: 'Buy a product', steps: ['search', 'detail', 'cart.add', 'checkout'] }],
    rateLimit: 1000,
    sessionTtl: 3600,
  });
}

describe('Integration: Fetch handler end-to-end', () => {
  let door: AgentDoor;
  let handler: (req: Request) => Promise<Response>;

  beforeAll(() => {
    door = createTestDoor();
    handler = door.handler();
  });

  afterAll(() => door.destroy());

  async function json(res: Response): Promise<any> {
    return res.json();
  }

  it('serves agents.json with valid structure', async () => {
    const res = await handler(new Request('https://int-test.example/.well-known/agents.json'));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.schema_version).toBe('0.1.0');
    expect(body.site.name).toBe('Integration Test');
    expect(body.capabilities.length).toBeGreaterThan(0);
    expect(body.session.create).toBeDefined();
  });

  it('serves agents.txt as text/plain', async () => {
    const res = await handler(new Request('https://int-test.example/.well-known/agents.txt'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/plain');
    const text = await res.text();
    expect(text).toContain('Name: Integration Test');
    expect(text).toContain('Capabilities: search,');
  });

  it('full shopping flow: session → search → detail → cart → checkout', async () => {
    // Create session
    const sessionRes = await handler(new Request(
      'https://int-test.example/.well-known/agents/api/session',
      { method: 'POST' },
    ));
    const session = await json(sessionRes);
    expect(session.ok).toBe(true);
    const token = session.data.session_token;
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    // Search
    const searchRes = await handler(new Request(
      'https://int-test.example/.well-known/agents/api/search?q=widget',
    ));
    const searchData = await json(searchRes);
    expect(searchData.ok).toBe(true);
    expect(searchData.data[0].name).toContain('widget');

    // Detail
    const detailRes = await handler(new Request(
      'https://int-test.example/.well-known/agents/api/detail/42',
    ));
    const detailData = await json(detailRes);
    expect(detailData.ok).toBe(true);
    expect(detailData.data.id).toBe('42');

    // Add to cart
    const addRes = await handler(new Request(
      'https://int-test.example/.well-known/agents/api/cart/add',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Agent-Session': token },
        body: JSON.stringify({ item_id: '42', quantity: 2, name: 'Widget', price: 1500 }),
      },
    ));
    const addData = await json(addRes);
    expect(addData.ok).toBe(true);
    expect(addData.data.cart_size).toBe(1);

    // View cart
    const viewRes = await handler(new Request(
      'https://int-test.example/.well-known/agents/api/cart/view',
      { headers: { 'X-Agent-Session': token } },
    ));
    const viewData = await json(viewRes);
    expect(viewData.ok).toBe(true);
    expect(viewData.data.items).toHaveLength(1);
    expect(viewData.data.subtotal_cents).toBe(3000);

    // Checkout
    const checkoutRes = await handler(new Request(
      'https://int-test.example/.well-known/agents/api/checkout',
      {
        method: 'POST',
        headers: { 'X-Agent-Session': token },
      },
    ));
    const checkoutData = await json(checkoutRes);
    expect(checkoutData.ok).toBe(true);
    expect(checkoutData.data.handoff_url).toContain('pay/123');
    expect(checkoutData.data.expires_at).toBeDefined();
    expect(checkoutData.data.message).toBeDefined();

    // Delete session
    const deleteRes = await handler(new Request(
      'https://int-test.example/.well-known/agents/api/session',
      {
        method: 'DELETE',
        headers: { 'X-Agent-Session': token },
      },
    ));
    const deleteData = await json(deleteRes);
    expect(deleteData.ok).toBe(true);
  });

  it('CORS headers are set on every response', async () => {
    const res = await handler(new Request('https://int-test.example/.well-known/agents.json'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-Agent-Session');
    expect(res.headers.get('Link')).toContain('agents.json');
  });

  it('CORS preflight returns 204', async () => {
    const res = await handler(new Request('https://int-test.example/.well-known/agents/api/search', {
      method: 'OPTIONS',
    }));
    expect(res.status).toBe(204);
  });

  it('returns 404 for unmatched routes', async () => {
    const res = await handler(new Request('https://int-test.example/nonexistent'));
    expect(res.status).toBe(404);
  });

  it('returns 401 for session-gated endpoints without token', async () => {
    const res = await handler(new Request(
      'https://int-test.example/.well-known/agents/api/cart/view',
    ));
    const data = await json(res);
    expect(res.status).toBe(401);
    expect(data.ok).toBe(false);
  });

  it('contact flow with valid data', async () => {
    const res = await handler(new Request(
      'https://int-test.example/.well-known/agents/api/contact',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice', email: 'alice@example.com', message: 'Hello!' }),
      },
    ));
    const data = await json(res);
    expect(data.ok).toBe(true);
    expect(data.data.sent).toBe(true);
  });
});
