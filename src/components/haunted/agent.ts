/**
 * Casper's browser agent loop — a ReAct-style tool loop that lets the model
 * operate the Haunted Browser through a fixed, validated tool set. Ported
 * from the standalone Haunted Browser app and wired to Blood Sweat Code's
 * Casper command API instead of a standalone model server.
 *
 * The model never emits raw JS; it can only call the tools below, and every
 * argument is validated before execution. Mutating actions respect the
 * autonomy mode:
 *
 * - supervised: every action that changes browser state needs user approval
 * - auto:       actions run automatically (sensitive domains still blocked)
 * - dryrun:     mutating actions are described but never executed
 */

export type AutonomyMode = 'supervised' | 'auto' | 'dryrun';

export interface AgentTabInfo {
  index: number;
  title: string;
  url: string;
  active: boolean;
}

export interface AgentToolbelt {
  listTabs: () => AgentTabInfo[];
  openTab: (url: string) => void;
  closeTab: (index: number) => string | void;
  switchTab: (index: number) => string | void;
  navigate: (url: string) => void;
  readPage: () => Promise<{ url: string; title: string; text: string } | { error: string }>;
  /** Run a fixed, tool-generated script in the active page. Null when unavailable (web iframe mode / New Tab). */
  executeInPage: ((code: string) => Promise<unknown>) | null;
}

export interface AgentAction {
  tool: string;
  args: Record<string, unknown>;
  /** Human-readable description shown in the panel and approval prompt. */
  describe: string;
  mutating: boolean;
}

export interface AgentStepEvent {
  type: 'thought' | 'action' | 'observation' | 'blocked' | 'final' | 'error';
  text: string;
  action?: AgentAction;
}

export interface AgentRunOptions {
  goal: string;
  mode: AutonomyMode;
  toolbelt: AgentToolbelt;
  /** True when the browser runs in a real Chromium webview (desktop app). */
  native: boolean;
  callAgentStep: (messages: { role: string; content: string }[]) => Promise<{ content?: string; error?: string }>;
  onEvent: (e: AgentStepEvent) => void;
  requestApproval: (action: AgentAction) => Promise<boolean>;
  signal?: AbortSignal;
  maxSteps?: number;
}

/* ------------------------------------------------------------------ */
/* Guardrails                                                          */
/* ------------------------------------------------------------------ */

// Domains Casper must never act on autonomously: banking, payments, email,
// and auth portals. Reading is fine; acting (click/fill/navigate) is not.
const SENSITIVE_HOST_PATTERNS = [
  /(^|\.)paypal\.com$/i,
  /(^|\.)(chase|bankofamerica|wellsfargo|citibank|capitalone|usbank|schwab|fidelity)\.com$/i,
  /(^|\.)(coinbase|binance|kraken)\.(com|us)$/i,
  /(^|\.)mail\.google\.com$/i,
  /(^|\.)outlook\.(com|live\.com)$/i,
  /(^|\.)mail\.yahoo\.com$/i,
  /(^|\.)accounts\.google\.com$/i,
  /(^|\.)login\.(microsoftonline|live)\.com$/i,
  /bank/i,
];

export function isSensitiveUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return SENSITIVE_HOST_PATTERNS.some((p) => p.test(host));
  } catch {
    return false;
  }
}

function validHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Tool protocol                                                       */
/* ------------------------------------------------------------------ */

export const AGENT_TOOLS_DOC = `You can operate the browser by calling tools. To call a tool, reply with EXACTLY one line in this format (nothing else on the line):

TOOL: toolName {"arg": "value"}

Available tools:
- listTabs {} — list open tabs with their index, title, url, and which is active
- openTab {"url": "https://..."} — open a new tab at the url and switch to it
- closeTab {"index": 0} — close the tab at that index
- switchTab {"index": 0} — make the tab at that index active
- navigate {"url": "https://..."} — navigate the ACTIVE tab to the url
- readPage {} — read the active page's title, url, and visible text
- click {"selector": "css selector"} — click the first element matching the selector on the active page
- fill {"selector": "css selector", "value": "text"} — set the value of the matching input/textarea and dispatch input events
- scroll {"direction": "down"} — scroll the active page ("up", "down", "top", or "bottom")

Rules:
- Call at most ONE tool per reply. After each call you'll receive an OBSERVATION with the result.
- When the goal is complete (or impossible), reply with your final answer as plain text WITHOUT any TOOL: line. Summarize what you did.
- Never invent tool names or arguments. Never ask to run arbitrary JavaScript.
- Prefer readPage before clicking or filling so you know what's on the page.`;

const WEB_MODE_NOTE =
  'NOTE: this browser is embedded in a web page (iframe mode), so readPage, click, fill, and scroll are NOT available — they will return errors. You can still list, open, close, and switch tabs and navigate by URL. Plan around that.';

export function buildAgentSystemPrompt(mode: AutonomyMode, native: boolean): string {
  const modeLine =
    mode === 'dryrun'
      ? 'You are in DRY RUN mode: actions that would change browser state are simulated, not executed. Still plan them normally.'
      : mode === 'supervised'
        ? 'You are in SUPERVISED mode: the user approves each state-changing action before it runs. If an action is denied, adapt or finish.'
        : 'You are in AUTONOMOUS mode: approved tools run automatically. Be careful and precise.';
  return `You are Casper, the ghost who haunts Blood Sweat Code's Haunted Browser — now acting as the user's browser operator. You complete browsing goals by calling tools, step by step, observing results as you go. Keep your spooky charm to a light touch; precision comes first.\n\n${AGENT_TOOLS_DOC}\n\n${native ? '' : `${WEB_MODE_NOTE}\n\n`}${modeLine}\n\nSafety: you must not act on banking, payment, email, or login pages — those actions will be blocked. Do not enter passwords or other credentials anywhere.`;
}

/**
 * Serialize an agent conversation into a single Casper command string.
 * BSC's /api/casper/command takes one command (plus its own persona and
 * history handling), so the agent transcript rides inside the command with
 * tools disabled server-side. Bounded so it stays well under the server's
 * command length cap.
 */
const STEP_MAX_CHARS = 6000;
const STEP_MAX_TURNS = 16;

export function buildAgentStepCommand(messages: { role: string; content: string }[]): string {
  const system = messages[0]?.role === 'system' ? messages[0].content : '';
  const rest = messages[0]?.role === 'system' ? messages.slice(1) : messages;
  const goal = rest[0]?.content ?? '';
  const turns = rest.slice(1).slice(-STEP_MAX_TURNS);
  const transcript = turns
    .map((m) => `${m.role === 'assistant' ? 'YOU SAID' : 'OBSERVATION'}:\n${m.content.slice(0, STEP_MAX_CHARS)}`)
    .join('\n\n');
  return [
    system,
    `=== GOAL ===\n${goal.slice(0, STEP_MAX_CHARS)}`,
    transcript ? `=== TRANSCRIPT SO FAR ===\n${transcript}` : '',
    'Reply with your next single TOOL: call, or your final answer as plain text with no TOOL: line.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

interface ParsedToolCall {
  tool: string;
  args: Record<string, unknown>;
}

function splitToolCallContent(content: string): { thought: string; toolLine: string } | null {
  const lines = content.split(/\r?\n/);
  let last = lines.length - 1;
  while (last >= 0 && !lines[last]?.trim()) last--;
  if (last < 0) return null;
  return {
    thought: lines.slice(0, last).join('\n').trim(),
    toolLine: lines[last].trim(),
  };
}

export function parseToolCall(content: string): ParsedToolCall | null {
  const parts = splitToolCallContent(content);
  if (!parts) return null;
  const m = parts.toolLine.match(/^TOOL:\s*([a-zA-Z]+)\s*(\{.*\})?\s*$/);
  if (!m) return null;
  const tool = m[1];
  let args: Record<string, unknown> = {};
  if (m[2]) {
    try {
      const parsed = JSON.parse(m[2]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
    } catch {
      return { tool, args: { __parseError: true } };
    }
  }
  return { tool, args };
}

/** The model's commentary around a TOOL: line, shown as its "thought". */
function thoughtAround(content: string): string {
  return splitToolCallContent(content)?.thought || '';
}

/* ------------------------------------------------------------------ */
/* Page scripts (fixed templates — model input is JSON-escaped)        */
/* ------------------------------------------------------------------ */

function clickScript(selector: string): string {
  return `(function(){var el=document.querySelector(${JSON.stringify(selector)});if(!el)return {ok:false,error:'no element matches selector'};el.scrollIntoView({block:'center'});el.click();return {ok:true,tag:el.tagName.toLowerCase(),text:(el.innerText||el.value||'').slice(0,120)};})()`;
}

function fillScript(selector: string, value: string): string {
  return `(function(){var el=document.querySelector(${JSON.stringify(selector)});if(!el)return {ok:false,error:'no element matches selector'};var v=${JSON.stringify(value)};var proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;var d=Object.getOwnPropertyDescriptor(proto,'value');if(d&&d.set){d.set.call(el,v);}else{el.value=v;}el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true,tag:el.tagName.toLowerCase()};})()`;
}

function scrollScript(direction: string): string {
  const move =
    direction === 'up'
      ? 'window.scrollBy(0,-Math.round(window.innerHeight*0.8))'
      : direction === 'top'
        ? 'window.scrollTo(0,0)'
        : direction === 'bottom'
          ? 'window.scrollTo(0,document.body.scrollHeight)'
          : 'window.scrollBy(0,Math.round(window.innerHeight*0.8))';
  return `(function(){${move};return {ok:true,scrollY:Math.round(window.scrollY)};})()`;
}

/* ------------------------------------------------------------------ */
/* Action resolution + execution                                       */
/* ------------------------------------------------------------------ */

function resolveAction(call: ParsedToolCall): AgentAction | { error: string } {
  const { tool, args } = call;
  if (args.__parseError) return { error: `Could not parse the JSON arguments for ${tool}. Use valid JSON on the TOOL: line.` };
  switch (tool) {
    case 'listTabs':
      return { tool, args: {}, describe: 'List open tabs', mutating: false };
    case 'readPage':
      return { tool, args: {}, describe: 'Read the active page', mutating: false };
    case 'openTab':
    case 'navigate': {
      const url = validHttpUrl(args.url);
      if (!url) return { error: `${tool} needs a valid http(s) "url" argument.` };
      return {
        tool,
        args: { url },
        describe: tool === 'openTab' ? `Open a new tab at ${url}` : `Navigate the active tab to ${url}`,
        mutating: true,
      };
    }
    case 'closeTab':
    case 'switchTab': {
      const index = typeof args.index === 'number' ? args.index : NaN;
      if (!Number.isInteger(index) || index < 0) return { error: `${tool} needs a non-negative integer "index".` };
      return {
        tool,
        args: { index },
        describe: `${tool === 'closeTab' ? 'Close' : 'Switch to'} tab ${index}`,
        mutating: true,
      };
    }
    case 'click': {
      const selector = typeof args.selector === 'string' ? args.selector.trim() : '';
      if (!selector || selector.length > 300) return { error: 'click needs a css "selector" argument.' };
      return { tool, args: { selector }, describe: `Click "${selector}" on the active page`, mutating: true };
    }
    case 'fill': {
      const selector = typeof args.selector === 'string' ? args.selector.trim() : '';
      if (!selector || selector.length > 300) return { error: 'fill needs a css "selector" argument.' };
      if (typeof args.value !== 'string') return { error: 'fill needs a string "value" argument.' };
      const value = args.value;
      if (value.length > 2000) return { error: 'fill value is too long.' };
      return {
        tool,
        args: { selector, value },
        describe: `Fill "${selector}" with "${value.length > 60 ? value.slice(0, 57) + '…' : value}"`,
        mutating: true,
      };
    }
    case 'scroll': {
      const dir = typeof args.direction === 'string' ? args.direction : 'down';
      if (!['up', 'down', 'top', 'bottom'].includes(dir)) return { error: 'scroll direction must be up, down, top, or bottom.' };
      return { tool, args: { direction: dir }, describe: `Scroll ${dir}`, mutating: true };
    }
    default:
      return { error: `Unknown tool "${tool}". Use only the documented tools.` };
  }
}

async function executeAction(action: AgentAction, toolbelt: AgentToolbelt): Promise<string> {
  const activeUrl = toolbelt.listTabs().find((t) => t.active)?.url || '';
  const target = action.tool === 'openTab' || action.tool === 'navigate' ? String(action.args.url) : activeUrl;
  if (action.mutating && isSensitiveUrl(target)) {
    return `BLOCKED: ${action.describe} — acting on sensitive domains (banking, email, auth) is not allowed.`;
  }
  switch (action.tool) {
    case 'listTabs':
      return JSON.stringify(toolbelt.listTabs());
    case 'openTab':
      toolbelt.openTab(String(action.args.url));
      return `Opened new tab at ${action.args.url}. It may still be loading — readPage to inspect it.`;
    case 'closeTab':
      return toolbelt.closeTab(Number(action.args.index)) || `Closed tab ${action.args.index}.`;
    case 'switchTab':
      return toolbelt.switchTab(Number(action.args.index)) || `Switched to tab ${action.args.index}.`;
    case 'navigate':
      toolbelt.navigate(String(action.args.url));
      return `Navigating the active tab to ${action.args.url}. It may still be loading — readPage to inspect it.`;
    case 'readPage': {
      const r = await toolbelt.readPage();
      if ('error' in r) return `ERROR: ${r.error}`;
      return `url: ${r.url}\ntitle: ${r.title}\npage text (truncated):\n${r.text.slice(0, 8000)}`;
    }
    case 'click':
    case 'fill':
    case 'scroll': {
      if (!toolbelt.executeInPage) {
        return 'ERROR: no live page to act on (New Tab or embedded web mode). Page actions need the desktop app.';
      }
      const code =
        action.tool === 'click'
          ? clickScript(String(action.args.selector))
          : action.tool === 'fill'
            ? fillScript(String(action.args.selector), String(action.args.value))
            : scrollScript(String(action.args.direction));
      try {
        const result = await toolbelt.executeInPage(code);
        return JSON.stringify(result);
      } catch (err) {
        return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    default:
      return `ERROR: unhandled tool ${action.tool}`;
  }
}

/* ------------------------------------------------------------------ */
/* The loop                                                            */
/* ------------------------------------------------------------------ */

export async function runAgent(opts: AgentRunOptions): Promise<void> {
  const maxSteps = opts.maxSteps ?? 12;
  const convo: { role: string; content: string }[] = [
    { role: 'system', content: buildAgentSystemPrompt(opts.mode, opts.native) },
    { role: 'user', content: opts.goal },
  ];

  for (let step = 0; step < maxSteps; step++) {
    if (opts.signal?.aborted) {
      opts.onEvent({ type: 'error', text: 'Agent run cancelled.' });
      return;
    }
    let reply: { content?: string; error?: string };
    try {
      reply = await opts.callAgentStep(convo);
    } catch (err) {
      if (opts.signal?.aborted) {
        opts.onEvent({ type: 'error', text: 'Agent run cancelled.' });
      } else {
        opts.onEvent({ type: 'error', text: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (reply.error) {
      opts.onEvent({ type: 'error', text: reply.error });
      return;
    }
    const content = reply.content || '';
    const call = parseToolCall(content);
    if (!call) {
      opts.onEvent({ type: 'final', text: content.trim() || '(no reply)' });
      return;
    }

    const thought = thoughtAround(content);
    if (thought) opts.onEvent({ type: 'thought', text: thought });

    const resolved = resolveAction(call);
    if ('error' in resolved) {
      opts.onEvent({ type: 'blocked', text: resolved.error });
      convo.push({ role: 'assistant', content });
      convo.push({ role: 'system', content: `OBSERVATION: ${resolved.error}` });
      continue;
    }

    let observation: string;
    if (resolved.mutating && opts.mode === 'dryrun') {
      observation = `DRY RUN: would ${resolved.describe.charAt(0).toLowerCase()}${resolved.describe.slice(1)} (not executed). Assume it succeeded and continue planning, or finish with a summary of the plan.`;
      opts.onEvent({ type: 'action', text: `[dry run] ${resolved.describe}`, action: resolved });
    } else if (resolved.mutating && opts.mode === 'supervised') {
      opts.onEvent({ type: 'action', text: `Wants to: ${resolved.describe}`, action: resolved });
      const approved = await opts.requestApproval(resolved);
      if (opts.signal?.aborted) {
        opts.onEvent({ type: 'error', text: 'Agent run cancelled.' });
        return;
      }
      if (!approved) {
        observation = `DENIED: the user declined "${resolved.describe}". Adapt or finish.`;
        opts.onEvent({ type: 'blocked', text: `Denied: ${resolved.describe}` });
      } else {
        observation = await executeAction(resolved, opts.toolbelt);
        if (opts.signal?.aborted) {
          opts.onEvent({ type: 'error', text: 'Agent run cancelled.' });
          return;
        }
        opts.onEvent({ type: 'observation', text: observation });
      }
    } else {
      if (resolved.mutating) opts.onEvent({ type: 'action', text: resolved.describe, action: resolved });
      observation = await executeAction(resolved, opts.toolbelt);
      if (opts.signal?.aborted) {
        opts.onEvent({ type: 'error', text: 'Agent run cancelled.' });
        return;
      }
      opts.onEvent({ type: 'observation', text: observation });
      if (observation.startsWith('BLOCKED:')) {
        opts.onEvent({ type: 'blocked', text: observation.slice(9).trim() });
      }
    }

    convo.push({ role: 'assistant', content });
    convo.push({ role: 'system', content: `OBSERVATION: ${observation}` });
  }
  opts.onEvent({
    type: 'final',
    text: "I hit my step limit for this run — here's where things stand. Give me a follow-up goal to continue.",
  });
}

/** Fixed page-snapshot script used by the readPage tool in native mode. */
export const READ_PAGE_SCRIPT = `(function(){var t='';try{t=(document.body&&document.body.innerText)||'';t=t.slice(0,30000);}catch(e){}return {url:location.href,title:document.title||'',text:t};})()`;
