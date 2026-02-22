import { ApiResponse } from './types';

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  fetchImpl?: typeof fetch;
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

export async function request<T = any>(
  url: string,
  opts: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const { method = 'GET', headers = {}, body, query, fetchImpl = fetch } = opts;

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

  const res = await fetchImpl(fullUrl, init);

  if (!res.ok && res.status !== 400 && res.status !== 401 && res.status !== 404 && res.status !== 429) {
    throw new AgentClientError(`HTTP ${res.status} from ${fullUrl}`, res.status);
  }

  const json = (await res.json()) as ApiResponse<T>;
  return json;
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
