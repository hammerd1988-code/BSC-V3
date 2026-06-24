/**
 * Types for the Casper Swarm — sub-agent orchestration system.
 *
 * The swarm allows an orchestrator agent to decompose complex tasks into
 * subtasks, spawn independent sub-agents to execute them in parallel,
 * monitor progress, and review/aggregate results.
 */

export type AgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SubTask {
  /** Unique task identifier. */
  id: string;
  /** Human-readable task description. */
  description: string;
  /** Dependencies — IDs of tasks that must complete before this one starts. */
  dependsOn: string[];
  /** Assigned agent ID (set when spawned). */
  agentId?: string;
  /** Current status. */
  status: AgentStatus;
  /** Final output from the agent. */
  result?: string;
  /** Error message if failed. */
  error?: string;
  /** Tool calls executed by this agent. */
  toolCallLog: ToolCallEntry[];
  /** Files modified by this agent. */
  filesModified: string[];
  /** Start time. */
  startedAt?: number;
  /** End time. */
  completedAt?: number;
}

export interface ToolCallEntry {
  toolName: string;
  args: Record<string, unknown>;
  ok: boolean;
  durationMs: number;
  timestamp: number;
}

export interface SwarmPlan {
  /** Original user objective. */
  objective: string;
  /** Decomposed subtasks. */
  tasks: SubTask[];
  /** Model used for orchestration. */
  model: string;
  /** Swarm session ID. */
  sessionId: string;
  /** When the plan was created. */
  createdAt: number;
  /** Max parallel agents. */
  maxParallel: number;
}

export interface AgentReport {
  taskId: string;
  status: AgentStatus;
  result?: string;
  error?: string;
  toolCallLog: ToolCallEntry[];
  filesModified: string[];
  durationMs: number;
}

export interface SwarmProgress {
  sessionId: string;
  objective: string;
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  tasks: SubTask[];
  elapsedMs: number;
}

/** IPC messages between orchestrator and sub-agents. */
export type IpcMessage =
  | { type: 'agent:start'; taskId: string; description: string; context: string }
  | { type: 'agent:token'; taskId: string; token: string }
  | { type: 'agent:tool_call'; taskId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'agent:tool_result'; taskId: string; toolName: string; ok: boolean; durationMs: number }
  | { type: 'agent:file_modified'; taskId: string; filePath: string }
  | { type: 'agent:complete'; taskId: string; result: string }
  | { type: 'agent:error'; taskId: string; error: string }
  | { type: 'agent:cancel'; taskId: string };
