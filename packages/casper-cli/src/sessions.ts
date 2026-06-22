import fs from 'fs';
import path from 'path';
import { getConfig, getConfigPath } from './config.js';
import type { ChatMessage } from './llm/client.js';

const SESSIONS_DIR_NAME = 'sessions';
const MAX_SESSIONS = 50;
const SESSION_FILE_EXT = '.json';

interface SessionMeta {
  id: string;
  title: string;
  model: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  cwd: string;
}

interface SessionData extends SessionMeta {
  messages: ChatMessage[];
}

function getSessionsDir(): string {
  // Store sessions alongside the config file (~/.config/casper-cli/sessions/)
  const configDir = path.dirname(getConfigPath());
  const dir = path.join(configDir, SESSIONS_DIR_NAME);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function generateId(): string {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timePart = now.toISOString().slice(11, 19).replace(/:/g, '');
  const rand = Math.random().toString(36).slice(2, 6);
  return `${datePart}-${timePart}-${rand}`;
}

function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser || !firstUser.content) return 'Untitled session';
  const text = firstUser.content.slice(0, 60);
  return text.length < firstUser.content.length ? text + '…' : text;
}

function sessionPath(dir: string, id: string): string {
  return path.join(dir, id + SESSION_FILE_EXT);
}

export function saveSession(
  messages: ChatMessage[],
  model: string,
  existingId?: string,
): string {
  const dir = getSessionsDir();
  const id = existingId || generateId();
  const filePath = sessionPath(dir, id);

  const existing = existingId ? loadSession(existingId) : null;

  const data: SessionData = {
    id,
    title: existing?.title || deriveTitle(messages),
    model,
    messageCount: messages.length,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cwd: getConfig('workingDirectory') || process.cwd(),
    messages,
  };

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  pruneOldSessions(dir);
  return id;
}

export function loadSession(id: string): SessionData | null {
  const dir = getSessionsDir();
  const filePath = sessionPath(dir, id);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export function listSessions(): SessionMeta[] {
  const dir = getSessionsDir();
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith(SESSION_FILE_EXT))
    .sort()
    .reverse();

  const sessions: SessionMeta[] = [];
  for (const file of files.slice(0, MAX_SESSIONS)) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      const data = JSON.parse(raw) as SessionData;
      sessions.push({
        id: data.id,
        title: data.title,
        model: data.model,
        messageCount: data.messageCount,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        cwd: data.cwd,
      });
    } catch {
      // skip corrupt files
    }
  }
  return sessions;
}

export function deleteSession(id: string): boolean {
  const dir = getSessionsDir();
  const filePath = sessionPath(dir, id);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

export function getLastSessionId(): string | null {
  const sessions = listSessions();
  return sessions.length > 0 ? sessions[0].id : null;
}

function pruneOldSessions(dir: string): void {
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith(SESSION_FILE_EXT))
      .sort()
      .reverse();

    for (const file of files.slice(MAX_SESSIONS)) {
      fs.unlinkSync(path.join(dir, file));
    }
  } catch {
    // Non-blocking
  }
}
