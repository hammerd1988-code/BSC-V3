import chalk from 'chalk';
import { openUrl } from './utils/open-url.js';
import { getConfig, setConfig, deleteConfig } from './config.js';

/**
 * Derive the relay HTTP base URL from the configured relayUrl.
 * Accepts wss://host[/path], https://host, or plain host values.
 */
export function getRelayHttpBase(override?: string): string {
  const raw = override || getConfig('relayUrl') || 'https://bloodsweatcode.org';
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    url = new URL('https://bloodsweatcode.org');
  }
  const protocol = url.protocol === 'ws:' ? 'http:' : url.protocol === 'wss:' ? 'https:' : url.protocol;
  return `${protocol}//${url.host}`;
}

interface DeviceInitBody {
  success: boolean;
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
  error?: string;
}

interface DevicePollBody {
  success: boolean;
  status: 'pending' | 'authorized' | 'expired';
  accessToken?: string;
  userId?: string;
  error?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Device-code login: request a code from the relay, show it to the user,
 * open the verification page, and poll until the operator approves.
 */
export async function loginFlow(opts: { relayUrl?: string } = {}): Promise<void> {
  const base = getRelayHttpBase(opts.relayUrl);
  const machineId = getConfig('machineId');
  const machineName = getConfig('machineName');

  console.log(chalk.magenta('🔮 Casper Auth — link this machine'));
  console.log(chalk.dim(`   Relay: ${base}`));
  console.log('');

  let init: DeviceInitBody;
  try {
    const res = await fetch(`${base}/api/casper/relay/device/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machineId, machineName }),
    });
    init = (await res.json()) as DeviceInitBody;
    if (!res.ok || !init.success) throw new Error(init.error || `HTTP ${res.status}`);
  } catch (e: any) {
    console.log(chalk.red(`   ✗ Could not reach relay: ${e.message}`));
    return;
  }

  console.log(`   Your code: ${chalk.bold.cyan(init.userCode)}`);
  console.log(chalk.dim(`   Enter it at: ${init.verificationUrl}`));
  console.log('');
  openUrl(init.verificationUrl);

  console.log(chalk.dim('   Waiting for approval...'));
  const intervalMs = Math.max(2, init.interval || 5) * 1000;
  const deadline = Date.now() + (init.expiresIn || 600) * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);
    let poll: DevicePollBody;
    try {
      const res = await fetch(`${base}/api/casper/relay/device/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceCode: init.deviceCode }),
      });
      poll = (await res.json()) as DevicePollBody;
    } catch {
      continue; // transient network error — keep polling
    }
    if (poll.status === 'authorized' && poll.accessToken) {
      setConfig('accessToken', poll.accessToken);
      if (poll.userId) setConfig('userId', poll.userId);
      console.log(chalk.green('   \u2714 Machine linked. Run: casper daemon start'));
      return;
    }
    if (poll.status === 'expired') {
      console.log(chalk.red('   \u2717 Code expired. Run casper auth login again.'));
      return;
    }
  }
  console.log(chalk.red('   \u2717 Timed out waiting for approval.'));
}

export function logout(): void {
  deleteConfig('accessToken');
  deleteConfig('userId');
  console.log(chalk.green('   ✓ Logged out — relay token cleared.'));
}

export function authStatus(): void {
  const token = getConfig('accessToken');
  const userId = getConfig('userId');
  console.log(chalk.magenta('🔮 Casper Auth Status'));
  console.log(chalk.dim(`   Machine: ${getConfig('machineName')} (${getConfig('machineId')})`));
  console.log(chalk.dim(`   Relay:   ${getRelayHttpBase()}`));
  console.log(`   Linked:  ${token ? chalk.green('yes') : chalk.yellow('no — run casper auth login')}`);
  if (userId) console.log(chalk.dim(`   User:    ${userId}`));
}
