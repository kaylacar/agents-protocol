import { CapabilityDefinition } from '../types';

interface BrowseOptions {
  handler: (options?: {
    page?: number;
    limit?: number;
    category?: string;
    filters?: Record<string, string>;
  }) => Promise<{ items: unknown[]; total: number }>;
}

export function browse({ handler }: BrowseOptions): CapabilityDefinition {
  return {
    name: 'browse',
    description: 'Browse items with pagination and filtering',
    method: 'GET',
    params: {
      page: { type: 'number', required: false, description: 'Page number' },
      limit: { type: 'number', required: false, description: 'Items per page' },
      category: { type: 'string', required: false, description: 'Filter by category' },
    },
    handler: async (req) => {
      const page = req.query.page ? parseInt(req.query.page, 10) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
      if (page !== undefined && isNaN(page)) throw new Error('page must be a number');
      if (limit !== undefined && isNaN(limit)) throw new Error('limit must be a number');
      const category = req.query.category;
      const { page: _p, limit: _l, category: _c, ...filters } = req.query;
      return handler({ page, limit, category, filters });
    },
  };
}
