import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDbError } from '../errors.ts';

test('handleDbError logs operation context and warns for RLS-like errors', () => {
  const errors: string[] = [];
  const warns: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => errors.push(String(args[0]));
  console.warn = (...args: unknown[]) => warns.push(String(args[0]));

  try {
    handleDbError(new Error('Permission denied by row-level security policy'), 'insert', '/posts');
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }

  assert.equal(errors.length, 1);
  assert.match(errors[0], /\[DB:insert\] \/posts/);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /RLS policy blocked this operation/);
});

test('handleDbError does not warn for non-RLS errors', () => {
  const warns: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warns.push(String(args[0]));

  try {
    handleDbError('Network timeout', 'select', null);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warns.length, 0);
});

