import { CapabilityDefinition, CartItem } from '../types';

export function cart(): CapabilityDefinition[] {
  const add: CapabilityDefinition = {
    name: 'cart.add',
    description: 'Add an item to the cart',
    method: 'POST',
    requiresSession: true,
    params: {
      item_id: { type: 'string', required: true, description: 'Item ID to add' },
      quantity: { type: 'number', required: true, description: 'Quantity to add' },
      name: { type: 'string', required: false, description: 'Item name' },
      price: { type: 'number', required: false, description: 'Item price' },
    },
    handler: async (req, session) => {
      const { item_id, quantity, name, price } = req.body;
      if (typeof item_id !== 'string' || typeof quantity !== 'number') {
        throw new Error('Missing required parameters: item_id, quantity');
      }

      const existing = session!.cartItems.find(i => i.itemId === item_id);
      if (existing) {
        existing.quantity += quantity;
        if (typeof name === 'string') existing.name = name;
        if (typeof price === 'number') existing.price = price;
      } else {
        const item: CartItem = { itemId: item_id, quantity };
        if (typeof name === 'string') item.name = name;
        if (typeof price === 'number') item.price = price;
        session!.cartItems.push(item);
      }

      return { item_id, quantity: existing?.quantity ?? quantity, cart_size: session!.cartItems.length };
    },
  };

  const view: CapabilityDefinition = {
    name: 'cart.view',
    description: 'View current cart contents',
    method: 'GET',
    requiresSession: true,
    handler: async (_req, session) => {
      const items = session!.cartItems;
      const subtotal = items.reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0);
      return { items, subtotal };
    },
  };

  const update: CapabilityDefinition = {
    name: 'cart.update',
    description: 'Update the quantity of a cart item',
    method: 'PUT',
    requiresSession: true,
    params: {
      item_id: { type: 'string', required: true, description: 'Item ID to update' },
      quantity: { type: 'number', required: true, description: 'New quantity' },
    },
    handler: async (req, session) => {
      const { item_id, quantity } = req.body;
      if (typeof item_id !== 'string' || typeof quantity !== 'number') {
        throw new Error('Missing required parameters: item_id, quantity');
      }

      const item = session!.cartItems.find(i => i.itemId === item_id);
      if (!item) throw new Error(`Item not found in cart: ${item_id}`);

      item.quantity = quantity;
      return { item_id, quantity };
    },
  };

  const remove: CapabilityDefinition = {
    name: 'cart.remove',
    description: 'Remove an item from the cart',
    method: 'DELETE',
    requiresSession: true,
    params: {
      item_id: { type: 'string', required: true, description: 'Item ID to remove' },
    },
    handler: async (req, session) => {
      const raw = req.body.item_id ?? req.query.item_id;
      if (typeof raw !== 'string' || !raw) throw new Error('Missing required parameter: item_id');
      const item_id = raw;

      const index = session!.cartItems.findIndex(i => i.itemId === item_id);
      if (index === -1) throw new Error(`Item not found in cart: ${item_id}`);

      session!.cartItems.splice(index, 1);
      return { item_id, removed: true };
    },
  };

  return [add, view, update, remove];
}
