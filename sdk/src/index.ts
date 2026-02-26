export { AgentDoor } from './server';
export { SessionManager } from './session';
export { RateLimiter } from './rate-limiter';
// AuditManager re-exported conditionally — depends on optional @rer peer deps.
// Use: const { AuditManager } = require('@agents-protocol/sdk') — will be undefined if @rer not installed.
export type { AuditManager } from './audit';
export { generateAgentsTxt } from './agents-txt';
export { generateAgentsJson } from './agents-json';
export { search, browse, detail, cart, checkout, contact } from './capabilities';
export type { CapabilityHandler, RegisteredCapability } from './capabilities';
export type {
  SiteConfig,
  CapabilityDefinition,
  AgentDoorConfig,
  AgentRequest,
  FlowDefinition,
  SessionData,
  AgentResponse,
  AgentsJsonManifest,
  CartItem,
  OpenAPISpec,
} from './types';
