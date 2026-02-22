# Session Specification

**Version:** 0.1.0
**Status:** Draft

## Overview

Sessions are short-lived, scoped contexts for stateful agent interactions. Any capability that modifies state (adding to a cart, starting a checkout) requires a session. Sessions give the site a way to group related actions, enforce time limits, and produce audit trails.

Each session maps to exactly one RER envelope and one RER runtime instance (see [Audit Trail](audit.md)).

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
HTTP/1.1 201 Created
Content-Type: application/json

{
  "ok": true,
  "data": {
    "session_token": "tok_a1b2c3d4e5f6",
    "expires_at": "2026-02-19T13:30:00Z",
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
| `session_token` | string | Opaque token the agent must include in subsequent requests. |
| `expires_at` | string (ISO 8601) | When the session expires. |
| `capabilities` | array of strings | The session-required capabilities available in this session. |

The `session_token` format is implementation-defined. It MUST be at least 32 characters and cryptographically random.

## Using a Session

After creating a session, the agent includes the token in the `X-Agent-Session` header on every request to a session-required capability:

```
POST /.well-known/agents/api/cart
Content-Type: application/json
X-Agent-Session: tok_a1b2c3d4e5f6

{
  "item_id": "prod_9f8e7d",
  "quantity": 1
}
```

If the header is missing or the token is invalid/expired, the site responds with `401 Unauthorized`:

```json
{
  "ok": false,
  "error": "Session token is missing, invalid, or expired."
}
```

Non-session capabilities (like `search` or `browse`) do not require the header. However, an agent MAY include it to associate those calls with a session for audit purposes.

## Session Expiry

Sessions have a time-to-live (TTL) defined in `agents.json` under `session.ttl`. The default is **1800 seconds** (30 minutes).

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
X-Agent-Session: tok_a1b2c3d4e5f6
```

Response:

```json
{
  "ok": true,
  "data": {
    "session_token": "tok_a1b2c3d4e5f6",
    "ended_at": "2026-02-19T13:15:00Z",
    "audit_artifact_url": "/.well-known/agents/api/audit/tok_a1b2c3d4e5f6"
  }
}
```

If audit is enabled, the response includes the URL where the signed audit artifact can be retrieved.

### 3. Checkout Completion

When a `checkout` capability with `human_handoff: true` succeeds, the session is considered complete. The site MAY end the session immediately or keep it alive until the TTL for the agent to view the final cart state.

## Session Lifecycle Diagram

```
Agent                                   Site
  |                                       |
  |  POST /session                        |
  |-------------------------------------->|
  |  201 { session_token, expires_at }    |
  |<--------------------------------------|
  |                                       |   [RER envelope created]
  |  POST /cart  (X-Agent-Session: tok)   |
  |-------------------------------------->|
  |  201 { cart }                         |   [RER event logged]
  |<--------------------------------------|
  |                                       |
  |  POST /checkout (X-Agent-Session: tok)|
  |-------------------------------------->|
  |  200 { handoff_url }                  |   [RER event logged]
  |<--------------------------------------|
  |                                       |
  |  DELETE /session (X-Agent-Session: tok)|
  |-------------------------------------->|
  |  200 { ended_at, audit_artifact_url } |   [RER artifact signed]
  |<--------------------------------------|
```

## Concurrency

- An agent MAY have multiple active sessions with the same site, up to the `rate_limit.max_sessions` limit.
- Each session is independent. Cart contents are not shared across sessions.
- Sites SHOULD enforce the `max_sessions` limit and return `429` if exceeded.

## Security Considerations

- Session tokens MUST be treated as secrets. Agents MUST NOT log them in plain text or share them with other agents.
- Sites SHOULD bind sessions to the originating IP or agent identity where possible.
- Sites MUST invalidate all sessions if a security event is detected (e.g., key rotation).
- Session tokens MUST be generated using a cryptographically secure random number generator (CSPRNG).
