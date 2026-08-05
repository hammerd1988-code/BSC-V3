import SSHClient, {
  PtyType,
  type HostKeyInfo,
  type HostKeyOptions,
  type ShellOptions,
} from '@bloodsweatcode/react-native-ssh-sftp-bsc';
import { Platform } from 'react-native';
import {
  SshConnection,
  SshTransport,
  SftpEntry,
  TransferProgress,
  UnsupportedCapabilityError,
} from './types';

type Handler<T> = (value: T) => void;

export const nativeCapabilities = {
  hostKeyVerification: Platform.OS === 'android',
  rawShellOutput: Platform.OS === 'android',
  sftpChmod: Platform.OS === 'android',
  shellResize: Platform.OS === 'android',
  keyboardInteractive: false,
  agentForwarding: false,
} as const;

export class NativeSshTransport implements SshTransport {
  readonly capabilities = nativeCapabilities;

  private client: SSHClient | null = null;
  private readonly shellHandlers = new Set<Handler<string>>();
  private readonly rawShellHandlers = new Set<Handler<string>>();
  private readonly progressHandlers = new Set<Handler<TransferProgress>>();
  hostKeyInfo?: HostKeyInfo;

  async connect(connection: SshConnection): Promise<void> {
    this.disconnect();
    const options: HostKeyOptions = {
      knownHostsPath: connection.knownHostsPath,
      pinnedFingerprint: connection.pinnedFingerprint,
      acceptNewHostKey: connection.acceptNewHostKey,
    };
    if (connection.auth === 'password') {
      this.client = await SSHClient.connectWithPassword(
        connection.host,
        connection.port,
        connection.username,
        connection.password ?? '',
        options,
      );
    } else {
      this.client = await SSHClient.connectWithKey(
        connection.host,
        connection.port,
        connection.username,
        connection.privateKey ?? '',
        connection.passphrase,
        options,
      );
    }
    this.hostKeyInfo = this.client.hostKeyInfo;

    this.client.on('Shell', (value: unknown) => {
      const output = typeof value === 'string' ? value : String(value ?? '');
      if (output) this.shellHandlers.forEach((handler) => handler(output));
    });
    this.client.on('ShellRaw', (value: unknown) => {
      const output = typeof value === 'string' ? value : String(value ?? '');
      if (output) this.rawShellHandlers.forEach((handler) => handler(output));
    });
    this.client.on('DownloadProgress', (value: unknown) => {
      this.emitProgress('download', value);
    });
    this.client.on('UploadProgress', (value: unknown) => {
      this.emitProgress('upload', value);
    });
  }

  async exec(command: string): Promise<string> {
    return this.requireClient().execute(command);
  }

  async startShell(options?: ShellOptions): Promise<void> {
    await this.requireClient().startShell(PtyType.XTERM, options);
  }

  async writeShell(data: string): Promise<void> {
    await this.requireClient().writeToShell(data);
  }

  closeShell(): void {
    this.client?.closeShell();
  }

  onShellOutput(handler: Handler<string>): () => void {
    this.shellHandlers.add(handler);
    return () => this.shellHandlers.delete(handler);
  }

  onRawShellOutput(handler: Handler<string>): () => void {
    this.rawShellHandlers.add(handler);
    return () => this.rawShellHandlers.delete(handler);
  }

  setPtySize(cols: number, rows: number, widthPx = 0, heightPx = 0): void {
    if (this.capabilities.shellResize) {
      this.client?.setPtySize(cols, rows, widthPx, heightPx);
    }
  }

  async connectSftp(): Promise<void> {
    await this.requireClient().connectSFTP();
  }

  async list(path: string): Promise<SftpEntry[]> {
    return this.requireClient().sftpLs(path) as Promise<SftpEntry[]>;
  }

  async mkdir(path: string): Promise<void> {
    await this.requireClient().sftpMkdir(path);
  }

  async rm(path: string): Promise<void> {
    await this.requireClient().sftpRm(path);
  }

  async rmdir(path: string): Promise<void> {
    await this.requireClient().sftpRmdir(path);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.requireClient().sftpRename(oldPath, newPath);
  }

  async chmod(path: string, permissions: number): Promise<void> {
    if (!this.capabilities.sftpChmod) {
      throw new UnsupportedCapabilityError('sftpChmod');
    }
    await this.requireClient().sftpChmod(path, permissions);
  }

  async upload(localPath: string, remoteDirectory: string): Promise<void> {
    await this.requireClient().sftpUpload(localPath, remoteDirectory);
  }

  async download(remotePath: string, localDirectory: string): Promise<string> {
    return this.requireClient().sftpDownload(remotePath, localDirectory);
  }

  onTransferProgress(handler: Handler<TransferProgress>): () => void {
    this.progressHandlers.add(handler);
    return () => this.progressHandlers.delete(handler);
  }

  cancelUpload(): void {
    this.client?.sftpCancelUpload();
  }

  cancelDownload(): void {
    this.client?.sftpCancelDownload();
  }

  disconnect(): void {
    this.client?.disconnect();
    this.client = null;
    this.shellHandlers.clear();
    this.rawShellHandlers.clear();
    this.progressHandlers.clear();
  }

  private requireClient(): SSHClient {
    if (!this.client) throw new Error('SSH client is not connected.');
    return this.client;
  }

  private emitProgress(direction: TransferProgress['direction'], value: unknown): void {
    const percent = Number.parseInt(String(value ?? '0'), 10);
    if (!Number.isFinite(percent)) return;
    const progress = { direction, percent };
    this.progressHandlers.forEach((handler) => handler(progress));
  }
}

export function createNativeTransport(): SshTransport {
  return new NativeSshTransport();
}
