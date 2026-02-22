import { AgentDoorConfig, CapabilityDefinition } from './types';

function flattenCapabilities(config: AgentDoorConfig): CapabilityDefinition[] {
  return config.capabilities.flat();
}

function capabilityToEndpoint(cap: CapabilityDefinition, basePath: string): string {
  const base = `${basePath}/agents/api`;
  const parts = cap.name.split('.');
  if (parts.length > 1) {
    return `${base}/${parts.join('/')}`;
  }
  if (cap.params && Object.keys(cap.params).some(k => k === 'id' || k === ':id')) {
    return `${base}/${cap.name}/:id`;
  }
  return `${base}/${cap.name}`;
}

export function generateAgentsJson(config: AgentDoorConfig): object {
  const basePath = config.basePath ?? '/.well-known';
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
      endpoint: capabilityToEndpoint(cap, basePath),
      ...(cap.params && { params: cap.params }),
      ...(cap.requiresSession && { requires_session: true }),
      ...(cap.humanHandoff && { human_handoff: true }),
    })),
    session: {
      create: `${basePath}/agents/api/session`,
      ...(config.sessionTtl && { ttl_seconds: config.sessionTtl }),
    },
    ...(config.rateLimit && { rate_limit: { requests_per_minute: config.rateLimit } }),
    ...(config.audit && {
      audit: {
        enabled: true,
        endpoint: `${basePath}/agents/api/audit/:session_id`,
        description: 'Retrieve signed RER artifact for a completed session',
      },
    }),
  };
}
