import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SshTransport } from '../transport/types';
import { AnsiSpan, AnsiStyle, parseAnsiLine, stripTerminalControls } from '../terminal/ansi';

const MAX_LINES = 500;

function StyledLine({ spans }: { spans: AnsiSpan[] }) {
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

export default function TerminalScreen({ transport, onDisconnect }: {
  transport: SshTransport;
  onDisconnect: () => void;
}) {
  const [lines, setLines] = useState<AnsiSpan[][]>([]);
  const [command, setCommand] = useState('');
  const [shellActive, setShellActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ctrlMode, setCtrlMode] = useState(false);
  const [terminalSize, setTerminalSize] = useState({ width: 0, height: 0 });
  const scrollRef = useRef<ScrollView>(null);
  const pendingLineRef = useRef('');
  const styleRef = useRef<AnsiStyle>({});
  const fallbackBytesRef = useRef<Uint8Array>(new Uint8Array());
  const decoderRef = useRef<TextDecoder | null>(
    typeof TextDecoder === 'function' ? new TextDecoder('utf-8', { fatal: false }) : null,
  );

  const append = useCallback((value: string) => {
    if (!value) return;
    const input = stripTerminalControls(`${pendingLineRef.current}${value}`);
    const nextLines: AnsiSpan[][] = [];
    let start = 0;
    let newlineIndex = input.indexOf('\n');
    while (newlineIndex >= 0) {
      const rawLine = input.slice(start, newlineIndex);
      const visibleLine = rawLine.split('\r').at(-1) ?? '';
      const parsed = parseAnsiLine(visibleLine, styleRef.current);
      nextLines.push(parsed.spans);
      styleRef.current = parsed.style;
      start = newlineIndex + 1;
      newlineIndex = input.indexOf('\n', start);
    }
    pendingLineRef.current = input.slice(start);
    if (nextLines.length) {
      setLines((current) => [...current, ...nextLines].slice(-MAX_LINES));
    }
  }, []);

  const decodeBase64 = useCallback((value: string): string => {
    try {
      const binary = globalThis.atob(value);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      if (decoderRef.current) return decoderRef.current.decode(bytes, { stream: true });
      const combined = new Uint8Array(fallbackBytesRef.current.length + bytes.length);
      combined.set(fallbackBytesRef.current);
      combined.set(bytes, fallbackBytesRef.current.length);
      const [complete, remainder] = splitCompleteUtf8(combined);
      fallbackBytesRef.current = remainder;
      return decodeUtf8Fallback(complete);
    } catch (error) {
      return `\n[raw shell decode error: ${errorMessage(error)}]\n`;
    }
  }, []);

  useEffect(
    () => transport.capabilities.rawShellOutput
      ? transport.onRawShellOutput((value) => append(decodeBase64(value)))
      : transport.onShellOutput(append),
    [append, decodeBase64, transport],
  );

  const startShell = async () => {
    try {
      const useRawOutput = transport.capabilities.rawShellOutput;
      await transport.startShell({
        ...(useRawOutput ? { rawOutput: true } : {}),
        cols: Math.max(20, Math.floor(terminalSize.width / 7)),
        rows: Math.max(4, Math.floor(terminalSize.height / 18)),
      });
      setShellActive(true);
      append(useRawOutput
        ? '// Shell started with raw byte output.\n'
        : '// Shell started with line output; terminal fidelity is limited on this platform.\n');
    } catch (error) {
      append(`ERROR: ${errorMessage(error)}\n`);
    }
  };

  const execute = async () => {
    const value = command;
    if (!value.trim() || busy) return;
    setCommand('');
    setBusy(true);
    append(`$ ${value}\n`);
    try {
      const output = await transport.exec(value.trim());
      append(output.endsWith('\n') ? output : `${output}\n`);
    } catch (error) {
      append(`ERROR: ${errorMessage(error)}\n`);
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
      append(`ERROR: ${errorMessage(error)}\n`);
    }
  };

  const disconnect = () => {
    transport.closeShell();
    onDisconnect();
  };

  const verified = transport.capabilities.hostKeyVerification && transport.hostKeyInfo;

  return (
    <View style={styles.container}>
      <View style={styles.statusRow}>
        <Text style={verified ? styles.verified : styles.unverified}>
          {verified
            ? `● VERIFIED · ${transport.hostKeyInfo?.keyType} · ${transport.hostKeyInfo?.fingerprint}`
            : '● UNVERIFIED HOST'}
        </Text>
        <Text style={styles.statusText}>{shellActive ? 'SHELL ACTIVE' : 'CONNECTED'}</Text>
      </View>
      <ScrollView
        ref={scrollRef}
        style={styles.terminal}
        contentContainerStyle={styles.terminalContent}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setTerminalSize({ width, height });
          if (shellActive && transport.capabilities.shellResize) {
            transport.setPtySize(Math.max(20, Math.floor(width / 7)), Math.max(4, Math.floor(height / 18)));
          }
        }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {lines.map((line, index) => <StyledLine key={`${index}-${line.map((span) => span.text).join('')}`} spans={line} />)}
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

function decodeUtf8Fallback(bytes: Uint8Array): string {
  try {
    const encoded = Array.from(bytes, (byte) => `%${byte.toString(16).padStart(2, '0')}`).join('');
    return decodeURIComponent(encoded);
  } catch {
    return String.fromCharCode(...bytes);
  }
}

function splitCompleteUtf8(bytes: Uint8Array): [Uint8Array, Uint8Array] {
  if (!bytes.length) return [bytes, bytes];
  let end = bytes.length;
  let continuationCount = 0;
  for (let index = end - 1; index >= 0 && (bytes[index] & 0xc0) === 0x80; index -= 1) {
    continuationCount += 1;
  }
  const lead = bytes[end - continuationCount - 1];
  if (lead === undefined) return [bytes, new Uint8Array()];
  const expected = lead >= 0xf0 ? 3 : lead >= 0xe0 ? 2 : lead >= 0xc0 ? 1 : 0;
  if (expected > continuationCount) return [new Uint8Array(), bytes];
  return [bytes.slice(0, end), bytes.slice(end)];
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020617' },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8 },
  verified: { color: '#67e8f9', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
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
