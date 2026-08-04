import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { loadTrustedHosts, removeTrustedHost, TrustedHost } from '../storage/hosts';

interface TrustedHostsScreenProps {
  onBack: () => void;
}

export default function TrustedHostsScreen({ onBack }: TrustedHostsScreenProps) {
  const [hosts, setHosts] = useState<TrustedHost[]>([]);

  const refresh = useCallback(async () => {
    setHosts(await loadTrustedHosts());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = (host: TrustedHost) => {
    Alert.alert(
      'Remove trusted key?',
      `Future connections to ${host.host}:${host.port} will require a new trust decision.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await removeTrustedHost(host.host, host.port);
            await refresh();
          },
        },
      ],
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <Text style={styles.backText}>← BACK TO HOSTS</Text>
      </TouchableOpacity>
      <Text style={styles.title}>TRUSTED HOST KEYS</Text>
      {hosts.length === 0 ? (
        <Text style={styles.empty}>No trusted host keys saved on this device.</Text>
      ) : hosts.map((host) => (
        <View key={`${host.host}:${host.port}`} style={styles.card}>
          <View style={styles.copy}>
            <Text style={styles.host}>{host.host}:{host.port}</Text>
            <Text style={styles.meta}>{host.keyType} · {host.fingerprint}</Text>
          </View>
          <TouchableOpacity onPress={() => remove(host)} style={styles.removeButton}>
            <Text style={styles.removeText}>REMOVE</Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  backButton: { alignSelf: 'flex-start', paddingVertical: 8 },
  backText: { color: '#67e8f9', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  title: { color: '#e2e8f0', fontSize: 16, fontWeight: '900', letterSpacing: 2 },
  empty: { color: '#94a3b8', fontSize: 13, lineHeight: 20 },
  card: { alignItems: 'center', backgroundColor: '#111827', borderColor: '#334155', borderRadius: 8, borderWidth: 1, flexDirection: 'row', padding: 12 },
  copy: { flex: 1, gap: 4 },
  host: { color: '#e2e8f0', fontFamily: 'monospace', fontSize: 13 },
  meta: { color: '#94a3b8', fontFamily: 'monospace', fontSize: 10 },
  removeButton: { backgroundColor: '#7f1d1d', borderRadius: 6, paddingHorizontal: 9, paddingVertical: 8 },
  removeText: { color: '#fee2e2', fontSize: 9, fontWeight: '900' },
});
