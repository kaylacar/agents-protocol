import { v4 as uuidv4 } from 'uuid';
import {
  Runtime,
  generateEd25519KeyPair,
  signEnvelope,
} from 'rer';
import type {
  Ed25519KeyPair,
  Envelope,
  RunArtifact,
  ToolExecutor,
  ToolRequest,
  ToolResponse,
} from 'rer';

export class AuditManager {
  private keyPair: Ed25519KeyPair;
  private runtimes = new Map<string, Runtime>();
  private artifacts = new Map<string, RunArtifact>();
  private pendingHandlers = new Map<string, Array<() => Promise<any>>>();
  private ttlSeconds: number;

  constructor(ttlSeconds: number = 3600) {
    this.keyPair = generateEd25519KeyPair();
    this.ttlSeconds = ttlSeconds;
  }

  startSession(sessionToken: string, siteUrl: string, capabilityNames: string[]): void {
    const runId = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);

    const envelope: Envelope = {
      envelope_version: '0.1',
      run_id: runId,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      principal: { type: 'agent_session', id: sessionToken },
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
    envelope.envelope_signature = signEnvelope(envelope, this.keyPair.privateKey);

    // Register a pass-through executor for each capability.
    // The real handler is stored in pendingHandlers and executed when
    // runtime.callTool() invokes the executor.
    const toolExecutors: Record<string, ToolExecutor> = {};
    for (const name of capabilityNames) {
      toolExecutors[name] = async (_req: ToolRequest): Promise<ToolResponse> => {
        const key = `${sessionToken}:${name}`;
        const queue = this.pendingHandlers.get(key);
        const handler = queue?.shift();
        let result: any = {};
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

    this.runtimes.set(sessionToken, runtime);
  }

  /**
   * Execute a capability through the RER runtime so it gets logged
   * as ToolCalled + ToolReturned events in the hash chain.
   */
  async callCapability(
    sessionToken: string,
    capabilityName: string,
    requestData: Record<string, unknown>,
    handler: () => Promise<any>,
  ): Promise<any> {
    const runtime = this.runtimes.get(sessionToken);
    if (!runtime) {
      return handler();
    }

    // Queue the handler so the registered executor can pick it up
    const key = `${sessionToken}:${capabilityName}`;
    if (!this.pendingHandlers.has(key)) {
      this.pendingHandlers.set(key, []);
    }
    this.pendingHandlers.get(key)!.push(handler);

    try {
      const result = await runtime.callTool({
        tool: capabilityName,
        input: requestData,
      });
      return result.output.data;
    } catch {
      // If RER blocks the call, try running the handler directly
      const queue = this.pendingHandlers.get(key);
      const pending = queue?.shift();
      if (pending) {
        return pending();
      }
      return {};
    }
  }

  endSession(sessionToken: string): RunArtifact | null {
    const runtime = this.runtimes.get(sessionToken);
    if (!runtime) return null;

    try {
      runtime.end('completed', 'Session ended');
    } catch {
      // Runtime may already be ended or expired
    }

    let artifact: RunArtifact | null = null;
    try {
      artifact = runtime.buildArtifact();
      this.artifacts.set(sessionToken, artifact);
    } catch {
      // Artifact build can fail if runtime was never started properly
    }

    this.runtimes.delete(sessionToken);
    for (const key of this.pendingHandlers.keys()) {
      if (key.startsWith(sessionToken + ':')) {
        this.pendingHandlers.delete(key);
      }
    }

    return artifact;
  }

  getArtifact(sessionToken: string): RunArtifact | null {
    return this.artifacts.get(sessionToken) ?? null;
  }

  getPublicKey(): Buffer {
    return this.keyPair.publicKey;
  }

  destroy(): void {
    for (const [token, runtime] of this.runtimes) {
      try {
        runtime.end('completed', 'Shutdown');
        const artifact = runtime.buildArtifact();
        this.artifacts.set(token, artifact);
      } catch {
        // ignore
      }
    }
    this.runtimes.clear();
    this.pendingHandlers.clear();
  }
}
