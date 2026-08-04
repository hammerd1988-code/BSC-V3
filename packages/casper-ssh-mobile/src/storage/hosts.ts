import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { AuthType } from '../transport/types';

const PROFILES_KEY = 'casper-ssh.host-profiles.v1';
const CREDENTIAL_PREFIX = 'casper-ssh.credentials.v1.';
const TRUST_PREFIX = 'casper-ssh.host-trust.v1.';

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

export function hostTrustKey(host: string, port: number): string {
  return `${TRUST_PREFIX}${host.trim().toLowerCase()}:${port}`;
}

export async function isHostTrustAcknowledged(host: string, port: number): Promise<boolean> {
  return (await AsyncStorage.getItem(hostTrustKey(host, port))) === 'accepted';
}

export async function acknowledgeHostTrust(host: string, port: number): Promise<void> {
  await AsyncStorage.setItem(hostTrustKey(host, port), 'accepted');
}

export async function clearHostTrust(host: string, port: number): Promise<void> {
  await AsyncStorage.removeItem(hostTrustKey(host, port));
}
