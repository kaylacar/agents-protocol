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

The canonical JSON Schema is at [`schemas/agents.schema.json`](schemas/agents.schema.json) (JSON Schema draft-07).

## Top-Level Structure

```json
{
  "schema_version": "0.1.0",
  "site": { ... },
  "capabilities": [ ... ],
  "session": { ... },
  "rate_limit": { ... },
  "audit": { ... },
  "docs_url": "https://example.com/docs/agents"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `schema_version` | string | Yes | Semver version of the protocol. |
| `site` | object | Yes | Site identity. |
| `capabilities` | array | Yes | List of capability objects (at least one). |
| `session` | object | No | Session configuration. Required if any capability uses sessions. |
| `rate_limit` | object | No | Rate limiting configuration. |
| `audit` | object | No | Audit trail configuration. |
| `docs_url` | string | No | URL to human-readable docs. |

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
    "page": { "type": "integer", "required": false, "default": 1, "description": "Page number" },
    "limit": { "type": "integer", "required": false, "default": 20, "description": "Results per page" }
  },
  "requires_session": false,
  "human_handoff": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Capability identifier. Lowercase, may contain dots and underscores (`search`, `cart.add`). |
| `description` | string | No | Plain-language description of what this does. |
| `endpoint` | string | Yes | URL path for this capability, relative to the site origin. |
| `method` | string | Yes | HTTP method: `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`. |
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

For `GET` endpoints, parameters are sent as query string values. For `POST`/`PUT`/`PATCH`, parameters are sent in the JSON request body.

## `session` Object

```json
{
  "create": "/.well-known/agents/api/session",
  "delete": "/.well-known/agents/api/session",
  "ttl_seconds": 1800
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `create` | string | Yes | URL path to create a session (POST). |
| `delete` | string | No | URL path to end a session (DELETE). Defaults to the `create` URL. |
| `ttl_seconds` | integer | No | Session time-to-live in seconds. Minimum: 60. Default: `1800`. |

If any capability has `requires_session: true`, the `session` object SHOULD be present. If omitted, the defaults apply.

## `rate_limit` Object

```json
{
  "requests_per_minute": 60,
  "max_sessions": 5
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `requests_per_minute` | integer | No | Maximum requests per minute. |
| `max_sessions` | integer | No | Maximum concurrent sessions per agent. |

## `audit` Object

```json
{
  "enabled": true,
  "endpoint": "/.well-known/agents/api/audit",
  "public_key": "MCowBQYDK2VwAyEA..."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `enabled` | boolean | No | Whether audit trails are produced. Default: `false`. |
| `endpoint` | string | No | URL to retrieve audit artifacts. Default: `/.well-known/agents/api/audit`. |
| `public_key` | string | No | Base64-encoded Ed25519 public key for offline artifact verification. |

## Full Example

```json
{
  "schema_version": "0.1.0",
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
        "page": { "type": "integer", "default": 1, "description": "Page number" },
        "limit": { "type": "integer", "default": 20, "description": "Results per page" }
      },
      "requires_session": false
    },
    {
      "name": "browse",
      "description": "List products with optional filters",
      "endpoint": "/.well-known/agents/api/browse",
      "method": "GET",
      "params": {
        "category": { "type": "string", "description": "Filter by category" },
        "sort": { "type": "string", "enum": ["price_asc", "price_desc", "newest"], "default": "newest" },
        "page": { "type": "integer", "default": 1 },
        "limit": { "type": "integer", "default": 20 }
      },
      "requires_session": false
    },
    {
      "name": "detail",
      "description": "Get full details for a product",
      "endpoint": "/.well-known/agents/api/detail",
      "method": "GET",
      "params": {
        "id": { "type": "string", "required": true, "description": "Product ID" }
      },
      "requires_session": false
    },
    {
      "name": "cart.add",
      "description": "Add a product to the cart",
      "endpoint": "/.well-known/agents/api/cart",
      "method": "POST",
      "params": {
        "item_id": { "type": "string", "required": true, "description": "Product ID" },
        "quantity": { "type": "integer", "required": true, "description": "Quantity to add" }
      },
      "requires_session": true
    },
    {
      "name": "cart.view",
      "description": "View the current cart",
      "endpoint": "/.well-known/agents/api/cart",
      "method": "GET",
      "requires_session": true
    },
    {
      "name": "cart.update",
      "description": "Update quantity of a cart item",
      "endpoint": "/.well-known/agents/api/cart",
      "method": "PATCH",
      "params": {
        "item_id": { "type": "string", "required": true, "description": "Product ID" },
        "quantity": { "type": "integer", "required": true, "description": "New quantity (0 to remove)" }
      },
      "requires_session": true
    },
    {
      "name": "cart.remove",
      "description": "Remove an item from the cart",
      "endpoint": "/.well-known/agents/api/cart",
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
    "ttl_seconds": 1800
  },
  "rate_limit": {
    "requests_per_minute": 60,
    "max_sessions": 5
  },
  "audit": {
    "enabled": true,
    "endpoint": "/.well-known/agents/api/audit",
    "public_key": "MCowBQYDK2VwAyEABkii3p4rtgXxez3sB2DfGel553kx4EAKWBLMFCYV6YM="
  },
  "docs_url": "https://acmeceramics.example.com/docs/agents"
}
```

## Validation

Implementations SHOULD validate `agents.json` against the [JSON Schema](schemas/agents.schema.json) before using it. At minimum, verify:

1. `schema_version` is present and is a valid semver string.
2. `site.name` and `site.url` are present.
3. `capabilities` is a non-empty array.
4. Each capability has `name`, `endpoint`, and `method`.
5. If any capability has `requires_session: true`, the site should have session configuration (or use defaults).
