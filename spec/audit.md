# Audit Trail Specification (RER Integration)

**Version:** 0.1.0
**Status:** Draft

## Overview

The audit trail gives agents, users, and site operators a cryptographic proof of what happened during a session. It answers three questions:

1. **What did the agent do?** — Every capability call is logged as a pair of events (`ToolCalled` + `ToolReturned`).
2. **What policies were enforced?** — The RER envelope records which capabilities were permitted.
3. **Was anything tampered with?** — The event log is hash-chained and the artifact is signed with Ed25519.

The audit system is powered by [RER (Runtime Enforcement and Recording)](https://github.com/kaylacar/rer). Sites that set `audit.enabled: true` in `agents.json` produce a signed artifact for every session.

## For AI Agents

If you are an AI agent, here is what audit means for you:

1. **Check `agents.json`:** If `audit.enabled` is `true`, your actions are being cryptographically logged.
2. **No extra work required.** Audit is transparent — you use the same API, same headers, same requests. The logging happens server-side.
3. **After ending a session**, you can retrieve the signed artifact at the `audit.endpoint` URL (replace `:session_id` with your session token).
4. **The artifact is self-contained.** It includes the full event chain, envelope, and signature. You or your operator can verify it offline.
5. **If audit is disabled**, the audit endpoint returns `404`. Sessions still work normally.

## What RER Provides

RER is a lightweight runtime that provides three things the agents protocol relies on:

- **Hash-chained event log.** Each event includes a hash of the previous event, forming an append-only chain. If any event is modified or removed after the fact, the chain breaks and verification fails.
- **Ed25519 signatures.** When a session ends, the complete event chain is signed with the site's Ed25519 private key. Anyone with the site's public key can verify the artifact offline.
- **Policy enforcement.** RER evaluates policy rules before each capability call. The permitted capabilities are recorded in the envelope. Policy decisions are enforced in-process and cryptographically sealed.

## How It Works

### 1. Session Start Creates an RER Envelope

When a session is created (see [Sessions](session.md)), the site creates a corresponding RER envelope. The envelope is scoped to the capabilities declared in `agents.json`.

```
Session created: a1b2c3d4-e5f6-7890-abcd-ef1234567890
  -> RER envelope created
  -> Capabilities loaded as permitted tools
  -> Runtime initialized
```

The envelope records:

```json
{
  "envelope_version": "rer-envelope/0.1",
  "run_id": "unique-run-uuid",
  "created_at": "2026-02-19T13:00:00.000Z",
  "expires_at": "2026-02-19T14:00:00.000Z",
  "principal": {
    "type": "agent_session",
    "id": "session-token-value"
  },
  "permissions": {
    "models": { "allow": [], "deny": [] },
    "tools": {
      "allow": ["search", "browse", "detail", "cart.add", "cart.view", "cart.update", "cart.remove", "checkout"],
      "deny": []
    },
    "spend_caps": { "max_usd": null },
    "rate_limits": { "max_model_calls": null, "max_tool_calls": null },
    "human_approval": { "required_for_tools": [] }
  },
  "context": {
    "site": "https://acmeceramics.example.com"
  },
  "envelope_signature": "base64-ed25519-signature..."
}
```

### 2. Every Capability Call Goes Through the RER Runtime

When an agent calls a capability, the request passes through the RER runtime before reaching the site's handler:

```
Agent Request
  -> RER Policy Check (is this capability in the permitted tools list?)
  -> ToolCalled event logged (capability name + input params)
  -> Site Handler (business logic)
  -> ToolReturned event logged (capability name + output data)
  -> Response to Agent
```

Events are logged as `ToolCalled` and `ToolReturned` pairs. Each event includes the capability name (`tool`), the input/output data, and a hash link to the previous event in the chain.

### 3. Session End Produces a Signed Artifact

When the session ends (expiry, explicit `DELETE`, or checkout completion), the RER runtime:

1. Finalizes the event chain.
2. Signs the artifact with the site's Ed25519 private key.
3. Stores the signed artifact for retrieval.

## Retrieving an Audit Artifact

```
GET /.well-known/agents/api/audit/:session_id
```

The `:session_id` is the session token from the original session.

### Response

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "ok": true,
  "data": {
    "run_id": "unique-run-uuid",
    "envelope": {
      "envelope_version": "rer-envelope/0.1",
      "run_id": "unique-run-uuid",
      "created_at": "2026-02-19T13:00:00.000Z",
      "expires_at": "2026-02-19T14:00:00.000Z",
      "principal": {
        "type": "agent_session",
        "id": "session-token-value"
      },
      "permissions": {
        "tools": {
          "allow": ["search", "cart.add", "cart.view", "checkout"],
          "deny": []
        }
      },
      "context": { "site": "https://acmeceramics.example.com" },
      "envelope_signature": "base64..."
    },
    "events": [
      {
        "header": {
          "event_type": "ToolCalled",
          "event_hash": "sha256-hash...",
          "parent_event_hash": ""
        },
        "payload": {
          "tool": "search",
          "input": { "q": "blue mugs" }
        }
      },
      {
        "header": {
          "event_type": "ToolReturned",
          "event_hash": "sha256-hash...",
          "parent_event_hash": "sha256-hash-of-previous..."
        },
        "payload": {
          "tool": "search",
          "output": { "data": "..." }
        }
      },
      {
        "header": {
          "event_type": "ToolCalled",
          "event_hash": "sha256-hash...",
          "parent_event_hash": "sha256-hash-of-previous..."
        },
        "payload": {
          "tool": "cart.add",
          "input": { "item_id": "prod_9f8e7d", "quantity": 2 }
        }
      },
      {
        "header": {
          "event_type": "ToolReturned",
          "event_hash": "sha256-hash...",
          "parent_event_hash": "sha256-hash-of-previous..."
        },
        "payload": {
          "tool": "cart.add",
          "output": { "data": { "item_id": "prod_9f8e7d", "quantity": 2, "cart_size": 1 } }
        }
      }
    ],
    "runtime_signature": "base64-ed25519-signature...",
    "envelope_signature": "base64-ed25519-signature..."
  }
}
```

### Error Responses

| Code | Meaning |
|---|---|
| `404` | Session not found or audit not enabled for this session. |
| `425` | Session is still active. Artifact not yet produced. |

## Offline Verification

Anyone can verify an audit artifact without contacting the site:

1. **Verify the hash chain.** Walk through the `events` array. Each event's `header.parent_event_hash` should match the `header.event_hash` of the previous event. The first event should have an empty `parent_event_hash`.
2. **Verify the envelope signature.** Use the site's Ed25519 public key (from `agents.json` at `audit.public_key` or from the artifact's envelope) to verify `envelope_signature` against the canonical envelope contents.
3. **Verify the runtime signature.** Verify `runtime_signature` against the complete event chain using the same public key.

If all checks pass, the artifact is authentic and untampered.

## Artifact Retention

Sites SHOULD retain audit artifacts for at least one session TTL window after the session ends. The SDK retains artifacts for one additional TTL window after session expiry, then evicts them. Sites MAY retain them longer.

After the retention period, the artifact endpoint returns `404`. However, any party that downloaded the artifact can still verify it offline using the public key.

## Privacy

- Sites MUST NOT include sensitive user data (passwords, payment details, full addresses) in audit events.
- The `input` and `output` fields in events SHOULD redact sensitive values.
- Agents SHOULD inform their users that audit artifacts exist and may be retrieved by the site operator or the user.

## When Audit Is Disabled

If `audit.enabled` is `false` (or the `audit` object is absent from `agents.json`):

- No RER envelope is created.
- No events are logged.
- The audit endpoint returns `404` for all session IDs.
- Sessions still work normally; they just do not produce artifacts.
