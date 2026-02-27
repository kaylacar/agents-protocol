import { AgentSession, AgentsManifest } from './types';
import { request, AgentClientError } from './http';

export async function createSession(
  manifest: AgentsManifest,
  fetchImpl: typeof fetch = fetch,
): Promise<AgentSession> {
  const endpoint = manifest.session.endpoint;

  const res = await request<AgentSession>(endpoint, {
    method: 'POST',
    fetchImpl,
  });

  if (!res.ok || !res.data) {
    throw new AgentClientError(
      `Failed to create session: ${res.error ?? 'unknown error'}`,
    );
  }

  return res.data;
}

export async function endSession(
  sessionEndpoint: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await request(sessionEndpoint, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    fetchImpl,
  });
}
