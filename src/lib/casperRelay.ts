// Frontend API client for the Casper CLI relay (/api/casper/relay/*).
import { authedFetch } from './authSession';

export interface RelayMachine {
  machineId: string;
  machineName: string;
  os: string | null;
  cliVersion: string | null;
  online: boolean;
  lastSeen: string | null;
  processes: Array<{ id: string; command: string; pid: number; uptime: number; port?: number }>;
  capabilities: string[];
}

export interface RelayConversationTurn {
  role: 'user' | 'casper';
  text: string;
}

async function parseJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return body as T;
}

export async function listRelayMachines(): Promise<RelayMachine[]> {
  const res = await authedFetch('/api/casper/relay/machines');
  const body = await parseJson<{ machines: RelayMachine[] }>(res);
  return body.machines ?? [];
}

export async function sendRelayDirective(params: {
  machineId?: string;
  command: string;
  conversationHistory?: RelayConversationTurn[];
}): Promise<{ directiveId: string; machineId: string }> {
  const res = await authedFetch('/api/casper/relay/directive', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return parseJson(res);
}

export async function abortRelayDirective(directiveId: string): Promise<void> {
  const res = await authedFetch(`/api/casper/relay/directive/${encodeURIComponent(directiveId)}/abort`, {
    method: 'POST',
  });
  await parseJson(res);
}

export async function respondRelayApproval(directiveId: string, approved: boolean): Promise<void> {
  const res = await authedFetch('/api/casper/relay/approval', {
    method: 'POST',
    body: JSON.stringify({ directiveId, approved }),
  });
  await parseJson(res);
}

export async function approveRelayDevice(userCode: string): Promise<{ machineId: string; machineName: string }> {
  const res = await authedFetch('/api/casper/relay/device/approve', {
    method: 'POST',
    body: JSON.stringify({ userCode }),
  });
  return parseJson(res);
}

export async function revokeRelayMachine(machineId: string): Promise<void> {
  const res = await authedFetch(`/api/casper/relay/machines/${encodeURIComponent(machineId)}/revoke`, {
    method: 'POST',
  });
  await parseJson(res);
}
