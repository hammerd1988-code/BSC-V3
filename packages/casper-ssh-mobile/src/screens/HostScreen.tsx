import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AuthType, SshConnection } from '../transport/types';
import { HostCredentials, HostProfile } from '../storage/hosts';

interface HostScreenProps {
  profiles: HostProfile[];
  selectedProfileId?: string;
  onSelectProfile: (profile: HostProfile) => Promise<HostCredentials | undefined> | void;
  onDeleteProfile: (profile: HostProfile) => void;
  onConnect: (profile: HostProfile, credentials: HostCredentials) => void;
  onSaveProfile: (
    profile: Omit<HostProfile, 'id'>,
    credentials: HostCredentials,
  ) => Promise<HostProfile>;
  hostKeyVerificationAvailable: boolean;
  onManageTrustedHosts: () => void;
  connecting: boolean;
}

const emptyProfile: Omit<HostProfile, 'id'> = {
  label: '',
  host: '',
  port: 22,
  username: '',
  authType: 'password',
  saveCredentials: false,
};

export default function HostScreen({
  profiles,
  selectedProfileId,
  onSelectProfile,
  onDeleteProfile,
  onConnect,
  onSaveProfile,
  hostKeyVerificationAvailable,
  onManageTrustedHosts,
  connecting,
}: HostScreenProps) {
  const [profile, setProfile] = useState<Omit<HostProfile, 'id'>>(emptyProfile);
  const [credentials, setCredentials] = useState<HostCredentials>({});
  const [isNew, setIsNew] = useState(true);

  useEffect(() => {
    if (!selectedProfileId) {
      setProfile(emptyProfile);
      setCredentials({});
      setIsNew(true);
    }
  }, [selectedProfileId]);

  const update = <K extends keyof typeof profile>(
    key: K,
    value: (typeof profile)[K],
  ) => setProfile((current) => ({ ...current, [key]: value }));

  const select = async (saved: HostProfile) => {
    const savedCredentials = await onSelectProfile(saved);
    setProfile(saved);
    setCredentials(savedCredentials ?? {});
    setIsNew(false);
  };

  const submit = async () => {
    if (!profile.host.trim() || !profile.username.trim()) {
      Alert.alert('Missing connection details', 'Host and username are required.');
      return;
    }
    const port = Number(profile.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      Alert.alert('Invalid port', 'Enter a port between 1 and 65535.');
      return;
    }
    if (profile.authType === 'password' && !credentials.password) {
      Alert.alert('Missing password', 'Enter a password or load saved credentials.');
      return;
    }
    if (profile.authType === 'key' && !credentials.privateKey) {
      Alert.alert('Missing private key', 'Enter a private key or load saved credentials.');
      return;
    }
    const normalized = { ...profile, port, label: profile.label.trim() || profile.host.trim() };
    let savedProfile: HostProfile;
    try {
      savedProfile = await onSaveProfile(normalized, credentials);
    } catch (error) {
      Alert.alert('Unable to save credentials', errorMessage(error));
      return;
    }
    onConnect(savedProfile, credentials);
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {profiles.length > 0 && (
        <View style={styles.savedSection}>
          <Text style={styles.sectionTitle}>SAVED HOSTS</Text>
          {profiles.map((saved) => (
            <View key={saved.id} style={styles.savedRow}>
              <TouchableOpacity style={styles.savedHost} onPress={() => void select(saved)}>
                <Text style={styles.savedLabel}>{saved.label}</Text>
                <Text style={styles.savedMeta}>
                  {saved.username}@{saved.host}:{saved.port} · {saved.authType}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityLabel={`Delete ${saved.label}`}
                onPress={() =>
                  Alert.alert('Delete saved host?', 'Stored credentials will also be erased.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => onDeleteProfile(saved) },
                  ])
                }
              >
                <Text style={styles.deleteText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => {
              setProfile(emptyProfile);
              setCredentials({});
              onSelectProfile({ ...emptyProfile, id: '' });
              setIsNew(true);
            }}
          >
            <Text style={styles.secondaryText}>+ NEW HOST</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={styles.secondaryButton} onPress={onManageTrustedHosts}>
        <Text style={styles.secondaryText}>MANAGE TRUSTED HOST KEYS</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>{isNew ? 'NEW CONNECTION' : 'CONNECTION'}</Text>
      <TextInput
        style={styles.input}
        placeholder="Host label (optional)"
        placeholderTextColor="#64748b"
        value={profile.label}
        onChangeText={(value) => update('label', value)}
      />
      <TextInput
        style={styles.input}
        placeholder="Host or IP address"
        placeholderTextColor="#64748b"
        value={profile.host}
        onChangeText={(value) => update('host', value)}
        autoCapitalize="none"
      />
      <View style={styles.inline}>
        <TextInput
          style={[styles.input, styles.portInput]}
          placeholder="Port"
          placeholderTextColor="#64748b"
          value={String(profile.port)}
          onChangeText={(value) => update('port', Number(value.replace(/\D/g, '').slice(0, 5)) || 0)}
          keyboardType="number-pad"
        />
        <TextInput
          style={[styles.input, styles.userInput]}
          placeholder="Username"
          placeholderTextColor="#64748b"
          value={profile.username}
          onChangeText={(value) => update('username', value)}
          autoCapitalize="none"
        />
      </View>

      <View style={styles.modeRow}>
        {(['password', 'key'] as AuthType[]).map((mode) => (
          <TouchableOpacity
            key={mode}
            onPress={() => {
              const leavingMode = profile.authType;
              update('authType', mode);
              setCredentials((current) => leavingMode === 'password'
                ? { privateKey: current.privateKey, passphrase: current.passphrase }
                : { password: current.password });
            }}
            style={[styles.modeButton, profile.authType === mode && styles.modeButtonActive]}
          >
            <Text style={styles.modeText}>{mode === 'password' ? 'PASSWORD' : 'PRIVATE KEY'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {profile.authType === 'password' ? (
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#64748b"
          value={credentials.password ?? ''}
          onChangeText={(password) => setCredentials((current) => ({ ...current, password }))}
          secureTextEntry
          autoCapitalize="none"
        />
      ) : (
        <>
          <TextInput
            style={[styles.input, styles.keyInput]}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            placeholderTextColor="#64748b"
            value={credentials.privateKey ?? ''}
            onChangeText={(privateKey) => setCredentials((current) => ({ ...current, privateKey }))}
            multiline
            textAlignVertical="top"
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Key passphrase (optional)"
            placeholderTextColor="#64748b"
            value={credentials.passphrase ?? ''}
            onChangeText={(passphrase) => setCredentials((current) => ({ ...current, passphrase }))}
            secureTextEntry
            autoCapitalize="none"
          />
        </>
      )}

      <View style={styles.saveRow}>
        <View style={styles.saveCopy}>
          <Text style={styles.saveTitle}>SAVE CREDENTIALS</Text>
          <Text style={styles.saveHint}>Encrypted by the device secure store</Text>
        </View>
        <Switch
          value={profile.saveCredentials}
          onValueChange={(saveCredentials) => update('saveCredentials', saveCredentials)}
          trackColor={{ false: '#334155', true: '#0e7490' }}
          thumbColor={profile.saveCredentials ? '#67e8f9' : '#94a3b8'}
        />
      </View>

      <Text style={hostKeyVerificationAvailable ? styles.trustNotice : styles.warning}>
        {hostKeyVerificationAvailable
          ? 'Android verifies the server host key against the local known_hosts file.'
          : 'This platform cannot cryptographically verify server host keys. New connections will be marked unverified.'}
      </Text>
      <TouchableOpacity
        onPress={submit}
        style={[styles.primaryButton, connecting && styles.disabledButton]}
        disabled={connecting}
      >
        <Text style={styles.primaryText}>{connecting ? 'CONNECTING...' : 'CONNECT'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

export type { SshConnection };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  sectionTitle: { color: '#67e8f9', fontSize: 12, fontWeight: '900', letterSpacing: 2, marginTop: 4 },
  savedSection: { gap: 8 },
  savedRow: {
    alignItems: 'center',
    backgroundColor: '#111827',
    borderColor: '#1e3a8a',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 12,
  },
  savedHost: { flex: 1 },
  savedLabel: { color: '#e2e8f0', fontSize: 15, fontWeight: '800' },
  savedMeta: { color: '#64748b', fontFamily: 'monospace', fontSize: 11, marginTop: 4 },
  deleteText: { color: '#fb7185', fontSize: 26, paddingLeft: 12 },
  secondaryButton: { alignItems: 'center', borderColor: '#334155', borderRadius: 9, borderWidth: 1, padding: 11 },
  secondaryText: { color: '#94a3b8', fontWeight: '800', letterSpacing: 1 },
  input: {
    backgroundColor: '#111827',
    borderColor: '#334155',
    borderRadius: 9,
    borderWidth: 1,
    color: '#e2e8f0',
    fontFamily: 'monospace',
    fontSize: 14,
    padding: 12,
  },
  inline: { flexDirection: 'row', gap: 8 },
  portInput: { flex: 0.35 },
  userInput: { flex: 1 },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeButton: { alignItems: 'center', backgroundColor: '#111827', borderColor: '#334155', borderRadius: 9, borderWidth: 1, flex: 1, padding: 12 },
  modeButtonActive: { backgroundColor: '#164e63', borderColor: '#22d3ee' },
  modeText: { color: '#cbd5e1', fontSize: 11, fontWeight: '800' },
  keyInput: { height: 132 },
  saveRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  saveCopy: { flex: 1 },
  saveTitle: { color: '#e2e8f0', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  saveHint: { color: '#64748b', fontSize: 11, marginTop: 3 },
  warning: { color: '#fbbf24', fontSize: 11, lineHeight: 16, textAlign: 'center' },
  trustNotice: { color: '#67e8f9', fontSize: 11, lineHeight: 16, textAlign: 'center' },
  primaryButton: { alignItems: 'center', backgroundColor: '#0e7490', borderRadius: 10, marginTop: 4, padding: 15 },
  disabledButton: { opacity: 0.5 },
  primaryText: { color: '#ecfeff', fontWeight: '900', letterSpacing: 1 },
});
