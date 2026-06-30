// Casper CLI ↔ Railway WebSocket relay protocol.
//
// This file defines the message contract between:
//   • Casper CLI daemon (local machine)
//   • Railway backend (server.unified.ts relay namespace)
//   • Mobile / Web clients (indirect, via Railway)
//
// Both sides serialize these types as JSON over WSS.

// ── Shared primitives ─────────────────────────────────────────────────────────

export type DirectiveSource = 'mobile' | 'web' | 'cli_repl' | 'routine';

export type DirectiveStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ApprovalLevel = 'auto' | 'confirm-local' | 'confirm-remote';

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

// ── CLI → Railway messages ────────────────────────────────────────────────────

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

// Tool execution lifecycle (CLI → Railway, streamed to requesting client)
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

// Approval request from CLI → Railway → Mobile/Web
export interface ApprovalRequestMessage {
  type: 'cli:approval_request';
  directiveId: string;
  machineId: string;
  toolName: string;
  args: Record<string, unknown>;
  reason: string; // Human-readable explanation of why approval is needed
}

// Directive completion
export interface DirectiveCompleteMessage {
  type: 'directive:complete';
  directiveId: string;
  status: 'completed' | 'failed';
  response: string;
  toolCalls?: Array<{ name: string; result: unknown }>;
}

// LLM streaming token (CLI → Railway → Web/Mobile for live response rendering)
export interface LlmTokenMessage {
  type: 'llm:token';
  directiveId: string;
  token: string;
}

// File transfer ack (CLI → Railway → Web/Mobile) — daemon reports the result of
// writing a pushed file to disk on the machine.
export interface FileReceivedMessage {
  type: 'file:received';
  transferId: string;
  ok: boolean;
  fileName?: string;
  path?: string; // Absolute path the file was written to.
  relativePath?: string; // Path relative to the machine's working directory.
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

// ── Railway → CLI messages ────────────────────────────────────────────────────

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
  respondedBy: string; // userId who approved/denied
}

export interface RelayAckMessage {
  type: 'relay:ack';
  machineId: string;
  sessionId: string;
}

// File push (Railway → CLI) — operator uploaded a file from web/mobile; the
// daemon writes it into its working directory's inbox so directives can act on it.
export interface FilePushMessage {
  type: 'file:push';
  transferId: string;
  fileName: string;
  contentBase64: string;
  size: number; // Decoded byte length, for validation.
}

export type RelayToCliMessage =
  | DirectiveMessage
  | AbortMessage
  | ApprovalResponseMessage
  | RelayAckMessage
  | FilePushMessage;

// ── REST API types (for mobile/web → Railway) ─────────────────────────────────

export interface DeviceAuthInitResponse {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceAuthPollResponse {
  status: 'pending' | 'authorized' | 'expired';
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
}

export interface MachineListResponse {
  machines: Array<MachineInfo & { online: boolean; lastSeen: string }>;
}

export interface DirectiveRequest {
  machineId?: string; // If null, use first online machine
  command: string;
  conversationHistory?: ConversationTurn[];
  source: DirectiveSource;
}

export interface DirectiveResponse {
  directiveId: string;
  status: DirectiveStatus;
}
