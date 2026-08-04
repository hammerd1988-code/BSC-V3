export type AuthType = 'password' | 'key';

export interface SshConnection {
  host: string;
  port: number;
  username: string;
  auth: AuthType;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  knownHostsPath: string;
  pinnedFingerprint?: string;
  acceptNewHostKey?: boolean;
}

export interface HostKeyInfo {
  keyType: string;
  fingerprint: string;
}

export interface HostKeyError extends Error {
  code: 'SSH_HOST_KEY_UNKNOWN' | 'SSH_HOST_KEY_CHANGED' | string;
  keyType?: string;
  fingerprint?: string;
}

export interface SftpEntry {
  filename: string;
  isDirectory: boolean;
  modificationDate: string;
  lastAccess: string;
  fileSize: number;
  ownerUserID: number;
  ownerGroupID: number;
  flags: number;
}

export interface TransferProgress {
  direction: 'upload' | 'download';
  percent: number;
}

export interface SshCapabilities {
  hostKeyVerification: boolean;
  rawShellOutput: boolean;
  sftpChmod: boolean;
  shellResize: boolean;
  keyboardInteractive: boolean;
  agentForwarding: boolean;
}

export class UnsupportedCapabilityError extends Error {
  readonly capability: keyof SshCapabilities;

  constructor(capability: keyof SshCapabilities) {
    super(`SSH transport capability is not supported: ${capability}`);
    this.name = 'UnsupportedCapabilityError';
    this.capability = capability;
  }
}

export interface SshTransport {
  readonly capabilities: SshCapabilities;
  readonly verifyHostKey?: (fingerprint: string) => Promise<boolean>;
  readonly hostKeyInfo?: HostKeyInfo;

  connect(connection: SshConnection): Promise<void>;
  exec(command: string): Promise<string>;

  startShell(options?: { rawOutput?: boolean; cols?: number; rows?: number; widthPx?: number; heightPx?: number }): Promise<void>;
  writeShell(data: string): Promise<void>;
  closeShell(): void;
  onShellOutput(handler: (output: string) => void): () => void;
  onRawShellOutput(handler: (base64: string) => void): () => void;
  setPtySize(cols: number, rows: number, widthPx?: number, heightPx?: number): void;

  connectSftp(): Promise<void>;
  list(path: string): Promise<SftpEntry[]>;
  mkdir(path: string): Promise<void>;
  rm(path: string): Promise<void>;
  rmdir(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  chmod(path: string, permissions: number): Promise<void>;
  upload(localPath: string, remoteDirectory: string): Promise<void>;
  download(remotePath: string, localDirectory: string): Promise<string>;
  onTransferProgress(handler: (progress: TransferProgress) => void): () => void;
  cancelUpload(): void;
  cancelDownload(): void;

  disconnect(): void;
}
