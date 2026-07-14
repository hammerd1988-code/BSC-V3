import chalk from 'chalk';
import { casperApi } from './api.js';

export interface MemoryRecord {
  id: string;
  user_id: string | null;
  memory_type: string;
  content: string;
  importance: number;
  tags?: string[];
  context?: Record<string, unknown> | null;
  session_id?: string | null;
  pinned?: boolean;
  created_at: string;
  last_accessed?: string;
  access_count?: number;
}

export interface MemoryContext {
  contextNote: string;
  stateModifier: string;
  relevantMemories: string;
}

export async function fetchMemoryContext(): Promise<MemoryContext | null> {
  try {
    const res = await casperApi<{ success: boolean; contextNote?: string; stateModifier?: string; relevantMemories?: string }>('/api/casper/memory-context');
    if (!res.success) return null;
    return {
      contextNote: res.contextNote || '',
      stateModifier: res.stateModifier || '',
      relevantMemories: res.relevantMemories || '',
    };
  } catch {
    // Silently skip if the relay is unreachable or unauthenticated.
    return null;
  }
}

export interface ListMemoriesResponse {
  success: boolean;
  memories: MemoryRecord[];
  total: number;
  offset: number;
  limit: number;
}

export async function listMemories(opts: { q?: string; type?: string; pinned?: boolean; limit?: number; offset?: number } = {}): Promise<ListMemoriesResponse> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.type) params.set('type', opts.type);
  if (opts.pinned) params.set('pinned', 'true');
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.offset) params.set('offset', String(opts.offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return casperApi<ListMemoriesResponse>(`/api/casper/memories${qs}`);
}

export async function addMemory(fields: {
  content: string;
  memory_type?: string;
  importance?: number;
  tags?: string[];
  pinned?: boolean;
}): Promise<{ success: boolean; memory: MemoryRecord }> {
  return casperApi<{ success: boolean; memory: MemoryRecord }>('/api/casper/memories', {
    method: 'POST',
    body: JSON.stringify(fields),
  });
}

export async function getMemory(id: string): Promise<{ success: boolean; memory: MemoryRecord }> {
  return casperApi<{ success: boolean; memory: MemoryRecord }>(`/api/casper/memories/${id}`);
}

export async function updateMemory(id: string, fields: Partial<Pick<MemoryRecord, 'content' | 'importance' | 'tags' | 'pinned'>>): Promise<{ success: boolean; memory: MemoryRecord }> {
  return casperApi<{ success: boolean; memory: MemoryRecord }>(`/api/casper/memories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export async function deleteMemory(id: string): Promise<{ success: boolean }> {
  return casperApi<{ success: boolean }>(`/api/casper/memories/${id}`, { method: 'DELETE' });
}

export async function bulkDeleteMemories(ids: string[]): Promise<{ success: boolean; deleted: number }> {
  return casperApi<{ success: boolean; deleted: number }>('/api/casper/memories/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export async function setContextNote(content: string): Promise<{ success: boolean; contextNote: string }> {
  return casperApi<{ success: boolean; contextNote: string }>('/api/casper/user/context-note', {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

// Format a single memory for terminal output.
export function formatMemory(memory: MemoryRecord): string {
  const pinned = memory.pinned ? ' ' + chalk.yellow('📌') : '';
  const type = chalk.cyan(memory.memory_type);
  const importance = chalk.dim(`importance ${memory.importance}/10`);
  const tags = (memory.tags && memory.tags.length > 0) ? chalk.dim(`tags: ${memory.tags.join(', ')}`) : '';
  const header = `[${type}] ${importance}${pinned}`;
  const lines = [
    `${chalk.magenta(memory.id)}  ${header}`,
    `  ${memory.content}`,
  ];
  if (tags) lines.push(`  ${tags}`);
  return lines.join('\n');
}

export function formatMemoryContext(ctx: MemoryContext): string {
  const parts: string[] = [];
  if (ctx.contextNote) {
    parts.push(`--- PERMANENT USER CONTEXT NOTE ---\n${ctx.contextNote}`);
  }
  if (ctx.relevantMemories) {
    parts.push(`--- RELEVANT MEMORIES ---\n${ctx.relevantMemories}`);
  }
  if (ctx.stateModifier) {
    parts.push(`--- LIVE STATE ---\n${ctx.stateModifier}`);
  }
  return parts.join('\n\n');
}
