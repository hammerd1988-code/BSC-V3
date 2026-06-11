import fs from 'fs';
import { getAuditLogPath, getConfig } from '../config.js';

/**
 * Append an audit entry to the history log (JSONL format).
 */
export function audit(action: string, details: Record<string, unknown>): void {
  if (!getConfig('auditLog')) return;

  const entry = {
    ts: new Date().toISOString(),
    action,
    ...details,
  };

  try {
    const logPath = getAuditLogPath();
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch {
    // Non-blocking — don't crash if log write fails
  }
}
