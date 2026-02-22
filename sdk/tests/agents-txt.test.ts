import { generateAgentsTxt } from '../src/agents-txt';
import { AgentDoorConfig } from '../src/types';

function makeConfig(overrides?: Partial<AgentDoorConfig>): AgentDoorConfig {
  return {
    site: { name: 'Test Store', url: 'https://test.com', description: 'A test store', contact: 'hi@test.com' },
    capabilities: [
      { name: 'search', description: 'Search', method: 'GET', handler: async () => [] },
      { name: 'browse', description: 'Browse', method: 'GET', handler: async () => ({ items: [], total: 0 }) },
    ],
    ...overrides,
  };
}

describe('generateAgentsTxt', () => {
  it('includes site name and URL', () => {
    const txt = generateAgentsTxt(makeConfig());
    expect(txt).toContain('Site: Test Store');
    expect(txt).toContain('URL: https://test.com');
  });

  it('includes description and contact when provided', () => {
    const txt = generateAgentsTxt(makeConfig());
    expect(txt).toContain('Description: A test store');
    expect(txt).toContain('Contact: hi@test.com');
  });

  it('omits description and contact when not provided', () => {
    const txt = generateAgentsTxt(makeConfig({
      site: { name: 'Minimal', url: 'https://min.com' },
    }));
    expect(txt).not.toContain('Description:');
    expect(txt).not.toContain('Contact:');
  });

  it('lists all capabilities as Allow directives', () => {
    const txt = generateAgentsTxt(makeConfig());
    expect(txt).toContain('Allow: search');
    expect(txt).toContain('Allow: browse');
  });

  it('includes rate limit when configured', () => {
    const txt = generateAgentsTxt(makeConfig({ rateLimit: 120 }));
    expect(txt).toContain('Rate-Limit: 120/minute');
  });

  it('includes session TTL when configured', () => {
    const txt = generateAgentsTxt(makeConfig({ sessionTtl: 900 }));
    expect(txt).toContain('Session-TTL: 900s');
  });

  it('links to agents.json with site URL and base path', () => {
    const txt = generateAgentsTxt(makeConfig());
    expect(txt).toContain('Agents-JSON: https://test.com/.well-known/agents.json');
  });

  it('respects custom basePath', () => {
    const txt = generateAgentsTxt(makeConfig({ basePath: '/api' }));
    expect(txt).toContain('Agents-JSON: https://test.com/api/agents.json');
  });

  it('flattens nested capability arrays (from cart())', () => {
    const cartCaps = [
      { name: 'cart.add', description: 'Add', method: 'POST' as const, requiresSession: true, handler: async () => {} },
      { name: 'cart.view', description: 'View', method: 'GET' as const, requiresSession: true, handler: async () => {} },
    ];
    const txt = generateAgentsTxt(makeConfig({ capabilities: [cartCaps] as any }));
    expect(txt).toContain('Allow: cart.add');
    expect(txt).toContain('Allow: cart.view');
  });
});
