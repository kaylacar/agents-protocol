/**
 * Minimal type declarations for @rer/core and @rer/runtime.
 * These stubs allow the SDK to compile without the optional @rer peer
 * dependencies installed. When @rer packages are present, their actual
 * types take precedence via node_modules resolution.
 */

declare module '@rer/core' {
  export interface Ed25519KeyPair {
    publicKey: Buffer;
    privateKey: Buffer;
  }
  export interface RuntimeEnvelope {
    envelope_version: string;
    run_id: string;
    created_at: string;
    expires_at: string;
    principal: { type: string; id: string };
    permissions: {
      models: { allow: string[]; deny: string[] };
      tools: { allow: string[]; deny: string[] };
      spend_caps: { max_usd: number | null };
      rate_limits: { max_model_calls: number | null; max_tool_calls: number | null };
      human_approval: { required_for_tools: string[] };
    };
    context: Record<string, unknown>;
    envelope_signature: string;
  }
  export interface RuntimeRunArtifact {
    run_id: string;
    envelope: RuntimeEnvelope;
    events: Array<{
      header: {
        event_type: string;
        event_hash: string;
        parent_event_hash: string | null;
      };
      payload: Record<string, unknown>;
    }>;
    runtime_signature: string;
  }
  export interface ToolRequest {
    tool: string;
    input: Record<string, unknown>;
  }
  export interface ToolResponse {
    tool: string;
    output: { data: unknown };
  }
  export type ToolExecutor = (req: ToolRequest) => Promise<ToolResponse>;
  export class PolicyDeniedError extends Error {}
  export function generateEd25519KeyPair(): Ed25519KeyPair;
  export function ed25519Sign(data: string, privateKey: Buffer): string;
  export function canonicalize(obj: unknown): string;
}

declare module '@rer/runtime' {
  import type {
    RuntimeEnvelope,
    Ed25519KeyPair,
    ToolExecutor,
    ToolRequest,
    RuntimeRunArtifact,
  } from '@rer/core';

  export class Runtime {
    constructor(opts: {
      envelope: RuntimeEnvelope;
      signerKeyPair: Ed25519KeyPair;
      toolExecutors: Record<string, ToolExecutor>;
    });
    start(): void;
    callTool(req: ToolRequest): Promise<{ output: { data: unknown } }>;
    end(status: string, message: string): void;
    buildArtifact(): RuntimeRunArtifact;
  }
}
