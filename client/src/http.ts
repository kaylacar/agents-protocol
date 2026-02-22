import { ApiResponse } from './types';

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryDelay?: number;
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

export async function request<T = any>(
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

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(retryDelay * Math.pow(2, attempt - 1));
    }

    const res = await fetchImpl(fullUrl, init);

    if (res.status === 429) {
      lastError = new AgentClientError('Rate limit exceeded — retrying', 429);
      continue;
    }

    if (!res.ok && res.status !== 400 && res.status !== 401 && res.status !== 404) {
      throw new AgentClientError(`HTTP ${res.status} from ${fullUrl}`, res.status);
    }

    const json = (await res.json()) as ApiResponse<T>;
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
