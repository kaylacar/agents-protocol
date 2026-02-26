import { AgentDoorConfig, AgentsJsonManifest } from './types';
import { flattenCapabilities, capabilityRoute } from './utils';

export function generateAgentsJson(config: AgentDoorConfig): AgentsJsonManifest {
  const basePath = config.basePath ?? '/.well-known';
  const apiBase = `${basePath}/agents/api`;
  const capabilities = flattenCapabilities(config);

  return {
    schema_version: '1.0',
    site: {
      name: config.site.name,
      url: config.site.url,
      ...(config.site.description && { description: config.site.description }),
      ...(config.site.contact && { contact: config.site.contact }),
    },
    capabilities: capabilities.map(cap => ({
      name: cap.name,
      description: cap.description,
      method: cap.method,
      endpoint: capabilityRoute(cap, apiBase),
      ...(cap.params && { params: cap.params }),
      ...(cap.requiresSession && { requires_session: true }),
      ...(cap.humanHandoff && { human_handoff: true }),
    })),
    session: {
      create: `${apiBase}/session`,
      delete: `${apiBase}/session`,
      ...(config.sessionTtl && { ttl_seconds: config.sessionTtl }),
    },
    ...(config.flows && config.flows.length > 0 && {
      flows: config.flows.map(f => ({
        name: f.name,
        description: f.description,
        steps: f.steps,
      })),
    }),
    ...(config.rateLimit && { rate_limit: { requests_per_minute: config.rateLimit } }),
    ...(config.audit && {
      audit: {
        enabled: true,
        endpoint: `${apiBase}/audit/:session_id`,
        description: 'Retrieve signed RER artifact for a completed session',
      },
    }),
  };
}
