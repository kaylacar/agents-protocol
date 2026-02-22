import { AgentDoorConfig, CapabilityDefinition } from './types';

function flattenCapabilities(config: AgentDoorConfig): CapabilityDefinition[] {
  return config.capabilities.flat();
}

export function generateAgentsTxt(config: AgentDoorConfig): string {
  const basePath = config.basePath ?? '/.well-known';
  const capabilities = flattenCapabilities(config);

  const lines: string[] = [
    `# agents.txt - ${config.site.name}`,
    `# ${config.site.url}`,
    '',
    `Site: ${config.site.name}`,
    `URL: ${config.site.url}`,
  ];

  if (config.site.description) {
    lines.push(`Description: ${config.site.description}`);
  }
  if (config.site.contact) {
    lines.push(`Contact: ${config.site.contact}`);
  }

  lines.push('');
  lines.push(`Agents-JSON: ${config.site.url}${basePath}/agents.json`);
  lines.push('');
  lines.push('# Capabilities');

  for (const cap of capabilities) {
    lines.push(`Allow: ${cap.name}`);
  }

  if (config.rateLimit) {
    lines.push('');
    lines.push(`Rate-Limit: ${config.rateLimit}/minute`);
  }

  if (config.sessionTtl) {
    lines.push(`Session-TTL: ${config.sessionTtl}s`);
  }

  if (config.audit) {
    lines.push(`Audit: true`);
    lines.push(`Audit-Endpoint: ${config.site.url}${basePath}/agents/api/audit/:session_id`);
  }

  lines.push('');
  return lines.join('\n');
}
