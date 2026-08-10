// @vitest-environment node
/**
 * `/api/colosseum/persona-bots/ensure` and `/sapphire/ensure` seed the hardcoded
 * roster through the service role, and BotForge and Colosseum both call them on
 * mount — so the full upsert ran once per page view, and any authenticated
 * client could repeat it at will. Admin-gating them would break those pages, so
 * the seed is throttled instead.
 */
import { describe, expect, it } from 'vitest';
import { memoizeEnsure } from './colosseumRoutes';

describe('memoizeEnsure', () => {
  it('runs the seed once within the window', async () => {
    let calls = 0;
    const ensure = memoizeEnsure(async () => ++calls, 60_000);

    await expect(ensure()).resolves.toBe(1);
    await expect(ensure()).resolves.toBe(1);
    await expect(ensure()).resolves.toBe(1);
    expect(calls).toBe(1);
  });

  it('shares one in-flight promise between concurrent callers', async () => {
    let calls = 0;
    const ensure = memoizeEnsure(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return calls;
    }, 60_000);

    // Two page loads landing together must not both run the upsert.
    const [a, b] = await Promise.all([ensure(), ensure()]);
    expect(calls).toBe(1);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it('runs again once the window has passed', async () => {
    let calls = 0;
    const ensure = memoizeEnsure(async () => ++calls, 1);

    await expect(ensure()).resolves.toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(ensure()).resolves.toBe(2);
  });

  it('does not cache a failure, or the roster stays broken all window', async () => {
    let calls = 0;
    const ensure = memoizeEnsure(async () => {
      calls += 1;
      if (calls === 1) throw new Error('seed failed');
      return calls;
    }, 60_000);

    await expect(ensure()).rejects.toThrow('seed failed');
    await expect(ensure()).resolves.toBe(2);
    expect(calls).toBe(2);
  });
});
