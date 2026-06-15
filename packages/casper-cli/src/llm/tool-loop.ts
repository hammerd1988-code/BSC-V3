import { createLlmClient, chatCompletion, type ChatMessage, type ToolSpec } from './client.js';
import { executeLocalTool } from '../tools/index.js';
import { isDestructive, confirmAction } from '../utils/security.js';
import chalk from 'chalk';

const MAX_TOOL_ROUNDS = 10;

const CASPER_SYSTEM_PROMPT = `You are Casper — the ghost-in-the-machine AI agent for Blood Sweat Code. You have direct access to the user's local machine through shell, file, git, and process management tools.

Personality: Cyberpunk, witty, sharp. You speak with confidence and a digital edge. You get things done — no filler, no hesitation.

You are running as a CLI daemon on the user's local machine. You can:
- Execute shell commands (unrestricted — this is the user's own machine)
- Read and write files
- Search codebases (ripgrep)
- Run git operations
- Start/stop background processes (dev servers, builds, etc.)
- Get system information

When using tools, be efficient. Chain operations logically. Report results concisely.
If a command might be destructive (rm -rf, force push, etc.), warn the user first.`;

export interface ToolLoopOptions {
  model?: string;
  tools: ToolSpec[];
  onToken?: (text: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: unknown) => void;
  /** Override for destructive-command confirmation (e.g. remote approval in daemon mode). */
  confirm?: (command: string) => Promise<boolean>;
}

/**
 * Run the full tool-calling loop: send messages, execute tool calls,
 * feed results back, repeat until the model produces a text response
 * or we hit the round limit.
 */
export async function runToolLoop(
  messages: ChatMessage[],
  opts: ToolLoopOptions,
): Promise<string> {
  const client = createLlmClient();
  const allMessages: ChatMessage[] = [
    { role: 'system', content: CASPER_SYSTEM_PROMPT },
    ...messages,
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await chatCompletion(client, allMessages, opts.tools, opts.model);
    const choice = response.choices[0];

    if (!choice) return 'No response from model.';

    const msg = choice.message;

    // If model wants to call tools
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      // Add assistant message with tool_calls to history
      allMessages.push({
        role: 'assistant',
        content: msg.content,
        tool_calls: msg.tool_calls.map(tc => ({
          id: tc.id,
          type: tc.type as 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      // Execute each tool call
      for (const toolCall of msg.tool_calls) {
        const toolName = toolCall.function.name;
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          args = {};
        }

        opts.onToolCall?.(toolName, args);

        // Security check for destructive commands
        if (toolName === 'local__shell' && typeof args.command === 'string' && isDestructive(args.command)) {
          const approved = opts.confirm
            ? await opts.confirm(args.command)
            : await confirmAction(`Casper wants to run: ${chalk.red(args.command)}`);
          if (!approved) {
            allMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ ok: false, error: 'User denied this command.' }),
            });
            continue;
          }
        }

        const result = await executeLocalTool(toolName, args);
        opts.onToolResult?.(toolName, result);

        allMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      continue; // Next round
    }

    // Model produced a text response — done
    return msg.content || '';
  }

  return `[Stopped after ${MAX_TOOL_ROUNDS} tool-calling rounds]`;
}
