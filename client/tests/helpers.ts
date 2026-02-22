import { AgentsManifest } from '../src/types';

export const SITE_URL = 'https://test-store.example';
export const BASE = `${SITE_URL}/.well-known`;
export const API = `${BASE}/agents/api`;

export const MANIFEST: AgentsManifest = {
  schema_version: '1.0',
  site: { name: 'Test Store', url: SITE_URL, description: 'A test store' },
  capabilities: [
    { name: 'search', description: 'Search items', method: 'GET', endpoint: `${API}/search`, params: { q: { type: 'string', required: true } } },
    { name: 'browse', description: 'Browse items', method: 'GET', endpoint: `${API}/browse` },
    { name: 'detail', description: 'Item detail', method: 'GET', endpoint: `${API}/detail/:id` },
    { name: 'cart.add', description: 'Add to cart', method: 'POST', endpoint: `${API}/cart/add`, requires_session: true },
    { name: 'cart.view', description: 'View cart', method: 'GET', endpoint: `${API}/cart/view`, requires_session: true },
    { name: 'cart.update', description: 'Update cart', method: 'PUT', endpoint: `${API}/cart/update`, requires_session: true },
    { name: 'cart.remove', description: 'Remove from cart', method: 'DELETE', endpoint: `${API}/cart/remove`, requires_session: true },
    { name: 'checkout', description: 'Checkout', method: 'POST', endpoint: `${API}/checkout`, requires_session: true, human_handoff: true },
    { name: 'contact', description: 'Contact', method: 'POST', endpoint: `${API}/contact` },
  ],
  session: { create: `${API}/session`, ttl_seconds: 3600 },
  rate_limit: { requests_per_minute: 60 },
  audit: { enabled: true, endpoint: `${API}/audit/:session_id` },
};

export const SESSION = {
  session_token: 'test-token-abc123',
  expires_at: new Date(Date.now() + 3600000).toISOString(),
  capabilities: ['search', 'browse', 'cart.add', 'cart.view', 'cart.update', 'cart.remove', 'checkout', 'contact'],
  audit: true,
};

/** Build a mock fetch that maps URL prefixes to response factories */
export function mockFetch(routes: Record<string, (url: string, init?: RequestInit) => any>): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    for (const [prefix, handler] of Object.entries(routes)) {
      if (url.includes(prefix)) {
        const body = handler(url, init);
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ ok: false, error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

export function manifestFetch(extra?: Record<string, (url: string, init?: RequestInit) => any>): typeof fetch {
  return mockFetch({
    'agents.json': () => MANIFEST,
    '/session': (_url, init) => {
      if (init?.method === 'DELETE') return { ok: true, data: { ended: true } };
      return { ok: true, data: SESSION };
    },
    ...extra,
  });
}
