import readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import { runToolLoop } from './llm/tool-loop.js';
import { LOCAL_TOOL_SPECS } from './tool-specs.js';
import type { ChatMessage } from './llm/client.js';

export interface ReplOptions {
  model: string;
  preferLocal: boolean;
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
  console.log(chalk.dim(`  Type your message, or 'exit' to quit.\n`));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('casper> '),
  });

  const conversationHistory: ChatMessage[] = [];

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }
    if (input === 'exit' || input === 'quit' || input === '.exit') {
      console.log(chalk.magenta('\n  Until next time. 🔮\n'));
      rl.close();
      process.exit(0);
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
