import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import { AuthType } from '../transport/types';

const PROFILES_KEY = 'casper-ssh.host-profiles.v1';
const CREDENTIAL_PREFIX = 'casper-ssh.credentials.v1.';
const TRUSTED_HOSTS_KEY = 'casper-ssh.trusted-hosts.v1';

export interface HostProfile {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  saveCredentials: boolean;
}

export interface HostCredentials {
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface TrustedHost {
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  acceptedAt: string;
}

export async function loadHostProfiles(): Promise<HostProfile[]> {
  const raw = await AsyncStorage.getItem(PROFILES_KEY);
  if (!raw) return [];
  try {
    const profiles = JSON.parse(raw) as HostProfile[];
    return Array.isArray(profiles) ? profiles : [];
  } catch {
    return [];
  }
}

export async function saveHostProfiles(profiles: HostProfile[]): Promise<void> {
  await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

export async function readCredentials(id: string): Promise<HostCredentials> {
  const raw = await SecureStore.getItemAsync(`${CREDENTIAL_PREFIX}${id}`);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as HostCredentials;
  } catch {
    return {};
  }
}

export async function writeCredentials(id: string, credentials: HostCredentials): Promise<void> {
  await SecureStore.setItemAsync(`${CREDENTIAL_PREFIX}${id}`, JSON.stringify(credentials));
}

export async function clearCredentials(id: string): Promise<void> {
  await SecureStore.deleteItemAsync(`${CREDENTIAL_PREFIX}${id}`);
}

export function knownHostsFile(): File {
  return new File(Paths.document, 'known_hosts');
}

export function knownHostsPath(): string {
  const uri = knownHostsFile().uri;
  return uri.startsWith('file://') ? decodeURIComponent(uri.slice(7)) : uri;
}

export async function loadTrustedHosts(): Promise<TrustedHost[]> {
  const raw = await AsyncStorage.getItem(TRUSTED_HOSTS_KEY);
  if (!raw) return [];
  try {
    const hosts = JSON.parse(raw) as TrustedHost[];
    return Array.isArray(hosts) ? hosts : [];
  } catch {
    return [];
  }
}

export async function recordTrustedHost(host: TrustedHost): Promise<void> {
  const current = await loadTrustedHosts();
  const next = [
    ...current.filter((item) => !(item.host === host.host && item.port === host.port)),
    host,
  ];
  await AsyncStorage.setItem(TRUSTED_HOSTS_KEY, JSON.stringify(next));
}

export async function removeTrustedHost(host: string, port: number): Promise<void> {
  const current = await loadTrustedHosts();
  await AsyncStorage.setItem(
    TRUSTED_HOSTS_KEY,
    JSON.stringify(current.filter((item) => !(item.host === host && item.port === port))),
  );

  const file = knownHostsFile();
  if (!file.exists) return;
  const lines = (await file.text()).split(/\r?\n/);
  const canonical = port === 22 ? host : `[${host}]:${port}`;
  const filtered = lines.filter((line) => {
    if (!line.trim() || line.startsWith('#')) return true;
    const first = line.trim().split(/\s+/)[0];
    return !first.split(',').includes(canonical) && !first.split(',').includes(host);
  });
  file.write(filtered.join('\n'));
}
