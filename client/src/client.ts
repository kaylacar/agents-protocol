import { AgentsManifest, AgentSession, AgentClientConfig, AgentsCapability, AgentsFlow, CartItem, CartView, CheckoutResult } from './types';
import { discover, discoverTxt } from './discover';
import { createSession, endSession } from './session';
import { request, AgentClientError } from './http';

export class AgentClient {
  private manifest: AgentsManifest | null = null;
  private session: AgentSession | null = null;
  private siteUrl: string;
  private fetchImpl: typeof fetch;
  private userAgent: string;
  private maxRetries: number;
  private retryDelay: number;
  private pageSize: number;

  constructor(siteUrl: string, config: AgentClientConfig = {}) {
    this.siteUrl = siteUrl.replace(/\/$/, '');
    if (this.siteUrl.startsWith('http://') && !config.allowInsecure) {
      console.warn(
        `[AgentClient] Connecting over insecure HTTP to ${this.siteUrl}. ` +
        'Set { allowInsecure: true } to suppress this warning.',
      );
    }
    this.fetchImpl = config.fetch ?? fetch;
    this.userAgent = config.userAgent ?? '@agents-protocol/client/0.1.0';
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelay = config.retryDelay ?? 1000;
    this.pageSize = config.pageSize ?? 20;
  }

  /** Fetch agents.json and learn what this site supports (cached after first call) */
  async discover(): Promise<AgentsManifest> {
    if (!this.manifest) {
      this.manifest = await discover(this.siteUrl, this.fetchImpl);
    }
    return this.manifest;
  }

  /** Get the human-readable agents.txt */
  async discoverTxt(): Promise<string> {
    return discoverTxt(this.siteUrl, this.fetchImpl);
  }

  /** Return the site's suggested flows, if any */
  async flows(): Promise<AgentsFlow[]> {
    const manifest = await this.getManifest();
    return manifest.flows ?? [];
  }

  /** Create a session (required for cart, checkout, and other session-gated capabilities) */
  async connect(): Promise<AgentSession> {
    const manifest = await this.getManifest();
    this.session = await createSession(manifest, this.fetchImpl);
    return this.session;
  }

  /** End the current session and seal the audit trail */
  async disconnect(): Promise<void> {
    if (!this.session) return;
    const manifest = await this.getManifest();
    await endSession(manifest.session.create, this.session.session_token, this.fetchImpl);
    this.session = null;
  }

  /** Check if a capability is supported by this site */
  supports(capabilityName: string): boolean {
    return !!this.manifest?.capabilities.find(c => c.name === capabilityName);
  }

  /** Get the manifest (auto-discovers if not yet fetched) */
  async getManifest(): Promise<AgentsManifest> {
    if (!this.manifest) await this.discover();
    return this.manifest!;
  }

  // --- Typed capability methods ---

  /** Search the site for items matching a query */
  async search(query: string, options?: { limit?: number }): Promise<unknown[]> {
    const cap = await this.requireCapability('search');
    const res = await request<unknown[]>(cap.endpoint, {
      method: 'GET',
      query: { q: query, limit: options?.limit },
      headers: this.authHeaders(),
      fetchImpl: this.fetchImpl,
    });
    return this.unwrap(res, 'search');
  }

  /** Browse items with pagination and filtering */
  async browse(options?: {
    page?: number;
    limit?: number;
    category?: string;
    filters?: Record<string, string>;
  }): Promise<{ items: unknown[]; total: number }> {
    const cap = await this.requireCapability('browse');
    const res = await request<{ items: unknown[]; total: number }>(cap.endpoint, {
      method: 'GET',
      query: { page: options?.page, limit: options?.limit, category: options?.category, ...options?.filters },
      headers: this.authHeaders(),
      fetchImpl: this.fetchImpl,
    });
    return this.unwrap(res, 'browse');
  }

  /** Get full details for a specific item by ID */
  async detail(id: string): Promise<unknown> {
    const cap = await this.requireCapability('detail');
    const endpoint = cap.endpoint.replace(':id', encodeURIComponent(id));
    const res = await request<unknown>(endpoint, {
      method: 'GET',
      headers: this.authHeaders(),
      fetchImpl: this.fetchImpl,
    });
    return this.unwrap(res, 'detail');
  }

  /** Add an item to the cart (requires session) */
  async cartAdd(itemId: string, quantity: number, meta?: { name?: string; price?: number }): Promise<{ item_id: string; quantity: number; cart_size: number }> {
    await this.requireSession();
    const cap = await this.requireCapability('cart.add');
    const res = await request<{ item_id: string; quantity: number; cart_size: number }>(cap.endpoint, {
      method: 'POST',
      body: { item_id: itemId, quantity, ...meta },
      headers: this.authHeaders(),
      fetchImpl: this.fetchImpl,
    });
    return this.unwrap(res, 'cart.add');
  }

  /** View current cart contents (requires session) */
  async cartView(): Promise<CartView> {
    await this.requireSession();
    const cap = await this.requireCapability('cart.view');
    const res = await request<CartView>(cap.endpoint, {
      method: 'GET',
      headers: this.authHeaders(),
      fetchImpl: this.fetchImpl,
    });
    return this.unwrap(res, 'cart.view');
  }

  /** Update quantity of a cart item (requires session) */
  async cartUpdate(itemId: string, quantity: number): Promise<{ item_id: string; quantity: number }> {
    await this.requireSession();
    const cap = await this.requireCapability('cart.update');
    const res = await request<{ item_id: string; quantity: number }>(cap.endpoint, {
      method: 'PATCH',
      body: { item_id: itemId, quantity },
      headers: this.authHeaders(),
      fetchImpl: this.fetchImpl,
    });
    return this.unwrap(res, 'cart.update');
  }

  /** Remove an item from the cart (requires session) */
  async cartRemove(itemId: string): Promise<{ item_id: string; removed: boolean }> {
    await this.requireSession();
    const cap = await this.requireCapability('cart.remove');
    const res = await request<{ item_id: string; removed: boolean }>(cap.endpoint, {
      method: 'DELETE',
      body: { item_id: itemId },
      headers: this.authHeaders(),
      fetchImpl: this.fetchImpl,
    });
    return this.unwrap(res, 'cart.remove');
  }

  /**
   * Get a checkout URL. The agent hands this URL to the human to complete payment.
   * The agent never completes checkout itself — that's the human handoff.
   */
  async checkout(): Promise<CheckoutResult> {
    await this.requireSession();
    const cap = await this.requireCapability('checkout');
    const res = await request<CheckoutResult>(cap.endpoint, {
      method: 'POST',
      headers: this.authHeaders(),
      fetchImpl: this.fetchImpl,
    });
    return this.unwrap(res, 'checkout');
  }

  /** Send a contact message */
  async contact(name: string, email: string, message: string): Promise<{ sent: boolean }> {
    const cap = await this.requireCapability('contact');
    const res = await request<{ sent: boolean }>(cap.endpoint, {
      method: 'POST',
      body: { name, email, message },
      headers: this.authHeaders(),
      fetchImpl: this.fetchImpl,
    });
    return this.unwrap(res, 'contact');
  }

  /**
   * Call any capability by name with raw params.
   * Use this for capabilities not covered by the typed methods.
   */
  async call(capabilityName: string, params?: Record<string, unknown>): Promise<unknown> {
    const cap = await this.requireCapability(capabilityName);
    if (cap.requires_session && !this.session) {
      await this.connect();
    }
    const isGet = cap.method === 'GET' || cap.method === 'DELETE';
    const res = await request(cap.endpoint, {
      method: cap.method,
      query: isGet ? (params as Record<string, string | number | undefined>) : undefined,
      body: !isGet ? params : undefined,
      headers: this.authHeaders(),
      fetchImpl: this.fetchImpl,
      maxRetries: this.maxRetries,
      retryDelay: this.retryDelay,
    });
    return this.unwrap(res, capabilityName);
  }

  /**
   * Auto-paginate a browse-style capability that returns { items, total }.
   * Yields each page's items array until all items have been retrieved.
   *
   * Usage:
   *   for await (const items of client.paginate('browse', { category: 'mugs' })) {
   *     process(items);
   *   }
   */
  async *paginate<T = unknown>(
    capabilityName: string,
    params: Record<string, unknown> = {},
  ): AsyncGenerator<T[]> {
    let page = 1;
    const limit = (params.limit as number) ?? this.pageSize;

    while (true) {
      const raw = await this.call(capabilityName, { ...params, page, limit });
      const result = raw as { items?: T[]; total?: number } | null;
      const items: T[] = result?.items ?? [];
      if (items.length === 0) break;

      yield items;

      const fetched = page * limit;
      if (fetched >= (result?.total ?? fetched)) break;
      page++;
    }
  }

  /** Retrieve the signed audit artifact for the current session */
  async getAuditArtifact(): Promise<unknown> {
    if (!this.session) {
      throw new AgentClientError('No active session — connect() first');
    }
    const manifest = await this.getManifest();
    if (!manifest.audit?.enabled) {
      throw new AgentClientError('This site does not have audit enabled');
    }
    const endpoint = manifest.audit.endpoint.replace(':session_id', this.session.session_token);
    const res = await request(endpoint, { fetchImpl: this.fetchImpl });
    return this.unwrap(res, 'audit');
  }

  // --- Private helpers ---

  private async requireCapability(name: string): Promise<AgentsCapability> {
    const manifest = await this.getManifest();
    const cap = manifest.capabilities.find(c => c.name === name);
    if (!cap) {
      throw new AgentClientError(
        `Capability '${name}' is not supported by ${this.siteUrl}. ` +
        `Available: ${manifest.capabilities.map(c => c.name).join(', ')}`,
      );
    }
    return cap;
  }

  private async requireSession(): Promise<AgentSession> {
    if (!this.session) {
      throw new AgentClientError(
        'This capability requires a session. Call connect() first.',
      );
    }
    return this.session;
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
    };
    if (this.session) {
      headers['X-Agent-Session'] = this.session.session_token;
    }
    return headers;
  }

  private unwrap<T>(res: { ok: boolean; data?: T; error?: string }, capability: string): T {
    if (!res.ok || res.data === undefined) {
      throw new AgentClientError(
        `${capability} failed: ${res.error ?? 'unknown error'}`,
      );
    }
    return res.data;
  }
}
