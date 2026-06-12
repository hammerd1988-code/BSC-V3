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
  anthropicApiKey?: string;
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
