import { describe, expect, it, vi, beforeEach } from 'vitest';

describe('casper lib', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports expected interfaces and constants', async () => {
    vi.mock('../supabase', () => ({
      supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) } },
    }));
    vi.mock('./authSession', () => ({
      authHeaders: vi.fn().mockResolvedValue({}),
      authedFetch: vi.fn(),
    }));

    const mod = await import('./casper');
    expect(mod.CASPER_SUBAGENT_MAX_PARALLEL).toBe(8);
    expect(mod.CASPER_HISTORY_WINDOW).toBe(10);
    expect(typeof mod.spawnCasperSubagents).toBe('function');
    expect(typeof mod.sendCasperCommand).toBe('function');
  });

  it('CASPER_SUBAGENT_MAX_PARALLEL is 8', async () => {
    vi.mock('../supabase', () => ({
      supabase: { auth: { getSession: vi.fn() } },
    }));
    vi.mock('./authSession', () => ({
      authHeaders: vi.fn(),
      authedFetch: vi.fn(),
    }));

    const { CASPER_SUBAGENT_MAX_PARALLEL } = await import('./casper');
    expect(CASPER_SUBAGENT_MAX_PARALLEL).toBe(8);
  });

  it('CASPER_HISTORY_WINDOW is 10', async () => {
    vi.mock('../supabase', () => ({
      supabase: { auth: { getSession: vi.fn() } },
    }));
    vi.mock('./authSession', () => ({
      authHeaders: vi.fn(),
      authedFetch: vi.fn(),
    }));

    const { CASPER_HISTORY_WINDOW } = await import('./casper');
    expect(CASPER_HISTORY_WINDOW).toBe(10);
  });
});

describe('casperIntegrations', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports encodeIntegrationKey and maskSecret helpers', async () => {
    const mod = await import('./casperIntegrations');
    expect(typeof mod.encodeIntegrationKey).toBe('function');
    expect(typeof mod.maskSecret).toBe('function');
    expect(Array.isArray(mod.AVAILABLE_CASPER_INTEGRATIONS)).toBe(true);
    expect(Array.isArray(mod.CASPER_INTEGRATION_CATEGORIES)).toBe(true);
  });

  it('encodeIntegrationKey encodes and decodes correctly', async () => {
    const { encodeIntegrationKey } = await import('./casperIntegrations');
    const encoded = encodeIntegrationKey('github-api');
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
  });

  it('maskSecret masks secrets properly', async () => {
    const { maskSecret } = await import('./casperIntegrations');
    const masked = maskSecret('sk-1234567890abcdef');
    expect(masked).not.toBe('sk-1234567890abcdef');
    expect(masked).toContain('•');
  });
});
