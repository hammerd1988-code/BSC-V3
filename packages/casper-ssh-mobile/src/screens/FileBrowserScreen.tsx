import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { SftpEntry, SshTransport, TransferProgress } from '../transport/types';

interface FileBrowserScreenProps {
  transport: SshTransport;
}

export default function FileBrowserScreen({ transport }: FileBrowserScreenProps) {
  const [path, setPath] = useState('/');
  const [pathInput, setPathInput] = useState('/');
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastDownload, setLastDownload] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<{ title: string; value: string; submit: (value: string) => void } | null>(null);

  const browse = async (nextPath = path) => {
    setLoading(true);
    try {
      await transport.connectSftp();
      const result = await transport.list(nextPath);
      setPath(nextPath);
      setPathInput(nextPath);
      setEntries(result.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory)));
    } catch (error) {
      Alert.alert('SFTP error', errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void browse('/');
    return transport.onTransferProgress(setProgress);
  }, [transport]);

  const parent = () => {
    if (path === '/') return;
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    void browse(`/${parts.join('/') || ''}`.replace(/\/$/, '') || '/');
  };

  const selectedPath = (name: string) => `${path === '/' ? '' : path}/${name}`;

  const upload = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    try {
      setProgress({ direction: 'upload', percent: 0 });
      await transport.upload(result.assets[0].uri, path);
      await browse();
    } catch (error) {
      Alert.alert('Upload failed', errorMessage(error));
    } finally {
      setProgress(null);
    }
  };

  const download = async (entry: SftpEntry) => {
    try {
      setProgress({ direction: 'download', percent: 0 });
      const localPath = await transport.download(selectedPath(entry.filename), Paths.document.uri);
      setLastDownload(localPath);
    } catch (error) {
      Alert.alert('Download failed', errorMessage(error));
    } finally {
      setProgress(null);
    }
  };

  const remove = (entry: SftpEntry) => {
    Alert.alert(`Delete ${entry.filename}?`, entry.isDirectory ? 'The directory must be empty.' : undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            if (entry.isDirectory) await transport.rmdir(selectedPath(entry.filename));
            else await transport.rm(selectedPath(entry.filename));
            await browse();
          } catch (error) {
            Alert.alert('Delete failed', errorMessage(error));
          }
        },
      },
    ]);
  };

  const rename = (entry: SftpEntry) => {
    setPrompt({
      title: 'Rename',
      value: entry.filename,
      submit: (newName) => {
        if (!newName.trim()) return;
        void transport
          .rename(selectedPath(entry.filename), selectedPath(newName.trim()))
          .then(() => browse())
          .catch((error) => Alert.alert('Rename failed', errorMessage(error)));
      },
    });
  };

  const mkdir = () => {
    setPrompt({
      title: 'New directory',
      value: '',
      submit: (name) => {
        if (!name.trim()) return;
        void transport
          .mkdir(selectedPath(name.trim()))
          .then(() => browse())
          .catch((error) => Alert.alert('Create directory failed', errorMessage(error)));
      },
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.pathRow}>
        <TouchableOpacity style={styles.upButton} onPress={parent}>
          <Text style={styles.upText}>↑</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.pathInput}
          value={pathInput}
          onChangeText={setPathInput}
          onSubmitEditing={() => void browse(pathInput.trim() || '/')}
          autoCapitalize="none"
        />
        <TouchableOpacity style={styles.goButton} onPress={() => void browse(pathInput.trim() || '/')}>
          <Text style={styles.goText}>GO</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionButton} onPress={() => void upload()}>
          <Text style={styles.actionText}>UPLOAD</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={mkdir}>
          <Text style={styles.actionText}>MKDIR</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={() => void browse()}>
          <Text style={styles.actionText}>{loading ? '...' : 'REFRESH'}</Text>
        </TouchableOpacity>
      </View>
      {progress && (
        <View style={styles.progressRow}>
          <Text style={styles.progressText}>{progress.direction.toUpperCase()} {progress.percent}%</Text>
          <TouchableOpacity
            onPress={() => (progress.direction === 'upload' ? transport.cancelUpload() : transport.cancelDownload())}
          >
            <Text style={styles.cancelText}>CANCEL</Text>
          </TouchableOpacity>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.list}>
        {entries.map((entry) => (
          <View key={`${entry.filename}-${entry.modificationDate}`} style={styles.entry}>
            <TouchableOpacity
              style={styles.entryMain}
              onPress={() => (entry.isDirectory ? void browse(selectedPath(entry.filename)) : void download(entry))}
            >
              <Text style={styles.entryIcon}>{entry.isDirectory ? '▸' : '·'}</Text>
              <View style={styles.entryCopy}>
                <Text style={styles.entryName}>{entry.filename}</Text>
                <Text style={styles.entryMeta}>
                  {entry.isDirectory ? 'DIRECTORY' : `${entry.fileSize} bytes`}
                </Text>
              </View>
            </TouchableOpacity>
            <View style={styles.entryActions}>
              {!entry.isDirectory && (
                <TouchableOpacity onPress={() => void download(entry)}>
                  <Text style={styles.smallAction}>GET</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => rename(entry)}>
                <Text style={styles.smallAction}>REN</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => remove(entry)}>
                <Text style={styles.deleteAction}>DEL</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
      {lastDownload && (
        <View style={styles.downloadRow}>
          <Text style={styles.downloadText} numberOfLines={1}>Saved: {lastDownload}</Text>
          <TouchableOpacity onPress={() => void Linking.openURL(new File(lastDownload).uri)}>
            <Text style={styles.openText}>OPEN</Text>
          </TouchableOpacity>
        </View>
      )}
      <Modal visible={prompt !== null} transparent animationType="fade" onRequestClose={() => setPrompt(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{prompt?.title}</Text>
            <TextInput
              style={styles.modalInput}
              value={prompt?.value ?? ''}
              onChangeText={(value) => setPrompt((current) => current ? { ...current, value } : current)}
              autoFocus
              autoCapitalize="none"
              onSubmitEditing={() => {
                if (prompt) prompt.submit(prompt.value);
                setPrompt(null);
              }}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setPrompt(null)}>
                <Text style={styles.modalCancel}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (prompt) prompt.submit(prompt.value);
                  setPrompt(null);
                }}
              >
                <Text style={styles.modalSubmit}>SAVE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {!transport.capabilities.sftpChmod && (
        <Text style={styles.unsupported}>CHMOD unavailable in the native SSH library on this platform.</Text>
      )}
    </View>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#020617', flex: 1 },
  pathRow: { flexDirection: 'row', gap: 7, padding: 10 },
  upButton: { alignItems: 'center', backgroundColor: '#1e293b', borderRadius: 8, justifyContent: 'center', width: 38 },
  upText: { color: '#67e8f9', fontSize: 20 },
  pathInput: { backgroundColor: '#111827', borderColor: '#334155', borderRadius: 8, borderWidth: 1, color: '#e2e8f0', flex: 1, fontFamily: 'monospace', padding: 10 },
  goButton: { alignItems: 'center', backgroundColor: '#0e7490', borderRadius: 8, justifyContent: 'center', paddingHorizontal: 12 },
  goText: { color: '#ecfeff', fontSize: 11, fontWeight: '900' },
  actionRow: { flexDirection: 'row', gap: 7, paddingHorizontal: 10, paddingBottom: 8 },
  actionButton: { alignItems: 'center', backgroundColor: '#164e63', borderRadius: 8, flex: 1, padding: 11 },
  actionText: { color: '#cffafe', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  progressRow: { alignItems: 'center', backgroundColor: '#172554', flexDirection: 'row', justifyContent: 'space-between', padding: 10 },
  progressText: { color: '#bae6fd', fontFamily: 'monospace', fontSize: 11 },
  cancelText: { color: '#fca5a5', fontSize: 11, fontWeight: '900' },
  list: { padding: 10, paddingTop: 2 },
  entry: { alignItems: 'center', borderBottomColor: '#1e293b', borderBottomWidth: 1, flexDirection: 'row', paddingVertical: 12 },
  entryMain: { alignItems: 'center', flex: 1, flexDirection: 'row' },
  entryIcon: { color: '#22d3ee', fontSize: 20, width: 24 },
  entryCopy: { flex: 1 },
  entryName: { color: '#e2e8f0', fontFamily: 'monospace', fontSize: 14 },
  entryMeta: { color: '#64748b', fontSize: 10, marginTop: 3 },
  entryActions: { flexDirection: 'row', gap: 9 },
  smallAction: { color: '#67e8f9', fontSize: 10, fontWeight: '900' },
  deleteAction: { color: '#fb7185', fontSize: 10, fontWeight: '900' },
  downloadRow: { alignItems: 'center', borderTopColor: '#164e63', borderTopWidth: 1, flexDirection: 'row', gap: 12, padding: 10 },
  downloadText: { color: '#94a3b8', flex: 1, fontSize: 10 },
  openText: { color: '#67e8f9', fontSize: 11, fontWeight: '900' },
  unsupported: { color: '#64748b', fontSize: 10, padding: 10, textAlign: 'center' },
  modalBackdrop: { alignItems: 'center', backgroundColor: '#000000aa', flex: 1, justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#111827', borderColor: '#155e75', borderRadius: 12, borderWidth: 1, padding: 16, width: '100%' },
  modalTitle: { color: '#67e8f9', fontSize: 15, fontWeight: '900', marginBottom: 12 },
  modalInput: { backgroundColor: '#020617', borderColor: '#334155', borderRadius: 8, borderWidth: 1, color: '#e2e8f0', padding: 11 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20, paddingTop: 16 },
  modalCancel: { color: '#94a3b8', fontSize: 11, fontWeight: '900' },
  modalSubmit: { color: '#67e8f9', fontSize: 11, fontWeight: '900' },
});
