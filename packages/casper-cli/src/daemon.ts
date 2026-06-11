import chalk from 'chalk';
import { getConfig } from './config.js';

/**
 * Start the Casper daemon — maintains a WebSocket connection to Railway
 * relay and executes remote directives locally.
 *
 * Phase 1B implementation — currently a stub that validates config
 * and reports readiness. Full WebSocket relay will be wired in Phase 1B.
 */
export async function startDaemon(opts: { relayUrl?: string }): Promise<void> {
  const relayUrl = opts.relayUrl || getConfig('relayUrl');
  const machineId = getConfig('machineId');
  const machineName = getConfig('machineName');

  console.log(chalk.magenta('🔮 Casper Daemon'));
  console.log(chalk.dim(`   Machine: ${machineName} (${machineId})`));
  console.log(chalk.dim(`   Relay:   ${relayUrl}`));
  console.log('');

  // Check for auth token
  const token = getConfig('accessToken');
  if (!token) {
    console.log(chalk.yellow('   ⚠ Not authenticated. Run: casper auth login'));
    console.log(chalk.dim('   (Phase 1B: device auth flow not yet implemented)'));
    return;
  }

  console.log(chalk.green('   ✓ Authenticated'));
  console.log(chalk.dim('   Phase 1B: WebSocket relay connection will be implemented next.'));
  console.log(chalk.dim('   For now, use interactive mode: casper chat'));
}

export async function stopDaemon(): Promise<void> {
  console.log(chalk.dim('   Daemon stop — Phase 1B (not yet implemented)'));
}

export async function daemonStatus(): Promise<void> {
  const machineId = getConfig('machineId');
  const machineName = getConfig('machineName');
  const token = getConfig('accessToken');

  console.log(chalk.magenta('🔮 Casper Daemon Status'));
  console.log(chalk.dim(`   Machine: ${machineName} (${machineId})`));
  console.log(chalk.dim(`   Auth:    ${token ? chalk.green('configured') : chalk.yellow('not configured')}`));
  console.log(chalk.dim(`   Status:  ${chalk.yellow('offline')} (daemon mode is Phase 1B)`));
}
