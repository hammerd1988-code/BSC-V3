import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// `client.js` imports the persisted config module. Isolate that side effect so
// this release check never reads or modifies a developer/runner's real config.
const tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'casper-provider-test-'));
process.env.XDG_CONFIG_HOME = tempConfigDir;
process.env.APPDATA = tempConfigDir;

const {
  OPENROUTER_BASE_URL,
  resolveCloudConfig,
} = await import('../dist/llm/client.js');

const emptySaved = {
  openaiApiKey: undefined,
  openrouterApiKey: undefined,
  baseUrl: undefined,
};

const fromOpenRouterEnv = resolveCloudConfig(
  {},
  { OPENROUTER_API_KEY: 'or-env-key' },
  emptySaved,
);
assert.equal(fromOpenRouterEnv.provider, 'openrouter');
assert.equal(fromOpenRouterEnv.apiKey, 'or-env-key');
assert.equal(fromOpenRouterEnv.baseURL, OPENROUTER_BASE_URL);
assert.equal(fromOpenRouterEnv.defaultHeaders?.['X-OpenRouter-Title'], 'Casper CLI');

const openRouterEnvOverridesStaleSavedUrl = resolveCloudConfig(
  {},
  { OPENROUTER_API_KEY: 'or-env-key' },
  { ...emptySaved, baseUrl: 'https://api.openai.com/v1' },
);
assert.equal(openRouterEnvOverridesStaleSavedUrl.provider, 'openrouter');
assert.equal(openRouterEnvOverridesStaleSavedUrl.baseURL, OPENROUTER_BASE_URL);

const fromSavedOpenRouter = resolveCloudConfig(
  {},
  {},
  { ...emptySaved, openrouterApiKey: 'or-saved-key' },
);
assert.equal(fromSavedOpenRouter.provider, 'openrouter');
assert.equal(fromSavedOpenRouter.apiKey, 'or-saved-key');
assert.equal(fromSavedOpenRouter.baseURL, OPENROUTER_BASE_URL);

const customOpenAiCompatible = resolveCloudConfig(
  {},
  {
    OPENAI_API_KEY: 'custom-key',
    OPENAI_BASE_URL: 'https://llm.example.com/v1',
    OPENROUTER_API_KEY: 'must-not-win',
  },
  emptySaved,
);
assert.equal(customOpenAiCompatible.provider, 'openai-compatible');
assert.equal(customOpenAiCompatible.apiKey, 'custom-key');
assert.equal(customOpenAiCompatible.baseURL, 'https://llm.example.com/v1');
assert.equal(customOpenAiCompatible.defaultHeaders, undefined);

const explicitOpenRouterUrl = resolveCloudConfig(
  { baseUrl: 'https://openrouter.ai/api/v1' },
  { OPENROUTER_API_KEY: 'or-key' },
  emptySaved,
);
assert.equal(explicitOpenRouterUrl.provider, 'openrouter');
assert.equal(explicitOpenRouterUrl.apiKey, 'or-key');

assert.throws(
  () => resolveCloudConfig({}, {}, emptySaved),
  /OPENAI_API_KEY \/ OPENROUTER_API_KEY/,
);

console.log('OpenRouter/OpenAI provider resolution checks passed.');
fs.rmSync(tempConfigDir, { recursive: true, force: true });
