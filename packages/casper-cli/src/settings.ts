import readline from 'readline';
import chalk from 'chalk';
import {
  getAllConfig,
  setConfig,
  deleteConfig,
  getConfigPath,
  SECRET_KEYS,
  type CasperConfig,
} from './config.js';
import { validateBaseUrl } from './utils/url.js';

// Re-export so callers that already import from settings keep working.
export { SECRET_KEYS };

/**
 * Mask a secret for display: keep the first/last few chars so the user can
 * recognise it, hide the middle. Short values are fully masked.
 */
export function mask(value?: string): string {
  if (!value) return chalk.dim('(not set)');
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer)));
}

function bool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

/**
 * Print the full, current configuration with secrets masked. Powers both
 * `casper config list` and the "list all" option inside `casper settings`.
 */
export function printAllSettings(): void {
  const cfg = getAllConfig();
  console.log(chalk.bold.cyan('\n  🔮 Casper configuration'));
  console.log(chalk.dim(`  ${getConfigPath()}\n`));

  const rows: Array<[string, string]> = [
    ['LLM source', bool(cfg.preferLocalLlm) ? 'local (LM Studio / Ollama)' : 'cloud'],
    ['Base URL', cfg.baseUrl || chalk.dim('(not set — default: https://api.openai.com/v1)')],
    ['Local LLM URL', cfg.localLlmUrl || chalk.dim('(not set)')],
    ['Model', cfg.model || chalk.dim('(not set)')],
    ['OpenAI API key', mask(cfg.openaiApiKey)],
    ['OpenRouter API key', mask(cfg.openrouterApiKey)],
    ['Anthropic API key', mask(cfg.anthropicApiKey)],
    ['Approval level', cfg.approvalLevel],
    ['Working directory', cfg.workingDirectory],
    ['Audit log', bool(cfg.auditLog) ? 'on' : 'off'],
    ['Relay URL', cfg.relayUrl],
    ['Machine name', cfg.machineName],
    ['Linked', cfg.accessToken ? chalk.green('yes') : chalk.yellow('no — run: casper auth login')],
  ];

  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) {
    console.log(`  ${chalk.dim(label.padEnd(width))}  ${value}`);
  }
  console.log('');
}

function printMenu(cfg: CasperConfig): void {
  console.log(chalk.bold.cyan('\n  🔮 Casper Settings'));
  console.log(chalk.dim(`  ${getConfigPath()}\n`));
  const lines: Array<[string, string, string]> = [
    ['1', 'LLM source', bool(cfg.preferLocalLlm) ? 'local (LM Studio / Ollama)' : 'cloud'],
    ['2', 'Base URL', cfg.baseUrl || chalk.dim('(default: https://api.openai.com/v1)')],
    ['3', 'Local LLM URL', cfg.localLlmUrl || chalk.dim('(not set)')],
    ['4', 'Model', cfg.model || chalk.dim('(not set)')],
    ['5', 'OpenAI API key', mask(cfg.openaiApiKey)],
    ['6', 'OpenRouter API key', mask(cfg.openrouterApiKey)],
    ['7', 'Anthropic API key', mask(cfg.anthropicApiKey)],
    ['8', 'Approval level', cfg.approvalLevel],
    ['9', 'Working directory', cfg.workingDirectory],
    ['10', 'Audit log', bool(cfg.auditLog) ? 'on' : 'off'],
  ];
  for (const [num, label, value] of lines) {
    console.log(`  ${chalk.cyan(num)}) ${label.padEnd(18)} ${chalk.dim('→')} ${value}`);
  }
  console.log(`  ${chalk.cyan('l')}) List everything (incl. relay / link status)`);
  console.log(`  ${chalk.cyan('q')}) Save & quit`);
}

const APPROVAL_LEVELS: ReadonlyArray<CasperConfig['approvalLevel']> = [
  'auto',
  'confirm-local',
  'confirm-remote',
];

/**
 * Interactive, menu-driven settings editor. Uses line-mode readline only
 * (no raw-mode / keypress handling) so it stays safe inside the pkg-bundled
 * standalone binary, where raw-mode toggling segfaults.
 */
export async function runSettings(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    let done = false;
    while (!done) {
      const cfg = getAllConfig();
      printMenu(cfg);
      const choice = (await ask(rl, chalk.cyan('\n  Select an option: '))).trim().toLowerCase();

      switch (choice) {
        case '1': {
          const current = bool(cfg.preferLocalLlm);
          const answer = (
            await ask(rl, `  Use a local LLM (LM Studio / Ollama)? [Y/n] (current: ${current ? 'local' : 'cloud'}): `)
          )
            .trim()
            .toLowerCase();
          const useLocal = answer === '' ? current : !['n', 'no', 'cloud', 'c'].includes(answer);
          setConfig('preferLocalLlm', useLocal);
          console.log(chalk.green(`  ✔ LLM source set to ${useLocal ? 'local' : 'cloud'}.`));
          if (useLocal && !cfg.localLlmUrl) {
            console.log(chalk.yellow('  Tip: set the Local LLM URL (option 3), e.g. http://localhost:1234/v1'));
          }
          break;
        }
        case '2': {
          const answer = (
            await ask(rl, `  Base URL (blank = keep "${cfg.baseUrl || 'not set'}", "-" to clear): `)
          ).trim();
          if (answer === '-') {
            deleteConfig('baseUrl');
            console.log(chalk.green('  ✔ Cleared.'));
          } else if (answer) {
            try {
              setConfig('baseUrl', validateBaseUrl(answer));
              console.log(chalk.green('  ✔ Updated.'));
            } catch (err) {
              console.log(chalk.yellow(`  ${(err as Error).message} Left unchanged.`));
            }
          }
          break;
        }
        case '3': {
          const answer = (
            await ask(rl, `  Local LLM URL (blank = keep "${cfg.localLlmUrl || 'not set'}", "-" to clear): `)
          ).trim();
          if (answer === '-') {
            deleteConfig('localLlmUrl');
            console.log(chalk.green('  ✔ Cleared.'));
          } else if (answer) {
            try {
              setConfig('localLlmUrl', validateBaseUrl(answer, { allowInsecureHttp: true }));
              console.log(chalk.green('  ✔ Updated.'));
            } catch (err) {
              console.log(chalk.yellow(`  ${(err as Error).message} Left unchanged.`));
            }
          }
          break;
        }
        case '4': {
          const answer = (await ask(rl, `  Model id (blank = keep "${cfg.model}"): `)).trim();
          if (answer) {
            setConfig('model', answer);
            console.log(chalk.green('  ✔ Updated.'));
          }
          break;
        }
        case '5': {
          const answer = (
            await ask(rl, `  OpenAI API key (current ${mask(cfg.openaiApiKey)}; blank = keep, "-" to clear): `)
          ).trim();
          if (answer === '-') {
            deleteConfig('openaiApiKey');
            console.log(chalk.green('  ✔ Cleared.'));
          } else if (answer) {
            setConfig('openaiApiKey', answer);
            console.log(chalk.green('  ✔ Saved (stored owner-only at the config path above).'));
          }
          break;
        }
        case '6': {
          const answer = (
            await ask(rl, `  OpenRouter API key (current ${mask(cfg.openrouterApiKey)}; blank = keep, "-" to clear): `)
          ).trim();
          if (answer === '-') {
            deleteConfig('openrouterApiKey');
            console.log(chalk.green('  ✔ Cleared.'));
          } else if (answer) {
            setConfig('openrouterApiKey', answer);
            console.log(chalk.green('  ✔ Saved (stored owner-only at the config path above).'));
          }
          break;
        }
        case '7': {
          const answer = (
            await ask(rl, `  Anthropic API key (current ${mask(cfg.anthropicApiKey)}; blank = keep, "-" to clear): `)
          ).trim();
          if (answer === '-') {
            deleteConfig('anthropicApiKey');
            console.log(chalk.green('  ✔ Cleared.'));
          } else if (answer) {
            setConfig('anthropicApiKey', answer);
            console.log(chalk.green('  ✔ Saved (stored owner-only at the config path above).'));
          }
          break;
        }
        case '8': {
          console.log(`    ${chalk.cyan('1')}) auto           ${chalk.dim('— run everything without asking')}`);
          console.log(`    ${chalk.cyan('2')}) confirm-local  ${chalk.dim('— ask before risky local commands')}`);
          console.log(`    ${chalk.cyan('3')}) confirm-remote ${chalk.dim('— ask before remote-triggered commands')}`);
          const answer = (await ask(rl, `  Choose [1-3] (current: ${cfg.approvalLevel}): `)).trim();
          const picked = APPROVAL_LEVELS[Number(answer) - 1];
          if (picked) {
            setConfig('approvalLevel', picked);
            console.log(chalk.green(`  ✔ Approval level set to ${picked}.`));
          } else if (answer) {
            console.log(chalk.yellow('  Unrecognised choice — left unchanged.'));
          }
          break;
        }
        case '9': {
          const answer = (await ask(rl, `  Working directory (blank = keep "${cfg.workingDirectory}"): `)).trim();
          if (answer) {
            setConfig('workingDirectory', answer);
            console.log(chalk.green('  ✔ Updated.'));
          }
          break;
        }
        case '10': {
          const next = !bool(cfg.auditLog);
          setConfig('auditLog', next);
          console.log(chalk.green(`  ✔ Audit log ${next ? 'enabled' : 'disabled'}.`));
          break;
        }
        case 'l':
        case 'list': {
          printAllSettings();
          break;
        }
        case 'q':
        case 'quit':
        case 'exit':
        case '': {
          done = true;
          break;
        }
        default:
          console.log(chalk.yellow(`  Unknown option "${choice}".`));
      }
    }
  } finally {
    rl.close();
  }

  console.log(chalk.magenta('\n  Settings saved. 🔮\n'));
}
