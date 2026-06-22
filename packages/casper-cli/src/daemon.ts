import os from 'os';
import chalk from 'chalk';
import { io, type Socket } from 'socket.io-client';
import { getConfig } from './config.js';
import { getRelayHttpBase } from './auth.js';
import { runToolLoop } from './llm/tool-loop.js';
import type { ChatMessage } from './llm/client.js';
import { LOCAL_TOOL_SPECS } from './tool-specs.js';
import { listProcesses } from './tools/index.js';
import { audit } from './utils/logger.js';
import type {
  CliToRelayMessage,
  RelayToCliMessage,
  DirectiveMessage,
  MachineInfo,
  ProcessInfo,
} from './protocol.js';

const VERSION = '0.1.0';
const HEARTBEAT_INTERVAL_MS = 30_000;
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

function machineInfo(): MachineInfo {
  return {
    machineId: getConfig('machineId'),
    machineName: getConfig('machineName'),
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    nodeVersion: process.version,
    cliVersion: VERSION,
    capabilities: LOCAL_TOOL_SPECS.map((t) => t.function.name),
  };
}

function currentProcesses(): ProcessInfo[] {
  const result = listProcesses();
  return result.ok && Array.isArray(result.data) ? (result.data as ProcessInfo[]) : [];
}

/**
 * Start the Casper daemon — maintains a Socket.IO connection to the
 * Railway relay (`/relay` namespace) and executes remote directives
 * locally through the same tool loop used by the REPL.
 */
export async function startDaemon(opts: { relayUrl?: string }): Promise<void> {
  const httpBase = getRelayHttpBase(opts.relayUrl);
  const machine = machineInfo();
  const token = getConfig('accessToken');

  console.log(chalk.magenta('🔮 Casper Daemon'));
  console.log(chalk.dim(`   Machine: ${machine.machineName} (${machine.machineId})`));
  console.log(chalk.dim(`   Relay:   ${httpBase}/relay`));
  console.log('');

  if (!token) {
    console.log(chalk.yellow('   ⚠ Not authenticated. Run: casper auth login'));
    return;
  }

  const socket: Socket = io(`${httpBase}/relay`, {
    auth: { token },
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 30000,
    timeout: 15000,
  });

  const send = (message: CliToRelayMessage) => socket.emit('relay:message', message);

  // directiveId -> resolver for a pending remote approval
  const pendingApprovals = new Map<string, (approved: boolean) => void>();
  const abortedDirectives = new Set<string>();
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  socket.on('connect', () => {
    console.log(chalk.green('   ✓ Connected to relay — registering machine…'));
    send({ type: 'cli:register', token: '', machine });
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      send({
        type: 'cli:heartbeat',
        machineId: machine.machineId,
        uptime: process.uptime(),
        load: os.loadavg(),
        processes: currentProcesses(),
      });
    }, HEARTBEAT_INTERVAL_MS);
  });

  socket.on('connect_error', (err) => {
    console.log(chalk.red(`   ✗ Relay connection error: ${err.message}`));
    if (/invalid|revoked|required/i.test(err.message)) {
      console.log(chalk.yellow('   Token rejected. Run: casper auth login'));
      socket.disconnect();
      process.exit(1);
    }
  });

  socket.on('disconnect', (reason) => {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    console.log(chalk.yellow(`   ⚠ Disconnected from relay (${reason}) — will retry.`));
  });

  async function executeDirective(directive: DirectiveMessage): Promise<void> {
    const startedAt = Date.now();
    console.log(chalk.cyan(`   ◆ Directive [${directive.source}]: ${directive.command}`));
    audit('remote_directive', { id: directive.id, source: directive.source, command: directive.command });

    const messages: ChatMessage[] = [
      ...directive.conversationHistory.map((turn): ChatMessage => ({
        role: turn.role === 'casper' ? 'assistant' : 'user',
        content: turn.text,
      })),
    ];
    if (messages[messages.length - 1]?.content !== directive.command) {
      messages.push({ role: 'user', content: directive.command });
    }

    const approvalLevel = getConfig('approvalLevel');

    try {
      const response = await runToolLoop(messages, {
        model: getConfig('model'),
        tools: LOCAL_TOOL_SPECS,
        onToken: (token) => {
          if (abortedDirectives.has(directive.id)) return;
          send({ type: 'llm:token', directiveId: directive.id, token });
        },
        onToolCall: (name, args) => {
          if (abortedDirectives.has(directive.id)) throw new Error('Directive aborted by operator.');
          send({ type: 'tool:start', directiveId: directive.id, toolName: name, args });
        },
        onToolResult: (name, result) => {
          const r = result as { ok?: boolean; error?: string } | undefined;
          send({
            type: 'tool:result',
            directiveId: directive.id,
            result: {
              ok: r?.ok !== false,
              data: result,
              error: r?.ok === false ? r?.error : undefined,
              durationMs: Date.now() - startedAt,
            },
          });
        },
        confirm: async (command: string) => {
          if (approvalLevel === 'auto') return true;
          send({
            type: 'cli:approval_request',
            directiveId: directive.id,
            machineId: machine.machineId,
            toolName: 'local__shell',
            args: { command },
            reason: `Casper wants to run a potentially destructive command: ${command}`,
          });
          return new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => {
              pendingApprovals.delete(directive.id);
              resolve(false);
            }, APPROVAL_TIMEOUT_MS);
            pendingApprovals.set(directive.id, (approved) => {
              clearTimeout(timer);
              pendingApprovals.delete(directive.id);
              resolve(approved);
            });
          });
        },
      });

      if (abortedDirectives.has(directive.id)) {
        abortedDirectives.delete(directive.id);
        send({ type: 'directive:complete', directiveId: directive.id, status: 'failed', response: 'Directive aborted by operator.' });
        return;
      }

      send({ type: 'directive:complete', directiveId: directive.id, status: 'completed', response });
      console.log(chalk.green(`   ✓ Directive complete (${Date.now() - startedAt}ms)`));
    } catch (e: any) {
      abortedDirectives.delete(directive.id);
      send({ type: 'directive:complete', directiveId: directive.id, status: 'failed', response: e.message || 'Directive failed.' });
      console.log(chalk.red(`   ✗ Directive failed: ${e.message}`));
    }
  }

  socket.on('relay:message', (message: RelayToCliMessage) => {
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;
    switch (message.type) {
      case 'relay:ack':
        console.log(chalk.green(`   ✓ Registered (session ${message.sessionId.slice(0, 8)}…)`));
        console.log(chalk.dim('   Listening for directives. Ctrl+C to stop.'));
        send({ type: 'cli:status', machineId: machine.machineId, online: true, processes: currentProcesses() });
        break;
      case 'directive':
        void executeDirective(message);
        break;
      case 'cli:abort':
        abortedDirectives.add(message.directiveId);
        pendingApprovals.get(message.directiveId)?.(false);
        console.log(chalk.yellow(`   ⚠ Abort requested for directive ${message.directiveId.slice(0, 8)}…`));
        break;
      case 'cli:approval_response':
        pendingApprovals.get(message.directiveId)?.(message.approved);
        console.log(message.approved
          ? chalk.green('   ✓ Operator approved.')
          : chalk.red('   ✗ Operator denied.'));
        break;
    }
  });

  const shutdown = () => {
    console.log(chalk.dim('\n   Shutting down daemon…'));
    if (heartbeat) clearInterval(heartbeat);
    socket.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process alive while the socket runs.
  await new Promise(() => undefined);
}

export async function stopDaemon(): Promise<void> {
  console.log(chalk.dim('   The daemon runs in the foreground — stop it with Ctrl+C in its terminal,'));
  console.log(chalk.dim('   or kill the casper process from your process manager.'));
}

export async function daemonStatus(): Promise<void> {
  const machineId = getConfig('machineId');
  const machineName = getConfig('machineName');
  const token = getConfig('accessToken');
  const base = getRelayHttpBase();

  console.log(chalk.magenta('🔮 Casper Daemon Status'));
  console.log(chalk.dim(`   Machine: ${machineName} (${machineId})`));
  console.log(chalk.dim(`   Relay:   ${base}/relay`));
  console.log(chalk.dim(`   Auth:    ${token ? chalk.green('linked') : chalk.yellow('not linked — run casper auth login')}`));
}
