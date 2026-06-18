/**
 * Typed accessor for the Electron desktop bridge (`window.bscDesktop`).
 *
 * When the web app runs inside the Blood Sweat Code desktop shell
 * (packages/desktop), the preload script exposes native capabilities the
 * browser can't offer: direct access to local LLM servers (LM Studio / Ollama,
 * which browsers can't reach over HTTPS due to mixed-content/CORS) and the
 * embedded Casper CLI for shell-backed build/push/scrape operations.
 *
 * In a normal browser these helpers are inert: `isDesktopApp()` returns false
 * and the typed bridge is `null`, so callers can cleanly fall back to cloud
 * models and the relay-based Casper flow.
 */

export type LocalLlmProvider = 'lmstudio' | 'ollama' | 'custom';

export interface LocalLlmTarget {
  provider: LocalLlmProvider;
  baseUrl?: string;
}

export interface ProviderStatus {
  provider: LocalLlmProvider;
  baseUrl: string;
  online: boolean;
  models: string[];
  error?: string;
}

export interface LocalChatRequest {
  target: LocalLlmTarget;
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
}

export interface CasperRunOptions {
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface CasperRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface DesktopUpdateStatus {
  state: 'checking' | 'available' | 'not-available' | 'downloaded' | 'error';
  version?: string;
  message?: string;
}

export interface BscDesktopApi {
  isDesktop: true;
  getVersion(): Promise<string>;
  localLlm: {
    detect(): Promise<ProviderStatus[]>;
    probe(target: LocalLlmTarget): Promise<ProviderStatus>;
    chat(req: LocalChatRequest): Promise<unknown>;
  };
  casper: {
    run(opts: CasperRunOptions): Promise<CasperRunResult>;
    version(): Promise<string>;
  };
  onUpdateStatus(cb: (status: DesktopUpdateStatus) => void): () => void;
}

declare global {
  interface Window {
    bscDesktop?: BscDesktopApi;
  }
}

/** True only when running inside the Electron desktop shell. */
export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && window.bscDesktop?.isDesktop === true;
}

/** The desktop bridge, or null in a normal browser. */
export function getDesktopBridge(): BscDesktopApi | null {
  if (typeof window === 'undefined') return null;
  return window.bscDesktop ?? null;
}
