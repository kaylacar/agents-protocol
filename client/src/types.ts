// agents.json structures (as returned by a site)

export interface AgentsSiteInfo {
  name: string;
  url: string;
  description?: string;
  contact?: string;
}

export interface AgentsCapabilityParam {
  type: string;
  required?: boolean;
  description?: string;
}

export interface AgentsCapability {
  name: string;
  description: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpoint: string;
  params?: Record<string, AgentsCapabilityParam>;
  requires_session?: boolean;
  human_handoff?: boolean;
}

/** Suggested step sequence for a common agent task */
export interface AgentsFlow {
  name: string;
  description: string;
  steps: string[];
}

export interface AgentsSessionConfig {
  create: string;
  delete?: string;
  ttl_seconds?: number;
}

export interface AgentsAuditConfig {
  enabled: boolean;
  endpoint: string;
  description?: string;
}

export interface AgentsManifest {
  schema_version: string;
  site: AgentsSiteInfo;
  capabilities: AgentsCapability[];
  flows?: AgentsFlow[];
  session: AgentsSessionConfig;
  rate_limit?: { requests_per_minute: number };
  audit?: AgentsAuditConfig;
}

// Session returned after creation

export interface AgentSession {
  session_token: string;
  expires_at: string;
  capabilities: string[];
  audit?: boolean;
}

// Generic API response wrapper

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

// Cart types

export interface CartItem {
  itemId: string;
  name?: string;
  quantity: number;
  price?: number;
}

export interface CartView {
  items: CartItem[];
  subtotal: number;
}

// Checkout

export interface CheckoutResult {
  checkout_url: string;
  human_handoff: true;
}

// Client config

export interface AgentClientConfig {
  /** User-Agent string sent with every request */
  userAgent?: string;
  /** Fetch implementation (defaults to global fetch) */
  fetch?: typeof fetch;
  /** Maximum retries on 429 rate-limit responses. Default: 3 */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff on retries. Default: 1000 */
  retryDelay?: number;
  /** Default page size for paginate(). Default: 20 */
  pageSize?: number;
  /** Request timeout in milliseconds. Default: 30000 (30s). 0 = no timeout. */
  timeout?: number;
}
