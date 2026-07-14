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
import { pluginList, pluginInfo, pluginInit, pluginRemove } from './plugins/index.js';
import { runSettings, printAllSettings } from './settings.js';
import { fetchMemoryContext, listMemories, addMemory, getMemory, updateMemory, deleteMemory, bulkDeleteMemories, setContextNote, formatMemory, formatMemoryContext } from './memory.js';
import chalk from 'chalk';

const VERSION = '0.1.1';

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

config
  .command('list')
  .alias('ls')
  .description('Show all config values (secrets masked)')
  .action(() => {
    printAllSettings();
  });

// Interactive settings wizard — the friendly front door for config.
program
  .command('settings')
  .description('Open the interactive settings menu (model, local LLM, API keys, approvals)')
  .action(async () => {
    await runSettings();
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

// Memory management bridge (syncs with the web Casper memory store)
const memory = program.command('memory').description('Manage Casper memories stored in your BSC account');

memory
  .command('list')
  .description('List your Casper memories')
  .option('--type <type>', 'Filter by memory type')
  .option('--pinned', 'Only pinned memories')
  .option('--search <query>', 'Search memory content')
  .option('--limit <n>', 'Max results', '50')
  .option('--offset <n>', 'Pagination offset', '0')
  .action(async (opts) => {
    try {
      const res = await listMemories({
        q: opts.search,
        type: opts.type,
        pinned: opts.pinned,
        limit: parseInt(opts.limit, 10),
        offset: parseInt(opts.offset, 10),
      });
      if (res.memories.length === 0) {
        console.log(chalk.dim('  No memories found.'));
        return;
      }
      for (const memory of res.memories) {
        console.log(formatMemory(memory));
        console.log();
      }
      console.log(chalk.dim(`  ${res.total} total · showing ${res.offset + 1}-${res.offset + res.memories.length}`));
    } catch (e: any) {
      console.error(chalk.red(`  ✗ ${e.message}`));
      process.exit(1);
    }
  });

memory
  .command('add <content...>')
  .description('Add a memory to your Casper account')
  .option('--type <type>', 'Memory type', 'preference')
  .option('--importance <n>', 'Importance 1-10', '7')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--pinned', 'Pin the memory', false)
  .action(async (contentArr, opts) => {
    try {
      const content = contentArr.join(' ');
      const tags = opts.tags ? String(opts.tags).split(',').map((t: string) => t.trim()).filter(Boolean) : [];
      const res = await addMemory({
        content,
        memory_type: opts.type,
        importance: parseInt(opts.importance, 10),
        tags,
        pinned: opts.pinned,
      });
      console.log(chalk.green(`  ✓ Memory added: ${res.memory.id}`));
    } catch (e: any) {
      console.error(chalk.red(`  ✗ ${e.message}`));
      process.exit(1);
    }
  });

memory
  .command('show <id>')
  .description('Show a single memory')
  .action(async (id) => {
    try {
      const res = await getMemory(id);
      console.log(formatMemory(res.memory));
    } catch (e: any) {
      console.error(chalk.red(`  ✗ ${e.message}`));
      process.exit(1);
    }
  });

memory
  .command('rm <id>')
  .description('Delete a memory by id')
  .action(async (id) => {
    try {
      await deleteMemory(id);
      console.log(chalk.green(`  ✓ Deleted memory ${id}`));
    } catch (e: any) {
      console.error(chalk.red(`  ✗ ${e.message}`));
      process.exit(1);
    }
  });

memory
  .command('rm-batch <ids...>')
  .description('Delete multiple memories by id')
  .action(async (ids) => {
    try {
      const res = await bulkDeleteMemories(ids);
      console.log(chalk.green(`  ✓ Deleted ${res.deleted} memories`));
    } catch (e: any) {
      console.error(chalk.red(`  ✗ ${e.message}`));
      process.exit(1);
    }
  });

memory
  .command('pin <id>')
  .description('Toggle pin on a memory')
  .action(async (id) => {
    try {
      const existing = await getMemory(id);
      const next = !existing.memory.pinned;
      await updateMemory(id, { pinned: next });
      console.log(chalk.green(`  ✓ Memory ${next ? 'pinned' : 'unpinned'}`));
    } catch (e: any) {
      console.error(chalk.red(`  ✗ ${e.message}`));
      process.exit(1);
    }
  });

memory
  .command('context')
  .description('Show the BSC memory context that gets prepended to every Casper conversation')
  .action(async () => {
    try {
      const ctx = await fetchMemoryContext();
      if (!ctx) {
        console.log(chalk.dim('  No memory context available (not linked or unreachable).'));
        return;
      }
      console.log(formatMemoryContext(ctx));
    } catch (e: any) {
      console.error(chalk.red(`  ✗ ${e.message}`));
      process.exit(1);
    }
  });

memory
  .command('set-context <note...>')
  .description('Set your permanent Casper context note')
  .action(async (noteArr) => {
    try {
      const note = noteArr.join(' ');
      const res = await setContextNote(note);
      console.log(chalk.green(`  ✓ Context note saved (${res.contextNote.length} chars)`));
    } catch (e: any) {
      console.error(chalk.red(`  ✗ ${e.message}`));
      process.exit(1);
    }
  });

// Quick context-note shorthand
program
  .command('context <note...>')
  .description('Set your permanent Casper context note (shorthand for `casper memory set-context`)')
  .action(async (noteArr) => {
    try {
      const note = noteArr.join(' ');
      const res = await setContextNote(note);
      console.log(chalk.green(`  ✓ Context note saved (${res.contextNote.length} chars)`));
    } catch (e: any) {
      console.error(chalk.red(`  ✗ ${e.message}`));
      process.exit(1);
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

// Plugin management
const plugin = program.command('plugin').description('Manage Casper plugins (custom AI tools)');

plugin
  .command('list')
  .description('List all installed plugins')
  .action(() => {
    pluginList();
  });

plugin
  .command('info <name>')
  .description('Show detailed info about a plugin')
  .action((name) => {
    pluginInfo(name);
  });

plugin
  .command('init <name>')
  .description('Create a new plugin scaffold')
  .option('-g, --global', 'Create as a global plugin (available in all projects)')
  .option('--runtime <runtime>', 'Entry script runtime: node, python, bash (default: node)')
  .action((name, opts) => {
    pluginInit(name, { global: opts.global, runtime: opts.runtime });
  });

plugin
  .command('remove <name>')
  .description('Remove an installed plugin')
  .option('-g, --global', 'Remove from global plugins only')
  .action((name, opts) => {
    pluginRemove(name, { global: opts.global });
  });

program.parse();
