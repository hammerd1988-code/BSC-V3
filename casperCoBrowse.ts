// Casper Co-Browse — real-time shared browser control via Socket.IO.
//
// The server captures periodic screenshots of a user's Playwright page
// and streams them as base64 data URIs directly over the socket (no
// Storage upload per frame). The client can send mouse/keyboard events
// back, creating a shared-control experience.
//
// Security: the session owner is proved by a Supabase access token on
// `cobrowse:start` and cached on the socket. The `userId` field a client
// sends is never trusted — it used to be, and "first call wins" binding
// meant any anonymous socket could claim another account's id and then
// drive that user's browser and receive screenshots of their pages.

import type { Server as SocketServer, Socket } from 'socket.io';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCasperAuthFromToken } from './casperControlCenter.js';
import { socketErrorBoundary } from './serverSecurity.js';
import {
  browserNavigate,
  browserGoBack,
  browserListPages,
  getCoBrowsePage,
} from './casperBrowser.js';

const STREAM_FPS = 3;
const STREAM_INTERVAL_MS = Math.round(1000 / STREAM_FPS);
const SCREENSHOT_QUALITY = 60; // lower quality for streaming (fast)

interface CoBrowseSession {
  userId: string;
  pageId: string;
  controller: 'user' | 'casper';
  streaming: boolean;
  intervalHandle: ReturnType<typeof setInterval> | null;
  socketId: string;
}

const activeSessions = new Map<string, CoBrowseSession>();

// Capture a raw JPEG screenshot and emit as a base64 data URI — no
// Supabase Storage upload, so we don't create thousands of orphaned files.
async function captureAndEmit(
  socket: Socket,
  session: CoBrowseSession,
): Promise<void> {
  if (!session.streaming) return;
  try {
    const page = getCoBrowsePage(session.userId, session.pageId);
    if (!page) return;
    const buf = await page.screenshot({ type: 'jpeg', quality: SCREENSHOT_QUALITY, fullPage: false });
    const base64 = `data:image/jpeg;base64,${(buf as Buffer).toString('base64')}`;
    const title = await page.title();
    const url = page.url();
    socket.emit('cobrowse:frame', {
      pageId: session.pageId,
      url,
      title,
      screenshotUrl: base64,
      controller: session.controller,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.warn('[cobrowse] Frame capture failed:', err);
  }
}

/**
 * The co-browse owner for this socket.
 *
 * Either proved on `cobrowse:start` by a Supabase access token, or inherited
 * from the `user:register` handshake in server.ts, which verifies the same
 * token before stashing the resolved profile id on `socket.data.userId`.
 */
function getSocketUserId(socket: Socket): string | undefined {
  const data = socket.data as { cobrowseUserId?: string; userId?: string };
  return data?.cobrowseUserId || data?.userId || undefined;
}

function setSocketUserId(socket: Socket, userId: string): void {
  (socket.data as Record<string, unknown>).cobrowseUserId = userId;
}

/** The verified owner, or null when this socket has never proved an identity. */
function sessionOwner(socket: Socket): string | null {
  return getSocketUserId(socket) ?? null;
}

export function registerCoBrowseSocket(io: SocketServer, supabase: SupabaseClient): void {
  io.on('connection', (socket: Socket) => {
    // Socket.IO does not catch listener exceptions, so an unexpected payload
    // shape would otherwise take the process down.
    const on = socketErrorBoundary(socket, 'cobrowse');

    on('cobrowse:start', async (data: { userId?: string; url?: string; pageId?: string; token?: string }) => {
      const url = data?.url;
      if (!url) {
        socket.emit('cobrowse:error', { error: 'url is required.' });
        return;
      }
      const pageId = data?.pageId;

      // Identity comes from the token, or from a socket that already registered
      // with server.ts. It never comes from data.userId.
      let userId = sessionOwner(socket);
      if (!userId && typeof data?.token === 'string' && data.token) {
        const auth = await resolveCasperAuthFromToken(data.token, supabase);
        if (auth.ok && auth.profile) {
          userId = auth.profile.id;
          setSocketUserId(socket, userId);
        }
      }
      if (!userId) {
        socket.emit('cobrowse:error', { error: 'Sign in again — this socket has no verified session.' });
        return;
      }

      // Clean up any existing session for this user
      const existing = activeSessions.get(userId);
      if (existing?.intervalHandle) {
        clearInterval(existing.intervalHandle);
      }

      try {
        const navResult = await browserNavigate(url, supabase, userId, {
          pageId,
          waitUntil: 'domcontentloaded',
          screenshot: true,
        });

        if (!navResult.ok) {
          socket.emit('cobrowse:error', { error: navResult.error || 'Navigation failed.' });
          return;
        }

        const session: CoBrowseSession = {
          userId,
          pageId: navResult.pageId,
          controller: 'user',
          streaming: true,
          intervalHandle: null,
          socketId: socket.id,
        };

        // Send the initial frame (this one comes from browserNavigate which
        // uploads to Storage — fine for the first frame)
        socket.emit('cobrowse:started', {
          pageId: navResult.pageId,
          url: navResult.url,
          title: navResult.title,
          screenshotUrl: navResult.screenshotUrl,
          controller: 'user',
        });

        // Start streaming loop (uses raw base64, no Storage upload)
        session.intervalHandle = setInterval(() => {
          void captureAndEmit(socket, session);
        }, STREAM_INTERVAL_MS);

        activeSessions.set(userId, session);
      } catch (err: any) {
        socket.emit('cobrowse:error', { error: err?.message || 'Failed to start co-browse session.' });
      }
    });

    // Stop streaming
    on('cobrowse:stop', () => {
      const userId = sessionOwner(socket);
      if (!userId) return;
      const session = activeSessions.get(userId);
      if (session) {
        session.streaming = false;
        if (session.intervalHandle) clearInterval(session.intervalHandle);
        activeSessions.delete(userId);
        socket.emit('cobrowse:stopped', { pageId: session.pageId });
      }
    });

    // Navigate to a new URL within an active session
    on('cobrowse:navigate', async (data: { url?: string }) => {
      const userId = sessionOwner(socket);
      if (!userId) return;
      const session = activeSessions.get(userId);
      if (!session) {
        socket.emit('cobrowse:error', { error: 'No active co-browse session.' });
        return;
      }
      if (!data?.url) {
        socket.emit('cobrowse:error', { error: 'url is required.' });
        return;
      }
      try {
        const result = await browserNavigate(data.url, supabase, userId, {
          pageId: session.pageId,
          waitUntil: 'domcontentloaded',
          screenshot: true,
        });
        if (result.ok) {
          socket.emit('cobrowse:navigated', {
            pageId: session.pageId,
            url: result.url,
            title: result.title,
            screenshotUrl: result.screenshotUrl,
          });
        } else {
          socket.emit('cobrowse:error', { error: result.error || 'Navigation failed.' });
        }
      } catch (err: any) {
        socket.emit('cobrowse:error', { error: err?.message || 'Navigation failed.' });
      }
    });

    // User clicks an element by viewport coordinates
    on('cobrowse:click', async (data: { x?: number; y?: number }) => {
      const userId = sessionOwner(socket);
      if (!userId) return;
      const session = activeSessions.get(userId);
      if (!session || session.controller !== 'user') return;
      // Non-finite coordinates reach Playwright as NaN and reject the action.
      const x = Number(data?.x);
      const y = Number(data?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      try {
        const page = getCoBrowsePage(userId, session.pageId);
        if (page) {
          await page.mouse.click(x, y);
          await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
          socket.emit('cobrowse:action_ack', { action: 'click', x, y });
        }
      } catch (err: any) {
        socket.emit('cobrowse:error', { error: err?.message || 'Click failed.' });
      }
    });

    // User types text or presses a key
    on('cobrowse:type', async (data: { text?: string; key?: string }) => {
      const userId = sessionOwner(socket);
      if (!userId) return;
      const session = activeSessions.get(userId);
      if (!session || session.controller !== 'user') return;
      try {
        const page = getCoBrowsePage(userId, session.pageId);
        if (page) {
          if (data?.key) {
            await page.keyboard.press(String(data.key));
          } else if (data?.text) {
            await page.keyboard.type(String(data.text), { delay: 30 });
          }
          socket.emit('cobrowse:action_ack', { action: 'type', text: data?.text || data?.key });
        }
      } catch (err: any) {
        socket.emit('cobrowse:error', { error: err?.message || 'Type failed.' });
      }
    });

    // Scroll
    on('cobrowse:scroll', async (data: { deltaX?: number; deltaY?: number }) => {
      const userId = sessionOwner(socket);
      if (!userId) return;
      const session = activeSessions.get(userId);
      if (!session || session.controller !== 'user') return;
      const deltaX = Number(data?.deltaX);
      const deltaY = Number(data?.deltaY);
      if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
      try {
        const page = getCoBrowsePage(userId, session.pageId);
        if (page) {
          await page.mouse.wheel(deltaX, deltaY);
        }
      } catch { /* best effort */ }
    });

    // Go back
    on('cobrowse:back', async () => {
      const userId = sessionOwner(socket);
      if (!userId) return;
      const session = activeSessions.get(userId);
      if (!session) return;
      try {
        await browserGoBack(supabase, userId, { pageId: session.pageId, screenshot: false });
        socket.emit('cobrowse:action_ack', { action: 'back' });
      } catch (err: any) {
        socket.emit('cobrowse:error', { error: err?.message || 'Go back failed.' });
      }
    });

    // Hand off control between user and Casper
    on('cobrowse:handoff', (data: { controller?: 'user' | 'casper' }) => {
      const userId = sessionOwner(socket);
      if (!userId) return;
      const controller = data?.controller === 'casper' ? 'casper' : 'user';
      const session = activeSessions.get(userId);
      if (session) {
        session.controller = controller;
        socket.emit('cobrowse:controller_changed', { controller });
      }
    });

    // List open tabs for this user
    on('cobrowse:list_tabs', async () => {
      const userId = sessionOwner(socket);
      if (!userId) return;
      try {
        const tabs = await browserListPages(userId);
        socket.emit('cobrowse:tabs', { tabs });
      } catch (err: any) {
        socket.emit('cobrowse:error', { error: err?.message || 'Failed to list tabs.' });
      }
    });

    // Switch to a different tab
    on('cobrowse:switch_tab', async (data: { pageId?: string }) => {
      const userId = sessionOwner(socket);
      if (!userId) return;
      const session = activeSessions.get(userId);
      if (!session || !data?.pageId) return;
      session.pageId = String(data.pageId);
      // Immediate frame via base64
      const page = getCoBrowsePage(userId, session.pageId);
      if (page) {
        try {
          const buf = await page.screenshot({ type: 'jpeg', quality: SCREENSHOT_QUALITY, fullPage: false });
          const base64 = `data:image/jpeg;base64,${(buf as Buffer).toString('base64')}`;
          socket.emit('cobrowse:frame', {
            pageId: session.pageId,
            url: page.url(),
            title: await page.title(),
            screenshotUrl: base64,
            controller: session.controller,
            timestamp: Date.now(),
          });
        } catch { /* next interval will catch it */ }
      }
    });

    // Cleanup on disconnect
    on('disconnect', () => {
      for (const [userId, session] of activeSessions) {
        if (session.socketId === socket.id) {
          session.streaming = false;
          if (session.intervalHandle) clearInterval(session.intervalHandle);
          activeSessions.delete(userId);
        }
      }
    });
  });
}
