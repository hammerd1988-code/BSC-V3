import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeIntegrationKey, maskSecret } from '../casperIntegrations.ts';

test('maskSecret handles empty, short, and long values', () => {
  assert.equal(maskSecret(), 'No key stored');
  assert.equal(maskSecret('short-key'), '••••••');
  assert.equal(maskSecret('abcdefghijklmnop'), 'abcd••••••mnop');
});

test('encodeIntegrationKey returns null for blank input', () => {
  assert.equal(encodeIntegrationKey('   '), null);
});

test('encodeIntegrationKey trims value and adds enc prefix', () => {
  const encoded = encodeIntegrationKey('  secret-token  ');
  assert.ok(encoded);
  assert.ok(encoded!.startsWith('enc:'));
  assert.notEqual(encoded, 'enc:  secret-token  ');
});

