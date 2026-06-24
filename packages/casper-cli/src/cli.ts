import readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import { runToolLoop } from './llm/tool-loop.js';
import { LOCAL_TOOL_SPECS } from './tool-specs.js';
import type { ChatMessage } from './llm/client.js';
import { saveSession, loadSession, getLastSessionId } from './sessions.js';
import { loadProjectInstructions } from './init.js';
import { orchestrate } from './swarm/index.js';

export interface ReplOptions {
  model: string;
  preferLocal: boolean;
  resume?: string;
}

const BANNER = `
${chalk.magenta('╔══════════════════════════════════════════╗')}
${chalk.magenta('║')}  ${chalk.bold.cyan('🔮 Casper CLI')} ${chalk.dim('v0.1.0')}                     ${chalk.magenta('║')}
${chalk.magenta('║')}  ${chalk.dim('Ghost in the machine. At your service.')} ${chalk.magenta('║')}
${chalk.magenta('╚══════════════════════════════════════════╝')}
`;

export async function startRepl(opts: ReplOptions): Promise<void> {
  console.log(BANNER);
  console.log(chalk.dim(`  Model: ${opts.model}${opts.preferLocal ? ' (local)' : ''}`));

  // Load project-specific instructions if .casper/instructions.md exists
  const projectInstr = loadProjectInstructions();
  if (projectInstr) {
    console.log(chalk.dim(`  Project instructions: loaded from .casper/instructions.md`));
  }

  let conversationHistory: ChatMessage[] = [];
  let sessionId: string | undefined;

  // Resume a previous session if requested
  if (opts.resume) {
    const resumeId = opts.resume === 'last' ? getLastSessionId() : opts.resume;
    if (resumeId) {
      const session = loadSession(resumeId);
      if (session) {
        conversationHistory = session.messages;
        sessionId = session.id;
        console.log(chalk.dim(`  Resumed session: ${session.title} (${session.messageCount} messages)`));
      } else {
        console.log(chalk.yellow(`  Session "${resumeId}" not found — starting fresh.`));
      }
    }
  }

  console.log(chalk.dim(`  Type your message, or 'exit' to quit. '/help' for commands.\n`));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('casper> '),
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }
    if (input === 'exit' || input === 'quit' || input === '.exit') {
      // Auto-save on exit if there's conversation history
      if (conversationHistory.length > 0) {
        sessionId = saveSession(conversationHistory, opts.model, sessionId);
        console.log(chalk.dim(`\n  Session saved: ${sessionId}`));
      }
      console.log(chalk.magenta('\n  Until next time. 🔮\n'));
      rl.close();
      process.exit(0);
    }

    // Slash commands
    if (input === '/save') {
      if (conversationHistory.length === 0) {
        console.log(chalk.dim('  Nothing to save yet.'));
      } else {
        sessionId = saveSession(conversationHistory, opts.model, sessionId);
        console.log(chalk.green(`  Session saved: ${sessionId}`));
      }
      rl.prompt();
      return;
    }
    if (input === '/clear') {
      conversationHistory = [];
      sessionId = undefined;
      console.log(chalk.dim('  Conversation cleared.'));
      rl.prompt();
      return;
    }
    if (input.startsWith('/swarm ')) {
      const objective = input.slice(7).trim();
      if (!objective) {
        console.log(chalk.dim('  Usage: /swarm <objective>'));
        console.log(chalk.dim('  Example: /swarm Build auth system, add tests, update docs'));
      } else {
        console.log('');
        try {
          await orchestrate(objective, { model: opts.model });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(chalk.red(`  Swarm failed: ${msg}`));
        }
      }
      rl.prompt();
      return;
    }
    if (input === '/help') {
      console.log(chalk.magenta('\n  Commands:'));
      console.log(chalk.dim('    /save          ') + 'Save current session');
      console.log(chalk.dim('    /clear         ') + 'Clear conversation history');
      console.log(chalk.dim('    /swarm <task>   ') + 'Decompose task and run sub-agents in parallel');
      console.log(chalk.dim('    /help          ') + 'Show this help');
      console.log(chalk.dim('    exit           ') + 'Save & quit\n');
      rl.prompt();
      return;
    }

    conversationHistory.push({ role: 'user', content: input });

    // Show spinner until first token arrives, then switch to live streaming.
    const spinner = ora({ text: chalk.dim('Casper is thinking...'), spinner: 'dots' }).start();
    let firstToken = true;
    let streamedResponse = '';

    try {
      const response = await runToolLoop(conversationHistory, {
        model: opts.model,
        tools: LOCAL_TOOL_SPECS,
        onToken: (token) => {
          if (firstToken) {
            spinner.stop();
            process.stdout.write('\n');
            firstToken = false;
          }
          process.stdout.write(chalk.white(token));
          streamedResponse += token;
        },
        onToolCall: (name, args) => {
          // If we were streaming text before a tool call, add a newline.
          if (!firstToken) {
            process.stdout.write('\n');
            firstToken = true; // Reset so spinner shows again after tool calls.
          }
          spinner.start();
          spinner.text = chalk.dim(`  ⚙ ${name}(${JSON.stringify(args).slice(0, 60)}...)`);
        },
        onToolResult: (name, result: any) => {
          const status = result.ok ? chalk.green('✓') : chalk.red('✗');
          spinner.text = chalk.dim(`  ${status} ${name}`);
        },
      });

      if (firstToken) {
        // No tokens were streamed (shouldn't happen, but handle gracefully).
        spinner.stop();
        if (response) {
          console.log('');
          console.log(chalk.white(response));
        }
      }

      // Use the streamed content or the returned response for history.
      conversationHistory.push({ role: 'assistant', content: streamedResponse || response });
      console.log('\n');
    } catch (err: any) {
      spinner.stop();
      console.error(chalk.red(`\n  Error: ${err.message}\n`));
    }

    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}
