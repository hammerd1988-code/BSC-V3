import { getConfig } from '../config.js';
import readline from 'readline';

// Patterns that require confirmation before execution
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[a-z]*f|-[a-z]*r|--force|--recursive)/i,
  /\bgit\s+push\s+.*--force/i,
  /\bgit\s+reset\s+--hard/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bformat\b/i,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bsudo\s+rm\b/,
];

/**
 * Check if a command is considered destructive and needs approval.
 */
export function isDestructive(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some(pattern => pattern.test(command));
}

/**
 * Prompt the user for confirmation. Returns true if approved.
 */
export async function confirmAction(description: string): Promise<boolean> {
  const level = getConfig('approvalLevel');
  if (level === 'auto') return true;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(`\n⚠️  ${description}\n   Approve? [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}
