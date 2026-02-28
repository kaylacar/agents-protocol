# Session Specification

**Version:** 0.1.0
**Status:** Draft

## Overview

Sessions are short-lived, scoped contexts for stateful agent interactions. Any capability that modifies state (adding to a cart, starting a checkout) requires a session. Sessions give the site a way to group related actions, enforce time limits, and produce audit trails.

Each session maps to exactly one RER envelope and one RER runtime instance when audit is enabled (see [Audit Trail](audit.md)).

## For AI Agents

If you are an AI agent, here is how sessions work in practice:

1. **Create a session** with `POST` to the `session.create` URL from `agents.json`.
2. **Store the `session_token`** from the response. You will need it for every session-required request.
3. **Send it as `Authorization: Bearer <session_token>`** on every request to a session-required capability (`cart.add`, `cart.view`, `cart.update`, `cart.remove`, `checkout`).
4. **Sessions expire.** Check `expires_at` in the response. Once expired, all requests with that token return `401`. Create a new session if you need more time.
5. **End the session** when done with `DELETE` to the `session.delete` URL, including the `Authorization: Bearer` header.
6. You do NOT need a session for `search`, `browse`, `detail`, or `contact`.

## Creating a Session

```
POST /.well-known/agents/api/session
Content-Type: application/json
```

### Request Body

The request body is optional. If provided, it can include:

```json
{
  "agent_name": "MyShoppingAgent",
  "agent_version": "1.0.0",
  "purpose": "Find and purchase a birthday gift"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `agent_name` | string | No | Name of the agent creating the session. |
| `agent_version` | string | No | Version of the agent. |
| `purpose` | string | No | Human-readable description of what the agent intends to do. Recorded in the audit trail. |

All fields are optional. A bare `POST` with an empty body is valid.

### Response

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "ok": true,
  "data": {
    "session_token": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "expires_at": "2026-02-19T13:30:00.000Z",
    "capabilities": [
      "cart.add",
      "cart.view",
      "cart.update",
      "cart.remove",
      "checkout"
    ]
  }
}
```

| Field | Type | Description |
|---|---|---|
| `session_token` | string | Opaque token the agent must include in subsequent requests. UUID format. |
| `expires_at` | string (ISO 8601) | When the session expires. |
| `capabilities` | array of strings | The session-required capabilities available in this session. |

When audit is enabled, the response also includes `"audit": true`.

## Using a Session

After creating a session, the agent includes the token in the `Authorization` header on every request to a session-required capability:

```
POST /.well-known/agents/api/cart/add
Content-Type: application/json
Authorization: Bearer a1b2c3d4-e5f6-7890-abcd-ef1234567890

{
  "item_id": "prod_9f8e7d",
  "quantity": 1
}
```

The server also accepts `X-Session-Token: <token>` as an alternative header.

If the header is missing or the token is invalid/expired, the site responds with `401 Unauthorized`:

```json
{
  "ok": false,
  "error": "Session token is missing, invalid, or expired."
}
```

Non-session capabilities (like `search` or `browse`) do not require the header. However, an agent MAY include it to associate those calls with a session for audit purposes.

## Session Expiry

Sessions have a time-to-live (TTL) defined in `agents.json` under `session.ttl_seconds`. The default is **3600 seconds** (1 hour).

- The TTL starts when the session is created.
- The TTL is **not** extended by activity. It is a hard deadline.
- Once expired, all requests with that session token return `401`.

If an agent needs more time, it should create a new session.

## Ending a Session

A session ends when any of the following happens:

### 1. Expiry

The session TTL elapses. No action needed from the agent.

### 2. Explicit End

The agent sends a `DELETE` request:

```
DELETE /.well-known/agents/api/session
Authorization: Bearer a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

Response:

```json
{
  "ok": true,
  "data": {
    "ended": true
  }
}
```

### 3. Checkout Completion

When a `checkout` capability with `human_handoff: true` succeeds, the session is considered complete. The site MAY end the session immediately or keep it alive until the TTL for the agent to view the final cart state.

## Session Lifecycle Diagram

```
Agent                                        Site
  |                                            |
  |  POST /session                             |
  |------------------------------------------->|
  |  200 { session_token, expires_at }         |
  |<-------------------------------------------|
  |                                            |   [RER envelope created if audit enabled]
  |  POST /cart/add                            |
  |  Authorization: Bearer tok_...             |
  |------------------------------------------->|
  |  200 { item_id, quantity, cart_size }       |   [RER event logged]
  |<-------------------------------------------|
  |                                            |
  |  POST /checkout                            |
  |  Authorization: Bearer tok_...             |
  |------------------------------------------->|
  |  200 { checkout_url, human_handoff: true } |   [RER event logged]
  |<-------------------------------------------|
  |                                            |
  |  DELETE /session                           |
  |  Authorization: Bearer tok_...             |
  |------------------------------------------->|
  |  200 { ended: true }                       |   [RER artifact signed]
  |<-------------------------------------------|
```

## Concurrency

- An agent MAY have multiple active sessions with the same site.
- Each session is independent. Cart contents are not shared across sessions.

## Security Considerations

- Session tokens MUST be treated as secrets. Agents MUST NOT log them in plain text or share them with other agents.
- Sites SHOULD bind sessions to the originating IP or agent identity where possible.
- Sites MUST invalidate all sessions if a security event is detected (e.g., key rotation).
- Session tokens MUST be generated using a cryptographically secure random number generator (CSPRNG). The SDK uses UUIDs.
