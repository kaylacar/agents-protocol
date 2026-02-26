import { CapabilityDefinition } from '../types';

interface ContactOptions {
  handler: (message: { name: string; email: string; message: string }) => Promise<void>;
}

export function contact({ handler }: ContactOptions): CapabilityDefinition {
  return {
    name: 'contact',
    description: 'Send a contact message',
    method: 'POST',
    params: {
      name: { type: 'string', required: true, description: 'Sender name' },
      email: { type: 'string', required: true, description: 'Sender email' },
      message: { type: 'string', required: true, description: 'Message content' },
    },
    handler: async (req) => {
      const { name, email, message } = req.body;
      if (typeof name !== 'string' || typeof email !== 'string' || typeof message !== 'string'
          || !name || !email || !message) {
        throw new Error('Missing required parameters: name, email, message');
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Invalid email address format');
      }
      await handler({ name, email, message });
      return { sent: true };
    },
  };
}
