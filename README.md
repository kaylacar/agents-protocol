# agents-protocol

`agents.txt` is to AI agents what `robots.txt` is to crawlers — except instead of blocking bots, it tells AI agents what they can *do* on your site, and every action is cryptographically logged.

---

## The easy path — 5 minutes, no install

Create a file at `/.well-known/agents.txt` on your site:

```
# agents.txt — Agent Interaction Protocol v0.1

Name: My Store
URL: https://example.com
Description: An online store selling handmade ceramics
Contact: hello@example.com

Capabilities: search, browse, contact
Rate-Limit: 60/minute
```

That's it. Agents can now discover your site. No code, no dependencies, no server changes — just a file at a well-known path.

For sites that want to go further (sessions, cart, live API calls), keep reading.

---

## The full path — SDK with live capabilities

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

## Standard

This SDK implements the [agents.txt open standard](https://github.com/kaylacar/agents-txt). The standard defines the `/.well-known/agents.txt` and `/.well-known/agents.json` formats, the IANA well-known URI registrations, and the formal specification. If you need the lightweight parser/generator only (without the full SDK), use `@agents-txt/core` from that repo.

For AI policy declaration (training rights, licensing, per-agent permissions), see the companion standard [ai.txt](https://github.com/kaylacar/ai-txt). The two standards are complementary — `agents.txt` declares capabilities, `ai.txt` declares policy. Both can be served from the same site.

## Spec

- [agents.txt](spec/agents-txt.md)
- [agents.json](spec/agents-json.md)
- [Interaction API](spec/interaction-api.md)
- [Sessions](spec/session.md)
- [Audit](spec/audit.md)

---

## Development

```bash
npm install      # installs sdk + client (workspaces)
npm run build
npm test         # 87 tests
```

---

MIT
