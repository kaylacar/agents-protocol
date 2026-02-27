import { ApiResponse } from './types';

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryDelay?: number;
  /** Request timeout in milliseconds. Default: 30000 (30s). */
  timeoutMs?: number;
}

function buildUrl(base: string, query?: Record<string, string | number | undefined>): string {
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function request<T = unknown>(
  url: string,
  opts: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const {
    method = 'GET',
    headers = {},
    body,
    query,
    fetchImpl = fetch,
    maxRetries = 3,
    retryDelay = 1000,
    timeoutMs = 30_000,
  } = opts;

  const fullUrl = buildUrl(url, query);

  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...headers,
    },
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  let lastError: AgentClientError | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0 && lastError?.statusCode !== 429) {
      // Non-429 retries use standard backoff; 429 backoff is handled inline
      // after reading the Retry-After header.
      await sleep(retryDelay * Math.pow(2, attempt - 1));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: globalThis.Response;
    try {
      res = await fetchImpl(fullUrl, { ...init, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new AgentClientError(`Request to ${fullUrl} timed out after ${timeoutMs}ms`);
      }
      throw err;
    }
    clearTimeout(timer);

    if (res.status === 429) {
      // Respect the server's Retry-After header per spec
      const retryAfterHeader = res.headers.get('Retry-After');
      const serverDelaySec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 0;
      const serverDelayMs = Number.isFinite(serverDelaySec) ? serverDelaySec * 1000 : 0;
      const backoffMs = retryDelay * Math.pow(2, attempt);
      if (attempt < maxRetries) {
        await sleep(Math.max(serverDelayMs, backoffMs));
      }
      lastError = new AgentClientError('Rate limit exceeded — retrying', 429);
      continue;
    }

    if (!res.ok && res.status !== 400 && res.status !== 401 && res.status !== 404) {
      throw new AgentClientError(`HTTP ${res.status} from ${fullUrl}`, res.status);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new AgentClientError(
        `Invalid JSON response from ${fullUrl} (HTTP ${res.status})`,
        res.status,
      );
    }
    if (typeof json !== 'object' || json === null || typeof (json as Record<string, unknown>).ok !== 'boolean') {
      throw new AgentClientError(
        `Unexpected response format from ${fullUrl}: missing "ok" field`,
        res.status,
      );
    }
    return json as ApiResponse<T>;
  }

  throw lastError ?? new AgentClientError('Max retries exceeded');
}

export class AgentClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly serverError?: string,
  ) {
    super(message);
    this.name = 'AgentClientError';
  }
}
