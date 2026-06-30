// Relay protocol types used by the CLI daemon.
// Mirror of the repo-level shared/protocol.ts contract — keep in sync.

export type DirectiveSource = 'mobile' | 'web' | 'cli_repl' | 'routine';

export interface ConversationTurn {
  role: 'user' | 'casper';
  text: string;
}

export interface MachineInfo {
  machineId: string;
  machineName: string;
  os: string;
  arch: string;
  nodeVersion: string;
  cliVersion: string;
  capabilities: string[];
}

export interface ProcessInfo {
  id: string;
  command: string;
  pid: number;
  uptime: number;
  port?: number;
}

export interface CliRegisterMessage {
  type: 'cli:register';
  token: string;
  machine: MachineInfo;
}

export interface CliHeartbeatMessage {
  type: 'cli:heartbeat';
  machineId: string;
  uptime: number;
  load: number[];
  processes: ProcessInfo[];
}

export interface CliStatusMessage {
  type: 'cli:status';
  machineId: string;
  online: boolean;
  processes: ProcessInfo[];
}

export interface ToolStartMessage {
  type: 'tool:start';
  directiveId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolStdoutMessage {
  type: 'tool:stdout';
  directiveId: string;
  chunk: string;
}

export interface ToolResultMessage {
  type: 'tool:result';
  directiveId: string;
  result: {
    ok: boolean;
    data: unknown;
    error?: string;
    durationMs: number;
  };
}

export interface ApprovalRequestMessage {
  type: 'cli:approval_request';
  directiveId: string;
  machineId: string;
  toolName: string;
  args: Record<string, unknown>;
  reason: string;
}

export interface DirectiveCompleteMessage {
  type: 'directive:complete';
  directiveId: string;
  status: 'completed' | 'failed';
  response: string;
  toolCalls?: Array<{ name: string; result: unknown }>;
}

export interface LlmTokenMessage {
  type: 'llm:token';
  directiveId: string;
  token: string;
}

export interface FileReceivedMessage {
  type: 'file:received';
  transferId: string;
  ok: boolean;
  fileName?: string;
  path?: string;
  relativePath?: string;
  size?: number;
  error?: string;
}

export type CliToRelayMessage =
  | CliRegisterMessage
  | CliHeartbeatMessage
  | CliStatusMessage
  | ToolStartMessage
  | ToolStdoutMessage
  | ToolResultMessage
  | ApprovalRequestMessage
  | DirectiveCompleteMessage
  | LlmTokenMessage
  | FileReceivedMessage;

export interface DirectiveMessage {
  type: 'directive';
  id: string;
  command: string;
  conversationHistory: ConversationTurn[];
  source: DirectiveSource;
  userId: string;
  metadata?: Record<string, unknown>;
}

export interface AbortMessage {
  type: 'cli:abort';
  directiveId: string;
}

export interface ApprovalResponseMessage {
  type: 'cli:approval_response';
  directiveId: string;
  approved: boolean;
  respondedBy: string;
}

export interface RelayAckMessage {
  type: 'relay:ack';
  machineId: string;
  sessionId: string;
}

export interface FilePushMessage {
  type: 'file:push';
  transferId: string;
  fileName: string;
  contentBase64: string;
  size: number;
}

export type RelayToCliMessage =
  | DirectiveMessage
  | AbortMessage
  | ApprovalResponseMessage
  | RelayAckMessage
  | FilePushMessage;
