import { generateAgentsJson } from '../src/agents-json';
import { AgentDoorConfig, CapabilityDefinition } from '../src/types';

function makeConfig(overrides?: Partial<AgentDoorConfig>): AgentDoorConfig {
  return {
    site: { name: 'Test Store', url: 'https://test.com', description: 'A test store' },
    capabilities: [
      { name: 'search', description: 'Search items', method: 'GET', params: { q: { type: 'string', required: true } }, handler: async () => [] },
    ],
    ...overrides,
  };
}

describe('generateAgentsJson', () => {
  it('returns correct schema version', () => {
    const json = generateAgentsJson(makeConfig()) as any;
    expect(json.schema_version).toBe('1.0');
  });

  it('includes site metadata', () => {
    const json = generateAgentsJson(makeConfig()) as any;
    expect(json.site.name).toBe('Test Store');
    expect(json.site.url).toBe('https://test.com');
    expect(json.site.description).toBe('A test store');
  });

  it('maps capabilities to endpoints', () => {
    const json = generateAgentsJson(makeConfig()) as any;
    expect(json.capabilities).toHaveLength(1);
    expect(json.capabilities[0].name).toBe('search');
    expect(json.capabilities[0].endpoint).toBe('/.well-known/agents/api/search');
    expect(json.capabilities[0].method).toBe('GET');
  });

  it('maps dotted capability names to nested paths', () => {
    const caps: CapabilityDefinition[] = [
      { name: 'cart.add', description: 'Add to cart', method: 'POST', requiresSession: true, handler: async () => {} },
      { name: 'cart.view', description: 'View cart', method: 'GET', requiresSession: true, handler: async () => {} },
    ];
    const json = generateAgentsJson(makeConfig({ capabilities: caps })) as any;
    expect(json.capabilities[0].endpoint).toBe('/.well-known/agents/api/cart/add');
    expect(json.capabilities[1].endpoint).toBe('/.well-known/agents/api/cart/view');
  });

  it('marks session-required capabilities', () => {
    const caps: CapabilityDefinition[] = [
      { name: 'cart.add', description: 'Add', method: 'POST', requiresSession: true, handler: async () => {} },
    ];
    const json = generateAgentsJson(makeConfig({ capabilities: caps })) as any;
    expect(json.capabilities[0].requires_session).toBe(true);
  });

  it('marks human handoff capabilities', () => {
    const caps: CapabilityDefinition[] = [
      { name: 'checkout', description: 'Checkout', method: 'POST', requiresSession: true, humanHandoff: true, handler: async () => {} },
    ];
    const json = generateAgentsJson(makeConfig({ capabilities: caps })) as any;
    expect(json.capabilities[0].human_handoff).toBe(true);
  });

  it('includes session endpoint', () => {
    const json = generateAgentsJson(makeConfig()) as any;
    expect(json.session.create).toBe('/.well-known/agents/api/session');
  });

  it('includes rate limit when configured', () => {
    const json = generateAgentsJson(makeConfig({ rateLimit: 100 })) as any;
    expect(json.rate_limit.requests_per_minute).toBe(100);
  });

  it('omits rate_limit when not configured', () => {
    const json = generateAgentsJson(makeConfig()) as any;
    expect(json.rate_limit).toBeUndefined();
  });

  it('maps detail capability to :id route', () => {
    const caps: CapabilityDefinition[] = [
      { name: 'detail', description: 'Get detail', method: 'GET', params: { id: { type: 'string', required: true } }, handler: async () => {} },
    ];
    const json = generateAgentsJson(makeConfig({ capabilities: caps })) as any;
    expect(json.capabilities[0].endpoint).toBe('/.well-known/agents/api/detail/:id');
  });
});
