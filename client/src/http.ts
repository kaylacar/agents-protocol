import { ApiResponse } from './types';

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryDelay?: number;
  /** Request timeout in milliseconds. Default: 30000 (30s). 0 = no timeout. */
  timeout?: number;
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
    timeout = 30_000,
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

  // Attach AbortSignal for timeout if supported and timeout > 0
  if (timeout > 0 && typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    init.signal = AbortSignal.timeout(timeout);
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(retryDelay * Math.pow(2, attempt - 1));
    }

    let res: Response;
    try {
      res = await fetchImpl(fullUrl, init);
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new AgentClientError(`Request timed out after ${timeout}ms: ${fullUrl}`, 0);
      }
      throw err;
    }

    if (res.status === 429) {
      lastError = new AgentClientError('Rate limit exceeded — retrying', 429);
      continue;
    }

    // Parse JSON for all responses so error messages from the server are preserved
    const json = (await res.json()) as ApiResponse<T>;

    if (!res.ok) {
      if (res.status === 400 || res.status === 401 || res.status === 404) {
        // Return the server's error envelope — caller (unwrap) will handle it
        return json;
      }
      throw new AgentClientError(
        json.error ?? `HTTP ${res.status} from ${fullUrl}`,
        res.status,
        json.error,
      );
    }

    return json;
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
