import { AgentDoor } from '../src/server';
import { search, browse, detail, cart, checkout, contact } from '../src/capabilities';
import { mockReq, mockRes } from './helpers';

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
      flows: [
        { name: 'purchase', description: 'Find and buy a product', steps: ['search', 'detail', 'cart.add', 'checkout'] },
      ],
      rateLimit: 100,
      sessionTtl: 3600,
    });
    return door.middleware();
  }

  it('serves agents.txt', async () => {
    const mw = createDoor();
    const req = mockReq('GET', '/.well-known/agents.txt');
    const res = mockRes();
    await mw(req, res, jest.fn());

    expect(res._headers['content-type']).toBe('text/plain');
    expect(res._body).toContain('Name: Test');
  });

  it('serves agents.json', async () => {
    const mw = createDoor();
    const req = mockReq('GET', '/.well-known/agents.json');
    const res = mockRes();
    await mw(req, res, jest.fn());

    expect(res._body.schema_version).toBe('1.0');
    expect(res._body.site.name).toBe('Test');
    expect(res._body.capabilities.length).toBeGreaterThan(0);
  });

  it('includes flows in agents.json', async () => {
    const mw = createDoor();
    const req = mockReq('GET', '/.well-known/agents.json');
    const res = mockRes();
    await mw(req, res, jest.fn());

    expect(res._body.flows).toBeDefined();
    expect(res._body.flows[0].name).toBe('purchase');
    expect(res._body.flows[0].steps).toEqual(['search', 'detail', 'cart.add', 'checkout']);
  });

  it('includes flows in agents.txt', async () => {
    const mw = createDoor();
    const req = mockReq('GET', '/.well-known/agents.txt');
    const res = mockRes();
    await mw(req, res, jest.fn());

    expect(res._body).toContain('Flow: purchase');
    expect(res._body).toContain('search, detail, cart.add, checkout');
  });

  it('sets Link header on agent routes', async () => {
    const mw = createDoor();
    const req = mockReq('GET', '/.well-known/agents.json');
    const res = mockRes();
    await mw(req, res, jest.fn());

    expect(res._headers['link']).toContain('agents.json');
    expect(res._headers['link']).toContain('rel="agents"');
  });

  it('sets Link header and calls next() for unmatched routes', async () => {
    const mw = createDoor();
    const req = mockReq('GET', '/some/other/path');
    const res = mockRes();
    const next = jest.fn();
    await mw(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res._headers['link']).toContain('agents.json');
  });

  it('creates a session', async () => {
    const mw = createDoor();
    const req = mockReq('POST', '/.well-known/agents/api/session');
    const res = mockRes();
    await mw(req, res, jest.fn());

    expect(res._body.ok).toBe(true);
    expect(res._body.data.session_token).toBeDefined();
    expect(res._body.data.expires_at).toBeDefined();
    expect(res._body.data.capabilities).toBeInstanceOf(Array);
  });

  it('handles search', async () => {
    const mw = createDoor();
    const req = mockReq('GET', '/.well-known/agents/api/search', { query: { q: 'mug' } });
    const res = mockRes();
    await mw(req, res, jest.fn());

    expect(res._body.ok).toBe(true);
    expect(res._body.data[0].name).toContain('mug');
  });

  it('rejects session-required endpoints without token', async () => {
    const mw = createDoor();
    const req = mockReq('POST', '/.well-known/agents/api/cart/add', { body: { item_id: '1', quantity: 1 } });
    const res = mockRes();
    await mw(req, res, jest.fn());

    expect(res._status).toBe(401);
    expect(res._body.ok).toBe(false);
  });

  it('full flow: session → cart → checkout', async () => {
    const mw = createDoor();

    // Create session
    const sessionReq = mockReq('POST', '/.well-known/agents/api/session');
    const sessionRes = mockRes();
    await mw(sessionReq, sessionRes, jest.fn());
    const token = sessionRes._body.data.session_token;

    // Add to cart
    const addReq = mockReq('POST', '/.well-known/agents/api/cart/add', {
      body: { item_id: '1', quantity: 2, name: 'Blue Mug', price: 2800 },
      headers: { authorization: `Bearer ${token}` },
    });
    const addRes = mockRes();
    await mw(addReq, addRes, jest.fn());
    expect(addRes._body.ok).toBe(true);
    expect(addRes._body.data.cart_size).toBe(1);

    // View cart
    const viewReq = mockReq('GET', '/.well-known/agents/api/cart/view', {
      headers: { authorization: `Bearer ${token}` },
    });
    const viewRes = mockRes();
    await mw(viewReq, viewRes, jest.fn());
    expect(viewRes._body.ok).toBe(true);
    expect(viewRes._body.data.items).toHaveLength(1);
    expect(viewRes._body.data.subtotal_cents).toBe(5600);

    // Checkout
    const checkoutReq = mockReq('POST', '/.well-known/agents/api/checkout', {
      headers: { authorization: `Bearer ${token}` },
    });
    const checkoutRes = mockRes();
    await mw(checkoutReq, checkoutRes, jest.fn());
    expect(checkoutRes._body.ok).toBe(true);
    expect(checkoutRes._body.data.handoff_url).toContain('https://test.com/pay');
    expect(checkoutRes._body.data.expires_at).toBeDefined();
    expect(checkoutRes._body.data.message).toBeDefined();
  });

  it('handles detail with route params', async () => {
    const mw = createDoor();
    const req = mockReq('GET', '/.well-known/agents/api/detail/42');
    const res = mockRes();
    await mw(req, res, jest.fn());

    expect(res._body.ok).toBe(true);
    expect(res._body.data.id).toBe('42');
  });

  it('deletes a session', async () => {
    const mw = createDoor();
    const createReq = mockReq('POST', '/.well-known/agents/api/session');
    const createRes = mockRes();
    await mw(createReq, createRes, jest.fn());
    const token = createRes._body.data.session_token;

    const deleteReq = mockReq('DELETE', '/.well-known/agents/api/session', {
      headers: { authorization: `Bearer ${token}` },
    });
    const deleteRes = mockRes();
    await mw(deleteReq, deleteRes, jest.fn());
    expect(deleteRes._body.ok).toBe(true);
  });
});

describe('AgentDoor.fromOpenAPI', () => {
  it('creates capabilities from an OpenAPI spec', async () => {
    const spec = {
      info: { title: 'Pet Store', description: 'A pet store API' },
      servers: [{ url: 'https://pets.example.com' }],
      paths: {
        '/pets': {
          get: {
            operationId: 'listPets',
            summary: 'List all pets',
            parameters: [
              { name: 'limit', in: 'query' as const, schema: { type: 'integer', default: 20 } },
            ],
          },
          post: {
            operationId: 'createPet',
            summary: 'Create a pet',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    properties: { name: { type: 'string' }, species: { type: 'string' } },
                    required: ['name'],
                  },
                },
              },
            },
          },
        },
        '/pets/{id}': {
          get: {
            operationId: 'getPet',
            summary: 'Get a pet by ID',
            parameters: [
              { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } },
            ],
          },
        },
      },
    };

    const door = AgentDoor.fromOpenAPI(spec, 'https://pets.example.com');
    const agentsJson = door['agentsJson'] as any;

    expect(agentsJson.site.name).toBe('Pet Store');
    expect(agentsJson.capabilities).toHaveLength(3);

    const listPets = agentsJson.capabilities.find((c: any) => c.name === 'list_pets');
    expect(listPets).toBeDefined();
    expect(listPets.method).toBe('GET');
    expect(listPets.params?.limit).toBeDefined();

    const createPet = agentsJson.capabilities.find((c: any) => c.name === 'create_pet');
    expect(createPet).toBeDefined();
    expect(createPet.method).toBe('POST');
    expect(createPet.params?.name.required).toBe(true);

    door.destroy();
  });
});
