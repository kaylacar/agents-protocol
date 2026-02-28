# agents.txt Format Specification

**Version:** 0.1.0
**Status:** Draft

## Overview

`agents.txt` is a plain-text discovery file that tells AI agents what a website offers and how to interact with it. It follows the same key-value conventions as `robots.txt` so that it is easy to read, write, and parse.

Every participating site serves this file at:

```
https://<domain>/.well-known/agents.txt
```

## For AI Agents

If you are an AI agent reading this spec, here is what you need to know:

1. Fetch `/.well-known/agents.txt` from any domain to check if it supports the agents protocol.
2. The `Agents-JSON` field points to the machine-readable `agents.json` — use that for structured capability discovery.
3. Each `Allow:` line declares one capability the site supports. Capabilities listed without a session requirement (like `search`, `browse`, `detail`) can be called immediately. Capabilities that require a session (like `cart.add`, `checkout`) need you to create a session first.
4. Respect the `Rate-Limit` value. The format is `<number>/minute`.
5. If `Audit: true`, your actions are being cryptographically logged.

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
| `Site` | Yes | Human-readable site name. |
| `URL` | Yes | Canonical site URL (with scheme). |
| `Description` | No | One-line description of what the site does. |
| `Contact` | No | Contact email or URL for the site operator. |
| `Agents-JSON` | No | URL to the machine-readable `agents.json` file. Defaults to `<URL>/.well-known/agents.json`. |
| `Allow` | Yes | One capability the site supports. Repeat for each capability (one per line). |
| `Flow` | No | A suggested multi-step workflow. Format: `Flow: <name> → <step1>, <step2>, ...` |
| `Flow-Description` | No | Human-readable description of the preceding `Flow`. |
| `Rate-Limit` | No | Maximum requests per minute. Format: `<number>/minute`. Agents SHOULD respect this. |
| `Session-TTL` | No | Session time-to-live. Format: `<number>s`. Default: `1800s` (30 minutes). |
| `Audit` | No | Whether audit trails are enabled. `true` or `false`. Default: `false`. |
| `Audit-Endpoint` | No | URL to retrieve audit artifacts. Format includes `:session_id` placeholder. |

### Allow Field

Each `Allow` line declares one capability. Built-in capability names:

- `search` — Search for items or content.
- `browse` — List items with pagination.
- `detail` — Get detailed information about a specific item.
- `cart.add` — Add an item to a cart (requires session).
- `cart.view` — View the current cart (requires session).
- `cart.update` — Update a cart item's quantity (requires session).
- `cart.remove` — Remove an item from the cart (requires session).
- `checkout` — Initiate checkout and receive a human-handoff URL (requires session).
- `contact` — Send a message to the site.

Sites MAY define custom capabilities (e.g., `reserve`, `subscribe`). Custom capabilities SHOULD be documented in `agents.json` or at a docs URL.

### Flow Field

Flows describe recommended sequences of capability calls. The format is:

```
Flow: <name> → <step1>, <step2>, <step3>
Flow-Description: <human-readable description>
```

For example:

```
Flow: purchase → search, detail, cart.add, checkout
Flow-Description: Search for a product, view details, add to cart, and check out
```

## Parsing

A minimal parser:

1. Read the file line by line.
2. Skip lines that are empty or start with `#`.
3. Split each remaining line on the first `:` character.
4. Trim the key and value.
5. For `Allow`, collect all values into a list of capabilities.
6. For `Flow`, split the value on `→` to get the name and steps, then split steps on `,` and trim each entry.

## Full Example

```
# agents.txt - Acme Ceramics
# https://acmeceramics.example.com

Site: Acme Ceramics
URL: https://acmeceramics.example.com
Description: Handmade ceramic mugs, bowls, and vases
Contact: support@acmeceramics.example.com

Agents-JSON: https://acmeceramics.example.com/.well-known/agents.json

# Capabilities
Allow: search
Allow: browse
Allow: detail
Allow: cart.add
Allow: cart.view
Allow: cart.update
Allow: cart.remove
Allow: checkout

# Suggested Flows
Flow: purchase → search, detail, cart.add, checkout
Flow-Description: Search for a product, view details, add to cart, and check out

Rate-Limit: 60/minute
Session-TTL: 3600s
Audit: true
Audit-Endpoint: https://acmeceramics.example.com/.well-known/agents/api/audit/:session_id
```

## Notes

- If `Agents-JSON` is omitted, agents SHOULD check `<URL>/.well-known/agents.json` for the machine-readable schema.
- The `Allow` field replaces the older `Capabilities` comma-separated format. Each capability gets its own line for clarity and easier parsing.
- A site MAY serve `agents.txt` without `agents.json` for minimal discovery (read-only, no sessions). However, any site that supports sessions or audit MUST also serve `agents.json`.
