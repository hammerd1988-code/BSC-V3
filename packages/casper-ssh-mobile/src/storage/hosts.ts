import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import SSHClient from '@bloodsweatcode/react-native-ssh-sftp-bsc';
import { AuthType } from '../transport/types';

const PROFILES_KEY = 'casper-ssh.host-profiles.v1';
const CREDENTIAL_PREFIX = 'casper-ssh.credentials.v1.';
const CREDENTIAL_MANIFEST_SUFFIX = '.manifest';
const CREDENTIAL_CHUNK_SUFFIX = '.chunk.';
const CREDENTIAL_CHUNK_SIZE = 1500;
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
  const baseKey = `${CREDENTIAL_PREFIX}${id}`;
  const manifestRaw = await SecureStore.getItemAsync(`${baseKey}${CREDENTIAL_MANIFEST_SUFFIX}`);
  const raw = manifestRaw
    ? await readCredentialChunks(baseKey, manifestRaw)
    : await SecureStore.getItemAsync(baseKey);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as HostCredentials;
  } catch {
    return {};
  }
}

export async function writeCredentials(id: string, credentials: HostCredentials): Promise<void> {
  const baseKey = `${CREDENTIAL_PREFIX}${id}`;
  const previousManifest = await SecureStore.getItemAsync(`${baseKey}${CREDENTIAL_MANIFEST_SUFFIX}`);
  const serialized = JSON.stringify(credentials);
  const chunks = splitCredentialChunks(serialized);
  await Promise.all(
    chunks.map((chunk, index) => SecureStore.setItemAsync(`${baseKey}${CREDENTIAL_CHUNK_SUFFIX}${index}`, chunk)),
  );
  const previousCount = previousManifest ? parseManifest(previousManifest)?.count ?? 0 : 0;
  await Promise.all(
    Array.from({ length: Math.max(0, previousCount - chunks.length) }, (_, offset) =>
      SecureStore.deleteItemAsync(`${baseKey}${CREDENTIAL_CHUNK_SUFFIX}${chunks.length + offset}`),
    ),
  );
  await SecureStore.setItemAsync(
    `${baseKey}${CREDENTIAL_MANIFEST_SUFFIX}`,
    JSON.stringify({ version: 1, count: chunks.length }),
  );
  await SecureStore.deleteItemAsync(baseKey);
}

export async function clearCredentials(id: string): Promise<void> {
  const baseKey = `${CREDENTIAL_PREFIX}${id}`;
  const manifestRaw = await SecureStore.getItemAsync(`${baseKey}${CREDENTIAL_MANIFEST_SUFFIX}`);
  const count = manifestRaw ? parseManifest(manifestRaw)?.count ?? 0 : 0;
  await Promise.all([
    SecureStore.deleteItemAsync(baseKey),
    SecureStore.deleteItemAsync(`${baseKey}${CREDENTIAL_MANIFEST_SUFFIX}`),
    ...Array.from({ length: count }, (_, index) =>
      SecureStore.deleteItemAsync(`${baseKey}${CREDENTIAL_CHUNK_SUFFIX}${index}`),
    ),
  ]);
}

function splitCredentialChunks(value: string): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += CREDENTIAL_CHUNK_SIZE) {
    chunks.push(value.slice(index, index + CREDENTIAL_CHUNK_SIZE));
  }
  return chunks.length ? chunks : ['{}'];
}

async function readCredentialChunks(baseKey: string, manifestRaw: string): Promise<string | null> {
  const manifest = parseManifest(manifestRaw);
  if (!manifest || manifest.count < 1) return null;
  const chunks = await Promise.all(
    Array.from({ length: manifest.count }, (_, index) =>
      SecureStore.getItemAsync(`${baseKey}${CREDENTIAL_CHUNK_SUFFIX}${index}`),
    ),
  );
  return chunks.every((chunk): chunk is string => chunk !== null) ? chunks.join('') : null;
}

function parseManifest(value: string): { version: number; count: number } | null {
  try {
    const manifest = JSON.parse(value) as { version?: unknown; count?: unknown };
    return manifest.version === 1 && typeof manifest.count === 'number' && Number.isInteger(manifest.count)
      ? { version: 1, count: manifest.count }
      : null;
  } catch {
    return null;
  }
}

export function knownHostsFile(): File {
  return new File(Paths.document, 'known_hosts');
}

export function knownHostsPath(): string {
  return filesystemPath(knownHostsFile().uri);
}

export function filesystemPath(uriOrPath: string): string {
  return uriOrPath.startsWith('file://') ? decodeURIComponent(uriOrPath.slice(7)) : uriOrPath;
}

export function filesystemUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${encodeURI(path)}`;
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
  const file = knownHostsFile();
  if (file.exists) {
    try {
      await SSHClient.removeHostKey(host, port, knownHostsPath());
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        (error as { code?: unknown }).code !== 'SSH_HOST_KEY_NATIVE_UNAVAILABLE'
      ) {
        throw error;
      }
      // Fall back to filtering plaintext entries when the native helper is unavailable.

      const lines = (await file.text()).split(/\r?\n/);
      const canonical = port === 22 ? host : `[${host}]:${port}`;
      const filtered = lines.filter((line) => {
        if (!line.trim() || line.startsWith('#')) return true;
        const first = line.trim().split(/\s+/)[0];
        return !first.split(',').includes(canonical) && !first.split(',').includes(host);
      });
      file.write(filtered.join('\n'));
    }
  }

  const current = await loadTrustedHosts();
  await AsyncStorage.setItem(
    TRUSTED_HOSTS_KEY,
    JSON.stringify(current.filter((item) => !(item.host === host && item.port === port))),
  );
}
