import { AgentDoorConfig, CapabilityDefinition } from './types';

function flattenCapabilities(config: AgentDoorConfig): CapabilityDefinition[] {
  return config.capabilities.flat();
}

function capabilityToEndpoint(cap: CapabilityDefinition, basePath: string, siteUrl: string): string {
  const base = `${siteUrl}${basePath}/agents/api`;
  const parts = cap.name.split('.');
  if (cap.name === 'detail') return `${base}/detail/:id`;
  if (parts.length > 1) return `${base}/${parts.join('/')}`;
  return `${base}/${cap.name}`;
}

export function generateAgentsJson(config: AgentDoorConfig): object {
  const basePath = config.basePath ?? '/.well-known';
  const siteUrl = config.site.url.replace(/\/$/, '');
  const capabilities = flattenCapabilities(config);
  const sessionEndpoint = `${siteUrl}${basePath}/agents/api/session`;

  return {
    protocol_version: '0.1.0',
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
      endpoint: capabilityToEndpoint(cap, basePath, siteUrl),
      ...(cap.params && { params: cap.params }),
      ...(cap.requiresSession && { requires_session: true }),
      ...(cap.humanHandoff && { human_handoff: true }),
    })),
    session: {
      endpoint: sessionEndpoint,
      ...(config.sessionTtl && { ttl: config.sessionTtl }),
    },
    ...(config.flows && config.flows.length > 0 && {
      flows: config.flows.map(f => ({
        name: f.name,
        description: f.description,
        steps: f.steps,
      })),
    }),
    ...(config.rateLimit && { rate_limit: { max_requests_per_minute: config.rateLimit } }),
    ...(config.audit && {
      audit: {
        enabled: true,
        endpoint: `${siteUrl}${basePath}/agents/api/audit/:session_id`,
        description: 'Retrieve signed RER artifact for a completed session',
      },
    }),
  };
}
