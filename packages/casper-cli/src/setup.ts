import readline from 'readline';
import { Writable } from 'stream';
import chalk from 'chalk';
import { getConfig, setConfig, deleteConfig, getConfigPath, type CasperConfig } from './config.js';
import { printAllSettings } from './settings.js';
import { validateBaseUrl } from './utils/url.js';
import { OPENROUTER_BASE_URL, resolveCloudConfig } from './llm/client.js';

interface LocalProvider {
  name: string;
  url: string;
  models: string[];
}

class InputQueue {
  private buffer: string[] = [];
  private resolvers: Array<(line: string | null) => void> = [];
  private closed = false;

  constructor(rl: readline.Interface) {
    rl.on('line', (line) => {
      const resolve = this.resolvers.shift();
      if (resolve) {
        resolve(line);
      } else {
        this.buffer.push(line);
      }
    });
    rl.on('close', () => {
      this.closed = true;
      while (this.resolvers.length) {
        this.resolvers.shift()!(null);
      }
    });
  }

  async next(): Promise<string | null> {
    if (this.buffer.length) return this.buffer.shift()!;
    if (this.closed) return null;
    return new Promise((resolve) => this.resolvers.push(resolve));
  }
}

// When `echoMuted` is true, characters readline would normally echo back to
// the terminal are dropped. This lets us collect a secret without ever
// printing it — no raw-mode toggling required (raw mode segfaults inside the
// pkg-bundled standalone binary).
let echoMuted = false;
const mutableOut = new Writable({
  write(chunk, _enc, cb) {
    if (!echoMuted) process.stdout.write(chunk as Buffer);
    cb();
  },
});

function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: mutableOut,
    terminal: process.stdout.isTTY,
  });
}

async function ask(queue: InputQueue, question: string): Promise<string> {
  process.stdout.write(question);
  const line = await queue.next();
  if (line === null) {
    throw new Error('stdin closed before input was received');
  }
  // readline already echoes typed characters and emits a newline in TTY mode.
  if (!process.stdout.isTTY) {
    process.stdout.write(`${line}\n`);
  }
  return line.trim();
}

async function askPassword(queue: InputQueue, question: string): Promise<string> {
  process.stdout.write(question);
  // Suppress echo of the typed secret entirely (never rendered to the screen),
  // then print a masked confirmation once the line is submitted.
  echoMuted = true;
  let line: string | null;
  try {
    line = await queue.next();
  } finally {
    echoMuted = false;
  }
  if (line === null) {
    throw new Error('stdin closed before input was received');
  }
  const trimmed = line.trim();
  const mask = trimmed ? '*'.repeat(Math.min(trimmed.length, 12)) : '(skipped)';
  // No characters were echoed (input was muted), so just render the mask.
  process.stdout.write(`${mask}\n`);
  return trimmed;
}

async function choose<T extends { label: string }>(
  queue: InputQueue,
  question: string,
  items: T[],
  defaultIndex = 0,
): Promise<T | null> {
  console.log(chalk.cyan(question));
  for (let i = 0; i < items.length; i++) {
    const marker = i === defaultIndex ? chalk.green('  ● ') : '    ';
    console.log(`${marker}${i + 1}) ${items[i].label}`);
  }
  console.log(`    q) Skip / cancel`);
  const answer = await ask(queue, chalk.dim('  Select: '));
  if (answer.toLowerCase() === 'q') {
    return null;
  }
  if (answer === '') {
    return items[defaultIndex];
  }
  const n = parseInt(answer, 10);
  if (Number.isNaN(n) || n < 1 || n > items.length) {
    console.log(chalk.yellow('  Invalid choice.'));
    return null;
  }
  return items[n - 1];
}

async function fetchModels(baseUrl: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/models`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    if (Array.isArray(data.data)) {
      return data.data.map((m) => m.id).filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

async function detectLocalProviders(): Promise<LocalProvider[]> {
  const candidates = [
    { name: 'LM Studio', url: 'http://localhost:1234/v1' },
    { name: 'Ollama', url: 'http://localhost:11434/v1' },
  ];
  const providers: LocalProvider[] = [];
  for (const c of candidates) {
    const models = await fetchModels(c.url);
    if (models.length > 0) {
      providers.push({ name: c.name, url: c.url, models });
    }
  }
  return providers;
}

function hasLlmConfig(): boolean {
  if (getConfig('preferLocalLlm') && getConfig('localLlmUrl')) return true;
  try {
    resolveCloudConfig();
    return true;
  } catch {
    return false;
  }
}

async function setupOpenAI(queue: InputQueue): Promise<void> {
  console.log(chalk.cyan('\n  Using OpenAI or a custom OpenAI-compatible API.'));
  console.log(chalk.dim('  Your key is stored owner-only at:') + ` ${getConfigPath()}\n`);

  const key = await askPassword(queue, chalk.white('  API key: '));
  if (!key) {
    console.log(chalk.yellow('  No key entered. Skipping.'));
    return;
  }
  setConfig('openaiApiKey', key as CasperConfig['openaiApiKey']);
  // Avoid a previously saved OpenRouter key selecting OpenRouter when the
  // user intentionally switches back to OpenAI's default endpoint.
  deleteConfig('openrouterApiKey');

  const baseUrl = await ask(queue, chalk.white('  Base URL (default: https://api.openai.com/v1, or e.g. https://openrouter.ai/api/v1): '));
  if (baseUrl) {
    try {
      setConfig('baseUrl', validateBaseUrl(baseUrl) as CasperConfig['baseUrl']);
    } catch (err) {
      console.log(chalk.yellow(`  ${(err as Error).message} Using the default base URL.`));
      deleteConfig('baseUrl');
    }
  } else {
    deleteConfig('baseUrl');
  }

  const model = await ask(queue, chalk.white('  Model (default: gpt-4.1-mini): '));
  setConfig('model', model || 'gpt-4.1-mini');
  setConfig('preferLocalLlm', false);
}

async function setupOpenRouter(queue: InputQueue): Promise<void> {
  console.log(chalk.cyan('\n  Using OpenRouter.'));
  console.log(chalk.dim(`  Endpoint: ${OPENROUTER_BASE_URL}`));
  console.log(chalk.dim('  Create a key at https://openrouter.ai/settings/keys'));
  console.log(chalk.dim('  Your key is stored owner-only at:') + ` ${getConfigPath()}\n`);

  const key = await askPassword(queue, chalk.white('  OpenRouter API key: '));
  if (!key) {
    console.log(chalk.yellow('  No key entered. Skipping.'));
    return;
  }

  setConfig('openrouterApiKey', key);
  setConfig('baseUrl', OPENROUTER_BASE_URL);

  const model = await ask(
    queue,
    chalk.white('  OpenRouter model id (default: openai/gpt-4.1-mini): '),
  );
  setConfig('model', model || 'openai/gpt-4.1-mini');
  setConfig('preferLocalLlm', false);
}

async function setupLocal(queue: InputQueue): Promise<void> {
  console.log(chalk.cyan('\n  Looking for a local LLM on your machine...'));

  const providers = await detectLocalProviders();
  let url = '';
  let models: string[] = [];
  let sourceName = 'Local LLM';

  if (providers.length === 1) {
    const p = providers[0];
    const use = await ask(queue, chalk.white(`  Found ${p.name} at ${p.url}. Use it? [Y/n] `));
    if (use.toLowerCase() !== 'n' && use.toLowerCase() !== 'no') {
      url = p.url;
      models = p.models;
      sourceName = p.name;
    }
  } else if (providers.length > 1) {
    const picked = await choose(
      queue,
      'Multiple local LLM servers found:',
      providers.map((p) => ({
        label: `${p.name} — ${p.url} (${p.models.length} models)`,
        value: p,
      })),
    );
    if (picked) {
      url = picked.value.url;
      models = picked.value.models;
      sourceName = picked.value.name;
    }
  }

  if (!url) {
    const defaultUrl = 'http://localhost:1234/v1';
    const input = await ask(queue, chalk.white(`  Local LLM base URL (default: ${defaultUrl}): `));
    if (input) {
      try {
        url = validateBaseUrl(input, { allowInsecureHttp: true });
      } catch (err) {
        console.log(chalk.yellow(`  ${(err as Error).message} Using ${defaultUrl}.`));
        url = defaultUrl;
      }
    } else {
      url = defaultUrl;
    }
    models = await fetchModels(url);
    if (models.length > 0) {
      sourceName = 'Local LLM';
    }
  }

  console.log(chalk.dim(`  ${models.length > 0 ? `Found ${models.length} model(s) at ${url}.` : `No models auto-detected at ${url}.`}`));

  let model = '';
  if (models.length > 0) {
    const picked = await choose(
      queue,
      'Choose a model:',
      models.map((m) => ({ label: m, value: m })),
      0,
    );
    model = picked?.value || '';
  }
  if (!model) {
    const defaultModel = models[0] || 'default';
    const input = await ask(queue, chalk.white(`  Model id (default: ${defaultModel}): `));
    model = input || defaultModel;
  }

  setConfig('localLlmUrl', url as CasperConfig['localLlmUrl']);
  setConfig('model', model);
  setConfig('preferLocalLlm', true);

  console.log(chalk.green(`\n  ${sourceName} configured: ${url} → ${model}`));
}

export async function runSetup(): Promise<void> {
  const rl = createReadline();
  const queue = new InputQueue(rl);
  try {
    console.log(chalk.magenta('\n  🔮 Casper Setup\n'));
    console.log(chalk.dim('  Choose how Casper should talk to its language model.\n'));

    const provider = await choose(
      queue,
      'How do you want to power Casper?',
      [
        { label: 'OpenRouter (cloud — many model providers)', value: 'openrouter' as const },
        { label: 'OpenAI / custom OpenAI-compatible API (cloud)', value: 'openai' as const },
        { label: 'Local LLM — LM Studio / Ollama', value: 'local' as const },
        { label: 'Skip for now (configure later with `casper setup`)', value: 'skip' as const },
      ],
    );

    if (!provider) {
      console.log(chalk.dim('  Skipped. Run `casper setup` any time to configure.\n'));
      return;
    }

    if (provider.value === 'openrouter') {
      await setupOpenRouter(queue);
    } else if (provider.value === 'openai') {
      await setupOpenAI(queue);
    } else if (provider.value === 'local') {
      await setupLocal(queue);
    } else {
      console.log(chalk.dim('  Skipped. Run `casper setup` any time to configure.\n'));
      return;
    }

    if (hasLlmConfig()) {
      console.log(chalk.green('\n  Casper is ready.\n'));
      printAllSettings();
    } else {
      console.log(chalk.yellow('\n  Setup incomplete. Run `casper setup` to finish.\n'));
    }
  } finally {
    rl.close();
  }
}

export async function ensureConfigured(): Promise<void> {
  if (hasLlmConfig()) return;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'No LLM configured. Set OPENAI_API_KEY / OPENROUTER_API_KEY, or run `casper setup` in an interactive terminal.',
    );
  }

  console.log(chalk.yellow('\n  Casper needs an LLM provider before it can run.\n'));
  await runSetup();

  if (!hasLlmConfig()) {
    throw new Error(
      'No LLM configured. Run `casper setup` or set config manually.',
    );
  }
}
