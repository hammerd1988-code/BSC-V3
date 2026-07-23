import Conf from 'conf';
import os from 'os';
import path from 'path';

export interface CasperConfig {
  // Auth
  accessToken?: string;
  refreshToken?: string;
  userId?: string;

  // Connection
  relayUrl: string;
  machineId: string;
  machineName: string;

  // LLM
  model: string;
  openaiApiKey?: string;
  openrouterApiKey?: string;
  anthropicApiKey?: string;
  baseUrl?: string; // OpenAI-compatible base URL (OpenAI, OpenRouter, etc.)
  localLlmUrl?: string; // LM Studio / Ollama endpoint

  // Security
  approvalLevel: 'auto' | 'confirm-local' | 'confirm-remote';
  workingDirectory: string;
  auditLog: boolean;

  // Behavior
  preferLocalLlm: boolean;
}

const defaults: CasperConfig = {
  relayUrl: 'https://bloodsweatcode.org',
  machineId: `${os.hostname()}-${Math.random().toString(36).slice(2, 6)}`,
  machineName: os.hostname(),
  model: 'gpt-4.1-mini',
  approvalLevel: 'confirm-local',
  workingDirectory: process.cwd(),
  auditLog: true,
  preferLocalLlm: false,
};

const config = new Conf<CasperConfig>({
  projectName: 'casper-cli',
  defaults,
  configFileMode: 0o600, // Owner-only read/write
});

// Persist the generated machineId on first run so subsequent process invocations
// (e.g. `casper daemon start` after `casper auth login`) use the same value.
// Without this, Math.random() produces a different suffix each time the module
// loads, causing silent relay registration failures due to machineId mismatch.
// config.has() returns true for defaults even when never written; check the raw
// store instead so we only skip the write if a value was actually persisted.
if (!('machineId' in config.store)) {
  config.set('machineId', defaults.machineId);
}

// Keys that hold secrets — never echo their raw value to stdout/logs.
export const SECRET_KEYS: ReadonlyArray<keyof CasperConfig> = [
  'openaiApiKey',
  'openrouterApiKey',
  'anthropicApiKey',
  'accessToken',
  'refreshToken',
];

export function isSecretKey(key: string): key is keyof CasperConfig {
  return (SECRET_KEYS as readonly string[]).includes(key);
}

export function getConfig<K extends keyof CasperConfig>(key: K): CasperConfig[K] {
  return config.get(key);
}

export function setConfig<K extends keyof CasperConfig>(key: K, value: CasperConfig[K]): void {
  config.set(key, value);
}

export function deleteConfig(key: keyof CasperConfig): void {
  config.delete(key);
}

export function getAllConfig(): CasperConfig {
  return config.store;
}

export function getConfigPath(): string {
  return config.path;
}

export function resetConfig(): void {
  config.clear();
}

// Audit log path
export function getAuditLogPath(): string {
  return path.join(path.dirname(config.path), 'history.jsonl');
}
