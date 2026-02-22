# agents.txt Format Specification

**Version:** 0.1.0
**Status:** Draft

## Overview

`agents.txt` is a plain-text discovery file that tells AI agents what a website offers and how to interact with it. It follows the same key-value conventions as `robots.txt` so that it is easy to read, write, and parse.

Every participating site serves this file at:

```
https://<domain>/.well-known/agents.txt
```

## Format Rules

1. Each line is either a **field**, a **comment**, or **blank**.
2. Fields use the format `Key: Value`.
3. Keys are case-insensitive. Values are trimmed of leading/trailing whitespace.
4. Lines starting with `#` are comments and are ignored by parsers.
5. Blank lines are ignored.
6. The file MUST be served with `Content-Type: text/plain; charset=utf-8`.

## Fields

| Field | Required | Description |
|---|---|---|
| `Name` | Yes | Human-readable site name. |
| `URL` | Yes | Canonical site URL (with scheme). |
| `Description` | No | One-line description of what the site does. |
| `Contact` | No | Contact email or URL for the site operator. |
| `Capabilities` | Yes | Comma-separated list of capability names the site supports. |
| `Capabilities-URL` | No | URL to the machine-readable agents.json file. Defaults to `/.well-known/agents.json`. |
| `Agent-API` | No | Base URL for the interaction API. Defaults to `/.well-known/agents/api`. |
| `Session-Endpoint` | No | URL to create a session. Defaults to `<Agent-API>/session`. |
| `Docs` | No | URL to human-readable documentation for the site's agent capabilities. |
| `Rate-Limit` | No | Maximum requests per minute. Agents SHOULD respect this. |
| `Session-TTL` | No | Session time-to-live in seconds. Default: `1800` (30 minutes). |
| `Audit` | No | Whether audit trails are enabled. `true` or `false`. Default: `false`. |
| `Audit-Endpoint` | No | URL to retrieve audit artifacts. Defaults to `<Agent-API>/audit`. |

### Capabilities Field

The `Capabilities` value is a comma-separated list. Whitespace around each name is trimmed. Built-in capability names:

- `search` -- Search for items or content.
- `browse` -- List items with pagination.
- `detail` -- Get detailed information about a specific item.
- `cart.add` -- Add an item to a cart (requires session).
- `cart.view` -- View the current cart (requires session).
- `cart.update` -- Update a cart item's quantity (requires session).
- `cart.remove` -- Remove an item from the cart (requires session).
- `checkout` -- Initiate checkout and receive a human-handoff URL (requires session).
- `contact` -- Send a message to the site.

Sites MAY define custom capabilities (e.g., `reserve`, `subscribe`). Custom capabilities SHOULD be documented at the `Docs` URL.

## Parsing

A minimal parser:

1. Read the file line by line.
2. Skip lines that are empty or start with `#`.
3. Split each remaining line on the first `:` character.
4. Trim the key and value.
5. For `Capabilities`, split the value on `,` and trim each entry.

## Full Example

```
# agents.txt — Acme Ceramics
# https://acmeceramics.example.com

Name: Acme Ceramics
URL: https://acmeceramics.example.com
Description: Handmade ceramic mugs, bowls, and vases
Contact: support@acmeceramics.example.com

# What agents can do here
Capabilities: search, browse, detail, cart.add, cart.view, cart.update, cart.remove, checkout

# Endpoints (all defaults shown explicitly)
Capabilities-URL: https://acmeceramics.example.com/.well-known/agents.json
Agent-API: https://acmeceramics.example.com/.well-known/agents/api
Session-Endpoint: https://acmeceramics.example.com/.well-known/agents/api/session

# Docs for agent developers
Docs: https://acmeceramics.example.com/docs/agents

# Limits
Rate-Limit: 60
Session-TTL: 3600

# Audit trail (RER-backed)
Audit: true
Audit-Endpoint: https://acmeceramics.example.com/.well-known/agents/api/audit
```

## Notes

- If `Capabilities-URL` is omitted, agents SHOULD check `/.well-known/agents.json` for the machine-readable schema.
- If `Agent-API` is omitted, agents SHOULD use `/.well-known/agents/api` as the base path.
- A site MAY serve `agents.txt` without `agents.json` for minimal discovery (read-only, no sessions). However, any site that supports sessions or audit MUST also serve `agents.json`.
