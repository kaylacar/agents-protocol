import express from 'express';
import { AgentDoor, search, browse, detail, cart, checkout, contact } from '../../sdk/src';

// --- Fake product database ---

const products = [
  { id: '1', name: 'Blue Mug', price: 28, category: 'mugs', description: 'Handmade blue ceramic mug' },
  { id: '2', name: 'White Bowl', price: 35, category: 'bowls', description: 'Minimalist white stoneware bowl' },
  { id: '3', name: 'Terracotta Vase', price: 52, category: 'vases', description: 'Tall terracotta vase with natural glaze' },
  { id: '4', name: 'Green Plate', price: 22, category: 'plates', description: 'Forest green dinner plate' },
  { id: '5', name: 'Speckled Mug', price: 30, category: 'mugs', description: 'Speckled cream and brown mug' },
];

// --- Set up the Agent Door ---

const app = express();
app.use(express.json());

const door = new AgentDoor({
  site: {
    name: 'Ceramic Studio',
    url: 'http://localhost:3000',
    description: 'Handmade ceramics — mugs, bowls, vases, and more',
    contact: 'hello@ceramicstudio.example',
  },
  capabilities: [
    search({
      handler: async (query, opts) => {
        const q = query.toLowerCase();
        let results = products.filter(
          p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
        );
        if (opts?.limit) results = results.slice(0, opts.limit);
        return results;
      },
    }),

    browse({
      handler: async (opts) => {
        let items = [...products];
        if (opts?.category) {
          items = items.filter(p => p.category === opts.category);
        }
        const total = items.length;
        const page = opts?.page ?? 1;
        const limit = opts?.limit ?? 20;
        items = items.slice((page - 1) * limit, page * limit);
        return { items, total };
      },
    }),

    detail({
      handler: async (id) => {
        const product = products.find(p => p.id === id);
        if (!product) throw new Error(`Product not found: ${id}`);
        return product;
      },
    }),

    cart(),

    checkout({
      onCheckout: async (items) => {
        // In a real app, create a Stripe session or similar
        const total = items.reduce((sum, i) => sum + (i.price ?? 0) * i.quantity, 0);
        const fakeId = Math.random().toString(36).slice(2, 10);
        return { checkout_url: `http://localhost:3000/checkout/${fakeId}?total=${total}` };
      },
    }),

    contact({
      handler: async (msg) => {
        console.log(`[Contact] From: ${msg.name} <${msg.email}>`);
        console.log(`[Contact] Message: ${msg.message}`);
      },
    }),
  ],
  rateLimit: 60,
  sessionTtl: 1800,
});

app.use(door.middleware());

// Human-facing checkout page (the handoff destination)
app.get('/checkout/:id', (req, res) => {
  res.send(`<h1>Complete Your Purchase</h1><p>Order ${req.params.id} — total: $${req.query.total}</p>`);
});

app.get('/', (_req, res) => {
  res.send('Ceramic Studio — visit /.well-known/agents.txt to discover agent capabilities');
});

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`Ceramic Studio running on http://localhost:${port}`);
  console.log(`Agent discovery: http://localhost:${port}/.well-known/agents.txt`);
});
