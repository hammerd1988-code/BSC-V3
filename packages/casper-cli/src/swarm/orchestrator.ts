/**
 * Orchestrator — the brain of the Casper Swarm.
 *
 * Manages the lifecycle of sub-agents: spawns them according to the plan,
 * respects dependency ordering, runs independent tasks in parallel,
 * collects results, and produces a final review/summary.
 */
import { EventEmitter } from 'events';
import { executeAgent, type AgentCallbacks } from './agent.js';
import { createLlmClient, chatCompletion } from '../llm/client.js';
import { confirmAction } from '../utils/security.js';
import type { ChatMessage } from '../llm/client.js';
import type { SwarmPlan, SubTask, AgentReport, SwarmProgress } from './types.js';
import { formatDuration, truncate } from './utils.js';

export interface OrchestratorOptions {
  /** Max agents running in parallel. */
  maxParallel?: number;
  /** Model for sub-agents and review. */
  model?: string;
  /** Live progress callback. */
  onProgress?: (progress: SwarmProgress) => void;
  /** Per-agent token streaming callback. */
  onAgentToken?: (taskId: string, token: string) => void;
  /** Called when an agent starts. */
  onAgentStart?: (task: SubTask) => void;
  /** Called when an agent completes. */
  onAgentComplete?: (task: SubTask, report: AgentReport) => void;
}

const REVIEW_SYSTEM_PROMPT = `You are Casper — reviewing the work of your sub-agents.

For each completed task, assess:
1. Was the task completed successfully?
2. Were there any errors or issues?
3. What files were modified?

Then provide:
- A concise overall summary of what was accomplished
- Any issues or follow-ups needed
- A quality verdict: PASS, PARTIAL, or FAIL

Be direct and cyberpunk. No fluff.`;

export class Orchestrator extends EventEmitter {
  private plan: SwarmPlan;
  private reports: Map<string, AgentReport> = new Map();
  private activeAgents: Set<string> = new Set();
  private startTime: number = 0;
  private opts: OrchestratorOptions;
  /** Serializes destructive-command confirmations across concurrent agents. */
  private confirmQueue: Promise<void> = Promise.resolve();
  /** Tracks all spawned agent promises so they can be properly awaited. */
  private allAgentPromises: Promise<void>[] = [];

  constructor(plan: SwarmPlan, opts: OrchestratorOptions = {}) {
    super();
    this.plan = plan;
    this.opts = opts;
    if (opts.maxParallel) {
      this.plan.maxParallel = opts.maxParallel;
    }
  }

  /**
   * Execute the full swarm plan. Returns the final review.
   */
  async run(): Promise<string> {
    this.startTime = Date.now();
    this.emitProgress();

    // Process tasks respecting dependencies and parallelism
    while (this.hasPendingWork()) {
      const ready = this.getReadyTasks();

      if (ready.length === 0 && this.activeAgents.size === 0) {
        // Deadlock — tasks have unresolvable dependencies; mark them failed
        for (const task of this.plan.tasks) {
          if (task.status === 'pending') {
            task.status = 'failed';
            task.error = 'Deadlock: unresolvable or missing dependency';
          }
        }
        break;
      }

      if (ready.length === 0) {
        // Wait for an active agent to finish
        await this.waitForAnyCompletion();
        continue;
      }

      // Spawn agents for ready tasks (up to maxParallel)
      const slotsAvailable = this.plan.maxParallel - this.activeAgents.size;
      if (slotsAvailable <= 0) {
        await this.waitForAnyCompletion();
        continue;
      }
      const toSpawn = ready.slice(0, slotsAvailable);

      // Run these agents in parallel; attach .catch() so unhandled rejections
      // don't crash the process — runAgent's finally ensures activeAgents cleanup.
      const promises = toSpawn.map(task => {
        const p = this.runAgent(task).catch(err => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[swarm] unexpected error in agent ${task.id}: ${msg}`);
        });
        this.allAgentPromises.push(p);
        return p;
      });

      // Wait for at least one to complete before checking for more work
      await Promise.race(promises);
    }

    // Wait for all remaining agent promises to settle
    await Promise.allSettled(this.allAgentPromises);

    this.emitProgress();

    // Review all results
    const review = await this.reviewResults();
    return review;
  }

  /**
   * Run a single agent for a task.
   */
  private async runAgent(task: SubTask): Promise<void> {
    task.status = 'running';
    task.startedAt = Date.now();
    this.activeAgents.add(task.id);
    this.opts.onAgentStart?.(task);
    this.emitProgress();

    try {
      // Build context from completed dependency results
      const depContext = task.dependsOn
        .map(depId => {
          const report = this.reports.get(depId);
          if (!report) return null;
          const depTask = this.plan.tasks.find(t => t.id === depId);
          return `[${depId}: ${depTask?.description ?? 'unknown'}]\nResult: ${truncate(report.result ?? '(no output)', 500)}`;
        })
        .filter(Boolean)
        .join('\n\n');

      const callbacks: AgentCallbacks = {
        onToken: this.opts.onAgentToken,
        onToolCall: (taskId, toolName, args) => {
          const t = this.plan.tasks.find(t => t.id === taskId);
          if (t) {
            t.toolCallLog.push({
              toolName,
              args,
              ok: true,
              durationMs: 0,
              timestamp: Date.now(),
            });
          }
          this.emitProgress();
        },
        onToolResult: (taskId, toolName, ok) => {
          const t = this.plan.tasks.find(t => t.id === taskId);
          if (t && t.toolCallLog.length > 0) {
            const last = t.toolCallLog[t.toolCallLog.length - 1];
            last.ok = ok;
            last.durationMs = Date.now() - last.timestamp;
          }
          this.emitProgress();
        },
        onFileModified: (taskId, filePath) => {
          const t = this.plan.tasks.find(t => t.id === taskId);
          if (t && !t.filesModified.includes(filePath)) {
            t.filesModified.push(filePath);
          }
        },
      };

      const report = await executeAgent(task, {
        model: this.opts.model ?? this.plan.model,
        context: depContext || undefined,
        callbacks,
        confirm: this.serialConfirm,
      });

      // Update task state
      task.status = report.status;
      task.result = report.result;
      task.error = report.error;
      task.completedAt = Date.now();
      // Keep task.toolCallLog as built by orchestrator callbacks (has full args + timing)
      task.filesModified = report.filesModified;

      this.reports.set(task.id, report);

      this.opts.onAgentComplete?.(task, report);
      this.emitProgress();

      // If this task failed, cancel dependents
      if (report.status === 'failed') {
        this.cancelDependents(task.id);
      }
    } finally {
      // Always remove from activeAgents so the scheduler is never stuck
      this.activeAgents.delete(task.id);
    }
  }

  /**
   * Cancel all tasks that depend on a failed task.
   */
  private cancelDependents(failedId: string): void {
    for (const task of this.plan.tasks) {
      if (task.status === 'pending' && task.dependsOn.includes(failedId)) {
        task.status = 'cancelled';
        task.error = `Cancelled: dependency "${failedId}" failed`;
        // Recursively cancel downstream
        this.cancelDependents(task.id);
      }
    }
  }

  /**
   * Get tasks that are ready to execute (pending + all deps completed).
   */
  private getReadyTasks(): SubTask[] {
    return this.plan.tasks.filter(task => {
      if (task.status !== 'pending') return false;
      return task.dependsOn.every(depId => {
        const dep = this.plan.tasks.find(t => t.id === depId);
        return dep?.status === 'completed';
      });
    });
  }

  /**
   * Check if there's any pending or running work.
   */
  private hasPendingWork(): boolean {
    return this.plan.tasks.some(t => t.status === 'pending' || t.status === 'running');
  }

  /**
   * Wait for any active agent to complete.
   */
  private waitForAnyCompletion(): Promise<void> {
    const initialSize = this.activeAgents.size;
    return new Promise(resolve => {
      const check = () => {
        if (this.activeAgents.size < initialSize || this.activeAgents.size === 0) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      setTimeout(check, 100);
    });
  }

  /**
   * Serialized confirm — queues destructive-command confirmations so that
   * concurrent agents don't fight over stdin.
   */
  private serialConfirm = (command: string): Promise<boolean> => {
    const result = this.confirmQueue.then(() =>
      confirmAction(`[swarm agent] ${command}`)
    );
    this.confirmQueue = result.then(
      () => undefined,
      (err) => {
        // Log stdin errors so they aren't silently swallowed
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[swarm] confirm error: ${msg}`);
      }
    );
    return result;
  };

  /**
   * Use the LLM to review all agent results and produce a summary.
   */
  private async reviewResults(): Promise<string> {
    const client = createLlmClient();

    const taskSummaries = this.plan.tasks.map(task => {
      const report = this.reports.get(task.id);
      const status = task.status.toUpperCase();
      const duration = task.completedAt && task.startedAt
        ? formatDuration(task.completedAt - task.startedAt)
        : 'N/A';
      const files = task.filesModified.length > 0
        ? `Files: ${task.filesModified.join(', ')}`
        : 'No files modified';
      const toolCount = task.toolCallLog.length;
      const result = report?.result
        ? truncate(report.result, 800)
        : task.error ?? '(no output)';

      return `## ${task.id} [${status}] (${duration}, ${toolCount} tool calls)
Task: ${task.description}
${files}
Result: ${result}`;
    }).join('\n\n---\n\n');

    const elapsed = formatDuration(Date.now() - this.startTime);
    const completed = this.plan.tasks.filter(t => t.status === 'completed').length;
    const failed = this.plan.tasks.filter(t => t.status === 'failed').length;
    const total = this.plan.tasks.length;

    const messages: ChatMessage[] = [
      { role: 'system', content: REVIEW_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Review the work of ${total} sub-agents on this objective:

"${this.plan.objective}"

Stats: ${completed}/${total} completed, ${failed} failed, ${elapsed} total

${taskSummaries}`,
      },
    ];

    try {
      const response = await chatCompletion(client, messages, [], this.opts.model);
      return response.choices[0]?.message?.content ?? 'Review unavailable.';
    } catch {
      // Fallback: produce a mechanical summary
      return this.mechanicalSummary();
    }
  }

  /**
   * Fallback summary without LLM.
   */
  private mechanicalSummary(): string {
    const elapsed = formatDuration(Date.now() - this.startTime);
    const completed = this.plan.tasks.filter(t => t.status === 'completed').length;
    const failed = this.plan.tasks.filter(t => t.status === 'failed').length;
    const total = this.plan.tasks.length;
    const allFiles = [...new Set(this.plan.tasks.flatMap(t => t.filesModified))];

    let summary = `Swarm completed: ${completed}/${total} tasks succeeded, ${failed} failed (${elapsed})\n\n`;

    for (const task of this.plan.tasks) {
      const icon = task.status === 'completed' ? '✓' : task.status === 'failed' ? '✗' : '○';
      summary += `${icon} ${task.id}: ${task.description} [${task.status}]\n`;
      if (task.error) summary += `  Error: ${task.error}\n`;
    }

    if (allFiles.length > 0) {
      summary += `\nFiles modified: ${allFiles.join(', ')}`;
    }

    return summary;
  }

  /**
   * Get current progress snapshot.
   */
  getProgress(): SwarmProgress {
    return {
      sessionId: this.plan.sessionId,
      objective: this.plan.objective,
      total: this.plan.tasks.length,
      pending: this.plan.tasks.filter(t => t.status === 'pending').length,
      running: this.plan.tasks.filter(t => t.status === 'running').length,
      completed: this.plan.tasks.filter(t => t.status === 'completed').length,
      failed: this.plan.tasks.filter(t => t.status === 'failed').length,
      cancelled: this.plan.tasks.filter(t => t.status === 'cancelled').length,
      tasks: this.plan.tasks,
      elapsedMs: Date.now() - this.startTime,
    };
  }

  private emitProgress(): void {
    const progress = this.getProgress();
    this.opts.onProgress?.(progress);
    this.emit('progress', progress);
  }
}
