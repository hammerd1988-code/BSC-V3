// @vitest-environment node
/**
 * Static guards against this repo's dominant bug class: code that names a
 * database column, RPC, or mapper key that does not exist. None of it is a type
 * error, so `tsc` is blind to all of it, and every symptom is the same — the
 * feature looks implemented, logs nothing, and silently does nothing.
 *
 * Two real defects motivated these:
 *
 *   - `Factions.tsx` sent `toDb({ directorPlaybook, updatedAt })`. `updatedAt` is
 *     absent from CAMEL_TO_SNAKE, so it reached PostgREST as camelCase, and one
 *     unknown column rejects the *whole* payload — the faction director playbook
 *     had never saved once.
 *   - `scripts/verify-database.ts` called `rpc('get_tables_with_rls_status')`,
 *     which exists in no migration, on the only code path its RLS check could
 *     take.
 *
 * The RPC half resolves names and argument names against a real Postgres built
 * from the migration chain, because PostgREST resolves an RPC by argument name:
 * a renamed parameter is a runtime PGRST202, not a type error.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createDatabase, applyMigrations, type PgLiteLike } from '../scripts/migrationHarness.js';

const REPO_ROOT = path.join(import.meta.dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'android', 'ios', 'coverage', 'packages']);

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectSourceFiles(full, out);
    else if (/\.(ts|tsx|mts)$/.test(entry) && !/\.(test|spec)\./.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Returns the balanced `{...}` starting at `open`, skipping over string and
 * template literals so a brace inside a string cannot unbalance the scan.
 * Returns null when the object is not closed (or is not an object at all).
 */
function balancedObject(source: string, open: number): string | null {
  if (source[open] !== '{') return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * Keys declared at depth 1 of an object literal. Nested objects are skipped
 * deliberately: `rpc('f', { p_last_transmit: { content, sender_id } })` passes
 * one argument, not three, and a naive key regex reports the inner keys as
 * extra arguments.
 */
function topLevelKeys(objectSource: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let token = '';
  let expectingKey = true;

  for (let i = 0; i < objectSource.length; i += 1) {
    const ch = objectSource[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; token = ''; continue; }
    if (ch === '{' || ch === '[' || ch === '(') { depth += 1; continue; }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth -= 1;
      if (depth === 0) expectingKey = true;
      continue;
    }
    if (depth !== 1) continue;

    if (ch === ',') { expectingKey = true; token = ''; continue; }
    if (ch === ':') {
      if (expectingKey && token.trim()) keys.push(token.trim());
      expectingKey = false;
      token = '';
      continue;
    }
    if (/[A-Za-z0-9_$]/.test(ch)) token += ch;
    else if (!/\s/.test(ch)) token = '';
  }
  return keys;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function relative(file: string): string {
  return path.relative(REPO_ROOT, file);
}

const sourceFiles = collectSourceFiles(REPO_ROOT);

describe('schema drift', () => {
  let rpcArgumentNames: Map<string, string[][]>;

  beforeAll(async () => {
    const db: PgLiteLike = await createDatabase();
    await applyMigrations(db);
    const { rows } = await db.query<{ name: string; args: string }>(
      `select p.proname as name, pg_get_function_arguments(p.oid) as args
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'`,
    );
    rpcArgumentNames = new Map();
    for (const row of rows) {
      const names = row.args
        .split(',')
        .map((arg) => arg.trim().split(/\s+/)[0])
        .filter((name) => name && !['OUT', 'INOUT', 'VARIADIC'].includes(name));
      const existing = rpcArgumentNames.get(row.name) ?? [];
      existing.push(names);
      rpcArgumentNames.set(row.name, existing);
    }
  }, 120_000);

  it('only calls RPCs that the migration chain actually defines', () => {
    const missing: string[] = [];
    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\.rpc\(\s*['"`]([A-Za-z0-9_]+)['"`]/g)) {
        if (!rpcArgumentNames.has(match[1])) {
          missing.push(`${relative(file)}:${lineOf(source, match.index!)} rpc('${match[1]}')`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('passes each RPC only arguments it declares', () => {
    const mismatches: string[] = [];
    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\.rpc\(\s*['"`]([A-Za-z0-9_]+)['"`]\s*,\s*/g)) {
        const overloads = rpcArgumentNames.get(match[1]);
        if (!overloads) continue; // reported by the test above

        const objectStart = match.index! + match[0].length;
        const literal = balancedObject(source, objectStart);
        if (!literal) continue; // a variable was passed; not statically checkable

        const passed = topLevelKeys(literal);
        if (passed.length === 0) continue;
        if (!overloads.some((params) => passed.every((arg) => params.includes(arg)))) {
          mismatches.push(
            `${relative(file)}:${lineOf(source, match.index!)} rpc('${match[1]}', {${passed.join(', ')}}) ` +
              `— declared ${overloads.map((o) => `(${o.join(', ')})`).join(' | ')}`,
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  /**
   * `toDb()` rewrites only the keys present in CAMEL_TO_SNAKE and passes
   * everything else through untouched. A camelCase key it does not know is
   * therefore always a bug — whatever the table — because it reaches Postgres
   * still camelCase, and Postgres has no camelCase columns.
   */
  it('never hands toDb() a camelCase key it cannot convert', () => {
    const mapperSource = readFileSync(path.join(REPO_ROOT, 'src', 'supabase.ts'), 'utf8');
    const mapStart = mapperSource.indexOf('const CAMEL_TO_SNAKE');
    expect(mapStart).toBeGreaterThan(-1);
    const mapLiteral = balancedObject(mapperSource, mapperSource.indexOf('{', mapStart));
    expect(mapLiteral).not.toBeNull();
    const known = new Set(topLevelKeys(mapLiteral!));
    expect(known.size).toBeGreaterThan(20);

    const unconvertible: string[] = [];
    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\btoDb\(\s*/g)) {
        const objectStart = match.index! + match[0].length;
        const literal = balancedObject(source, objectStart);
        if (!literal) continue; // toDb(someVariable) — not statically checkable

        for (const key of topLevelKeys(literal)) {
          if (known.has(key)) continue;
          if (/^[a-z0-9_]+$/.test(key)) continue; // already snake_case, passes through correctly
          unconvertible.push(`${relative(file)}:${lineOf(source, match.index!)} toDb({ ${key} })`);
        }
      }
    }
    expect(unconvertible).toEqual([]);
  });
});
