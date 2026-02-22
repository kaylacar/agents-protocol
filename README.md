# agents.txt Protocol

**A standard for AI agents to discover and interact with websites.**

Like `robots.txt` tells crawlers what they can access, `agents.txt` tells AI agents what they can **do** — and provides cryptographic proof of what they did.

## The Problem

AI agents are increasingly browsing, shopping, and acting on behalf of humans. But there's no standard way for them to:

1. **Discover** what a website offers and how to interact with it
2. **Interact** through structured APIs rather than scraping HTML
3. **Prove** what they did — to the user, the site owner, or a regulator

## The Protocol

### Discovery

Every participating site serves two files:

- **`/.well-known/agents.txt`** — Human-readable discovery file (like robots.txt)
- **`/.well-known/agents.json`** — Machine-readable capabilities and endpoints

### Capabilities

Sites declare what agents can do:

| Capability | Description | Session Required |
|---|---|---|
| `search` | Search for items/content | No |
| `browse` | List items with pagination | No |
| `detail` | Get detailed item info | No |
| `cart.add` | Add item to cart | Yes |
| `cart.view` | View current cart | Yes |
| `cart.update` | Update cart item quantity | Yes |
| `cart.remove` | Remove item from cart | Yes |
| `checkout` | Get checkout URL (human completes) | Yes |
| `contact` | Send a message | No |

Sites can define custom capabilities beyond these built-ins.

### Sessions

Stateful actions (cart, checkout) require a session:

```
POST /.well-known/agents/api/session
→ { "session_token": "...", "expires_at": "...", "capabilities": [...] }
```

Sessions are time-limited and scoped to declared capabilities.

### Human Handoff

Some actions (checkout, payment, account creation) can never be completed by an agent. They return a URL for the human to finish the action. The agent facilitates; the human decides.

### Audit Trail

Every session produces a signed, hash-chained artifact (powered by [RER](https://github.com/kaylacar/rer)) that proves:
- What the agent did
- What policies were enforced
- That nothing was tampered with

## Quick Start

### For Site Owners (TypeScript/Node.js)

```typescript
import { AgentDoor, search, browse, cart, checkout } from '@agents-protocol/sdk';
import express from 'express';

const app = express();

const door = new AgentDoor({
  site: {
    name: 'My Store',
    url: 'https://example.com',
    description: 'Handmade ceramics',
  },
  capabilities: [
    search({ handler: async (q) => db.search(q) }),
    browse({ handler: async (page, filters) => db.list(page, filters) }),
    cart(),
    checkout({ onCheckout: async (cart) => stripe.createSession(cart) }),
  ],
});

app.use(door.middleware());
app.listen(3000);
```

Your site now serves:
- `/.well-known/agents.txt`
- `/.well-known/agents.json`
- `/.well-known/agents/api/*`

### For Agent Developers

```
1. GET /.well-known/agents.json → discover capabilities
2. POST /.well-known/agents/api/session → get session token
3. GET /.well-known/agents/api/search?q=blue+mugs → find items
4. POST /.well-known/agents/api/cart { item_id, quantity } → build cart
5. POST /.well-known/agents/api/checkout → get checkout URL
6. Return checkout URL to human
```

## Project Structure

```
agents-protocol/
├── spec/          # Protocol specification documents
├── sdk/           # TypeScript reference implementation
├── examples/      # Example integrations
└── README.md
```

## Specification

- [agents.txt Format](spec/agents-txt.md)
- [agents.json Schema](spec/agents-json.md)
- [Interaction API](spec/interaction-api.md)
- [Sessions](spec/session.md)
- [Audit Trail](spec/audit.md)

## License

MIT
