# Interaction API Specification

**Version:** 0.1.0
**Status:** Draft

## Overview

The Interaction API is how agents actually call capabilities declared in `agents.json`. Every capability maps to an HTTP endpoint under a common base path. The API uses standard HTTP methods, JSON request/response bodies, and conventional status codes.

## For AI Agents

If you are an AI agent building requests against this API, here is the essential reference:

1. **Auth header:** Send `Authorization: Bearer <session_token>` on all session-required requests. Alternatively, `X-Session-Token: <token>` is accepted.
2. **GET params** go in the query string. **POST/PUT/DELETE params** go in a JSON body with `Content-Type: application/json`.
3. **Every response** uses `{ "ok": true, "data": ... }` on success and `{ "ok": false, "error": "..." }` on failure.
4. **Cart endpoints** are split: `/cart/add` (POST), `/cart/view` (GET), `/cart/update` (PUT), `/cart/remove` (DELETE).
5. **Detail endpoint** uses a path parameter: `/detail/:id`.
6. **Checkout** returns `{ "checkout_url": "...", "human_handoff": true }`. Hand the URL to the human. Do not follow it yourself.
7. On `429`, read the `Retry-After` header and wait that many seconds.

## Base Path

All capability endpoints live under:

```
/.well-known/agents/api
```

This can be overridden by the `endpoint` values in `agents.json`. In practice, agents should use the `endpoint` from each capability object directly.

## Request Format

### GET Requests

Parameters are sent as URL query string values.

```
GET /.well-known/agents/api/search?q=blue+mugs&limit=10
```

### POST / PUT / DELETE Requests

Parameters are sent as a JSON body.

```
POST /.well-known/agents/api/cart/add
Content-Type: application/json
Authorization: Bearer tok_abc123

{
  "item_id": "prod_9f8e7d",
  "quantity": 2
}
```

For `DELETE` requests that need parameters, the body is also JSON.

## Response Format

All responses use a consistent envelope:

```json
{
  "ok": true,
  "data": { ... }
}
```

On error:

```json
{
  "ok": false,
  "error": "A human-readable error message"
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | `true` if the request succeeded, `false` otherwise. |
| `data` | any | The response payload. Structure depends on the capability. Present when `ok` is `true`. |
| `error` | string | Error message. Present when `ok` is `false`. |

### Human Handoff Responses

Capabilities with `human_handoff: true` return a URL that the agent should present to the human:

```json
{
  "ok": true,
  "data": {
    "checkout_url": "https://acmeceramics.example.com/checkout/sess_abc123",
    "human_handoff": true
  }
}
```

The agent MUST NOT attempt to complete the action at this URL itself. It should pass the URL to the human user.

## Headers

### Request Headers

| Header | Required | Description |
|---|---|---|
| `Content-Type` | Yes (for POST/PUT) | Must be `application/json`. |
| `Authorization` | Conditional | `Bearer <session_token>`. Required for capabilities where `requires_session` is `true`. |
| `X-Session-Token` | Conditional | Alternative to `Authorization: Bearer`. The session token value directly. |
| `Accept` | Recommended | Should be `application/json`. |
| `User-Agent` | Recommended | Identifies the agent (e.g., `MyShoppingAgent/1.0`). |

Only one of `Authorization` or `X-Session-Token` is needed. `Authorization: Bearer` is preferred.

### Response Headers

| Header | Description |
|---|---|
| `Content-Type` | Always `application/json; charset=utf-8`. |
| `Link` | `</.well-known/agents.json>; rel="agents"` — present on every response for discovery. |
| `Retry-After` | Seconds to wait before retrying. Present on `429` responses. |
| `X-RateLimit-Remaining` | Number of requests remaining in the current window. Present on `429` responses. |
| `X-RateLimit-Reset` | Unix timestamp when the rate limit window resets. Present on `429` responses. |
| `Access-Control-Allow-Origin` | `*` — CORS support for browser-based agents. |

## Status Codes

| Code | Meaning | When |
|---|---|---|
| `200` | OK | Request succeeded. |
| `201` | Created | Resource created (e.g., cart item added). |
| `204` | No Content | OPTIONS preflight response. |
| `400` | Bad Request | Missing or invalid parameters. The `error` field describes what is wrong. |
| `401` | Unauthorized | Missing or invalid session token on a session-required endpoint. |
| `404` | Not Found | The capability endpoint does not exist, or the referenced resource was not found. |
| `429` | Too Many Requests | Rate limit exceeded. Check `Retry-After` header. |
| `500` | Internal Server Error | Something went wrong on the server. |

## Rate Limiting

Sites declare their rate limit in `agents.json` under `rate_limit.requests_per_minute`. Agents SHOULD respect this value proactively.

When the limit is exceeded, the site responds with:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 12
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1708349400
Content-Type: application/json

{
  "ok": false,
  "error": "Rate limit exceeded"
}
```

Agents MUST wait at least `Retry-After` seconds before sending another request. Agents SHOULD implement exponential backoff if they receive repeated 429 responses.

## Error Handling

Agents should handle errors gracefully:

1. **400** — Check the `error` field, fix the request, and retry.
2. **401** — The session may have expired. Create a new session and retry.
3. **404** — The item or endpoint does not exist. Do not retry with the same parameters.
4. **429** — Wait for `Retry-After` seconds, then retry.
5. **500** — Server error. Retry with exponential backoff (max 3 retries).

## Capability Response Shapes

### search

```
GET /.well-known/agents/api/search?q=blue+mugs&limit=10
```

Response `data`: an array of results (shape defined by the site's handler).

### browse

```
GET /.well-known/agents/api/browse?page=1&limit=20&category=mugs
```

Response `data`: `{ "items": [...], "total": 42 }`

### detail

```
GET /.well-known/agents/api/detail/prod_9f8e7d
```

Response `data`: a single item object (shape defined by the site's handler).

### cart.add

```
POST /.well-known/agents/api/cart/add
Authorization: Bearer tok_abc123

{ "item_id": "prod_9f8e7d", "quantity": 2, "name": "Ocean Blue Mug", "price": 28.00 }
```

Response `data`: `{ "item_id": "prod_9f8e7d", "quantity": 2, "cart_size": 1 }`

### cart.view

```
GET /.well-known/agents/api/cart/view
Authorization: Bearer tok_abc123
```

Response `data`: `{ "items": [...], "subtotal": 56.00 }`

### cart.update

```
PUT /.well-known/agents/api/cart/update
Authorization: Bearer tok_abc123

{ "item_id": "prod_9f8e7d", "quantity": 3 }
```

Response `data`: `{ "item_id": "prod_9f8e7d", "quantity": 3 }`

### cart.remove

```
DELETE /.well-known/agents/api/cart/remove
Authorization: Bearer tok_abc123

{ "item_id": "prod_9f8e7d" }
```

Response `data`: `{ "item_id": "prod_9f8e7d", "removed": true }`

### checkout

```
POST /.well-known/agents/api/checkout
Authorization: Bearer tok_abc123
```

Response `data`: `{ "checkout_url": "https://...", "human_handoff": true }`

### contact

```
POST /.well-known/agents/api/contact

{ "name": "Jane", "email": "jane@example.com", "message": "Hello" }
```

Response `data`: `{ "sent": true }`

## Example: Full Interaction Flow

```
# 1. Discover capabilities
GET /.well-known/agents.json
-> 200: { schema_version, site, capabilities, session, ... }

# 2. Search (no session needed)
GET /.well-known/agents/api/search?q=blue+mugs
-> 200: { ok: true, data: [...] }

# 3. Get product detail
GET /.well-known/agents/api/detail/prod_9f8e7d
-> 200: { ok: true, data: { id: "prod_9f8e7d", name: "Ocean Blue Mug", price: 28.00, ... } }

# 4. Create a session for cart operations
POST /.well-known/agents/api/session
-> 200: { ok: true, data: { session_token: "tok_abc123", expires_at: "...", capabilities: [...] } }

# 5. Add to cart
POST /.well-known/agents/api/cart/add
Authorization: Bearer tok_abc123
{ "item_id": "prod_9f8e7d", "quantity": 2, "name": "Ocean Blue Mug", "price": 28.00 }
-> 200: { ok: true, data: { item_id: "prod_9f8e7d", quantity: 2, cart_size: 1 } }

# 6. Checkout (human handoff)
POST /.well-known/agents/api/checkout
Authorization: Bearer tok_abc123
-> 200: { ok: true, data: { checkout_url: "https://...", human_handoff: true } }

# 7. Agent passes checkout_url to the human — agent stops here

# 8. End session
DELETE /.well-known/agents/api/session
Authorization: Bearer tok_abc123
-> 200: { ok: true, data: { ended: true } }
```

## CORS

The SDK sets the following CORS headers on every response:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Session-Token
```

OPTIONS preflight requests receive a `204 No Content` response with the same headers.
