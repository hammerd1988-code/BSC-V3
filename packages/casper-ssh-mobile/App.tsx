import React, { useCallback, useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import HostScreen from './src/screens/HostScreen';
import TerminalScreen from './src/screens/TerminalScreen';
import FileBrowserScreen from './src/screens/FileBrowserScreen';
import TrustedHostsScreen from './src/screens/TrustedHostsScreen';
import { createNativeTransport, nativeCapabilities } from './src/transport/nativeTransport';
import { SshTransport } from './src/transport/types';
import {
  clearCredentials,
  HostCredentials,
  HostProfile,
  knownHostsPath,
  loadHostProfiles,
  recordTrustedHost,
  removeTrustedHost,
  readCredentials,
  saveHostProfiles,
  writeCredentials,
} from './src/storage/hosts';

type Screen = 'terminal' | 'files' | 'hosts';

export default function App() {
  const [profiles, setProfiles] = useState<HostProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<HostProfile | undefined>();
  const [transport, setTransport] = useState<SshTransport | null>(null);
  const [connectedProfile, setConnectedProfile] = useState<HostProfile | null>(null);
  const [screen, setScreen] = useState<Screen>('terminal');
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    void loadHostProfiles().then(setProfiles);
  }, []);

  useEffect(() => () => transport?.disconnect(), [transport]);

  const selectProfile = async (profile: HostProfile): Promise<HostCredentials | undefined> => {
    if (!profile.id) {
      setSelectedProfile(undefined);
      return undefined;
    }
    setSelectedProfile(profile);
    return profile.saveCredentials ? readCredentials(profile.id) : {};
  };

  const saveProfile = async (
    profileData: Omit<HostProfile, 'id'>,
    credentials: HostCredentials,
  ): Promise<HostProfile> => {
    const existing = selectedProfile?.id
      ? selectedProfile
      : profiles.find(
          (profile) =>
            profile.host === profileData.host &&
            profile.port === profileData.port &&
            profile.username === profileData.username,
        );
    const profile: HostProfile = {
      ...profileData,
      id: existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    const nextProfiles = [...profiles.filter((item) => item.id !== profile.id), profile];
    setProfiles(nextProfiles);
    setSelectedProfile(profile);
    await saveHostProfiles(nextProfiles);
    if (profile.saveCredentials) await writeCredentials(profile.id, credentials);
    else await clearCredentials(profile.id);
    return profile;
  };

  const deleteProfile = async (profile: HostProfile) => {
    try {
      await removeTrustedHost(profile.host, profile.port);
    } catch (error) {
      Alert.alert('Unable to remove saved host key', errorMessage(error));
      return;
    }
    const nextProfiles = profiles.filter((item) => item.id !== profile.id);
    setProfiles(nextProfiles);
    if (selectedProfile?.id === profile.id) setSelectedProfile(undefined);
    await saveHostProfiles(nextProfiles);
    await clearCredentials(profile.id);
  };

  const connect = async (profile: HostProfile, credentials: HostCredentials) => {
    setConnecting(true);
    let accepted = false;
    try {
      for (;;) {
        const nextTransport = createNativeTransport();
        try {
          await nextTransport.connect({
            host: profile.host,
            port: profile.port,
            username: profile.username,
            auth: profile.authType,
            knownHostsPath: knownHostsPath(),
            acceptNewHostKey: accepted,
            ...credentials,
          });
          if (nextTransport.hostKeyInfo) {
            await recordTrustedHost({
              host: profile.host,
              port: profile.port,
              keyType: nextTransport.hostKeyInfo.keyType,
              fingerprint: nextTransport.hostKeyInfo.fingerprint,
              acceptedAt: new Date().toISOString(),
            });
          }
          setTransport(nextTransport);
          setConnectedProfile(profile);
          setScreen('terminal');
          break;
        } catch (error) {
          nextTransport.disconnect();
          const details = hostKeyError(error);
          if (details?.code === 'SSH_HOST_KEY_UNKNOWN' && details.fingerprint && !accepted) {
            const shouldAccept = await confirmHostKey(profile, details.keyType ?? 'unknown', details.fingerprint);
            if (shouldAccept) {
              accepted = true;
              continue;
            }
          } else if (details?.code === 'SSH_HOST_KEY_CHANGED') {
            const shouldReTrust = await confirmChangedHost(profile);
            if (shouldReTrust) {
              try {
                await removeTrustedHost(profile.host, profile.port);
              } catch (removalError) {
                Alert.alert('Unable to remove saved host key', errorMessage(removalError));
                break;
              }
              accepted = false;
              continue;
            }
          } else {
            Alert.alert('Connection failed', errorMessage(error));
          }
          break;
        }
      }
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = useCallback(() => {
    transport?.disconnect();
    setTransport(null);
    setConnectedProfile(null);
    setScreen('terminal');
  }, [transport]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboard}>
        <View style={styles.header}>
          <Text style={styles.title}>CASPER</Text>
          <Text style={styles.subtitle}>ROAMING GHOST SSH</Text>
        </View>
        {!transport || !connectedProfile ? screen === 'hosts' ? (
          <TrustedHostsScreen onBack={() => setScreen('terminal')} />
        ) : (
          <HostScreen
            profiles={profiles}
            selectedProfileId={selectedProfile?.id}
            onSelectProfile={selectProfile}
            onDeleteProfile={(profile) => void deleteProfile(profile)}
            onConnect={connect}
            onSaveProfile={saveProfile}
            hostKeyVerificationAvailable={nativeCapabilities.hostKeyVerification}
            onManageTrustedHosts={() => setScreen('hosts')}
            connecting={connecting}
          />
        ) : (
          <>
            <View style={styles.hostBar}>
              <View style={styles.hostCopy}>
                <Text style={styles.connectedHost} numberOfLines={1}>
                  {connectedProfile.username}@{connectedProfile.host}:{connectedProfile.port}
                </Text>
                <Text
                  style={[
                    styles.trustText,
                    transport.capabilities.hostKeyVerification && transport.hostKeyInfo
                      ? styles.verifiedText
                      : styles.unverifiedText,
                  ]}
                >
                  {transport.capabilities.hostKeyVerification && transport.hostKeyInfo
                    ? `● VERIFIED · ${transport.hostKeyInfo.keyType} · ${transport.hostKeyInfo.fingerprint}`
                    : '● UNVERIFIED · HOST KEY VERIFICATION UNAVAILABLE'}
                </Text>
              </View>
              <TouchableOpacity style={styles.disconnectButton} onPress={disconnect}>
                <Text style={styles.disconnectText}>EXIT</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.tabs}>
              {(['terminal', 'files'] as Screen[]).map((tab) => (
                <TouchableOpacity
                  key={tab}
                  style={[styles.tab, screen === tab && styles.activeTab]}
                  onPress={() => setScreen(tab)}
                >
                  <Text style={[styles.tabText, screen === tab && styles.activeTabText]}>
                    {tab === 'terminal' ? 'TERMINAL' : 'FILES'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ display: screen === 'terminal' ? 'flex' : 'none', flex: 1 }}>
              <TerminalScreen transport={transport} onDisconnect={disconnect} />
            </View>
            <View style={{ display: screen === 'files' ? 'flex' : 'none', flex: 1 }}>
              <FileBrowserScreen transport={transport} active={screen === 'files'} />
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function hostKeyError(error: unknown): { code: string; keyType?: string; fingerprint?: string } | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as { code?: unknown; keyType?: unknown; fingerprint?: unknown };
  return typeof value.code === 'string'
    ? {
        code: value.code,
        keyType: typeof value.keyType === 'string' ? value.keyType : undefined,
        fingerprint: typeof value.fingerprint === 'string' ? value.fingerprint : undefined,
      }
    : undefined;
}

function confirmHostKey(profile: HostProfile, keyType: string, fingerprint: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Verify new host key',
      `${profile.host}:${profile.port} presented a ${keyType} key.\n\nSHA256 fingerprint:\n${fingerprint}\n\nOnly accept this if you trust this server.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Trust and save', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

function confirmChangedHost(profile: HostProfile): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'HOST KEY CHANGED',
      `The key for ${profile.host}:${profile.port} no longer matches the saved key. This may indicate a man-in-the-middle attack. Delete the saved key and re-trust only if you have independently verified the server.`,
      [{ text: 'Keep blocked', style: 'cancel', onPress: () => resolve(false) }, { text: 'Delete and re-trust', style: 'destructive', onPress: () => resolve(true) }],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#0a0a0f', flex: 1 },
  keyboard: { flex: 1 },
  header: { alignItems: 'center', borderBottomColor: '#1f2937', borderBottomWidth: 1, paddingBottom: 12, paddingTop: 18 },
  title: { color: '#22d3ee', fontSize: 27, fontWeight: '900', letterSpacing: 4 },
  subtitle: { color: '#94a3b8', fontSize: 11, letterSpacing: 2, marginTop: 3 },
  hostBar: { alignItems: 'center', borderBottomColor: '#1e293b', borderBottomWidth: 1, flexDirection: 'row', padding: 10 },
  hostCopy: { flex: 1 },
  connectedHost: { color: '#e2e8f0', fontFamily: 'monospace', fontSize: 12 },
  trustText: { fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 3 },
  verifiedText: { color: '#67e8f9' },
  unverifiedText: { color: '#fbbf24' },
  disconnectButton: { backgroundColor: '#7f1d1d', borderRadius: 7, paddingHorizontal: 12, paddingVertical: 9 },
  disconnectText: { color: '#fee2e2', fontSize: 10, fontWeight: '900' },
  tabs: { flexDirection: 'row', paddingHorizontal: 10, paddingTop: 8 },
  tab: { alignItems: 'center', borderBottomColor: '#1e293b', borderBottomWidth: 2, flex: 1, padding: 10 },
  activeTab: { borderBottomColor: '#22d3ee' },
  tabText: { color: '#64748b', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  activeTabText: { color: '#67e8f9' },
});
