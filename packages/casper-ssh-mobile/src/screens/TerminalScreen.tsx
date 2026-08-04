import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SshTransport } from '../transport/types';
import { AnsiSpan, parseAnsiLine, splitAnsiLines } from '../terminal/ansi';

const MAX_LINES = 500;

interface TerminalScreenProps {
  transport: SshTransport;
  onDisconnect: () => void;
}

function StyledLine({ line }: { line: string }) {
  const spans: AnsiSpan[] = parseAnsiLine(line);
  return (
    <Text selectable style={styles.termLine}>
      {spans.map((span, index) => (
        <Text key={`${index}-${span.text}`} style={span.style}>
          {span.text}
        </Text>
      ))}
    </Text>
  );
}

export default function TerminalScreen({ transport, onDisconnect }: TerminalScreenProps) {
  const [lines, setLines] = useState<string[]>(['// Interactive terminal ready.']);
  const [command, setCommand] = useState('');
  const [shellActive, setShellActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ctrlMode, setCtrlMode] = useState(false);
  const [terminalSize, setTerminalSize] = useState({ width: 0, height: 0 });
  const scrollRef = useRef<ScrollView>(null);

  const append = useCallback((value: string) => {
    setLines((current) => [...current, ...splitAnsiLines(value)].slice(-MAX_LINES));
  }, []);

  useEffect(() => transport.onShellOutput(append), [append, transport]);
  useEffect(() => transport.onRawShellOutput((value) => append(decodeBase64(value))), [append, transport]);

  const startShell = async () => {
    try {
      await transport.startShell({
        rawOutput: true,
        cols: Math.max(20, Math.floor(terminalSize.width / 7)),
        rows: Math.max(4, Math.floor(terminalSize.height / 18)),
      });
      setShellActive(true);
      append('// Shell started with raw byte output.');
    } catch (error) {
      append(`ERROR: ${errorMessage(error)}`);
    }
  };

  const execute = async () => {
    const value = command;
    if (!value.trim() || busy) return;
    setCommand('');
    setBusy(true);
    append(`$ ${value}`);
    try {
      append(await transport.exec(value.trim()));
    } catch (error) {
      append(`ERROR: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const send = async (value = command) => {
    if (!shellActive || !value) return;
    setCommand('');
    try {
      await transport.writeShell(value);
    } catch (error) {
      append(`ERROR: ${errorMessage(error)}`);
    }
  };

  const disconnect = () => {
    transport.closeShell();
    onDisconnect();
  };

  return (
    <View style={styles.container}>
      <View style={styles.statusRow}>
        <Text style={styles.unverified}>● UNVERIFIED HOST</Text>
        <Text style={styles.statusText}>{shellActive ? 'SHELL ACTIVE' : 'CONNECTED'}</Text>
      </View>
      <ScrollView
        ref={scrollRef}
        style={styles.terminal}
        contentContainerStyle={styles.terminalContent}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setTerminalSize({ width, height });
          if (shellActive) {
            transport.setPtySize(Math.max(20, Math.floor(width / 7)), Math.max(4, Math.floor(height / 18)));
          }
        }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {lines.map((line, index) => <StyledLine key={`${index}-${line}`} line={line} />)}
      </ScrollView>
      {shellActive && (
        <View style={styles.keyBar}>
          {[
            ['TAB', '\t'],
            ['CTRL', ''],
            ['ESC', '\u001b'],
            ['↑', '\u001b[A'],
            ['↓', '\u001b[B'],
            ['←', '\u001b[D'],
            ['→', '\u001b[C'],
            ['CTRL-C', '\u0003'],
          ].map(([label, value]) => (
            <TouchableOpacity
              key={label}
              style={[styles.keyButton, label === 'CTRL' && ctrlMode && styles.keyButtonActive]}
              onPress={() => (label === 'CTRL' ? setCtrlMode((active) => !active) : send(value))}
            >
              <Text style={styles.keyText}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.commandInput}
          placeholder={shellActive ? 'shell input' : 'remote command'}
          placeholderTextColor="#64748b"
          value={command}
          onChangeText={(value) => {
            if (ctrlMode && value) {
              const code = value.toUpperCase().charCodeAt(0);
              if (code >= 64 && code <= 95) void send(String.fromCharCode(code - 64));
              setCtrlMode(false);
              setCommand('');
            } else {
              setCommand(value);
            }
          }}
          onSubmitEditing={() => (shellActive ? send(`${command}\n`) : execute())}
          autoCapitalize="none"
          returnKeyType="send"
        />
        <TouchableOpacity style={styles.sendButton} onPress={() => (shellActive ? send(`${command}\n`) : execute())}>
          <Text style={styles.sendText}>SEND</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.actionRow}>
        {!shellActive && (
          <TouchableOpacity style={styles.secondaryButton} onPress={startShell}>
            <Text style={styles.secondaryText}>START SHELL</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.disconnectButton} onPress={disconnect}>
          <Text style={styles.secondaryText}>DISCONNECT</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function decodeBase64(value: string): string {
  try {
    const binary = globalThis.atob(value);
    const encoded = Array.from(binary, (character) => `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`).join('');
    return decodeURIComponent(encoded);
  } catch {
    return '';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020617' },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8 },
  unverified: { color: '#fbbf24', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  statusText: { color: '#67e8f9', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  terminal: { flex: 1, paddingHorizontal: 12 },
  terminalContent: { paddingBottom: 12 },
  termLine: { color: '#cbd5e1', fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
  keyBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, padding: 8 },
  keyButton: { backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: 6, borderWidth: 1, minWidth: 38, paddingHorizontal: 7, paddingVertical: 8 },
  keyButtonActive: { backgroundColor: '#0e7490', borderColor: '#67e8f9' },
  keyText: { color: '#a5f3fc', fontSize: 9, fontWeight: '900', textAlign: 'center' },
  inputRow: { flexDirection: 'row', gap: 8, padding: 10 },
  commandInput: { backgroundColor: '#111827', borderColor: '#155e75', borderRadius: 9, borderWidth: 1, color: '#e2e8f0', flex: 1, fontFamily: 'monospace', padding: 11 },
  sendButton: { alignItems: 'center', backgroundColor: '#0e7490', borderRadius: 9, justifyContent: 'center', paddingHorizontal: 14 },
  sendText: { color: '#ecfeff', fontSize: 11, fontWeight: '900' },
  actionRow: { flexDirection: 'row', gap: 8, padding: 10, paddingTop: 0 },
  secondaryButton: { alignItems: 'center', backgroundColor: '#164e63', borderRadius: 9, flex: 1, padding: 12 },
  disconnectButton: { alignItems: 'center', backgroundColor: '#7f1d1d', borderRadius: 9, flex: 1, padding: 12 },
  secondaryText: { color: '#e0f2fe', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
});
