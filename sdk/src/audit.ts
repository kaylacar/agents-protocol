/**
 * AuditManager — RER-backed session auditor for agents-protocol.
 *
 * ## Architecture note
 * This class embeds @rer/runtime (Layer B — Proof) directly inside agents-protocol
 * rather than delegating to BoxRuntime (Layer C — Runtime Container). This is an
 * intentional pragmatic choice: agents-protocol is a lightweight SDK, not a full
 * container host, so we construct a Runtime per session here rather than shelling
 * out to a BoxRuntime process. The trade-off is that policy is enforced in-process
 * (still cryptographically sealed) rather than across a process boundary.
 *
 * ## Key format guide
 * Ed25519KeyPair.publicKey is a 44-byte DER SPKI Buffer (12-byte ASN.1 prefix + 32 raw bytes).
 * @rer/evidence safeVerify() expects a raw 32-byte Uint8Array.
 *   getPublicKeyRaw() → 32-byte Uint8Array  — for @rer/evidence verification
 *   getPublicKeyDER() → 44-byte Buffer       — for @rer/runtime internals
 *
 * ## Concurrency constraint
 * callCapability() uses a per-(session, capability) queue to hand off handlers to
 * the registered ToolExecutor. This queue is single-consumer: concurrent calls to
 * the SAME capability on the SAME session execute handlers in arrival order but must
 * not be truly parallel — the second awaited callTool() blocks until the first
 * executor has dequeued and run its handler. Different capabilities on the same
 * session, or the same capability on different sessions, are fully independent.
 */

import { randomUUID, createHash } from 'node:crypto';
import { Runtime } from '@rer/runtime';
import { generateEd25519KeyPair, ed25519Sign, canonicalize } from '@rer/core';
import type {
  Ed25519KeyPair,
  RuntimeEnvelope,
  RuntimeRunArtifact,
  ToolExecutor,
  ToolRequest,
  ToolResponse,
} from '@rer/core';

/** Byte offset where the raw 32-byte key begins inside a DER SPKI Ed25519 public key. */
const SPKI_PREFIX_BYTES = 12;

interface SessionEntry {
  runtime: Runtime;
  expiresAt: number; // ms since epoch
}

interface ArtifactEntry {
  artifact: RuntimeRunArtifact;
  expiresAt: number; // ms since epoch — evicted after one additional TTL window
}

export class AuditManager {
  private keyPair: Ed25519KeyPair;
  private sessions = new Map<string, SessionEntry>();
  private artifacts = new Map<string, ArtifactEntry>();
  private pendingHandlers = new Map<string, Array<() => Promise<unknown>>>();
  private ttlSeconds: number;
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(ttlSeconds: number = 3600) {
    this.keyPair = generateEd25519KeyPair();
    this.ttlSeconds = ttlSeconds;

    // Evict sessions whose TTL expired without an explicit endSession() call.
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), 60_000);
    // Let the Node process exit without waiting for this timer.
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  startSession(sessionToken: string, siteUrl: string, capabilityNames: string[]): void {
    // Gracefully seal any existing session for this token before overwriting.
    if (this.sessions.has(sessionToken)) {
      this.endSession(sessionToken);
    }

    const runId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);

    // Hash the session token for the audit artifact (spec: SHOULD NOT store plaintext).
    const hashedToken = createHash('sha256').update(sessionToken).digest('hex');

    const envelope: RuntimeEnvelope = {
      envelope_version: 'rer-envelope/0.1',
      run_id: runId,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      principal: { type: 'agent_session', id: hashedToken },
      permissions: {
        models: { allow: [], deny: [] },
        tools: { allow: capabilityNames, deny: [] },
        spend_caps: { max_usd: null },
        rate_limits: { max_model_calls: null, max_tool_calls: null },
        human_approval: { required_for_tools: [] },
      },
      context: { site: siteUrl },
      envelope_signature: '',
    };
    const { envelope_signature: _, ...signable } = envelope;
    envelope.envelope_signature = ed25519Sign(canonicalize(signable), this.keyPair.privateKey);

    // Register a pass-through executor for each capability.
    // The real handler is stored in pendingHandlers and executed when
    // runtime.callTool() invokes the executor.
    const toolExecutors: Record<string, ToolExecutor> = {};
    for (const name of capabilityNames) {
      toolExecutors[name] = async (_req: ToolRequest): Promise<ToolResponse> => {
        const key = `${sessionToken}:${name}`;
        const queue = this.pendingHandlers.get(key);
        const handler = queue?.shift();
        let result: unknown = {};
        if (handler) {
          result = await handler();
        }
        return { tool: name, output: { data: result } };
      };
    }

    const runtime = new Runtime({
      envelope,
      signerKeyPair: this.keyPair,
      toolExecutors,
    });
    runtime.start();

    this.sessions.set(sessionToken, { runtime, expiresAt: expiresAt.getTime() });
  }

  /**
   * Execute a capability through the RER runtime so it gets logged
   * as ToolCalled + ToolReturned events in the hash chain.
   *
   * If the runtime denies the call (PolicyDeniedError), the error propagates
   * immediately — the handler is never invoked and the queued entry is removed.
   * There is no fallback path when an active session exists.
   */
  async callCapability(
    sessionToken: string,
    capabilityName: string,
    requestData: Record<string, unknown>,
    handler: () => Promise<unknown>,
  ): Promise<unknown> {
    const entry = this.sessions.get(sessionToken);
    if (!entry) {
      // No active session — run handler directly (no audit trail for this call).
      console.warn(`[AuditManager] No active audit session for token ${sessionToken.slice(0, 8)}…; capability '${capabilityName}' will not be audited.`);
      return handler();
    }

    // Queue the handler so the registered executor can pick it up.
    const key = `${sessionToken}:${capabilityName}`;
    let queue = this.pendingHandlers.get(key);
    if (!queue) {
      queue = [];
      this.pendingHandlers.set(key, queue);
    }
    queue.push(handler);

    try {
      const result = await entry.runtime.callTool({
        tool: capabilityName,
        input: requestData,
      });
      return result.output.data;
    } catch (err) {
      // Remove the stale queued handler — the executor will not run it.
      const queue = this.pendingHandlers.get(key);
      queue?.shift();
      // All errors propagate unconditionally. PolicyDeniedError must never be
      // swallowed or bypassed — policy enforcement is the entire point of this class.
      throw err;
    }
  }

  endSession(sessionToken: string): RuntimeRunArtifact | null {
    const entry = this.sessions.get(sessionToken);
    if (!entry) return null; // no session — not an error, caller checks

    try {
      entry.runtime.end('completed', 'Session ended');
    } catch (err) {
      console.warn(`[AuditManager] runtime.end() failed for session ${sessionToken}:`, err);
    }

    let artifact: RuntimeRunArtifact;
    try {
      artifact = entry.runtime.buildArtifact();
    } catch (err) {
      // Artifact construction failure must be visible — a silent failure means
      // audit records are lost with no indication to the caller.
      console.error(`[AuditManager] buildArtifact() failed for session ${sessionToken}:`, err);
      this.sessions.delete(sessionToken);
      this.clearPendingHandlers(sessionToken);
      return null;
    }

    this.artifacts.set(sessionToken, { artifact, expiresAt: Date.now() + this.ttlSeconds * 1000 });
    this.sessions.delete(sessionToken);
    this.clearPendingHandlers(sessionToken);

    return artifact;
  }

  getArtifact(sessionToken: string): RuntimeRunArtifact | null {
    return this.artifacts.get(sessionToken)?.artifact ?? null;
  }

  /**
   * Returns the raw 32-byte Ed25519 public key as a Uint8Array.
   * Use this with @rer/evidence safeVerify().
   */
  getPublicKeyRaw(): Uint8Array {
    // keyPair.publicKey is a 44-byte DER SPKI Buffer; the raw key starts at byte 12.
    return new Uint8Array(this.keyPair.publicKey.subarray(SPKI_PREFIX_BYTES, SPKI_PREFIX_BYTES + 32));
  }

  /**
   * Returns the full 44-byte DER SPKI Buffer.
   * Use this when passing to @rer/runtime internals that expect the DER format.
   */
  getPublicKeyDER(): Buffer {
    return this.keyPair.publicKey;
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
    for (const [token, entry] of this.sessions) {
      try {
        entry.runtime.end('completed', 'Shutdown');
        const artifact = entry.runtime.buildArtifact();
        this.artifacts.set(token, { artifact, expiresAt: Date.now() + this.ttlSeconds * 1000 });
      } catch (err) {
        console.warn(`[AuditManager] Failed to seal session ${token} during shutdown:`, err);
      }
    }
    this.sessions.clear();
    this.pendingHandlers.clear();
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [token, entry] of this.sessions) {
      if (now >= entry.expiresAt) {
        try {
          entry.runtime.end('completed', 'TTL expired');
          const artifact = entry.runtime.buildArtifact();
          this.artifacts.set(token, { artifact, expiresAt: now + this.ttlSeconds * 1000 });
        } catch (err) {
          console.warn(`[AuditManager] Failed to seal expired session ${token}:`, err);
        }
        this.sessions.delete(token);
        this.clearPendingHandlers(token);
      }
    }
    // Evict sealed artifacts whose retention window has elapsed.
    for (const [token, entry] of this.artifacts) {
      if (now >= entry.expiresAt) {
        this.artifacts.delete(token);
      }
    }
  }

  private clearPendingHandlers(sessionToken: string): void {
    for (const key of this.pendingHandlers.keys()) {
      if (key.startsWith(sessionToken + ':')) {
        this.pendingHandlers.delete(key);
      }
    }
  }
}
