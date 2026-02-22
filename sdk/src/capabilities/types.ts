import type { Request, Response } from 'express';
import type { SessionData } from '../types';

export interface CapabilityHandler {
  (req: Request, res: Response, session?: SessionData | null): Promise<any>;
}

export type RegisteredCapability = {
  name: string;
  description: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, { type: string; required?: boolean; description?: string }>;
  requiresSession?: boolean;
  humanHandoff?: boolean;
  handler: CapabilityHandler;
};
