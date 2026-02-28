# agents.json Schema Specification

**Version:** 0.1.0
**Status:** Draft

## Overview

`agents.json` is the machine-readable companion to `agents.txt`. While `agents.txt` gives agents a quick summary of what a site offers, `agents.json` provides the complete contract: every capability, its endpoint, parameters, session requirements, and configuration.

Every participating site serves this file at:

```
https://<domain>/.well-known/agents.json
```

The file MUST be served with `Content-Type: application/json; charset=utf-8`.

## For AI Agents

If you are an AI agent consuming this spec, here is the quickest path to integration:

1. Fetch `/.well-known/agents.json` from the target domain.
2. Read `capabilities` to learn what you can do. Each entry has a `name`, `endpoint`, `method`, and optional `params`.
3. For capabilities where `requires_session` is `true`, create a session first by `POST`ing to `session.create`.
4. Send the session token as `Authorization: Bearer <token>` on all session-required requests.
5. Use the `params` object on each capability to construct valid requests. For `GET` endpoints, send params as query strings. For `POST`/`PUT`/`DELETE`, send them as JSON body.
6. If `flows` is present, follow the suggested step sequences for common tasks.
7. Respect `rate_limit.requests_per_minute`.

## Top-Level Structure

```json
{
  "schema_version": "1.0",
  "site": { ... },
  "capabilities": [ ... ],
  "session": { ... },
  "flows": [ ... ],
  "rate_limit": { ... },
  "audit": { ... }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `schema_version` | string | Yes | Version of the agents.json schema. |
| `site` | object | Yes | Site identity. |
| `capabilities` | array | Yes | List of capability objects (at least one). |
| `session` | object | No | Session configuration. Required if any capability uses sessions. |
| `flows` | array | No | Suggested multi-step workflows. |
| `rate_limit` | object | No | Rate limiting configuration. |
| `audit` | object | No | Audit trail configuration. |

## `site` Object

```json
{
  "name": "Acme Ceramics",
  "url": "https://acmeceramics.example.com",
  "description": "Handmade ceramic mugs, bowls, and vases",
  "contact": "support@acmeceramics.example.com"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Human-readable site name. |
| `url` | string (URI) | Yes | Canonical site URL. |
| `description` | string | No | One-line description. |
| `contact` | string | No | Contact email or URL. |

## `capabilities` Array

Each entry describes one thing an agent can do on the site.

```json
{
  "name": "search",
  "description": "Search the product catalog",
  "endpoint": "/.well-known/agents/api/search",
  "method": "GET",
  "params": {
    "q": { "type": "string", "required": true, "description": "Search query" },
    "limit": { "type": "integer", "required": false, "description": "Results per page" }
  },
  "requires_session": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Capability identifier. Lowercase, may contain dots (`search`, `cart.add`). |
| `description` | string | No | Plain-language description of what this does. |
| `endpoint` | string | Yes | URL path for this capability, relative to the site origin. May include path parameters (e.g., `/:id`). |
| `method` | string | Yes | HTTP method: `GET`, `POST`, `PUT`, or `DELETE`. |
| `params` | object | No | Map of parameter names to parameter descriptors. |
| `requires_session` | boolean | No | Whether the agent must have an active session. Default: `false`. |
| `human_handoff` | boolean | No | Whether this returns a URL for a human to complete. Default: `false`. |

### Parameter Descriptor

Each value in the `params` object describes one parameter.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | Yes | `string`, `number`, `integer`, `boolean`, `array`, or `object`. |
| `description` | string | No | What this parameter does. |
| `required` | boolean | No | Whether it must be provided. Default: `false`. |
| `default` | any | No | Default value if omitted. |
| `enum` | array | No | Allowed values. |
| `items` | object | No | Schema for array items (when `type` is `array`). |

For `GET` endpoints, parameters are sent as query string values. For `POST`/`PUT`/`DELETE`, parameters are sent in the JSON request body.

## `session` Object

```json
{
  "create": "/.well-known/agents/api/session",
  "delete": "/.well-known/agents/api/session",
  "ttl_seconds": 3600
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `create` | string | No | URL to create sessions via `POST`. Default: `/.well-known/agents/api/session`. |
| `delete` | string | No | URL to end sessions via `DELETE`. Default: `/.well-known/agents/api/session`. |
| `ttl_seconds` | integer | No | Session time-to-live in seconds. Minimum: 60. Default: `3600`. |

If any capability has `requires_session: true`, the `session` object SHOULD be present. If omitted, the defaults apply.

## `flows` Array

Flows describe suggested multi-step workflows for common tasks.

```json
{
  "name": "purchase",
  "description": "Search for a product, view details, add to cart, and check out",
  "steps": ["search", "detail", "cart.add", "checkout"]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Flow identifier. |
| `description` | string | No | Plain-language description of what this flow accomplishes. |
| `steps` | array of strings | Yes | Ordered list of capability names to call. |

## `rate_limit` Object

```json
{
  "requests_per_minute": 60
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `requests_per_minute` | integer | No | Maximum requests per minute. |

## `audit` Object

```json
{
  "enabled": true,
  "endpoint": "/.well-known/agents/api/audit/:session_id",
  "description": "Retrieve signed RER artifact for a completed session"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `enabled` | boolean | No | Whether audit trails are produced. Default: `false`. |
| `endpoint` | string | No | URL to retrieve audit artifacts. Includes `:session_id` placeholder. Default: `/.well-known/agents/api/audit/:session_id`. |
| `description` | string | No | Human-readable description of the audit endpoint. |

## Full Example

```json
{
  "schema_version": "1.0",
  "site": {
    "name": "Acme Ceramics",
    "url": "https://acmeceramics.example.com",
    "description": "Handmade ceramic mugs, bowls, and vases",
    "contact": "support@acmeceramics.example.com"
  },
  "capabilities": [
    {
      "name": "search",
      "description": "Search the product catalog",
      "endpoint": "/.well-known/agents/api/search",
      "method": "GET",
      "params": {
        "q": { "type": "string", "required": true, "description": "Search query" },
        "limit": { "type": "integer", "description": "Results per page" }
      }
    },
    {
      "name": "browse",
      "description": "List products with optional filters",
      "endpoint": "/.well-known/agents/api/browse",
      "method": "GET",
      "params": {
        "category": { "type": "string", "description": "Filter by category" },
        "sort": { "type": "string", "enum": ["price_asc", "price_desc", "newest"], "description": "Sort order" },
        "page": { "type": "integer", "description": "Page number" },
        "limit": { "type": "integer", "description": "Results per page" }
      }
    },
    {
      "name": "detail",
      "description": "Get full details for a product",
      "endpoint": "/.well-known/agents/api/detail/:id",
      "method": "GET",
      "params": {
        "id": { "type": "string", "required": true, "description": "Product ID" }
      }
    },
    {
      "name": "cart.add",
      "description": "Add a product to the cart",
      "endpoint": "/.well-known/agents/api/cart/add",
      "method": "POST",
      "params": {
        "item_id": { "type": "string", "required": true, "description": "Product ID" },
        "quantity": { "type": "integer", "required": true, "description": "Quantity to add" },
        "name": { "type": "string", "description": "Product name" },
        "price": { "type": "number", "description": "Product price" }
      },
      "requires_session": true
    },
    {
      "name": "cart.view",
      "description": "View the current cart",
      "endpoint": "/.well-known/agents/api/cart/view",
      "method": "GET",
      "requires_session": true
    },
    {
      "name": "cart.update",
      "description": "Update quantity of a cart item",
      "endpoint": "/.well-known/agents/api/cart/update",
      "method": "PUT",
      "params": {
        "item_id": { "type": "string", "required": true, "description": "Product ID" },
        "quantity": { "type": "integer", "required": true, "description": "New quantity" }
      },
      "requires_session": true
    },
    {
      "name": "cart.remove",
      "description": "Remove an item from the cart",
      "endpoint": "/.well-known/agents/api/cart/remove",
      "method": "DELETE",
      "params": {
        "item_id": { "type": "string", "required": true, "description": "Product ID to remove" }
      },
      "requires_session": true
    },
    {
      "name": "checkout",
      "description": "Start checkout and get a URL for the human to complete payment",
      "endpoint": "/.well-known/agents/api/checkout",
      "method": "POST",
      "requires_session": true,
      "human_handoff": true
    }
  ],
  "session": {
    "create": "/.well-known/agents/api/session",
    "delete": "/.well-known/agents/api/session",
    "ttl_seconds": 3600
  },
  "flows": [
    {
      "name": "purchase",
      "description": "Search for a product, view details, add to cart, and check out",
      "steps": ["search", "detail", "cart.add", "checkout"]
    }
  ],
  "rate_limit": {
    "requests_per_minute": 60
  },
  "audit": {
    "enabled": true,
    "endpoint": "/.well-known/agents/api/audit/:session_id",
    "description": "Retrieve signed RER artifact for a completed session"
  }
}
```

## Validation

Implementations SHOULD validate `agents.json` before using it. At minimum, verify:

1. `schema_version` is present.
2. `site.name` and `site.url` are present.
3. `capabilities` is a non-empty array.
4. Each capability has `name`, `endpoint`, and `method`.
5. If any capability has `requires_session: true`, the site should have session configuration (or use defaults).
