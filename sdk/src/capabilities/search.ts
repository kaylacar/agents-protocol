import { CapabilityDefinition } from '../types';

interface SearchOptions {
  handler: (query: string, options?: { limit?: number }) => Promise<unknown[]>;
}

export function search({ handler }: SearchOptions): CapabilityDefinition {
  return {
    name: 'search',
    description: 'Search for items or content',
    method: 'GET',
    params: {
      q: { type: 'string', required: true, description: 'Search query' },
      limit: { type: 'number', required: false, description: 'Max results to return' },
    },
    handler: async (req) => {
      const q = req.query.q;
      if (!q) throw new Error('Missing required parameter: q');
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
      return handler(q, { limit });
    },
  };
}
