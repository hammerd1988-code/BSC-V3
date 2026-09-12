// @vitest-environment node
/**
 * Guard against re-introducing a bug this repo has now fixed several times.
 *
 * `supabase.auth.getSession()` hands back whatever token is cached. It does not
 * refresh one that is about to expire and it has no answer for the 401 that
 * comes back when it already has. A tab that was backgrounded past the token
 * lifetime therefore issues one dead request per call site, and because these
 * wrappers are written per-component the failure keeps reappearing somewhere
 * new: the license card, the subscription checkout, the Bot Mayhem console and
 * the admin AI panel each shipped their own copy.
 *
 * `authedFetch` in src/lib/authSession.ts is the one implementation that
 * refreshes ahead of expiry and retries once. This test fails when a module
 * grows a private replacement for it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..');

/** src/lib/authSession.ts is the implementation; it is allowed to do this. */
const IMPLEMENTATION = path.join(srcRoot, 'lib', 'authSession.ts');

function sourceFiles(dir: string = srcRoot): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      found.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

describe('authenticated fetch call sites', () => {
  it('has exactly one implementation of the refresh-and-retry wrapper', () => {
    const offenders = sourceFiles().filter((file) => {
      if (file === IMPLEMENTATION) return false;
      const source = readFileSync(file, 'utf8');
      // A local declaration of a helper whose name claims to do what
      // authSession already does.
      return /(?:function|const)\s+(?:authedFetch|authHeaders)\b/.test(source);
    });

    expect(offenders.map((f) => path.relative(srcRoot, f))).toEqual([]);
  });

  it('does not read a raw session to authorize an /api request', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      if (file === IMPLEMENTATION) continue;
      const source = readFileSync(file, 'utf8');
      if (!source.includes('auth.getSession()')) continue;
      // `getSession()` is fine on its own — reading the signed-in user's id, for
      // instance — and a `Bearer` header is fine on its own, since Casper sends
      // the user's own provider key to their local LLM that way. The bug is a
      // file that does both: reads the raw session and builds an Authorization
      // header out of it, whether inline or via a local `getToken()`.
      if (/Authorization:\s*`Bearer \$\{[^}]*(?:session|[Tt]oken)/.test(source)) {
        offenders.push(path.relative(srcRoot, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
