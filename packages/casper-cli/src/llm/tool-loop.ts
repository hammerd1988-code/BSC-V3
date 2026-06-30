import os from 'node:os';
import process from 'node:process';
import type OpenAI from 'openai';
import { createLlmClient, chatCompletionStream, type ChatMessage, type ToolSpec } from './client.js';
import { executeLocalTool } from '../tools/index.js';
import { isDestructive, confirmAction } from '../utils/security.js';
import { detectProjectContext } from '../context.js';
import { loadProjectInstructions } from '../init.js';
import { getPluginToolSpecs, isPluginTool, extractPluginName, loadPlugin } from '../plugins/index.js';
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
- Scrape web pages (fetch URLs, extract text/markdown/links)
- Use custom plugins installed by the user (tools prefixed with plugin__)

When using tools, be efficient. Chain operations logically. Report results concisely.
If a command might be destructive (rm -rf, force push, etc.), warn the user first.
Plugin tools (plugin__*) are user-defined extensions — use them when they match the task.`;

/**
 * Describe the host OS and the shell `local__shell` runs under, so the model
 * uses native command syntax on the first try instead of guessing (e.g. a
 * Unix `ls` that fails on Windows before falling back to `dir`).
 */
function buildEnvironmentPrompt(): string {
  if (process.platform === 'win32') {
    return [
      '--- HOST ENVIRONMENT ---',
      `OS: Windows (${os.release()})`,
      'Shell: local__shell runs commands via cmd.exe. Use Windows command syntax,',
      'NOT Unix: `dir` not `ls`, `type` not `cat`, `findstr` not `grep`,',
      '`copy`/`move`/`del` not `cp`/`mv`/`rm`. For richer commands, invoke PowerShell',
      'explicitly, e.g. `powershell -Command "Get-ChildItem"`. Use `\\` path separators.',
    ].join('\n');
  }
  const kind = process.platform === 'darwin' ? 'macOS' : 'Linux';
  return [
    '--- HOST ENVIRONMENT ---',
    `OS: ${kind} (${os.release()})`,
    'Shell: local__shell runs commands via a POSIX shell. Use Unix command syntax',
    '(`ls`, `cat`, `grep`, `cp`, `mv`, `rm`) and `/` path separators.',
  ].join('\n');
}

export interface ToolLoopOptions {
  model?: string;
  tools: ToolSpec[];
  onToken?: (text: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: unknown) => void;
  /** Override for destructive-command confirmation (e.g. remote approval in daemon mode). */
  confirm?: (detail: string, context?: { type: 'shell' | 'plugin'; toolName: string }) => Promise<boolean>;
  /** Inject project context into the system prompt. Defaults to true. */
  projectContext?: boolean;
}

interface AccumulatedToolCall {
  index: number;
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/**
 * Consume the streaming response, emitting text tokens via onToken and
 * accumulating tool_calls. Returns the finish reason and aggregated data.
 */
async function consumeStream(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  onToken?: (text: string) => void,
): Promise<{
  content: string;
  toolCalls: AccumulatedToolCall[];
  finishReason: string | null;
}> {
  let content = '';
  const toolCallMap = new Map<number, AccumulatedToolCall>();
  let finishReason: string | null = null;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    finishReason = chunk.choices[0]?.finish_reason ?? finishReason;

    // Text token
    if (delta.content) {
      content += delta.content;
      onToken?.(delta.content);
    }

    // Tool call deltas arrive incrementally: first chunk has id+name,
    // subsequent chunks append to arguments.
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        if (!toolCallMap.has(idx)) {
          toolCallMap.set(idx, {
            index: idx,
            id: tc.id ?? '',
            type: 'function',
            function: { name: tc.function?.name ?? '', arguments: '' },
          });
        }
        const acc = toolCallMap.get(idx)!;
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.function.name = tc.function.name;
        if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
      }
    }
  }

  const toolCalls = Array.from(toolCallMap.values()).sort((a, b) => a.index - b.index);
  return { content, toolCalls, finishReason };
}

/**
 * Run the full tool-calling loop with streaming: send messages, stream
 * text tokens to the caller, execute tool calls, feed results back,
 * repeat until the model produces a final text response or we hit
 * the round limit.
 */
export async function runToolLoop(
  messages: ChatMessage[],
  opts: ToolLoopOptions,
): Promise<string> {
  const client = createLlmClient();

  // Build system prompt, optionally enriched with project context and instructions.
  let systemPrompt = `${CASPER_SYSTEM_PROMPT}\n\n${buildEnvironmentPrompt()}`;
  if (opts.projectContext !== false) {
    const ctx = detectProjectContext();
    if (ctx) {
      systemPrompt += `\n\n--- PROJECT CONTEXT ---\n${ctx}`;
    }
    const instr = loadProjectInstructions();
    if (instr) {
      systemPrompt += `\n\n--- PROJECT INSTRUCTIONS ---\n${instr}`;
    }
  }

  const allMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  // Merge built-in tools with discovered plugin tools
  const pluginSpecs = getPluginToolSpecs();
  const allTools = [...opts.tools, ...pluginSpecs];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = await chatCompletionStream(client, allMessages, allTools, opts.model);
    const { content, toolCalls, finishReason } = await consumeStream(stream, opts.onToken);

    // If model wants to call tools
    if (toolCalls.length > 0) {
      // Add assistant message with tool_calls to history
      allMessages.push({
        role: 'assistant',
        content: content || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: tc.type,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      // Execute each tool call
      for (const toolCall of toolCalls) {
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
            ? await opts.confirm(args.command, { type: 'shell', toolName: 'local__shell' })
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

        // Security check for dangerous plugins
        if (isPluginTool(toolName)) {
          const pluginName = extractPluginName(toolName);
          const plugin = loadPlugin(pluginName);
          if (plugin?.manifest.dangerous) {
            const approved = opts.confirm
              ? await opts.confirm(pluginName, { type: 'plugin', toolName: `plugin__${pluginName}` })
              : await confirmAction(`Casper wants to run dangerous plugin: ${chalk.red(pluginName)}`);
            if (!approved) {
              allMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ ok: false, error: 'User denied this plugin execution.' }),
              });
              continue;
            }
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
    return content;
  }

  return `[Stopped after ${MAX_TOOL_ROUNDS} tool-calling rounds]`;
}
