import { AgentClient } from '../src/client';
import { AgentClientError } from '../src/http';
import { SITE_URL, API, MANIFEST, SESSION, manifestFetch, mockFetch } from './helpers';

describe('AgentClient', () => {
  describe('discover', () => {
    it('fetches and returns the manifest', async () => {
      const client = new AgentClient(SITE_URL, { fetch: manifestFetch() });
      const manifest = await client.discover();
      expect(manifest.site.name).toBe('Test Store');
    });

    it('caches the manifest (only one fetch)', async () => {
      let calls = 0;
      const fetchImpl = manifestFetch({ 'agents.json': () => { calls++; return MANIFEST; } });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl });
      await client.discover();
      await client.discover();
      expect(calls).toBe(1);
    });

    it('supports() returns true for known capabilities', async () => {
      const client = new AgentClient(SITE_URL, { fetch: manifestFetch() });
      await client.discover();
      expect(client.supports('search')).toBe(true);
      expect(client.supports('cart.add')).toBe(true);
      expect(client.supports('teleport')).toBe(false);
    });
  });

  describe('connect / disconnect', () => {
    it('creates a session on connect()', async () => {
      const client = new AgentClient(SITE_URL, { fetch: manifestFetch() });
      const session = await client.connect();
      expect(session.session_token).toBe('test-token-abc123');
      expect(session.capabilities).toContain('search');
    });

    it('disconnects and clears the session', async () => {
      const client = new AgentClient(SITE_URL, { fetch: manifestFetch() });
      await client.connect();
      await client.disconnect();
      // After disconnect, session-required calls should fail
      await expect(client.cartView()).rejects.toThrow('requires a session');
    });

    it('disconnect is a no-op when not connected', async () => {
      const client = new AgentClient(SITE_URL, { fetch: manifestFetch() });
      await expect(client.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('search', () => {
    it('calls the search endpoint with q param', async () => {
      let capturedUrl = '';
      const fetchImpl = manifestFetch({
        '/search': (url) => { capturedUrl = url; return { ok: true, data: [{ id: '1', name: 'Mug' }] }; },
      });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl });
      const results = await client.search('mug');
      expect(results).toHaveLength(1);
      expect((results[0] as { name: string }).name).toBe('Mug');
      expect(capturedUrl).toContain('q=mug');
    });

    it('passes limit option', async () => {
      let capturedUrl = '';
      const fetchImpl = manifestFetch({
        '/search': (url) => { capturedUrl = url; return { ok: true, data: [] }; },
      });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl });
      await client.search('bowl', { limit: 5 });
      expect(capturedUrl).toContain('limit=5');
    });

    it('throws AgentClientError for unsupported capability', async () => {
      const fetchImpl = mockFetch({ 'agents.json': () => ({ ...MANIFEST, capabilities: [] }) });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl });
      await expect(client.search('x')).rejects.toThrow(AgentClientError);
    });
  });

  describe('browse', () => {
    it('calls the browse endpoint', async () => {
      const fetchImpl = manifestFetch({
        '/browse': () => ({ ok: true, data: { items: [{ id: '2' }], total: 5 } }),
      });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl });
      const result = await client.browse({ page: 1, limit: 10 });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(5);
    });
  });

  describe('detail', () => {
    it('substitutes :id in the endpoint URL', async () => {
      let capturedUrl = '';
      const fetchImpl = manifestFetch({
        '/detail/': (url) => { capturedUrl = url; return { ok: true, data: { id: '42', name: 'Vase' } }; },
      });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl });
      const item = await client.detail('42');
      expect((item as { id: string }).id).toBe('42');
      expect(capturedUrl).toContain('/detail/42');
    });
  });

  describe('cart operations', () => {
    it('throws when calling cart without a session', async () => {
      const client = new AgentClient(SITE_URL, { fetch: manifestFetch() });
      await expect(client.cartAdd('1', 2)).rejects.toThrow('requires a session');
      await expect(client.cartView()).rejects.toThrow('requires a session');
    });

    it('adds to cart with a session', async () => {
      const fetchImpl = manifestFetch({
        '/cart/add': () => ({ ok: true, data: { item_id: '1', quantity: 2, cart_size: 1 } }),
      });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl });
      await client.connect();
      const result = await client.cartAdd('1', 2, { name: 'Blue Mug', price: 28 });
      expect(result.cart_size).toBe(1);
    });

    it('views cart', async () => {
      const fetchImpl = manifestFetch({
        '/cart/view': () => ({ ok: true, data: { items: [{ itemId: '1', quantity: 2 }], subtotal: 56 } }),
      });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl });
      await client.connect();
      const cart = await client.cartView();
      expect(cart.subtotal).toBe(56);
      expect(cart.items).toHaveLength(1);
    });

    it('updates cart item', async () => {
      const fetchImpl = manifestFetch({
        '/cart/update': () => ({ ok: true, data: { item_id: '1', quantity: 5 } }),
      });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl });
      await client.connect();
      const result = await client.cartUpdate('1', 5);
      expect(result.quantity).toBe(5);
    });

    it('removes cart item', async () => {
      const fetchImpl = manifestFetch({
        '/cart/remove': () => ({ ok: true, data: { item_id: '1', removed: true } }),
      });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl });
      await client.connect();
      const result = await client.cartRemove('1');
      expect(result.removed).toBe(true);
    });
  });

  describe('checkout', () => {
    it('returns checkout URL for human handoff', async () => {
      const fetchImpl = manifestFetch({
        '/checkout': () => ({ ok: true, data: { checkout_url: 'https://test.com/pay/xyz', human_handoff: true } }),
      });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl });
      await client.connect();
      const result = await client.checkout();
      expect(result.checkout_url).toContain('https://test.com/pay');
      expect(result.human_handoff).toBe(true);
    });

    it('throws when called without a session', async () => {
      const client = new AgentClient(SITE_URL, { fetch: manifestFetch() });
      await expect(client.checkout()).rejects.toThrow('requires a session');
    });
  });

  describe('contact', () => {
    it('sends a contact message', async () => {
      const fetchImpl = manifestFetch({
        '/contact': () => ({ ok: true, data: { sent: true } }),
      });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl });
      const result = await client.contact('Alice', 'alice@example.com', 'Hello!');
      expect(result.sent).toBe(true);
    });
  });

  describe('call (generic)', () => {
    it('calls any capability by name', async () => {
      const fetchImpl = manifestFetch({
        '/search': () => ({ ok: true, data: [{ id: '1' }] }),
      });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl });
      const result = await client.call('search', { q: 'test' });
      expect(result).toHaveLength(1);
    });

    it('throws for unknown capability names', async () => {
      const client = new AgentClient(SITE_URL, { fetch: manifestFetch() });
      await expect(client.call('teleport')).rejects.toThrow(AgentClientError);
    });
  });

  describe('getAuditArtifact', () => {
    it('fetches audit artifact for the current session', async () => {
      const artifact = { run_id: 'abc', events: [], runtime_signature: 'sig' };
      const fetchImpl = manifestFetch({
        '/audit/': () => ({ ok: true, data: artifact }),
      });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl });
      await client.connect();
      const result = await client.getAuditArtifact();
      expect((result as { run_id: string }).run_id).toBe('abc');
    });

    it('throws when no session is active', async () => {
      const client = new AgentClient(SITE_URL, { fetch: manifestFetch() });
      await expect(client.getAuditArtifact()).rejects.toThrow('No active session');
    });
  });

  describe('Authorization header', () => {
    it('sends Bearer token when session is active', async () => {
      let capturedHeaders: Record<string, string> = {};
      const fetchImpl = manifestFetch({
        '/search': (_url, init) => {
          capturedHeaders = Object.fromEntries(
            Object.entries((init?.headers as Record<string, string>) ?? {})
          );
          return { ok: true, data: [] };
        },
      });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl });
      await client.connect();
      await client.search('test');
      expect(capturedHeaders['Authorization']).toBe(`Bearer ${SESSION.session_token}`);
    });
  });

  describe('flows', () => {
    it('returns flows from the manifest', async () => {
      const client = new AgentClient(SITE_URL, { fetch: manifestFetch() });
      const flows = await client.flows();
      expect(flows).toHaveLength(1);
      expect(flows[0].name).toBe('purchase');
      expect(flows[0].steps).toEqual(['search', 'detail', 'cart.add', 'checkout']);
    });

    it('returns empty array when manifest has no flows', async () => {
      const fetchImpl = mockFetch({ 'agents.json': () => ({ ...MANIFEST, flows: undefined }) });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl });
      const flows = await client.flows();
      expect(flows).toEqual([]);
    });
  });

  describe('paginate', () => {
    it('yields pages until total is reached', async () => {
      let page = 0;
      const fetchImpl = manifestFetch({
        '/browse': () => {
          page++;
          if (page === 1) return { ok: true, data: { items: [{ id: '1' }, { id: '2' }], total: 5 } };
          if (page === 2) return { ok: true, data: { items: [{ id: '3' }, { id: '4' }], total: 5 } };
          return { ok: true, data: { items: [{ id: '5' }], total: 5 } };
        },
      });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl, pageSize: 2 });
      const allItems: any[] = [];
      for await (const items of client.paginate('browse')) {
        allItems.push(...items);
      }
      expect(allItems).toHaveLength(5);
      expect(allItems.map(i => i.id)).toEqual(['1', '2', '3', '4', '5']);
    });

    it('stops when items array is empty', async () => {
      const fetchImpl = manifestFetch({
        '/browse': () => ({ ok: true, data: { items: [], total: 0 } }),
      });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl });
      const pages: any[][] = [];
      for await (const items of client.paginate('browse')) {
        pages.push(items);
      }
      expect(pages).toHaveLength(0);
    });

    it('auto-creates session for session-required capabilities', async () => {
      let sessionCreated = false;
      const fetchImpl = manifestFetch({
        '/session': (_url, init) => {
          if ((init?.method ?? 'GET') === 'POST') sessionCreated = true;
          return { ok: true, data: SESSION };
        },
        '/cart/view': () => ({ ok: true, data: { items: [{ id: '1', quantity: 1 }], total: 1 } }),
      });
      const client = new AgentClient(SITE_URL, { fetch: fetchImpl });
      // cart.view requires session — paginate should auto-connect
      for await (const _items of client.paginate('cart.view')) { break; }
      expect(sessionCreated).toBe(true);
    });
  });

  describe('retry on 429', () => {
    function buildFetchWithRateLimit(succeedAfterAttempts: number, counter: { n: number }): typeof fetch {
      return async (input: any, init?: any): Promise<Response> => {
        const url = input.toString();
        if (url.includes('agents.json')) {
          return new Response(JSON.stringify(MANIFEST), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/search')) {
          counter.n++;
          if (counter.n < succeedAfterAttempts) {
            return new Response(JSON.stringify({ ok: false, error: 'Rate limit exceeded' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
          }
          return new Response(JSON.stringify({ ok: true, data: [{ id: '1' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ ok: false, error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      };
    }

    it('retries and succeeds after rate limit clears', async () => {
      const counter = { n: 0 };
      const client = new AgentClient(SITE_URL, {
        fetch: buildFetchWithRateLimit(3, counter),
        maxRetries: 3,
        retryDelay: 0,
      });
      const results = await client.call('search', { q: 'test' });
      expect(results).toHaveLength(1);
      expect(counter.n).toBe(3);
    });

    it('throws AgentClientError after exhausting retries', async () => {
      const counter = { n: 0 };
      const client = new AgentClient(SITE_URL, {
        fetch: buildFetchWithRateLimit(999, counter), // never succeeds
        maxRetries: 2,
        retryDelay: 0,
      });
      await expect(client.call('search', { q: 'x' })).rejects.toThrow(AgentClientError);
    });
  });
});
