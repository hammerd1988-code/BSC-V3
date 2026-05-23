// Casper integration adapters.
//
// Until now, src/lib/casperIntegrations.ts was just a registry of
// definitions (name, description, scope strings). Storing an API key
// for "GitHub" only put a row in casper_integrations — Casper had no
// way to actually call GitHub. This module ships the real adapters.
//
// Each adapter exposes a list of tools (name + description + param
// schema) and an `execute(toolName, params, credentials)` method that
// makes the real HTTP call, returns a structured result, and never
// leaks the credential back to the client.
//
// The adapter framework is provider-agnostic so PR #46 (operator
// console + LLM tool-calling) can route the LLM's tool calls through
// the same code path the operator console uses by hand.

export type AdapterParamType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export type AdapterParam = {
  name: string;
  type: AdapterParamType;
  required?: boolean;
  description: string;
  default?: unknown;
};

export type AdapterTool = {
  name: string;
  description: string;
  params: AdapterParam[];
};

export type AdapterCredentials = {
  apiKey: string;
  config?: Record<string, any> | null;
};

export type AdapterExecuteResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
  status?: number;
  durationMs?: number;
};

export interface CasperIntegrationAdapter {
  id: string;
  name: string;
  tools: AdapterTool[];
  execute(toolName: string, params: Record<string, any>, credentials: AdapterCredentials): Promise<AdapterExecuteResult>;
}

// Reverse of the client-side encodeIntegrationKey. Stored keys look
// like `enc:<base64>` — strip the prefix, base64-decode, and trim.
// If the key was stored without the prefix (older rows), pass through.
export function decodeIntegrationKey(encoded: string | null | undefined): string | null {
  if (!encoded) return null;
  const trimmed = encoded.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('enc:')) return trimmed;
  const payload = trimmed.slice(4);
  try {
    return Buffer.from(payload, 'base64').toString('utf8').trim();
  } catch {
    return payload.trim();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function jsonFetch(
  url: string,
  init: RequestInit,
  timeoutMs = 20_000,
): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let data: any = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      // Different providers nest the error message at different paths:
      //   GitHub:  { message: "..." }
      //   Notion:  { message: "...", code: "..." }
      //   Discord: { message: "...", code: ... }
      //   Slack:   HTTP 200 with { ok: false, error: "..." } — handled separately
      //   Stripe:  { error: { type, message: "..." } }  ← nested
      // Stringifying a nested object directly yields "[object Object]", so
      // we walk the common shapes explicitly.
      let message: string | null = null;
      if (data && typeof data === 'object') {
        if (typeof data.message === 'string') message = data.message;
        else if (typeof data.error === 'string') message = data.error;
        else if (data.error && typeof data.error === 'object' && typeof data.error.message === 'string') message = data.error.message;
      }
      if (!message && typeof data === 'string') message = data.slice(0, 500);
      if (!message) message = `Upstream returned ${response.status}`;
      return { ok: false, status: response.status, data, error: message };
    }
    return { ok: true, status: response.status, data };
  } catch (err: any) {
    return { ok: false, status: 0, data: null, error: err?.name === 'AbortError' ? 'Upstream request timed out.' : (err?.message || 'Request failed.') };
  } finally {
    clearTimeout(timer);
  }
}

function requireString(params: Record<string, any>, name: string): string {
  const v = params[name];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Missing required parameter "${name}".`);
  }
  return v.trim();
}

function optionalString(params: Record<string, any>, name: string, fallback = ''): string {
  const v = params[name];
  return typeof v === 'string' ? v : fallback;
}

function optionalNumber(params: Record<string, any>, name: string, fallback?: number): number | undefined {
  const v = params[name];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return fallback;
}

// ---------------------------------------------------------------------------
// GitHub adapter
// ---------------------------------------------------------------------------

const githubAdapter: CasperIntegrationAdapter = {
  id: 'github',
  name: 'GitHub',
  tools: [
    { name: 'list_repos', description: 'List the authenticated user\'s repositories.', params: [
      { name: 'per_page', type: 'number', description: 'Page size (max 100).', default: 30 },
      { name: 'sort', type: 'string', description: 'created | updated | pushed | full_name.', default: 'updated' },
    ] },
    { name: 'get_repo', description: 'Get metadata for a single repo.', params: [
      { name: 'owner', type: 'string', required: true, description: 'Repo owner / org login.' },
      { name: 'repo', type: 'string', required: true, description: 'Repo name.' },
    ] },
    { name: 'list_issues', description: 'List issues in a repo.', params: [
      { name: 'owner', type: 'string', required: true, description: 'Repo owner / org login.' },
      { name: 'repo', type: 'string', required: true, description: 'Repo name.' },
      { name: 'state', type: 'string', description: 'open | closed | all.', default: 'open' },
      { name: 'per_page', type: 'number', description: 'Page size (max 100).', default: 30 },
    ] },
    { name: 'create_issue', description: 'Create a new issue.', params: [
      { name: 'owner', type: 'string', required: true, description: 'Repo owner / org login.' },
      { name: 'repo', type: 'string', required: true, description: 'Repo name.' },
      { name: 'title', type: 'string', required: true, description: 'Issue title.' },
      { name: 'body', type: 'string', description: 'Issue body markdown.' },
      { name: 'labels', type: 'array', description: 'Array of label name strings.' },
    ] },
    { name: 'create_issue_comment', description: 'Comment on an existing issue or PR.', params: [
      { name: 'owner', type: 'string', required: true, description: 'Repo owner / org login.' },
      { name: 'repo', type: 'string', required: true, description: 'Repo name.' },
      { name: 'issue_number', type: 'number', required: true, description: 'Issue or PR number.' },
      { name: 'body', type: 'string', required: true, description: 'Comment body markdown.' },
    ] },
    { name: 'list_pull_requests', description: 'List pull requests in a repo.', params: [
      { name: 'owner', type: 'string', required: true, description: 'Repo owner / org login.' },
      { name: 'repo', type: 'string', required: true, description: 'Repo name.' },
      { name: 'state', type: 'string', description: 'open | closed | all.', default: 'open' },
    ] },
  ],
  async execute(toolName, params, credentials) {
    const start = Date.now();
    const headers = {
      Authorization: `Bearer ${credentials.apiKey}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'casper-bsc-integration',
    };
    try {
      switch (toolName) {
        case 'list_repos': {
          const sort = optionalString(params, 'sort', 'updated');
          const perPage = optionalNumber(params, 'per_page', 30);
          const r = await jsonFetch(`https://api.github.com/user/repos?sort=${encodeURIComponent(sort)}&per_page=${perPage}`, { headers });
          return { ...r, durationMs: Date.now() - start };
        }
        case 'get_repo': {
          const owner = requireString(params, 'owner');
          const repo = requireString(params, 'repo');
          const r = await jsonFetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers });
          return { ...r, durationMs: Date.now() - start };
        }
        case 'list_issues': {
          const owner = requireString(params, 'owner');
          const repo = requireString(params, 'repo');
          const state = optionalString(params, 'state', 'open');
          const perPage = optionalNumber(params, 'per_page', 30);
          const r = await jsonFetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=${encodeURIComponent(state)}&per_page=${perPage}`, { headers });
          return { ...r, durationMs: Date.now() - start };
        }
        case 'create_issue': {
          const owner = requireString(params, 'owner');
          const repo = requireString(params, 'repo');
          const title = requireString(params, 'title');
          const body = optionalString(params, 'body');
          const labels = Array.isArray(params.labels) ? params.labels.filter((l: any) => typeof l === 'string') : undefined;
          const r = await jsonFetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body: body || undefined, labels }),
          });
          return { ...r, durationMs: Date.now() - start };
        }
        case 'create_issue_comment': {
          const owner = requireString(params, 'owner');
          const repo = requireString(params, 'repo');
          const issueNumber = optionalNumber(params, 'issue_number');
          const body = requireString(params, 'body');
          if (!issueNumber) throw new Error('Missing required parameter "issue_number".');
          const r = await jsonFetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ body }),
          });
          return { ...r, durationMs: Date.now() - start };
        }
        case 'list_pull_requests': {
          const owner = requireString(params, 'owner');
          const repo = requireString(params, 'repo');
          const state = optionalString(params, 'state', 'open');
          const r = await jsonFetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=${encodeURIComponent(state)}`, { headers });
          return { ...r, durationMs: Date.now() - start };
        }
        default:
          return { ok: false, error: `Unknown github tool: ${toolName}`, durationMs: Date.now() - start };
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'GitHub adapter failed.', durationMs: Date.now() - start };
    }
  },
};

// ---------------------------------------------------------------------------
// Notion adapter
// ---------------------------------------------------------------------------

const notionAdapter: CasperIntegrationAdapter = {
  id: 'notion',
  name: 'Notion',
  tools: [
    { name: 'search', description: 'Search Notion pages and databases.', params: [
      { name: 'query', type: 'string', description: 'Free-text query.', default: '' },
      { name: 'filter', type: 'string', description: 'page | database', default: '' },
    ] },
    { name: 'query_database', description: 'Query rows in a Notion database.', params: [
      { name: 'database_id', type: 'string', required: true, description: 'Database ID (32-char hex with dashes).' },
      { name: 'page_size', type: 'number', description: 'Page size (max 100).', default: 25 },
    ] },
    { name: 'create_page', description: 'Create a new page in a database or under a parent page.', params: [
      { name: 'parent', type: 'object', required: true, description: 'Either { database_id } or { page_id }.' },
      { name: 'properties', type: 'object', required: true, description: 'Notion properties payload.' },
      { name: 'children', type: 'array', description: 'Optional block array for the page body.' },
    ] },
    { name: 'append_blocks', description: 'Append children blocks to an existing page.', params: [
      { name: 'block_id', type: 'string', required: true, description: 'Parent block (page) ID.' },
      { name: 'children', type: 'array', required: true, description: 'Block array.' },
    ] },
  ],
  async execute(toolName, params, credentials) {
    const start = Date.now();
    const headers = {
      Authorization: `Bearer ${credentials.apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    };
    try {
      switch (toolName) {
        case 'search': {
          const body: any = { query: optionalString(params, 'query') };
          const filter = optionalString(params, 'filter');
          if (filter === 'page' || filter === 'database') body.filter = { value: filter, property: 'object' };
          const r = await jsonFetch('https://api.notion.com/v1/search', { method: 'POST', headers, body: JSON.stringify(body) });
          return { ...r, durationMs: Date.now() - start };
        }
        case 'query_database': {
          const dbId = requireString(params, 'database_id');
          const pageSize = optionalNumber(params, 'page_size', 25);
          const r = await jsonFetch(`https://api.notion.com/v1/databases/${encodeURIComponent(dbId)}/query`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ page_size: pageSize }),
          });
          return { ...r, durationMs: Date.now() - start };
        }
        case 'create_page': {
          const parent = params.parent;
          const properties = params.properties;
          if (!parent || typeof parent !== 'object') throw new Error('parent must be an object with database_id or page_id.');
          if (!properties || typeof properties !== 'object') throw new Error('properties must be an object.');
          const r = await jsonFetch('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers,
            body: JSON.stringify({ parent, properties, ...(Array.isArray(params.children) ? { children: params.children } : {}) }),
          });
          return { ...r, durationMs: Date.now() - start };
        }
        case 'append_blocks': {
          const blockId = requireString(params, 'block_id');
          const children = params.children;
          if (!Array.isArray(children) || !children.length) throw new Error('children must be a non-empty array.');
          const r = await jsonFetch(`https://api.notion.com/v1/blocks/${encodeURIComponent(blockId)}/children`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ children }),
          });
          return { ...r, durationMs: Date.now() - start };
        }
        default:
          return { ok: false, error: `Unknown notion tool: ${toolName}`, durationMs: Date.now() - start };
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Notion adapter failed.', durationMs: Date.now() - start };
    }
  },
};

// ---------------------------------------------------------------------------
// Discord adapter
// ---------------------------------------------------------------------------

const discordAdapter: CasperIntegrationAdapter = {
  id: 'discord',
  name: 'Discord',
  tools: [
    { name: 'get_self', description: 'Get the bot user identity (verifies the token is valid).', params: [] },
    { name: 'send_message', description: 'Send a message to a Discord channel.', params: [
      { name: 'channel_id', type: 'string', required: true, description: 'Discord channel snowflake ID.' },
      { name: 'content', type: 'string', required: true, description: 'Message text (markdown supported).' },
    ] },
    { name: 'list_guilds', description: 'List guilds the bot belongs to.', params: [] },
    { name: 'list_channels', description: 'List channels in a guild.', params: [
      { name: 'guild_id', type: 'string', required: true, description: 'Guild snowflake ID.' },
    ] },
  ],
  async execute(toolName, params, credentials) {
    const start = Date.now();
    const headers = {
      Authorization: `Bot ${credentials.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'casper-bsc-integration',
    };
    try {
      switch (toolName) {
        case 'get_self': {
          const r = await jsonFetch('https://discord.com/api/v10/users/@me', { headers });
          return { ...r, durationMs: Date.now() - start };
        }
        case 'send_message': {
          const channelId = requireString(params, 'channel_id');
          const content = requireString(params, 'content');
          const r = await jsonFetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ content }),
          });
          return { ...r, durationMs: Date.now() - start };
        }
        case 'list_guilds': {
          const r = await jsonFetch('https://discord.com/api/v10/users/@me/guilds', { headers });
          return { ...r, durationMs: Date.now() - start };
        }
        case 'list_channels': {
          const guildId = requireString(params, 'guild_id');
          const r = await jsonFetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/channels`, { headers });
          return { ...r, durationMs: Date.now() - start };
        }
        default:
          return { ok: false, error: `Unknown discord tool: ${toolName}`, durationMs: Date.now() - start };
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Discord adapter failed.', durationMs: Date.now() - start };
    }
  },
};

// ---------------------------------------------------------------------------
// Stripe adapter
// ---------------------------------------------------------------------------

const stripeAdapter: CasperIntegrationAdapter = {
  id: 'stripe',
  name: 'Stripe',
  tools: [
    { name: 'list_customers', description: 'List Stripe customers.', params: [
      { name: 'limit', type: 'number', description: 'Page size (max 100).', default: 25 },
      { name: 'email', type: 'string', description: 'Filter by exact email.' },
    ] },
    { name: 'list_subscriptions', description: 'List Stripe subscriptions.', params: [
      { name: 'limit', type: 'number', description: 'Page size (max 100).', default: 25 },
      { name: 'status', type: 'string', description: 'active | past_due | canceled | all.', default: 'all' },
    ] },
    { name: 'list_payment_intents', description: 'List Stripe PaymentIntents.', params: [
      { name: 'limit', type: 'number', description: 'Page size (max 100).', default: 25 },
    ] },
    { name: 'retrieve_balance', description: 'Get Stripe account balance.', params: [] },
  ],
  async execute(toolName, params, credentials) {
    const start = Date.now();
    const headers = {
      Authorization: `Bearer ${credentials.apiKey}`,
      'Stripe-Version': '2024-04-10',
    };
    try {
      switch (toolName) {
        case 'list_customers': {
          const limit = Math.min(optionalNumber(params, 'limit', 25) ?? 25, 100);
          const email = optionalString(params, 'email');
          const url = `https://api.stripe.com/v1/customers?limit=${limit}${email ? `&email=${encodeURIComponent(email)}` : ''}`;
          const r = await jsonFetch(url, { headers });
          return { ...r, durationMs: Date.now() - start };
        }
        case 'list_subscriptions': {
          const limit = Math.min(optionalNumber(params, 'limit', 25) ?? 25, 100);
          const status = optionalString(params, 'status', 'all');
          const url = `https://api.stripe.com/v1/subscriptions?limit=${limit}&status=${encodeURIComponent(status)}`;
          const r = await jsonFetch(url, { headers });
          return { ...r, durationMs: Date.now() - start };
        }
        case 'list_payment_intents': {
          const limit = Math.min(optionalNumber(params, 'limit', 25) ?? 25, 100);
          const r = await jsonFetch(`https://api.stripe.com/v1/payment_intents?limit=${limit}`, { headers });
          return { ...r, durationMs: Date.now() - start };
        }
        case 'retrieve_balance': {
          const r = await jsonFetch('https://api.stripe.com/v1/balance', { headers });
          return { ...r, durationMs: Date.now() - start };
        }
        default:
          return { ok: false, error: `Unknown stripe tool: ${toolName}`, durationMs: Date.now() - start };
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Stripe adapter failed.', durationMs: Date.now() - start };
    }
  },
};

// ---------------------------------------------------------------------------
// Slack adapter
// ---------------------------------------------------------------------------

const slackAdapter: CasperIntegrationAdapter = {
  id: 'slack',
  name: 'Slack',
  tools: [
    { name: 'auth_test', description: 'Verify the bot token and identity.', params: [] },
    { name: 'list_channels', description: 'List public + private channels the bot can see.', params: [
      { name: 'limit', type: 'number', description: 'Page size (max 1000).', default: 100 },
    ] },
    { name: 'post_message', description: 'Post a message to a channel.', params: [
      { name: 'channel', type: 'string', required: true, description: 'Channel ID (Cxxx) or name (#general).' },
      { name: 'text', type: 'string', required: true, description: 'Message text.' },
    ] },
  ],
  async execute(toolName, params, credentials) {
    const start = Date.now();
    const headers = {
      Authorization: `Bearer ${credentials.apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
    };
    const slackResultGuard = (r: { ok: boolean; status: number; data: any; error?: string }) => {
      // Slack always returns 200 OK with `ok: false` on logical failures.
      if (r.ok && r.data && typeof r.data === 'object' && r.data.ok === false) {
        return { ok: false, status: 200, data: r.data, error: r.data.error || 'Slack returned ok:false' };
      }
      return r;
    };
    try {
      switch (toolName) {
        case 'auth_test': {
          const r = slackResultGuard(await jsonFetch('https://slack.com/api/auth.test', { method: 'POST', headers }));
          return { ...r, durationMs: Date.now() - start };
        }
        case 'list_channels': {
          const limit = Math.min(optionalNumber(params, 'limit', 100) ?? 100, 1000);
          const r = slackResultGuard(await jsonFetch(`https://slack.com/api/conversations.list?limit=${limit}&types=public_channel,private_channel`, { headers }));
          return { ...r, durationMs: Date.now() - start };
        }
        case 'post_message': {
          const channel = requireString(params, 'channel');
          const text = requireString(params, 'text');
          const r = slackResultGuard(await jsonFetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers,
            body: JSON.stringify({ channel, text }),
          }));
          return { ...r, durationMs: Date.now() - start };
        }
        default:
          return { ok: false, error: `Unknown slack tool: ${toolName}`, durationMs: Date.now() - start };
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Slack adapter failed.', durationMs: Date.now() - start };
    }
  },
};

// ---------------------------------------------------------------------------
// Playwright browser adapter
// ---------------------------------------------------------------------------
// Unlike other adapters, the browser adapter doesn't need a user API key —
// it uses the server-side Playwright instance. The apiKey field in
// credentials is ignored (the integration definition marks it "optional").
// The adapter delegates to casperBrowser.ts for actual browser operations
// and receives a Supabase client + userId via the injected config object.

import {
  browserNavigate,
  browserScreenshot,
  browserClick,
  browserType,
  browserExtractText,
  browserGoBack,
  browserListPages,
  browserClosePage,
} from './casperBrowser.js';

const playwrightAdapter: CasperIntegrationAdapter = {
  id: 'playwright',
  name: 'Playwright Browser',
  tools: [
    { name: 'navigate', description: 'Navigate the browser to a URL and take a screenshot.', params: [
      { name: 'url', type: 'string', required: true, description: 'The URL to navigate to.' },
      { name: 'page_id', type: 'string', description: 'Reuse an existing browser tab by ID. Omit to open a new tab.' },
      { name: 'wait_until', type: 'string', description: 'load | domcontentloaded | networkidle. Default: domcontentloaded.' },
    ] },
    { name: 'screenshot', description: 'Take a screenshot of the current page.', params: [
      { name: 'page_id', type: 'string', description: 'Browser tab ID. Omit to use the most recent tab.' },
      { name: 'full_page', type: 'boolean', description: 'Capture the entire scrollable page. Default: false (viewport only).' },
    ] },
    { name: 'click', description: 'Click an element on the page by CSS selector.', params: [
      { name: 'selector', type: 'string', required: true, description: 'CSS selector of the element to click.' },
      { name: 'page_id', type: 'string', description: 'Browser tab ID.' },
    ] },
    { name: 'type', description: 'Type text into an input field.', params: [
      { name: 'selector', type: 'string', required: true, description: 'CSS selector of the input field.' },
      { name: 'text', type: 'string', required: true, description: 'Text to type.' },
      { name: 'press_enter', type: 'boolean', description: 'Press Enter after typing. Default: false.' },
      { name: 'page_id', type: 'string', description: 'Browser tab ID.' },
    ] },
    { name: 'extract_text', description: 'Extract text content from the page or a specific element.', params: [
      { name: 'selector', type: 'string', description: 'CSS selector. Omit to extract all visible text from the page body.' },
      { name: 'page_id', type: 'string', description: 'Browser tab ID.' },
    ] },
    { name: 'go_back', description: 'Navigate back to the previous page.', params: [
      { name: 'page_id', type: 'string', description: 'Browser tab ID.' },
    ] },
    { name: 'list_tabs', description: 'List all open browser tabs.', params: [] },
    { name: 'close_tab', description: 'Close a browser tab by ID.', params: [
      { name: 'page_id', type: 'string', required: true, description: 'Browser tab ID to close.' },
    ] },
  ],
  async execute(toolName, params, credentials) {
    const start = Date.now();
    // The Supabase client and userId are injected via the config object
    // by casperTools.ts when it resolves credentials for the playwright
    // integration. The adapter itself never touches user secrets.
    const supabase = credentials.config?.supabase as import('@supabase/supabase-js').SupabaseClient | undefined;
    const userId = credentials.config?.userId as string | undefined;
    if (!supabase || !userId) {
      return { ok: false, error: 'Browser tools require server context (supabase + userId).', durationMs: Date.now() - start };
    }
    try {
      switch (toolName) {
        case 'navigate': {
          const url = requireString(params, 'url');
          const pageId = optionalString(params, 'page_id') || undefined;
          const waitUntil = (optionalString(params, 'wait_until') || 'domcontentloaded') as 'load' | 'domcontentloaded' | 'networkidle';
          const result = await browserNavigate(url, supabase, userId, { pageId, waitUntil, screenshot: true });
          return { ok: result.ok, data: result, error: result.error, durationMs: result.durationMs };
        }
        case 'screenshot': {
          const pageId = optionalString(params, 'page_id') || undefined;
          const fullPage = params.full_page === true;
          const result = await browserScreenshot(supabase, userId, { pageId, fullPage });
          return { ok: result.ok, data: result, error: result.error, durationMs: result.durationMs };
        }
        case 'click': {
          const selector = requireString(params, 'selector');
          const pageId = optionalString(params, 'page_id') || undefined;
          const result = await browserClick(selector, supabase, userId, { pageId, screenshot: true });
          return { ok: result.ok, data: result, error: result.error, durationMs: result.durationMs };
        }
        case 'type': {
          const selector = requireString(params, 'selector');
          const text = requireString(params, 'text');
          const pageId = optionalString(params, 'page_id') || undefined;
          const pressEnter = params.press_enter === true;
          const result = await browserType(selector, text, supabase, userId, { pageId, pressEnter, screenshot: true });
          return { ok: result.ok, data: result, error: result.error, durationMs: result.durationMs };
        }
        case 'extract_text': {
          const pageId = optionalString(params, 'page_id') || undefined;
          const selector = optionalString(params, 'selector') || undefined;
          const result = await browserExtractText({ pageId, selector });
          return { ok: result.ok, data: result, error: result.error, durationMs: result.durationMs };
        }
        case 'go_back': {
          const pageId = optionalString(params, 'page_id') || undefined;
          const result = await browserGoBack(supabase, userId, { pageId, screenshot: true });
          return { ok: result.ok, data: result, error: result.error, durationMs: result.durationMs };
        }
        case 'list_tabs': {
          const tabs = await browserListPages();
          return { ok: true, data: { tabs }, durationMs: Date.now() - start };
        }
        case 'close_tab': {
          const pageId = requireString(params, 'page_id');
          await browserClosePage(pageId);
          return { ok: true, data: { closed: pageId }, durationMs: Date.now() - start };
        }
        default:
          return { ok: false, error: `Unknown Playwright tool: ${toolName}`, durationMs: Date.now() - start };
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Browser action failed.', durationMs: Date.now() - start };
    }
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const CASPER_ADAPTERS: Record<string, CasperIntegrationAdapter> = {
  github: githubAdapter,
  notion: notionAdapter,
  discord: discordAdapter,
  stripe: stripeAdapter,
  slack: slackAdapter,
  playwright: playwrightAdapter,
};

export function getAdapter(integrationKey: string): CasperIntegrationAdapter | null {
  return CASPER_ADAPTERS[integrationKey] ?? null;
}

export function listAdapterTools(): Array<{ integration: string; tools: AdapterTool[] }> {
  return Object.entries(CASPER_ADAPTERS).map(([id, adapter]) => ({ integration: id, tools: adapter.tools }));
}
