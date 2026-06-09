import chalk from 'chalk';
import ora from 'ora';
import { runToolLoop } from './llm/tool-loop.js';
import { LOCAL_TOOL_SPECS } from './tool-specs.js';
import type { ChatMessage } from './llm/client.js';

export interface ExecOptions {
  model: string;
}

/**
 * Run a single command through Casper and print the result.
 */
export async function runOnce(command: string, opts: ExecOptions): Promise<void> {
  const spinner = ora({ text: chalk.dim('Casper is working...'), spinner: 'dots' }).start();

  const messages: ChatMessage[] = [
    { role: 'user', content: command },
  ];

  try {
    const response = await runToolLoop(messages, {
      model: opts.model,
      tools: LOCAL_TOOL_SPECS,
      onToolCall: (name) => {
        spinner.text = chalk.dim(`  ⚙ ${name}`);
      },
      onToolResult: (name, result: any) => {
        const status = result.ok ? chalk.green('✓') : chalk.red('✗');
        spinner.text = chalk.dim(`  ${status} ${name}`);
      },
    });

    spinner.stop();
    console.log(response);
  } catch (err: any) {
    spinner.stop();
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}
