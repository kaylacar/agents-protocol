import { CapabilityDefinition } from '../types';

interface DetailOptions {
  handler: (id: string) => Promise<any>;
}

export function detail({ handler }: DetailOptions): CapabilityDefinition {
  return {
    name: 'detail',
    description: 'Get detailed information about a specific item',
    method: 'GET',
    params: {
      id: { type: 'string', required: true, description: 'Item identifier' },
    },
    handler: async (req) => {
      const id = req.params.id;
      if (!id) {
        throw new Error('Missing required parameter: id');
      }
      return handler(id);
    },
  };
}
