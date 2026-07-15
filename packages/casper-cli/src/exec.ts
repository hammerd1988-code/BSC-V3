import chalk from 'chalk';
import ora from './utils/spinner.js';
import { runToolLoop } from './llm/tool-loop.js';
import { LOCAL_TOOL_SPECS } from './tool-specs.js';
import type { ChatMessage } from './llm/client.js';

export interface ExecOptions {
  model: string;
  preferLocal?: boolean;
  localLlmUrl?: string;
}

/**
 * Run a single command through Casper and stream the result to stdout.
 */
export async function runOnce(command: string, opts: ExecOptions): Promise<void> {
  const spinner = ora({ text: chalk.dim('Casper is working...'), spinner: 'dots' }).start();
  let firstToken = true;

  const messages: ChatMessage[] = [
    { role: 'user', content: command },
  ];

  try {
    const response = await runToolLoop(messages, {
      model: opts.model,
      preferLocal: opts.preferLocal,
      localLlmUrl: opts.localLlmUrl,
      tools: LOCAL_TOOL_SPECS,
      onToken: (token) => {
        if (firstToken) {
          spinner.stop();
          firstToken = false;
        }
        process.stdout.write(token);
      },
      onToolCall: (name) => {
        if (!firstToken) {
          process.stdout.write('\n');
          firstToken = true;
        }
        spinner.start();
        spinner.text = chalk.dim(`  ⚙ ${name}`);
      },
      onToolResult: (name, result: any) => {
        const status = result.ok ? chalk.green('✓') : chalk.red('✗');
        spinner.text = chalk.dim(`  ${status} ${name}`);
      },
    });

    if (firstToken) {
      spinner.stop();
      if (response) process.stdout.write(response);
    }
    process.stdout.write('\n');
  } catch (err: any) {
    spinner.stop();
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}
