/**
 * Agent — runs a single subtask through the LLM tool loop.
 *
 * Each agent is an independent execution context with its own conversation
 * history. It reports progress back to the orchestrator via callbacks.
 */
import { runToolLoop } from '../llm/tool-loop.js';
import { LOCAL_TOOL_SPECS } from '../tool-specs.js';
import type { ChatMessage } from '../llm/client.js';
import type { SubTask, AgentReport, ToolCallEntry } from './types.js';

export interface AgentCallbacks {
  onToken?: (taskId: string, token: string) => void;
  onToolCall?: (taskId: string, toolName: string, args: Record<string, unknown>) => void;
  onToolResult?: (taskId: string, toolName: string, ok: boolean, durationMs: number) => void;
  onFileModified?: (taskId: string, filePath: string) => void;
}

const AGENT_SYSTEM_SUFFIX = `

You are a focused sub-agent working on a specific subtask as part of a larger mission.
- Complete your assigned task efficiently
- Report what you did clearly so the orchestrator can review your work
- Do NOT work on anything outside your assigned task
- If you encounter a blocker, explain it clearly rather than working around it`;

/**
 * Execute a subtask by running the LLM tool loop with a focused prompt.
 */
export async function executeAgent(
  task: SubTask,
  opts: {
    model: string;
    context?: string;
    callbacks?: AgentCallbacks;
    confirm?: (command: string) => Promise<boolean>;
  },
): Promise<AgentReport> {
  const startTime = Date.now();
  const toolCallLog: ToolCallEntry[] = [];
  const filesModified: string[] = [];

  // Track pending tool call args and start times for accurate logging
  // Use a counter-based key so multiple calls to the same tool in one round don't collide.
  let toolCallCounter = 0;
  const pendingToolCalls = new Map<number, { args: Record<string, unknown>; startTime: number }>();
  // Maps tool name → queue of pending call IDs (FIFO, matching tool-loop execution order)
  const toolCallQueue = new Map<string, number[]>();

  const contextBlock = opts.context
    ? `\n\n--- CONTEXT FROM PRIOR TASKS ---\n${opts.context}`
    : '';

  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: `## Your Assignment\n\n${task.description}${contextBlock}\n\nComplete this task. Be thorough and report what you accomplished.`,
    },
  ];

  try {
    const result = await runToolLoop(messages, {
      model: opts.model,
      tools: LOCAL_TOOL_SPECS,
      confirm: opts.confirm,
      onToken: (token) => {
        opts.callbacks?.onToken?.(task.id, token);
      },
      onToolCall: (name, args) => {
        const callId = toolCallCounter++;
        pendingToolCalls.set(callId, { args, startTime: Date.now() });
        const queue = toolCallQueue.get(name) ?? [];
        queue.push(callId);
        toolCallQueue.set(name, queue);
        opts.callbacks?.onToolCall?.(task.id, name, args);

        // Track file modifications
        if (name === 'local__write_file' && typeof args.path === 'string') {
          if (!filesModified.includes(args.path)) {
            filesModified.push(args.path);
            opts.callbacks?.onFileModified?.(task.id, args.path);
          }
        }
      },
      onToolResult: (name, rawResult: unknown) => {
        const r = rawResult as { ok?: boolean } | null;
        const ok = r?.ok !== false;
        const queue = toolCallQueue.get(name);
        const callId = queue?.shift();
        const pending = callId !== undefined ? pendingToolCalls.get(callId) : undefined;
        const callArgs = pending?.args ?? {};
        const durationMs = pending ? Date.now() - pending.startTime : 0;
        if (callId !== undefined) pendingToolCalls.delete(callId);
        toolCallLog.push({
          toolName: name,
          args: callArgs,
          ok,
          durationMs,
          timestamp: Date.now() - durationMs,
        });
        opts.callbacks?.onToolResult?.(task.id, name, ok, durationMs);
      },
    });

    return {
      taskId: task.id,
      status: 'completed',
      result,
      toolCallLog,
      filesModified,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      taskId: task.id,
      status: 'failed',
      error: errorMsg,
      toolCallLog,
      filesModified,
      durationMs: Date.now() - startTime,
    };
  }
}
