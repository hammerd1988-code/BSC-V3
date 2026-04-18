/*
  Lightweight auth-flow smoke tests for callback and next-route safety.
  Run with: npm run verify:auth
*/

function normalizeNext(value: string | null | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';
  if (value.startsWith('/auth/callback')) return '/';
  return value;
}

function buildCallbackUrl(origin: string, next: string): string {
  const callbackUrl = new URL('/auth/callback', origin);
  callbackUrl.searchParams.set('next', normalizeNext(next));
  return callbackUrl.toString();
}

function assertEqual(name: string, actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`${name} failed: expected "${expected}", got "${actual}"`);
  }
}

function run(): void {
  const tests: Array<[string, string | null | undefined, string]> = [
    ['empty next', null, '/'],
    ['simple in-app route', '/jobs', '/jobs'],
    ['query route', '/search?q=abc', '/search?q=abc'],
    ['external absolute url blocked', 'https://evil.example/steal', '/'],
    ['javascript scheme blocked', 'javascript:alert(1)', '/'],
    ['protocol-relative blocked', '//evil.example/steal', '/'],
    ['callback loop blocked', '/auth/callback?next=/jobs', '/'],
  ];

  for (const [name, input, expected] of tests) {
    assertEqual(name, normalizeNext(input), expected);
  }

  const callback = buildCallbackUrl('http://localhost:3000', '/jobs');
  assertEqual(
    'callback url with safe next',
    callback,
    'http://localhost:3000/auth/callback?next=%2Fjobs',
  );

  const callbackBlocked = buildCallbackUrl('http://localhost:3000', 'https://evil.example');
  assertEqual(
    'callback url with blocked next',
    callbackBlocked,
    'http://localhost:3000/auth/callback?next=%2F',
  );

  console.log('Auth flow smoke tests passed.');
}

run();
