import { CapabilityDefinition, CartItem } from '../types';

interface CheckoutOptions {
  onCheckout: (cart: CartItem[]) => Promise<{ checkout_url: string; expires_at?: string; message?: string }>;
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
      return {
        handoff_url: result.checkout_url,
        expires_at: result.expires_at ?? new Date(Date.now() + 30 * 60_000).toISOString(),
        message: result.message ?? 'Please complete your purchase at the link above.',
      };
    },
  };
}
