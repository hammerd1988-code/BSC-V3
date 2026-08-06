/*
  Auth-flow smoke test for callback and next-route safety.
  Run with: npm run verify:auth

  This exercises the *shipping* implementation in src/lib/authRedirect.ts. It
  used to define its own, weaker copy of normalizeNext (no origin check, no
  OAuth-param stripping) and assert against that, so it passed no matter what
  the app actually did. The exhaustive cases live in
  src/lib/authRedirect.test.ts; this stays as a dependency-free command.
*/

import { buildAuthReturnUrl, normalizeNextPath } from '../src/lib/authRedirect';

const ORIGIN = 'http://localhost:3000';

function assertEqual(name: string, actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`${name} failed: expected "${expected}", got "${actual}"`);
  }
}

function run(): void {
  const tests: Array<[string, string | null | undefined, string]> = [
    ['empty next', null, '/'],
    ['simple in-app route', '/marketplace', '/marketplace'],
    ['query route', '/search?q=abc', '/search?q=abc'],
    ['external absolute url blocked', 'https://evil.example/steal', '/'],
    ['javascript scheme blocked', 'javascript:alert(1)', '/'],
    ['protocol-relative blocked', '//evil.example/steal', '/'],
    ['backslash host blocked', '/\\evil.example/steal', '/'],
    ['callback loop blocked', '/auth/callback?next=/marketplace', '/'],
    ['traversal into callback blocked', '/feed/../auth/callback', '/'],
    ['oauth params stripped', '/feed?code=abc123', '/'],
  ];

  for (const [name, input, expected] of tests) {
    assertEqual(name, normalizeNextPath(input, ORIGIN), expected);
  }

  assertEqual(
    'return url with safe next',
    buildAuthReturnUrl(ORIGIN, '/marketplace'),
    'http://localhost:3000/?next=%2Fmarketplace',
  );

  assertEqual(
    'return url with blocked next',
    buildAuthReturnUrl(ORIGIN, 'https://evil.example'),
    'http://localhost:3000/?next=%2F',
  );

  console.log('Auth flow smoke tests passed.');
}

run();
