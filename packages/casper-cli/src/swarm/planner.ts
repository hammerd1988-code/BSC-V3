/**
 * Planner — uses the LLM to decompose a complex objective into subtasks.
 *
 * The planner takes a high-level objective (e.g. "Build the auth system,
 * add tests, update docs") and produces a SwarmPlan with independent
 * subtasks that can be executed in parallel where dependencies allow.
 */
import { createLlmClient, chatCompletion } from '../llm/client.js';
import type { ChatMessage } from '../llm/client.js';
import { detectProjectContext } from '../context.js';
import { loadProjectInstructions } from '../init.js';
import { randomId } from './utils.js';
import type { SwarmPlan, SubTask } from './types.js';

const PLANNER_SYSTEM_PROMPT = `You are Casper's task planner. Your job is to decompose a complex objective into independent subtasks that can be executed by separate AI agents in parallel.

Rules:
- Each subtask must be self-contained — an agent working on it needs no context from other agents
- Identify dependencies: if task B needs task A's output, mark it with "depends_on"
- Be specific: each task description should be actionable and unambiguous
- Include what tools/approach the agent should use
- Keep tasks small enough for a single focused agent session (10-20 tool calls max)
- Tasks with no dependencies can run in parallel

You must respond with a valid JSON array of task objects. Each object has:
{
  "id": "task-1",
  "description": "Detailed description of what this agent should do",
  "depends_on": []  // array of task IDs this depends on (empty if none)
}

Respond ONLY with the JSON array, no other text.`;

export async function planTasks(
  objective: string,
  opts: { model?: string; maxTasks?: number } = {},
): Promise<SwarmPlan> {
  const client = createLlmClient();
  const maxTasks = opts.maxTasks ?? 10;

  let systemPrompt = PLANNER_SYSTEM_PROMPT;
  systemPrompt += `\n\nConstraint: produce at most ${maxTasks} tasks.`;

  // Add project context so the planner understands the codebase
  const ctx = detectProjectContext();
  if (ctx) {
    systemPrompt += `\n\n--- PROJECT CONTEXT ---\n${ctx}`;
  }
  const instr = loadProjectInstructions();
  if (instr) {
    systemPrompt += `\n\n--- PROJECT INSTRUCTIONS ---\n${instr}`;
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Decompose this objective into subtasks:\n\n${objective}` },
  ];

  const response = await chatCompletion(client, messages, [], opts.model);
  const content = response.choices[0]?.message?.content?.trim() ?? '[]';

  // Parse the JSON response — handle markdown code blocks
  let jsonStr = content;
  const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  let rawTasks: Array<{ id: string; description: string; depends_on?: string[] }>;
  try {
    rawTasks = JSON.parse(jsonStr);
  } catch {
    // Fallback: single task with the whole objective
    rawTasks = [{ id: 'task-1', description: objective, depends_on: [] }];
  }

  if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
    rawTasks = [{ id: 'task-1', description: objective, depends_on: [] }];
  }

  const tasks: SubTask[] = rawTasks.slice(0, maxTasks).map((t, i) => ({
    id: t.id || `task-${i + 1}`,
    description: t.description || objective,
    dependsOn: Array.isArray(t.depends_on) ? t.depends_on : [],
    status: 'pending',
    toolCallLog: [],
    filesModified: [],
  }));

  return {
    objective,
    tasks,
    model: opts.model ?? 'gpt-4.1-mini',
    sessionId: randomId('swarm'),
    createdAt: Date.now(),
    maxParallel: 4,
  };
}
