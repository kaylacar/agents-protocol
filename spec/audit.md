# Audit Trail Specification (RER Integration)

**Version:** 0.1.0
**Status:** Draft

## Overview

The audit trail gives agents, users, and site operators a cryptographic proof of what happened during a session. It answers three questions:

1. **What did the agent do?** -- Every capability call is logged.
2. **What policies were enforced?** -- Every policy check is recorded.
3. **Was anything tampered with?** -- The log is hash-chained and signed.

The audit system is powered by [RER (Runtime Enforcement and Recording)](https://github.com/kaylacar/rer). Sites that set `audit.enabled: true` in `agents.json` produce a signed artifact for every session.

## What RER Provides

RER is a lightweight runtime that provides three things the agents.txt protocol relies on:

- **Hash-chained event log.** Each event includes a SHA-256 hash of the previous event, forming an append-only chain. If any event is modified or removed after the fact, the chain breaks and verification fails.
- **Ed25519 signatures.** When a session ends, the complete event chain is signed with the site's Ed25519 private key. Anyone with the site's public key (published in `agents.json`) can verify the artifact offline.
- **Policy enforcement.** RER evaluates policy rules before each capability call. Policies can restrict which capabilities are available, enforce parameter constraints, or require human handoff. Policy decisions are recorded in the event log alongside the capability calls.

## How It Works

### 1. Session Start Creates an RER Envelope

When a session is created (see [Sessions](session.md)), the site creates a corresponding RER envelope. The envelope is scoped to the capabilities declared in `agents.json`.

```
Session created: tok_a1b2c3d4e5f6
  -> RER envelope created
  -> Capabilities loaded as policy rules
  -> Runtime initialized
```

The envelope records:
- Session token (hashed, not plaintext)
- Session start time
- Agent identity (if provided)
- Declared purpose (if provided)
- Available capabilities

### 2. Every Capability Call Goes Through the RER Runtime

When an agent calls a capability, the request passes through the RER runtime before reaching the site's handler:

```
Agent Request
  -> RER Policy Check (is this capability allowed? are params valid?)
  -> Site Handler (business logic)
  -> RER Event Log (record what happened)
  -> Response to Agent
```

Each event in the log contains:

| Field | Description |
|---|---|
| `event_id` | Unique event identifier. |
| `timestamp` | ISO 8601 timestamp. |
| `capability` | The capability name (e.g., `cart.add`). |
| `method` | HTTP method. |
| `params` | Request parameters (sensitive values redacted). |
| `policy_result` | `allow` or `deny`, with the rule that matched. |
| `response_status` | HTTP status code returned. |
| `prev_hash` | SHA-256 hash of the previous event (empty for the first event). |

### 3. Session End Produces a Signed Artifact

When the session ends (expiry, explicit `DELETE`, or checkout completion), the RER runtime:

1. Finalizes the event chain.
2. Computes a root hash over all events.
3. Signs the root hash with the site's Ed25519 private key.
4. Stores the signed artifact.

The artifact contains the full event chain plus the signature. It is self-contained and can be verified without contacting the site.

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
    "session_id": "tok_a1b2c3d4e5f6",
    "site": "https://acmeceramics.example.com",
    "created_at": "2026-02-19T13:00:00Z",
    "ended_at": "2026-02-19T13:15:00Z",
    "agent": {
      "name": "MyShoppingAgent",
      "version": "1.0.0",
      "purpose": "Find and purchase a birthday gift"
    },
    "events": [
      {
        "event_id": "evt_001",
        "timestamp": "2026-02-19T13:01:12Z",
        "capability": "search",
        "method": "GET",
        "params": { "q": "blue mugs" },
        "policy_result": "allow",
        "response_status": 200,
        "prev_hash": ""
      },
      {
        "event_id": "evt_002",
        "timestamp": "2026-02-19T13:02:45Z",
        "capability": "cart.add",
        "method": "POST",
        "params": { "item_id": "prod_9f8e7d", "quantity": 2 },
        "policy_result": "allow",
        "response_status": 201,
        "prev_hash": "a3f2b8c1d4e5..."
      },
      {
        "event_id": "evt_003",
        "timestamp": "2026-02-19T13:05:30Z",
        "capability": "checkout",
        "method": "POST",
        "params": {},
        "policy_result": "allow",
        "response_status": 200,
        "prev_hash": "b7e1c9d3f2a6..."
      }
    ],
    "root_hash": "c4d8e2f1a5b9...",
    "signature": "MEUCIQD...",
    "public_key": "MCowBQYDK2VwAyEA..."
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

1. **Get the public key.** It is in the artifact itself and in `agents.json` at `audit.public_key`. For strong verification, compare both sources.
2. **Verify the hash chain.** Recompute the SHA-256 hash of each event and confirm it matches the `prev_hash` of the next event.
3. **Verify the root hash.** Hash all events together and confirm the result matches `root_hash`.
4. **Verify the signature.** Use the Ed25519 public key to verify that `signature` is a valid signature of `root_hash`.

If all checks pass, the artifact is authentic and untampered.

### Pseudocode

```python
import hashlib
from ed25519 import verify

def verify_artifact(artifact):
    events = artifact["events"]

    # 1. Verify hash chain
    for i, event in enumerate(events):
        if i == 0:
            assert event["prev_hash"] == ""
        else:
            expected = sha256(serialize(events[i - 1]))
            assert event["prev_hash"] == expected

    # 2. Verify root hash
    chain = "".join(sha256(serialize(e)) for e in events)
    assert sha256(chain) == artifact["root_hash"]

    # 3. Verify signature
    verify(artifact["public_key"], artifact["root_hash"], artifact["signature"])

    return True
```

## Artifact Retention

Sites SHOULD retain audit artifacts for at least 30 days after session end. Sites MAY retain them longer. The retention period SHOULD be documented in the site's agent documentation.

After the retention period, the artifact endpoint returns `404`. However, any party that downloaded the artifact can still verify it offline using the public key.

## Privacy

- Sites MUST NOT include sensitive user data (passwords, payment details, full addresses) in audit events.
- The `params` field in each event SHOULD redact sensitive values (e.g., replace card numbers with `****`).
- The session token stored in the artifact SHOULD be hashed, not stored in plaintext.
- Agents SHOULD inform their users that audit artifacts exist and may be retrieved by the site operator or the user.

## When Audit Is Disabled

If `audit.enabled` is `false` (or the `audit` object is absent from `agents.json`):

- No RER envelope is created.
- No events are logged.
- The audit endpoint returns `404` for all session IDs.
- Sessions still work normally; they just do not produce artifacts.
