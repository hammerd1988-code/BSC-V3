import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import SSHClient, { PtyType } from '@dylankenneally/react-native-ssh-sftp';

type AuthMode = 'password' | 'key';

interface HostConfig {
  host: string;
  port: string;
  username: string;
  password: string;
  privateKey: string;
  passphrase: string;
}

const MAX_LINES = 500;

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode>('password');
  const [config, setConfig] = useState<HostConfig>({
    host: '',
    port: '22',
    username: '',
    password: '',
    privateKey: '',
    passphrase: '',
  });
  const [command, setCommand] = useState('');
  const [terminal, setTerminal] = useState<string[]>([
    '// Casper Roaming Ghost SSH — ready to haunt.',
  ]);
  const [connected, setConnected] = useState(false);
  const [shellActive, setShellActive] = useState(false);
  const [sftpPath, setSftpPath] = useState('/');
  const clientRef = useRef<SSHClient | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const log = useCallback((line: string) => {
    setTerminal((prev) => [...prev.slice(-MAX_LINES), line]);
  }, []);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setConnected(false);
    setShellActive(false);
    log('Disconnected.');
  }, [log]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const updateConfig = useCallback(
    (key: keyof HostConfig, value: string) => {
      setConfig((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const connect = async () => {
    try {
      const port = parseInt(config.port || '22', 10);
      let client: SSHClient;
      if (authMode === 'password') {
        client = await SSHClient.connectWithPassword(
          config.host,
          port,
          config.username,
          config.password,
        );
      } else {
        client = await SSHClient.connectWithKey(
          config.host,
          port,
          config.username,
          config.privateKey,
          config.passphrase,
        );
      }
      client.on('Shell', (event: unknown) => {
        const line = typeof event === 'string' ? event : JSON.stringify(event);
        if (line.length) log(line);
      });
      clientRef.current = client;
      setConnected(true);
      log(`Connected to ${config.username}@${config.host}:${port}`);
    } catch (err: any) {
      const message = err?.message || String(err);
      Alert.alert('Connection failed', message);
      log(`ERROR: ${message}`);
    }
  };

  const runCommand = async () => {
    if (!clientRef.current || !command.trim()) return;
    const cmd = command.trim();
    try {
      log(`$ ${cmd}`);
      const result = await clientRef.current.execute(cmd);
      if (result) log(result);
    } catch (err: any) {
      log(`ERROR: ${err?.message || String(err)}`);
    }
    setCommand('');
  };

  const startShell = async () => {
    if (!clientRef.current) return;
    try {
      await clientRef.current.startShell(PtyType.XTERM);
      setShellActive(true);
      log('// Interactive shell started (XTERM)');
    } catch (err: any) {
      log(`ERROR: ${err?.message || String(err)}`);
    }
  };

  const sendToShell = async () => {
    if (!clientRef.current || !command.trim()) return;
    const cmd = command.trim();
    log(`$ ${cmd}`);
    try {
      await clientRef.current.writeToShell(`${cmd}\n`);
    } catch (err: any) {
      log(`ERROR: ${err?.message || String(err)}`);
    }
    setCommand('');
  };

  const listSftp = async () => {
    if (!clientRef.current) return;
    try {
      await clientRef.current.connectSFTP();
      const items = await clientRef.current.sftpLs(sftpPath);
      log(`SFTP ${sftpPath}:`);
      items.forEach((item) => {
        const type = item.isDirectory ? 'd' : '-';
        const size = item.fileSize.toString().padStart(10, ' ');
        log(`${type} ${size} ${item.filename}`);
      });
    } catch (err: any) {
      log(`ERROR: ${err?.message || String(err)}`);
    }
  };

  const renderForm = () => (
    <View style={styles.form}>
      <TextInput
        style={styles.input}
        placeholder="Host"
        placeholderTextColor="#555"
        value={config.host}
        onChangeText={(t) => updateConfig('host', t)}
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="Port"
        placeholderTextColor="#555"
        value={config.port}
        onChangeText={(t) => updateConfig('port', t)}
        keyboardType="number-pad"
      />
      <TextInput
        style={styles.input}
        placeholder="Username"
        placeholderTextColor="#555"
        value={config.username}
        onChangeText={(t) => updateConfig('username', t)}
        autoCapitalize="none"
      />

      <View style={styles.modeRow}>
        <TouchableOpacity
          onPress={() => setAuthMode('password')}
          style={[styles.modeBtn, authMode === 'password' && styles.modeBtnActive]}
        >
          <Text style={styles.modeText}>Password</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setAuthMode('key')}
          style={[styles.modeBtn, authMode === 'key' && styles.modeBtnActive]}
        >
          <Text style={styles.modeText}>Private Key</Text>
        </TouchableOpacity>
      </View>

      {authMode === 'password' ? (
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#555"
          value={config.password}
          onChangeText={(t) => updateConfig('password', t)}
          secureTextEntry
          autoCapitalize="none"
        />
      ) : (
        <>
          <TextInput
            style={[styles.input, styles.keyInput]}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            placeholderTextColor="#555"
            value={config.privateKey}
            onChangeText={(t) => updateConfig('privateKey', t)}
            multiline
            textAlignVertical="top"
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Key passphrase (optional)"
            placeholderTextColor="#555"
            value={config.passphrase}
            onChangeText={(t) => updateConfig('passphrase', t)}
            secureTextEntry
            autoCapitalize="none"
          />
        </>
      )}

      <TouchableOpacity onPress={connect} style={styles.actionBtn}>
        <Text style={styles.actionText}>CONNECT</Text>
      </TouchableOpacity>
    </View>
  );

  const renderTerminal = () => (
    <>
      <ScrollView
        ref={scrollRef}
        style={styles.terminal}
        contentContainerStyle={styles.terminalContent}
        onContentSizeChange={() =>
          scrollRef.current?.scrollToEnd({ animated: false })
        }
      >
        {terminal.map((line, i) => (
          <Text key={i} style={styles.termLine}>
            {line}
          </Text>
        ))}
      </ScrollView>

      <View style={styles.controls}>
        {!shellActive ? (
          <TouchableOpacity onPress={startShell} style={styles.actionBtn}>
            <Text style={styles.actionText}>START SHELL</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={sendToShell} style={styles.actionBtn}>
            <Text style={styles.actionText}>SEND TO SHELL</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={runCommand} style={styles.actionBtn}>
          <Text style={styles.actionText}>EXECUTE</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={listSftp} style={styles.actionBtn}>
          <Text style={styles.actionText}>SFTP LS</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.commandInput}
        placeholder="> command"
        placeholderTextColor="#555"
        value={command}
        onChangeText={setCommand}
        onSubmitEditing={shellActive ? sendToShell : runCommand}
        autoCapitalize="none"
      />

      <TextInput
        style={styles.input}
        placeholder="SFTP path"
        placeholderTextColor="#555"
        value={sftpPath}
        onChangeText={setSftpPath}
        autoCapitalize="none"
      />

      <TouchableOpacity onPress={disconnect} style={[styles.actionBtn, styles.disconnectBtn]}>
        <Text style={styles.actionText}>DISCONNECT</Text>
      </TouchableOpacity>
    </>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboard}
      >
        <View style={styles.header}>
          <Text style={styles.title}>CASPER</Text>
          <Text style={styles.subtitle}>Roaming Ghost SSH</Text>
        </View>
        {connected ? renderTerminal() : renderForm()}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  keyboard: {
    flex: 1,
  },
  header: {
    paddingTop: 24,
    paddingBottom: 12,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#22d3ee',
    letterSpacing: 4,
  },
  subtitle: {
    fontSize: 12,
    color: '#94a3b8',
    letterSpacing: 2,
    marginTop: 4,
  },
  form: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  input: {
    backgroundColor: '#111827',
    color: '#e2e8f0',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    padding: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 14,
  },
  keyInput: {
    height: 140,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modeBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#111827',
    alignItems: 'center',
  },
  modeBtnActive: {
    borderColor: '#22d3ee',
    backgroundColor: '#164e63',
  },
  modeText: {
    color: '#94a3b8',
    fontWeight: '700',
  },
  actionBtn: {
    backgroundColor: '#0e7490',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  actionText: {
    color: '#ecfeff',
    fontWeight: '800',
    letterSpacing: 1,
  },
  disconnectBtn: {
    backgroundColor: '#7f1d1d',
  },
  terminal: {
    flex: 1,
    backgroundColor: '#020617',
    padding: 12,
  },
  terminalContent: {
    paddingBottom: 12,
  },
  termLine: {
    color: '#22d3ee',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  controls: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  commandInput: {
    backgroundColor: '#111827',
    color: '#e2e8f0',
    borderWidth: 1,
    borderColor: '#22d3ee',
    borderRadius: 10,
    padding: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 14,
    marginHorizontal: 12,
    marginTop: 8,
  },
});
