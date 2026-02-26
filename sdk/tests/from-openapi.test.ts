import { AgentDoor } from '../src/server';

describe('AgentDoor.fromOpenAPI — error paths', () => {
  it('generates fallback name when operationId is missing', () => {
    const door = AgentDoor.fromOpenAPI(
      {
        paths: {
          '/items': {
            get: { summary: 'List items' },
          },
        },
      },
      'https://api.test.com',
    );
    const json = door['agentsJson'] as any;
    expect(json.capabilities[0].name).toBe('get_items');
    door.destroy();
  });

  it('skips unsupported HTTP methods', () => {
    const door = AgentDoor.fromOpenAPI(
      {
        paths: {
          '/items': {
            options: { summary: 'CORS preflight' } as any,
            get: { operationId: 'list', summary: 'List' },
          },
        },
      },
      'https://api.test.com',
    );
    const json = door['agentsJson'] as any;
    expect(json.capabilities).toHaveLength(1);
    expect(json.capabilities[0].name).toBe('list');
    door.destroy();
  });

  it('extracts both query and body params', () => {
    const door = AgentDoor.fromOpenAPI(
      {
        paths: {
          '/search': {
            post: {
              operationId: 'search',
              summary: 'Search',
              parameters: [
                { name: 'q', in: 'query' as const, required: true, schema: { type: 'string' } },
              ],
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      properties: { filters: { type: 'object' } },
                      required: ['filters'],
                    },
                  },
                },
              },
            },
          },
        },
      },
      'https://api.test.com',
    );
    const json = door['agentsJson'] as any;
    const searchCap = json.capabilities[0];
    expect(searchCap.params.q).toBeDefined();
    expect(searchCap.params.q.required).toBe(true);
    expect(searchCap.params.filters).toBeDefined();
    expect(searchCap.params.filters.required).toBe(true);
    door.destroy();
  });

  it('uses server URL from spec as site URL', () => {
    const door = AgentDoor.fromOpenAPI(
      {
        info: { title: 'My API' },
        servers: [{ url: 'https://custom.server.com' }],
        paths: {
          '/test': { get: { operationId: 'test', summary: 'Test' } },
        },
      },
      'https://fallback.test.com',
    );
    const json = door['agentsJson'] as any;
    expect(json.site.url).toBe('https://custom.server.com');
    door.destroy();
  });

  it('allows config overrides', () => {
    const door = AgentDoor.fromOpenAPI(
      {
        paths: {
          '/test': { get: { operationId: 'test', summary: 'Test' } },
        },
      },
      'https://api.test.com',
      { rateLimit: 42, audit: true, corsOrigin: 'https://mysite.com' },
    );
    const json = door['agentsJson'] as any;
    expect(json.rate_limit.requests_per_minute).toBe(42);
    expect(json.audit.enabled).toBe(true);
    door.destroy();
  });

  it('handles spec with no parameters or request body', () => {
    const door = AgentDoor.fromOpenAPI(
      {
        paths: {
          '/health': { get: { operationId: 'health', summary: 'Health check' } },
        },
      },
      'https://api.test.com',
    );
    const json = door['agentsJson'] as any;
    expect(json.capabilities[0].params).toBeUndefined();
    door.destroy();
  });
});
