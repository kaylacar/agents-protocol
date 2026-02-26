import { AgentDoorConfig, CapabilityDefinition } from './types';

/** Flatten nested capability arrays from the config into a single list. */
export function flattenCapabilities(config: AgentDoorConfig): CapabilityDefinition[] {
  return config.capabilities.flat();
}

/**
 * Derive the URL pattern for a capability relative to an API base path.
 * Capabilities can declare a custom `route` property; otherwise the pattern
 * is derived from the dot-separated name (e.g. 'cart.add' → 'cart/add').
 */
export function capabilityRoute(cap: CapabilityDefinition, apiBase: string): string {
  if (cap.route) return `${apiBase}/${cap.route}`;
  const parts = cap.name.split('.');
  if (parts.length > 1) return `${apiBase}/${parts.join('/')}`;
  return `${apiBase}/${cap.name}`;
}
