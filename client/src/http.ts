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

  const baseHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...headers,
  };

  // Only set Content-Type on requests that carry a body
  if (body !== undefined) {
    baseHeaders['Content-Type'] = 'application/json';
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(retryDelay * Math.pow(2, attempt - 1));
    }

    // Create a fresh AbortSignal per attempt so retries get their own timeout
    const init: RequestInit = {
      method,
      headers: baseHeaders,
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    if (timeout > 0 && typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
      init.signal = AbortSignal.timeout(timeout);
    }

    let res: Response;
    try {
      res = await fetchImpl(fullUrl, init);
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new AgentClientError(`Request timed out after ${timeout}ms: ${fullUrl}`, 0);
      }
      // Retry network errors (DNS failure, connection refused, etc.)
      if (err instanceof TypeError && attempt < maxRetries) {
        lastError = new AgentClientError(`Network error: ${(err as Error).message}`);
        continue;
      }
      throw err;
    }

    if (res.status === 429) {
      lastError = new AgentClientError(`Rate limit exceeded after ${attempt + 1} attempt(s)`, 429);
      continue;
    }

    // Parse JSON safely — some servers return HTML or empty bodies on errors
    let json: ApiResponse<T>;
    try {
      json = (await res.json()) as ApiResponse<T>;
    } catch {
      if (!res.ok) {
        throw new AgentClientError(
          `HTTP ${res.status} from ${fullUrl} (non-JSON response)`,
          res.status,
        );
      }
      throw new AgentClientError(
        `Failed to parse JSON response from ${fullUrl}`,
        res.status,
      );
    }

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
