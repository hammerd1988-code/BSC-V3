import React, { useCallback, useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import HostScreen from './src/screens/HostScreen';
import TerminalScreen from './src/screens/TerminalScreen';
import FileBrowserScreen from './src/screens/FileBrowserScreen';
import { createNativeTransport } from './src/transport/nativeTransport';
import { SshTransport } from './src/transport/types';
import {
  acknowledgeHostTrust,
  clearCredentials,
  clearHostTrust,
  HostCredentials,
  HostProfile,
  isHostTrustAcknowledged,
  loadHostProfiles,
  readCredentials,
  saveHostProfiles,
  writeCredentials,
} from './src/storage/hosts';

type Screen = 'terminal' | 'files';

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
  ) => {
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
  };

  const deleteProfile = async (profile: HostProfile) => {
    const nextProfiles = profiles.filter((item) => item.id !== profile.id);
    setProfiles(nextProfiles);
    if (selectedProfile?.id === profile.id) setSelectedProfile(undefined);
    await saveHostProfiles(nextProfiles);
    await clearCredentials(profile.id);
    await clearHostTrust(profile.host, profile.port);
  };

  const connect = async (profile: HostProfile, credentials: HostCredentials) => {
    const trusted = await isHostTrustAcknowledged(profile.host, profile.port);
    if (!trusted) {
      const accepted = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Unverified host',
          `The native SSH transport cannot verify ${profile.host}:${profile.port}. Accept this risk once to continue? The connection will remain marked UNVERIFIED.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Accept risk', style: 'destructive', onPress: () => resolve(true) },
          ],
        );
      });
      if (!accepted) return;
      await acknowledgeHostTrust(profile.host, profile.port);
    }

    setConnecting(true);
    const nextTransport = createNativeTransport();
    try {
      await nextTransport.connect({
        host: profile.host,
        port: profile.port,
        username: profile.username,
        auth: profile.authType,
        ...credentials,
      });
      setTransport(nextTransport);
      setConnectedProfile(profile);
      setScreen('terminal');
    } catch (error) {
      nextTransport.disconnect();
      Alert.alert('Connection failed', errorMessage(error));
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
        {!transport || !connectedProfile ? (
          <HostScreen
            profiles={profiles}
            selectedProfileId={selectedProfile?.id}
            onSelectProfile={selectProfile}
            onDeleteProfile={(profile) => void deleteProfile(profile)}
            onConnect={connect}
            onSaveProfile={saveProfile}
            connecting={connecting}
          />
        ) : (
          <>
            <View style={styles.hostBar}>
              <View style={styles.hostCopy}>
                <Text style={styles.connectedHost} numberOfLines={1}>
                  {connectedProfile.username}@{connectedProfile.host}:{connectedProfile.port}
                </Text>
                <Text style={styles.trustText}>UNVERIFIED · FINGERPRINT UNAVAILABLE</Text>
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
            {screen === 'terminal' ? (
              <TerminalScreen transport={transport} onDisconnect={disconnect} />
            ) : (
              <FileBrowserScreen transport={transport} />
            )}
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  trustText: { color: '#fbbf24', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 3 },
  disconnectButton: { backgroundColor: '#7f1d1d', borderRadius: 7, paddingHorizontal: 12, paddingVertical: 9 },
  disconnectText: { color: '#fee2e2', fontSize: 10, fontWeight: '900' },
  tabs: { flexDirection: 'row', paddingHorizontal: 10, paddingTop: 8 },
  tab: { alignItems: 'center', borderBottomColor: '#1e293b', borderBottomWidth: 2, flex: 1, padding: 10 },
  activeTab: { borderBottomColor: '#22d3ee' },
  tabText: { color: '#64748b', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  activeTabText: { color: '#67e8f9' },
});
