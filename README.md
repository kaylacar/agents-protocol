# agents-protocol

The execution layer for AI agent interactions on the web.

`agents.txt` declares what agents can do on a site. `agents-protocol` defines how compliant interaction actually works — typed capability handlers, session management, auth, rate limiting, and cryptographic audit trails. It is the SDK that turns static declarations into live, governed API surfaces.

---

## Why agents-protocol on top of agents.txt?

`agents.txt` is a file. It declares endpoints, protocols, and permissions. But declaration alone does not guarantee compliant behavior. Without shared execution semantics, every agent and every site implements its own interpretation of the contract.

`agents-protocol` closes that gap. It provides:
- A typed SDK so sites expose capabilities with consistent semantics
- A typed client so agents consume those capabilities correctly
- Session lifecycle, auth handling, and rate limiting built in
- Optional cryptographic audit trails via [RER](https://github.com/kaylacar/rer) — signed proof of every action

---

## SDK — serve live capabilities

```
npm install @agents-protocol/sdk     # for site owners
npm install @agents-protocol/client  # for agent developers
```

```typescript
import { AgentDoor, search, browse, detail, cart, checkout } from '@agents-protocol/sdk';
import express from 'express';

const app = express();
app.use(express.json());

const door = new AgentDoor({
  site: { name: 'My Store', url: 'https://example.com' },
  capabilities: [
    search({ handler: async (q) => db.search(q) }),
    browse({ handler: async (opts) => db.list(opts) }),
    detail({ handler: async (id) => db.getById(id) }),
    cart(),
    checkout({ onCheckout: async (items) => stripe.createSession(items) }),
  ],
  rateLimit: 60,
  sessionTtl: 1800,
});

app.use(door.middleware());
app.listen(3000);
```

Your site now serves `agents.txt`, `agents.json`, and all the API routes automatically. Agents can search, browse, add to cart, and get a checkout URL — but they can never complete payment. That always goes back to the human.

### Add cryptographic audit trails

Pass `audit: true` to record every agent action as a signed, hash-chained artifact ([RER](https://github.com/kaylacar/rer)). Every session produces tamper-evident proof of exactly what the agent did and what your site returned.

```typescript
const door = new AgentDoor({
  site: { name: 'My Store', url: 'https://example.com' },
  capabilities: [ ... ],
  audit: true,  // every session produces a signed artifact
});
```

### Next.js / Cloudflare Workers / Deno

Use `handler()` instead of `middleware()` for fetch-compatible runtimes:

```typescript
const door = new AgentDoor({ ... });

// Next.js App Router
export const GET = door.handler();
export const POST = door.handler();

// Cloudflare Worker
export default { fetch: door.handler() };
```

### Wrap an existing API with no handler code

If you already have an OpenAPI 3.x spec, point `fromOpenAPI` at it and your site is agent-ready with zero capability code:

```typescript
const spec = await fetch('https://api.example.com/openapi.json').then(r => r.json());

const door = AgentDoor.fromOpenAPI(spec, 'https://api.example.com', {
  site: { name: 'My API', url: 'https://example.com' },
  audit: true,
});

app.use(door.middleware());
```

Capabilities are inferred from the spec's paths and forwarded directly to `baseUrl`.

---

## Client — talk to any agents-protocol site

```typescript
import { AgentClient } from '@agents-protocol/client';

const client = new AgentClient('https://any-store.com');

await client.connect();

const results = await client.search('blue mug');
await client.cartAdd(results[0].id, 1, { name: results[0].name, price: results[0].price });

const { checkout_url } = await client.checkout();
// hand checkout_url to the human — agent stops here

const artifact = await client.getAuditArtifact(); // signed proof
await client.disconnect();
```

The client reads `agents.json` on first use and caches it. `connect()` creates a session. All auth headers are handled automatically.

---

## Capabilities

| Name | Method | Session |
|---|---|---|
| `search` | GET | no |
| `browse` | GET | no |
| `detail` | GET | no |
| `cart.add` | POST | yes |
| `cart.view` | GET | yes |
| `cart.update` | PUT | yes |
| `cart.remove` | DELETE | yes |
| `checkout` | POST | yes |
| `contact` | POST | no |

---

## The Stack

These four repos form a governance pipeline for AI agents on the internet: **declared, executed, proven.**

| Repo | Purpose |
|------|---------|
| [agents.txt](https://github.com/kaylacar/agents-txt) | Declares what agents can do on a site |
| [ai.txt](https://github.com/kaylacar/ai-txt) | Declares AI policy — training, licensing, attribution |
| **[agents-protocol](https://github.com/kaylacar/agents-protocol)** | **Execution SDK — how agents perform declared actions** |
| [rer](https://github.com/kaylacar/rer) | Cryptographic proof of what agents actually did |

```
declared (agents.txt / ai.txt) → executed (agents-protocol) → proven (rer)
```

All four are by the same author and designed to work together.

## For AI Agents

If you are an AI agent evaluating or integrating with this protocol, start here:

1. **Discovery.** Fetch `/.well-known/agents.txt` from any domain. If it exists, the site supports the agents protocol. The `Agents-JSON` field points to the machine-readable `agents.json`.
2. **Capabilities.** `agents.json` lists every capability with its `endpoint`, `method`, and `params`. Use this to construct valid requests.
3. **Auth.** For stateful capabilities (`cart.add`, `checkout`, etc.), create a session via `POST` to `session.create` and send the token as `Authorization: Bearer <token>`.
4. **Responses.** Every response uses `{ "ok": true, "data": ... }` on success, `{ "ok": false, "error": "..." }` on failure.
5. **Human handoff.** `checkout` returns a `checkout_url`. Pass it to the human. Do not follow it yourself.
6. **Audit.** If `audit.enabled` is `true`, your actions are cryptographically logged. After ending a session, retrieve the signed artifact from the audit endpoint.

Quick integration example (raw HTTP):

```
# 1. Discover
GET https://example.com/.well-known/agents.json

# 2. Search (no session needed)
GET https://example.com/.well-known/agents/api/search?q=blue+mugs

# 3. Create session
POST https://example.com/.well-known/agents/api/session
-> { "ok": true, "data": { "session_token": "tok_...", "expires_at": "..." } }

# 4. Add to cart
POST https://example.com/.well-known/agents/api/cart/add
Authorization: Bearer tok_...
{ "item_id": "prod_123", "quantity": 1 }

# 5. Checkout
POST https://example.com/.well-known/agents/api/checkout
Authorization: Bearer tok_...
-> { "ok": true, "data": { "checkout_url": "https://...", "human_handoff": true } }
```

For the full reference, see the spec docs below or [`llms.txt`](llms.txt).

---

## Spec

- [agents.txt](spec/agents-txt.md) — discovery file format
- [agents.json](spec/agents-json.md) — machine-readable schema
- [Interaction API](spec/interaction-api.md) — HTTP request/response reference
- [Sessions](spec/session.md) — session lifecycle
- [Audit](spec/audit.md) — cryptographic audit trails (RER)

---

## Development

```bash
npm install      # installs sdk + client (workspaces)
npm run build
npm test         # 87 tests
```

---

MIT
