import { getConfig } from './config.js';
import { getRelayHttpBase } from './auth.js';

export interface CasperApiError {
  error?: string;
  message?: string;
  [key: string]: unknown;
}

function getAccessToken(): string {
  const token = getConfig('accessToken');
  if (!token) {
    throw new Error('Not authenticated. Run `casper auth login` to link this machine.');
  }
  return token;
}

export async function casperApi<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const base = getRelayHttpBase();
  const url = `${base}${path}`;
  const token = getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const contentType = res.headers.get('content-type') || '';
  const body: unknown = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const payload = body as CasperApiError;
    const detail = payload && typeof payload === 'object'
      ? (payload.error || payload.message || JSON.stringify(payload))
      : String(body);
    throw new Error(`Casper API error (${res.status}): ${detail}`);
  }

  return body as T;
}
