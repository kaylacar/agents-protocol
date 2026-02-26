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
      if (q.length > 500) throw new Error('Search query exceeds maximum length of 500 characters');
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
      if (limit !== undefined && (isNaN(limit) || limit < 1 || limit > 100)) throw new Error('limit must be between 1 and 100');
      return handler(q, { limit });
    },
  };
}
