import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate the persisted config so this check never touches a real profile.
const tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'casper-bsc-sync-test-'));
process.env.XDG_CONFIG_HOME = tempConfigDir;
process.env.APPDATA = tempConfigDir;

const {
  applyBscSyncPlan,
  configMatchesSnapshot,
  planBscSync,
  refreshFromBscIfFollowing,
} = await import('../dist/bscSync.js');
const { getConfig, setConfig, deleteConfig } = await import('../dist/config.js');

const base = { modelSource: 'user', endpointSource: 'user', hasApiKey: true, temperature: null };

// --- planBscSync -----------------------------------------------------------

const openRouter = planBscSync({ ...base, model: 'qwen/qwen3.8-27b', endpoint: 'https://openrouter.ai/api/v1/' });
assert.equal(openRouter.provider, 'openrouter');
assert.equal(openRouter.keyField, 'openrouterApiKey');
assert.equal(openRouter.baseUrl, 'https://openrouter.ai/api/v1');
assert.equal(openRouter.model, 'qwen/qwen3.8-27b');
assert.equal(openRouter.preferLocalLlm, false);
assert.equal(openRouter.localLlmUrl, undefined);

const custom = planBscSync({ ...base, model: 'gpt-5.4-mini', endpoint: 'https://llm.example.com/v1' });
assert.equal(custom.provider, 'openai-compatible');
assert.equal(custom.keyField, 'openaiApiKey');
assert.equal(custom.baseUrl, 'https://llm.example.com/v1');

const local = planBscSync({ ...base, model: 'qwen3-8b', endpoint: 'http://localhost:1234/v1' });
assert.equal(local.provider, 'local');
assert.equal(local.keyField, null);
assert.equal(local.localLlmUrl, 'http://localhost:1234/v1');
assert.equal(local.preferLocalLlm, true);
assert.equal(local.baseUrl, undefined);

const lan = planBscSync({ ...base, model: 'm', endpoint: 'http://192.168.1.20:11434/v1' });
assert.equal(lan.provider, 'local');

assert.throws(() => planBscSync({ ...base, model: '', endpoint: 'https://openrouter.ai/api/v1' }), /no model/);
assert.throws(() => planBscSync({ ...base, model: 'm', endpoint: 'not a url' }), /not a valid URL/);
assert.throws(() => planBscSync({ ...base, model: 'm', endpoint: 'http://llm.example.com/v1' }), /plaintext/);

// --- configMatchesSnapshot ---------------------------------------------------

const snap = { model: 'a', baseUrl: 'https://openrouter.ai/api/v1', preferLocalLlm: false };
assert.equal(configMatchesSnapshot(snap, { model: 'a', baseUrl: 'https://openrouter.ai/api/v1', preferLocalLlm: false }), true);
assert.equal(configMatchesSnapshot(snap, { model: 'b', baseUrl: 'https://openrouter.ai/api/v1', preferLocalLlm: false }), false);
assert.equal(configMatchesSnapshot(snap, { model: 'a', baseUrl: 'https://api.openai.com/v1', preferLocalLlm: false }), false);
assert.equal(configMatchesSnapshot(snap, { model: 'a', baseUrl: 'https://openrouter.ai/api/v1', preferLocalLlm: true }), false);
const localSnap = { model: 'a', localLlmUrl: 'http://localhost:1234/v1', preferLocalLlm: true };
assert.equal(configMatchesSnapshot(localSnap, { model: 'a', localLlmUrl: 'http://localhost:1234/v1', preferLocalLlm: true }), true);
assert.equal(configMatchesSnapshot(localSnap, { model: 'a', localLlmUrl: 'http://localhost:9999/v1', preferLocalLlm: true }), false);

// --- refreshFromBscIfFollowing ----------------------------------------------

const realFetch = globalThis.fetch;
let remote = null;
let fetchCalls = 0;
globalThis.fetch = async (url, init) => {
  fetchCalls += 1;
  assert.match(String(url), /\/api\/casper\/user\/ai-settings$/, 'startup refresh must never request the key');
  assert.match(init.headers.Authorization, /^Bearer /);
  return new Response(JSON.stringify({ success: true, ...remote }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

// Not set up from BSC: nothing happens, no network.
assert.deepEqual(await refreshFromBscIfFollowing(), { status: 'not_following' });
assert.equal(fetchCalls, 0);

// Synced, but machine not linked: keep config, no network.
applyBscSyncPlan(openRouter);
assert.equal(getConfig('model'), 'qwen/qwen3.8-27b');
assert.equal(getConfig('baseUrl'), 'https://openrouter.ai/api/v1');
assert.equal(getConfig('preferLocalLlm'), false);
assert.deepEqual(await refreshFromBscIfFollowing(), { status: 'skipped' });
assert.equal(fetchCalls, 0);

// Linked and unchanged upstream.
setConfig('accessToken', 'device-token');
setConfig('openrouterApiKey', 'local-or-key');
remote = { ...base, model: 'qwen/qwen3.8-27b', endpoint: 'https://openrouter.ai/api/v1' };
assert.deepEqual(await refreshFromBscIfFollowing(), { status: 'unchanged' });
assert.equal(fetchCalls, 1);

// Upstream model changed on the same provider: follow it.
remote = { ...base, model: 'qwen/qwen3.8-max', endpoint: 'https://openrouter.ai/api/v1' };
const updated = await refreshFromBscIfFollowing();
assert.equal(updated.status, 'updated');
assert.equal(getConfig('model'), 'qwen/qwen3.8-max');
assert.equal(getConfig('bscSync').model, 'qwen/qwen3.8-max');
assert.equal(getConfig('openrouterApiKey'), 'local-or-key', 'local key must be preserved');

// Upstream moved to a provider with no local key: do not break the working config.
remote = { ...base, model: 'gpt-5.4-mini', endpoint: 'https://llm.example.com/v1' };
assert.deepEqual(await refreshFromBscIfFollowing(), { status: 'skipped' });
assert.equal(getConfig('model'), 'qwen/qwen3.8-max');
assert.equal(getConfig('baseUrl'), 'https://openrouter.ai/api/v1');

// Network failure: keep what we have.
globalThis.fetch = async () => { throw new Error('offline'); };
assert.deepEqual(await refreshFromBscIfFollowing(), { status: 'skipped' });
assert.equal(getConfig('model'), 'qwen/qwen3.8-max');

// User changed the model by hand: stop following, never overwrite.
globalThis.fetch = async () => { throw new Error('must not be called'); };
setConfig('model', 'my/own-choice');
const stopped = await refreshFromBscIfFollowing();
assert.equal(stopped.status, 'stopped');
assert.equal(getConfig('model'), 'my/own-choice');
assert.equal(getConfig('bscSync'), undefined);
assert.deepEqual(await refreshFromBscIfFollowing(), { status: 'not_following' });

globalThis.fetch = realFetch;
deleteConfig('accessToken');
deleteConfig('openrouterApiKey');

console.log('BSC-V3 model sync checks passed.');
fs.rmSync(tempConfigDir, { recursive: true, force: true });
