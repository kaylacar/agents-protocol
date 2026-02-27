import { AgentDoorConfig, CapabilityDefinition } from './types';

function flattenCapabilities(config: AgentDoorConfig): CapabilityDefinition[] {
  return config.capabilities.flat();
}

export function generateAgentsTxt(config: AgentDoorConfig): string {
  const basePath = config.basePath ?? '/.well-known';
  const siteUrl = config.site.url.replace(/\/$/, '');
  const capabilities = flattenCapabilities(config);

  const lines: string[] = [
    `# agents.txt - ${config.site.name}`,
    `# ${config.site.url}`,
    '',
    `Name: ${config.site.name}`,
    `URL: ${config.site.url}`,
  ];

  if (config.site.description) lines.push(`Description: ${config.site.description}`);
  if (config.site.contact) lines.push(`Contact: ${config.site.contact}`);

  lines.push('');
  lines.push(`Capabilities: ${capabilities.map(c => c.name).join(', ')}`);
  lines.push(`Capabilities-URL: ${siteUrl}${basePath}/agents.json`);

  if (config.flows && config.flows.length > 0) {
    lines.push('');
    lines.push('# Suggested Flows');
    for (const flow of config.flows) {
      lines.push(`Flow: ${flow.name} → ${flow.steps.join(', ')}`);
      if (flow.description) lines.push(`Flow-Description: ${flow.description}`);
    }
  }

  if (config.rateLimit) lines.push('');
  if (config.rateLimit) lines.push(`Rate-Limit: ${config.rateLimit}`);
  if (config.sessionTtl) lines.push(`Session-TTL: ${config.sessionTtl}`);
  if (config.audit) {
    lines.push(`Audit: true`);
    lines.push(`Audit-Endpoint: ${siteUrl}${basePath}/agents/api/audit/:session_id`);
  }

  lines.push('');
  return lines.join('\n');
}
