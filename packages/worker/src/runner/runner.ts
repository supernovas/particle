import type { EventType, ParticleEvent, ProjectState } from '@particle/core';

export const AGENT_ROLES = ['planner', 'implementer', 'reviewer'] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export interface AgentRunContext {
  role: string;
  project: string;
  taskId?: string;
  state: ProjectState;
  workdir: string;
  promptPath: string;
}

export interface AgentRunResult {
  events: ParticleEvent[];
  exitCode: number;
  transcriptPath: string;
}

export interface AgentRunner {
  start(ctx: AgentRunContext): Promise<AgentRunResult>;
}

/** The only fields accepted from an agent-authored event line. */
export interface AgentEventInput {
  type: EventType;
  data: unknown;
  [field: string]: unknown;
}

export function parseAgentRole(role: string): AgentRole {
  if ((AGENT_ROLES as readonly string[]).includes(role)) return role as AgentRole;
  throw new Error(`unknown agent role: ${role}`);
}
