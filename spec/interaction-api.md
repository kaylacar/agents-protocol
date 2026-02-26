# Interaction API Specification

**Version:** 0.1.0
**Status:** Draft

## Overview

The Interaction API is how agents actually call capabilities declared in `agents.json`. Every capability maps to an HTTP endpoint under a common base path. The API uses standard HTTP methods, JSON request/response bodies, and conventional status codes.

## Base Path

All capability endpoints live under:

```
/.well-known/agents/api
```

This can be overridden by the `Agent-API` field in `agents.txt` or inferred from the `endpoint` values in `agents.json`. In practice, agents should use the `endpoint` from each capability object directly.

## Request Format

### GET Requests

Parameters are sent as URL query string values.

```
GET /.well-known/agents/api/search?q=blue+mugs&limit=10
```

### POST / PUT / PATCH / DELETE Requests

Parameters are sent as a JSON body.

```
POST /.well-known/agents/api/cart
Content-Type: application/json
X-Agent-Session: tok_abc123

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

Capabilities with `human_handoff: true` return a URL in `data` that the agent should present to the human:

```json
{
  "ok": true,
  "data": {
    "handoff_url": "https://acmeceramics.example.com/checkout/sess_abc123",
    "expires_at": "2026-02-19T13:30:00Z",
    "message": "Please complete your purchase at the link above."
  }
}
```

The agent MUST NOT attempt to complete the action at this URL itself. It should pass the URL to the human user.

## Headers

### Request Headers

| Header | Required | Description |
|---|---|---|
| `Content-Type` | Yes (for POST/PUT/PATCH) | Must be `application/json`. |
| `X-Agent-Session` | Conditional | Required for capabilities where `requires_session` is `true`. Value is the `session_token` from session creation. |
| `Accept` | Recommended | Should be `application/json`. |
| `User-Agent` | Recommended | Identifies the agent (e.g., `MyShoppingAgent/1.0`). |

### Response Headers

| Header | Description |
|---|---|
| `Content-Type` | Always `application/json; charset=utf-8`. |
| `Retry-After` | Seconds to wait before retrying. Present on `429` responses. |
| `X-RateLimit-Remaining` | Optional. Number of requests remaining in the current window. |
| `X-RateLimit-Reset` | Optional. Unix timestamp when the rate limit window resets. |

## Status Codes

| Code | Meaning | When |
|---|---|---|
| `200` | OK | Request succeeded. |
| `201` | Created | Resource created (e.g., session, cart item). |
| `400` | Bad Request | Missing or invalid parameters. The `error` field describes what is wrong. |
| `401` | Unauthorized | Missing or invalid `X-Agent-Session` header on a session-required endpoint. |
| `404` | Not Found | The capability endpoint does not exist, or the referenced resource (item, session) was not found. |
| `429` | Too Many Requests | Rate limit exceeded. Check `Retry-After` header. |
| `500` | Internal Server Error | Something went wrong on the server. |

## Rate Limiting

Sites declare their rate limit in `agents.json` under `rate_limit.max_requests_per_minute`. Agents SHOULD respect this value proactively.

When the limit is exceeded, the site responds with:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 12
Content-Type: application/json

{
  "ok": false,
  "error": "Rate limit exceeded. Retry after 12 seconds."
}
```

Agents MUST wait at least `Retry-After` seconds before sending another request. Agents SHOULD implement exponential backoff if they receive repeated 429 responses.

## Error Handling

Agents should handle errors gracefully:

1. **400** -- Check the `error` field, fix the request, and retry.
2. **401** -- The session may have expired. Create a new session and retry.
3. **404** -- The item or endpoint does not exist. Do not retry with the same parameters.
4. **429** -- Wait for `Retry-After` seconds, then retry.
5. **500** -- Server error. Retry with exponential backoff (max 3 retries).

## Example: Full Interaction Flow

```
# 1. Discover capabilities
GET /.well-known/agents.json
-> 200: { schema_version, site, capabilities, ... }

# 2. Search (no session needed)
GET /.well-known/agents/api/search?q=blue+mugs
-> 200: { ok: true, data: { results: [...], total: 42, page: 1 } }

# 3. Get product detail
GET /.well-known/agents/api/detail?id=prod_9f8e7d
-> 200: { ok: true, data: { id: "prod_9f8e7d", name: "Ocean Blue Mug", price: 28.00, ... } }

# 4. Create a session for cart operations
POST /.well-known/agents/api/session
-> 201: { ok: true, data: { session_token: "tok_abc123", expires_at: "...", capabilities: [...] } }

# 5. Add to cart
POST /.well-known/agents/api/cart
X-Agent-Session: tok_abc123
{ "item_id": "prod_9f8e7d", "quantity": 2 }
-> 201: { ok: true, data: { cart: { items: [...], total: 56.00 } } }

# 6. Checkout (human handoff)
POST /.well-known/agents/api/checkout
X-Agent-Session: tok_abc123
-> 200: { ok: true, data: { handoff_url: "https://...", expires_at: "...", message: "..." } }

# 7. Agent passes handoff_url to the human
```

## CORS

Sites that want to support browser-based agents SHOULD set appropriate CORS headers:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Content-Type, X-Agent-Session
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
```

Sites MAY restrict the allowed origin to specific agent domains.
