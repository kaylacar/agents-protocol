import { CapabilityDefinition, CartItem } from '../types';

interface CheckoutOptions {
  onCheckout: (cart: CartItem[]) => Promise<{ checkout_url: string }>;
}

export function checkout({ onCheckout }: CheckoutOptions): CapabilityDefinition {
  return {
    name: 'checkout',
    description: 'Generate a checkout URL for human completion',
    method: 'POST',
    requiresSession: true,
    humanHandoff: true,
    handler: async (_req, session) => {
      if (!session) throw new Error('Session required');
      const items = session.cartItems;
      if (items.length === 0) throw new Error('Cart is empty');
      const result = await onCheckout(items);
      return { checkout_url: result.checkout_url, human_handoff: true };
    },
  };
}
