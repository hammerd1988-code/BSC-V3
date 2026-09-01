import { describe, expect, it } from 'vitest';
import {
  buildAgentStepCommand,
  buildAgentSystemPrompt,
  isSensitiveUrl,
  parseToolCall,
  runAgent,
  type AgentStepEvent,
  type AgentToolbelt,
  type AutonomyMode,
} from './agent';

function makeToolbelt(overrides: Partial<AgentToolbelt> = {}): AgentToolbelt & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    listTabs: () => [{ index: 0, title: 'Example', url: 'https://example.com/', active: true }],
    openTab: (url) => calls.push(`openTab:${url}`),
    closeTab: (i) => { calls.push(`closeTab:${i}`); },
    switchTab: (i) => { calls.push(`switchTab:${i}`); },
    navigate: (url) => calls.push(`navigate:${url}`),
    readPage: async () => ({ url: 'https://example.com/', title: 'Example', text: 'hello' }),
    executeInPage: async (code) => { calls.push(`exec:${code.slice(0, 20)}`); return { ok: true }; },
    ...overrides,
  };
}

function collectRun(opts: {
  replies: string[];
  mode?: AutonomyMode;
  toolbelt?: AgentToolbelt;
  approve?: boolean;
  native?: boolean;
}): Promise<AgentStepEvent[]> {
  const events: AgentStepEvent[] = [];
  let i = 0;
  return runAgent({
    goal: 'test goal',
    mode: opts.mode ?? 'auto',
    native: opts.native ?? true,
    toolbelt: opts.toolbelt ?? makeToolbelt(),
    callAgentStep: async () => ({ content: opts.replies[Math.min(i++, opts.replies.length - 1)] }),
    onEvent: (e) => events.push(e),
    requestApproval: async () => opts.approve ?? true,
  }).then(() => events);
}

describe('parseToolCall', () => {
  it('parses a tool line with args', () => {
    expect(parseToolCall('Thinking...\nTOOL: navigate {"url": "https://example.com"}')).toEqual({
      tool: 'navigate',
      args: { url: 'https://example.com' },
    });
  });

  it('returns null for plain text', () => {
    expect(parseToolCall('All done — the page says hello.')).toBeNull();
  });

  it('flags bad JSON as a parse error', () => {
    expect(parseToolCall('TOOL: click {oops}')).toEqual({ tool: 'click', args: { __parseError: true } });
  });
});

describe('isSensitiveUrl', () => {
  it('blocks banking and auth hosts', () => {
    expect(isSensitiveUrl('https://www.paypal.com/signin')).toBe(true);
    expect(isSensitiveUrl('https://accounts.google.com/')).toBe(true);
    expect(isSensitiveUrl('https://mybank.example.com/')).toBe(true);
    expect(isSensitiveUrl('https://example.com/')).toBe(false);
  });
});

describe('buildAgentStepCommand', () => {
  it('includes system prompt, goal, and transcript', () => {
    const cmd = buildAgentStepCommand([
      { role: 'system', content: buildAgentSystemPrompt('auto', true) },
      { role: 'user', content: 'find cats' },
      { role: 'assistant', content: 'TOOL: listTabs {}' },
      { role: 'system', content: 'OBSERVATION: []' },
    ]);
    expect(cmd).toContain('=== GOAL ===\nfind cats');
    expect(cmd).toContain('YOU SAID:\nTOOL: listTabs {}');
    expect(cmd).toContain('OBSERVATION:\nOBSERVATION: []');
    expect(cmd).toContain('TOOL:');
  });

  it('bounds transcript size', () => {
    const turns = Array.from({ length: 60 }, (_, i) => ({ role: 'system', content: `OBSERVATION ${i}: ${'x'.repeat(10000)}` }));
    const cmd = buildAgentStepCommand([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'goal' },
      ...turns,
    ]);
    expect(cmd.length).toBeLessThan(100_000);
    expect(cmd).not.toContain('OBSERVATION 0:');
    expect(cmd).toContain('OBSERVATION 59:');
  });
});

describe('buildAgentSystemPrompt', () => {
  it('notes iframe limits when not native', () => {
    expect(buildAgentSystemPrompt('auto', false)).toContain('iframe mode');
    expect(buildAgentSystemPrompt('auto', true)).not.toContain('iframe mode');
  });
});

describe('runAgent', () => {
  it('executes tools in auto mode and finishes with a final answer', async () => {
    const toolbelt = makeToolbelt();
    const events = await collectRun({
      replies: ['TOOL: navigate {"url": "https://example.com"}', 'Done — navigated.'],
      toolbelt,
    });
    expect(toolbelt.calls).toContain('navigate:https://example.com/');
    expect(events.at(-1)).toMatchObject({ type: 'final', text: 'Done — navigated.' });
  });

  it('does not execute mutating tools in dry run', async () => {
    const toolbelt = makeToolbelt();
    const events = await collectRun({
      replies: ['TOOL: openTab {"url": "https://example.com"}', 'Planned.'],
      mode: 'dryrun',
      toolbelt,
    });
    expect(toolbelt.calls).toHaveLength(0);
    expect(events.some((e) => e.type === 'action' && e.text.startsWith('[dry run]'))).toBe(true);
  });

  it('respects denial in supervised mode', async () => {
    const toolbelt = makeToolbelt();
    const events = await collectRun({
      replies: ['TOOL: navigate {"url": "https://example.com"}', 'Okay, stopping.'],
      mode: 'supervised',
      approve: false,
      toolbelt,
    });
    expect(toolbelt.calls).toHaveLength(0);
    expect(events.some((e) => e.type === 'blocked' && e.text.startsWith('Denied'))).toBe(true);
  });

  it('blocks mutations on sensitive domains', async () => {
    const toolbelt = makeToolbelt();
    const events = await collectRun({
      replies: ['TOOL: navigate {"url": "https://www.paypal.com/send"}', 'Understood.'],
      toolbelt,
    });
    expect(toolbelt.calls).toHaveLength(0);
    expect(events.some((e) => e.type === 'blocked')).toBe(true);
  });

  it('errors page actions when no executor (web iframe mode)', async () => {
    const toolbelt = makeToolbelt({ executeInPage: null });
    const events = await collectRun({
      replies: ['TOOL: click {"selector": "#go"}', 'Cannot click here.'],
      native: false,
      toolbelt,
    });
    const obs = events.find((e) => e.type === 'observation');
    expect(obs?.text).toContain('ERROR: no live page');
  });

  it('rejects unknown tools with a hint', async () => {
    const events = await collectRun({ replies: ['TOOL: hackPage {}', 'Fine.'] });
    expect(events.some((e) => e.type === 'blocked' && e.text.includes('Unknown tool'))).toBe(true);
  });

  it('stops when the abort signal fires', async () => {
    const ctrl = new AbortController();
    const events: AgentStepEvent[] = [];
    await runAgent({
      goal: 'test',
      mode: 'auto',
      native: true,
      toolbelt: makeToolbelt(),
      signal: ctrl.signal,
      callAgentStep: async () => {
        ctrl.abort();
        return { content: 'TOOL: listTabs {}' };
      },
      onEvent: (e) => events.push(e),
      requestApproval: async () => true,
    });
    expect(events.some((e) => e.type === 'error' && e.text.includes('cancelled'))).toBe(true);
  });
});
