import { AgentsManifest } from './types';
import { AgentClientError } from './http';

/**
 * Fetch and parse the agents.json manifest from a site URL.
 * Tries /.well-known/agents.json first, then /agents.json as fallback.
 */
export async function discover(
  siteUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AgentsManifest> {
  const base = siteUrl.replace(/\/$/, '');

  const candidates = [
    `${base}/.well-known/agents.json`,
    `${base}/agents.json`,
  ];

  const errors: Array<{ url: string; error: string }> = [];

  for (const url of candidates) {
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        errors.push({ url, error: `HTTP ${res.status}` });
        continue;
      }

      const json = await res.json() as AgentsManifest;

      if (!json.schema_version || !json.site || !Array.isArray(json.capabilities)) {
        throw new AgentClientError(
          `Invalid agents.json at ${url}: missing required fields`,
        );
      }

      return json;
    } catch (err) {
      if (err instanceof AgentClientError) throw err;
      errors.push({ url, error: (err as Error).message });
    }
  }

  const details = errors.map(e => `${e.url} (${e.error})`).join('; ');
  throw new AgentClientError(
    `No agents.json found at ${siteUrl}. Tried: ${details}`,
  );
}

/**
 * Fetch the human-readable agents.txt from a site URL.
 */
export async function discoverTxt(
  siteUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const base = siteUrl.replace(/\/$/, '');
  const url = `${base}/.well-known/agents.txt`;

  const res = await fetchImpl(url, { headers: { Accept: 'text/plain' } });
  if (!res.ok) {
    throw new AgentClientError(`Failed to fetch agents.txt from ${url}: HTTP ${res.status}`);
  }
  return res.text();
}
