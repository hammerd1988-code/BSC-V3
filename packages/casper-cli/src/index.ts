#!/usr/bin/env node
import { Command } from 'commander';
import { startRepl } from './cli.js';
import { startDaemon, stopDaemon, daemonStatus } from './daemon.js';
import { runOnce } from './exec.js';
import { getConfig, setConfig } from './config.js';
import { loginFlow, logout, authStatus } from './auth.js';
import { initProject } from './init.js';
import { listSessions, deleteSession } from './sessions.js';
import { orchestrate } from './swarm/index.js';
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
  .option('--resume [id]', 'Resume a previous session (use "last" or a session ID)')
  .action(async (opts) => {
    await startRepl({
      model: opts.model,
      preferLocal: opts.local ?? false,
      resume: opts.resume,
    });
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

// Auth (device-code flow against the Railway relay)
const auth = program.command('auth').description('Link this machine to your BSC account');

auth
  .command('login')
  .description('Link this machine via device code (approve at /casper/remote)')
  .option('--relay <url>', 'Relay URL override')
  .action(async (opts) => {
    await loginFlow({ relayUrl: opts.relay });
  });

auth
  .command('logout')
  .description('Clear the stored relay token')
  .action(() => {
    logout();
  });

auth
  .command('status')
  .description('Show auth/link status')
  .action(() => {
    authStatus();
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

// Project initialization
program
  .command('init')
  .description('Initialize .casper/ project config in the current directory')
  .option('--force', 'Overwrite existing .casper/ directory')
  .action(async (opts) => {
    await initProject({ force: opts.force });
  });

// Session management
const session = program.command('session').description('Manage conversation sessions');

session
  .command('list')
  .description('List saved sessions')
  .action(() => {
    const sessions = listSessions();
    if (sessions.length === 0) {
      console.log(chalk.dim('  No saved sessions.'));
      console.log(chalk.dim('  Sessions are auto-saved when you exit the REPL, or use /save.'));
      return;
    }
    console.log(chalk.magenta('\n  🔮 Saved Sessions\n'));
    for (const s of sessions) {
      const date = new Date(s.updatedAt).toLocaleDateString();
      console.log(`  ${chalk.cyan(s.id)}  ${chalk.white(s.title)}`);
      console.log(chalk.dim(`    ${s.messageCount} messages · ${s.model} · ${date}`));
    }
    console.log(chalk.dim(`\n  Resume with: casper chat --resume <id>\n`));
  });

session
  .command('delete <id>')
  .description('Delete a saved session')
  .action((id) => {
    if (deleteSession(id)) {
      console.log(chalk.green(`  Deleted session: ${id}`));
    } else {
      console.log(chalk.yellow(`  Session not found: ${id}`));
    }
  });

// Swarm orchestration
program
  .command('orchestrate <objective...>')
  .description('Decompose a complex task and run sub-agents in parallel')
  .option('--model <model>', 'LLM model for agents', 'gpt-4.1-mini')
  .option('--parallel <n>', 'Max parallel agents (default: 4)', '4')
  .option('--max-tasks <n>', 'Max subtasks to decompose into (default: 10)', '10')
  .option('--dry-run', 'Show the plan without executing')
  .action(async (objective, opts) => {
    await orchestrate(objective.join(' '), {
      model: opts.model,
      maxParallel: parseInt(opts.parallel, 10) || 4,
      maxTasks: parseInt(opts.maxTasks, 10) || 10,
      dryRun: opts.dryRun,
    });
  });

program.parse();
