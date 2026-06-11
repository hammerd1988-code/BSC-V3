#!/usr/bin/env node
import { Command } from 'commander';
import { startRepl } from './cli.js';
import { startDaemon, stopDaemon, daemonStatus } from './daemon.js';
import { runOnce } from './exec.js';
import { getConfig, setConfig } from './config.js';
import chalk from 'chalk';

const VERSION = '0.1.0';

const program = new Command();

program
  .name('casper')
  .description('Casper AI agent — local shell access and remote orchestration')
  .version(VERSION);

// Default: interactive REPL
program
  .command('chat', { isDefault: true })
  .description('Start interactive chat with Casper')
  .option('--model <model>', 'LLM model to use', 'gpt-4.1-mini')
  .option('--local', 'Prefer local LLM (LM Studio / Ollama)')
  .action(async (opts) => {
    await startRepl({ model: opts.model, preferLocal: opts.local ?? false });
  });

// One-shot command execution
program
  .command('exec <command>')
  .description('Run a command through Casper (one-shot)')
  .option('--model <model>', 'LLM model to use', 'gpt-4.1-mini')
  .action(async (command, opts) => {
    await runOnce(command, { model: opts.model });
  });

// Quick question
program
  .command('ask <question...>')
  .description('Ask Casper a quick question with local context')
  .option('--model <model>', 'LLM model to use', 'gpt-4.1-mini')
  .action(async (question, opts) => {
    await runOnce(question.join(' '), { model: opts.model });
  });

// Daemon management
const daemon = program.command('daemon').description('Manage the background daemon');

daemon
  .command('start')
  .description('Start the Casper daemon (connects to Railway relay)')
  .option('--relay <url>', 'WebSocket relay URL')
  .action(async (opts) => {
    await startDaemon({ relayUrl: opts.relay });
  });

daemon
  .command('stop')
  .description('Stop the running daemon')
  .action(async () => {
    await stopDaemon();
  });

daemon
  .command('status')
  .description('Show daemon status')
  .action(async () => {
    await daemonStatus();
  });

// Config management
const config = program.command('config').description('Manage CLI configuration');

config
  .command('get <key>')
  .description('Get a config value')
  .action((key) => {
    const value = getConfig(key);
    if (value !== undefined) {
      console.log(value);
    } else {
      console.log(chalk.dim('(not set)'));
    }
  });

config
  .command('set <key> <value>')
  .description('Set a config value')
  .action((key, value) => {
    setConfig(key, value);
    console.log(chalk.green(`Set ${key} = ${value}`));
  });

program.parse();
