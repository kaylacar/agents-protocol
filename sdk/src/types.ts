import type { Request, Response } from 'express';

export interface SiteConfig {
  name: string;
  url: string;
  description?: string;
  contact?: string;
}

export interface CapabilityDefinition {
  name: string;
  description: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, { type: string; required?: boolean; description?: string }>;
  requiresSession?: boolean;
  humanHandoff?: boolean;
  handler: (req: Request, res: Response, session?: SessionData | null) => Promise<any>;
}

export interface AgentDoorConfig {
  site: SiteConfig;
  capabilities: (CapabilityDefinition | CapabilityDefinition[])[];
  rateLimit?: number;
  sessionTtl?: number;
  audit?: boolean;
  basePath?: string;
}

export interface SessionData {
  sessionToken: string;
  siteId: string;
  capabilities: string[];
  cartItems: CartItem[];
  expiresAt: Date;
  createdAt: Date;
}

export interface AgentResponse<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface CartItem {
  itemId: string;
  name?: string;
  quantity: number;
  price?: number;
  metadata?: Record<string, any>;
}
