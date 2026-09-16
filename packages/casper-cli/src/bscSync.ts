import chalk from 'chalk';
import { casperApi } from './api.js';
import { getConfig, setConfig, deleteConfig, type BscSyncSnapshot } from './config.js';
import { isOpenRouterUrl } from './llm/client.js';
import { isLoopbackHost, validateBaseUrl } from './utils/url.js';

/** Response of `GET /api/casper/user/ai-settings` on the BSC-V3 server. */
export interface BscAiSettings {
  model: string;
  endpoint: string;
  modelSource: 'user' | 'platform';
  endpointSource: 'user' | 'platform';
  hasApiKey: boolean;
  apiKey?: string;
  temperature: number | null;
}

export type BscSyncProvider = 'openrouter' | 'openai-compatible' | 'local';

/** What the CLI config should look like to match the web Casper's AI Core. */
export interface BscSyncPlan extends BscSyncSnapshot {
  provider: BscSyncProvider;
  /** Config key that holds the credential for this provider (none for local). */
  keyField: 'openrouterApiKey' | 'openaiApiKey' | null;
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (isLoopbackHost(h)) return true;
  if (h === '0.0.0.0' || h.endsWith('.local') || h.endsWith('.localhost')) return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (!m) return false;
  const second = Number(m[1]);
  return second >= 16 && second <= 31;
}

export async function fetchBscAiSettings(opts: { includeKey?: boolean; timeoutMs?: number } = {}): Promise<BscAiSettings> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const path = opts.includeKey ? '/api/casper/user/ai-settings?includeKey=1' : '/api/casper/user/ai-settings';
    const res = await casperApi<{ success: boolean; error?: string } & BscAiSettings>(path, { signal: controller.signal });
    if (!res.success) throw new Error(res.error || 'BSC-V3 did not return AI settings.');
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export function planBscSync(settings: BscAiSettings): BscSyncPlan {
  const model = (settings.model || '').trim();
  if (!model) throw new Error('BSC-V3 returned no model.');

  let hostname: string;
  try {
    hostname = new URL(settings.endpoint).hostname;
  } catch {
    throw new Error(`BSC-V3 endpoint "${settings.endpoint}" is not a valid URL.`);
  }

  if (isPrivateHost(hostname)) {
    return {
      provider: 'local',
      keyField: null,
      model,
      localLlmUrl: validateBaseUrl(settings.endpoint, { allowInsecureHttp: true }),
      preferLocalLlm: true,
    };
  }

  const baseUrl = validateBaseUrl(settings.endpoint);
  const openRouter = isOpenRouterUrl(baseUrl);
  return {
    provider: openRouter ? 'openrouter' : 'openai-compatible',
    keyField: openRouter ? 'openrouterApiKey' : 'openaiApiKey',
    model,
    baseUrl,
    preferLocalLlm: false,
  };
}

export function toSnapshot(plan: BscSyncPlan): BscSyncSnapshot {
  const snapshot: BscSyncSnapshot = { model: plan.model, preferLocalLlm: plan.preferLocalLlm };
  if (plan.baseUrl) snapshot.baseUrl = plan.baseUrl;
  if (plan.localLlmUrl) snapshot.localLlmUrl = plan.localLlmUrl;
  return snapshot;
}

/** Write the model/endpoint from the plan and remember it as the synced state. */
export function applyBscSyncPlan(plan: BscSyncPlan): void {
  setConfig('model', plan.model);
  setConfig('preferLocalLlm', plan.preferLocalLlm);
  if (plan.baseUrl) setConfig('baseUrl', plan.baseUrl);
  if (plan.localLlmUrl) setConfig('localLlmUrl', plan.localLlmUrl);
  setConfig('bscSync', toSnapshot(plan));
}

/** True when the live config still matches what the last sync wrote. */
export function configMatchesSnapshot(
  snapshot: BscSyncSnapshot,
  current: { model?: string; baseUrl?: string; localLlmUrl?: string; preferLocalLlm?: boolean },
): boolean {
  if (current.model !== snapshot.model) return false;
  if (Boolean(current.preferLocalLlm) !== snapshot.preferLocalLlm) return false;
  if (snapshot.preferLocalLlm) return current.localLlmUrl === snapshot.localLlmUrl;
  return current.baseUrl === snapshot.baseUrl;
}

export type BscRefreshResult =
  | { status: 'not_following' | 'unchanged' | 'skipped' }
  | { status: 'stopped'; reason: string }
  | { status: 'updated'; plan: BscSyncPlan };

/**
 * Startup hook: if this machine was set up from BSC-V3 and the user has not
 * since changed the model by hand, pull the current web setting again. A
 * local edit (via `casper settings` / `casper config set`) ends following
 * so the CLI never silently overwrites an explicit choice. Network or auth
 * failures are treated as "keep what we have".
 */
export async function refreshFromBscIfFollowing(): Promise<BscRefreshResult> {
  const snapshot = getConfig('bscSync');
  if (!snapshot) return { status: 'not_following' };
  if (!getConfig('accessToken')) return { status: 'skipped' };

  const current = {
    model: getConfig('model'),
    baseUrl: getConfig('baseUrl'),
    localLlmUrl: getConfig('localLlmUrl'),
    preferLocalLlm: getConfig('preferLocalLlm'),
  };
  if (!configMatchesSnapshot(snapshot, current)) {
    deleteConfig('bscSync');
    return { status: 'stopped', reason: 'model or endpoint was changed locally' };
  }

  let plan: BscSyncPlan;
  try {
    plan = planBscSync(await fetchBscAiSettings({ timeoutMs: 4000 }));
  } catch {
    return { status: 'skipped' };
  }
  if (configMatchesSnapshot(snapshot, toSnapshot(plan))) return { status: 'unchanged' };

  // Only follow a switch to a cloud provider when the key for it is already
  // on this machine; otherwise the next request would fail with no way to
  // recover except re-running setup, so leave the working config alone.
  if (plan.keyField && !getConfig(plan.keyField)) {
    console.log(chalk.yellow(
      `  BSC-V3 now uses ${plan.model} via ${plan.baseUrl}, but no ${plan.provider} key is stored here. ` +
      'Run `casper setup --from-bsc` to switch.',
    ));
    return { status: 'skipped' };
  }

  applyBscSyncPlan(plan);
  console.log(chalk.dim(`  Model synced from BSC-V3: ${plan.model}`));
  return { status: 'updated', plan };
}

export function describeBscSettings(settings: BscAiSettings): string {
  const modelNote = settings.modelSource === 'platform' ? ' (Casper platform default)' : '';
  const endpointNote = settings.endpointSource === 'platform' ? ' (Casper platform endpoint)' : '';
  return `${settings.model}${modelNote} via ${settings.endpoint}${endpointNote}`;
}
