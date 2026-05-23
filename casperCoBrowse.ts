// Casper Co-Browse — real-time shared browser control via Socket.IO.
//
// The server captures periodic screenshots of a user's Playwright page
// and streams them to the client. The client can send mouse/keyboard
// events back, creating a shared-control experience.

import type { Server as SocketServer, Socket } from 'socket.io';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  browserNavigate,
  browserScreenshot,
  browserGoBack,
  browserListPages,
  getCoBrowsePage,
} from './casperBrowser.js';

const STREAM_FPS = 3;
const STREAM_INTERVAL_MS = Math.round(1000 / STREAM_FPS);

interface CoBrowseSession {
  userId: string;
  pageId: string;
  controller: 'user' | 'casper';
  streaming: boolean;
  intervalHandle: ReturnType<typeof setInterval> | null;
  socketId: string;
}

const activeSessions = new Map<string, CoBrowseSession>();

async function captureAndEmit(
  socket: Socket,
  supabase: SupabaseClient,
  session: CoBrowseSession,
): Promise<void> {
  if (!session.streaming) return;
  try {
    const result = await browserScreenshot(supabase, session.userId, {
      pageId: session.pageId,
      fullPage: false,
    });
    if (result.ok && result.screenshotUrl) {
      socket.emit('cobrowse:frame', {
        pageId: session.pageId,
        url: result.url,
        title: result.title,
        screenshotUrl: result.screenshotUrl,
        controller: session.controller,
        timestamp: Date.now(),
      });
    }
  } catch (err) {
    console.warn('[cobrowse] Frame capture failed:', err);
  }
}

export function registerCoBrowseSocket(io: SocketServer, supabase: SupabaseClient): void {
  io.on('connection', (socket: Socket) => {
    // Start a co-browse session: navigate to URL and begin streaming.
    socket.on('cobrowse:start', async (data: { userId: string; url: string; pageId?: string }) => {
      const { userId, url, pageId } = data;
      if (!userId || !url) {
        socket.emit('cobrowse:error', { error: 'userId and url are required.' });
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

        // Send the initial frame immediately
        socket.emit('cobrowse:started', {
          pageId: navResult.pageId,
          url: navResult.url,
          title: navResult.title,
          screenshotUrl: navResult.screenshotUrl,
          controller: 'user',
        });

        // Start streaming loop
        session.intervalHandle = setInterval(() => {
          void captureAndEmit(socket, supabase, session);
        }, STREAM_INTERVAL_MS);

        activeSessions.set(userId, session);
      } catch (err: any) {
        socket.emit('cobrowse:error', { error: err?.message || 'Failed to start co-browse session.' });
      }
    });

    // Stop streaming
    socket.on('cobrowse:stop', (data: { userId: string }) => {
      const session = activeSessions.get(data.userId);
      if (session) {
        session.streaming = false;
        if (session.intervalHandle) clearInterval(session.intervalHandle);
        activeSessions.delete(data.userId);
        socket.emit('cobrowse:stopped', { pageId: session.pageId });
      }
    });

    // Navigate to a new URL within an active session
    socket.on('cobrowse:navigate', async (data: { userId: string; url: string }) => {
      const session = activeSessions.get(data.userId);
      if (!session) {
        socket.emit('cobrowse:error', { error: 'No active co-browse session.' });
        return;
      }
      try {
        const result = await browserNavigate(data.url, supabase, data.userId, {
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
    socket.on('cobrowse:click', async (data: { userId: string; x: number; y: number }) => {
      const session = activeSessions.get(data.userId);
      if (!session) return;
      try {
        const page = getCoBrowsePage(data.userId, session.pageId);
        if (page) {
          await page.mouse.click(data.x, data.y);
          await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
          socket.emit('cobrowse:action_ack', { action: 'click', x: data.x, y: data.y });
        }
      } catch (err: any) {
        socket.emit('cobrowse:error', { error: err?.message || 'Click failed.' });
      }
    });

    // User types text or presses a key
    socket.on('cobrowse:type', async (data: { userId: string; text: string; key?: string }) => {
      const session = activeSessions.get(data.userId);
      if (!session) return;
      try {
        const page = getCoBrowsePage(data.userId, session.pageId);
        if (page) {
          if (data.key) {
            await page.keyboard.press(data.key);
          } else if (data.text) {
            await page.keyboard.type(data.text, { delay: 30 });
          }
          socket.emit('cobrowse:action_ack', { action: 'type', text: data.text || data.key });
        }
      } catch (err: any) {
        socket.emit('cobrowse:error', { error: err?.message || 'Type failed.' });
      }
    });

    // Scroll
    socket.on('cobrowse:scroll', async (data: { userId: string; deltaX: number; deltaY: number }) => {
      const session = activeSessions.get(data.userId);
      if (!session) return;
      try {
        const page = getCoBrowsePage(data.userId, session.pageId);
        if (page) {
          await page.mouse.wheel(data.deltaX, data.deltaY);
        }
      } catch { /* best effort */ }
    });

    // Go back
    socket.on('cobrowse:back', async (data: { userId: string }) => {
      const session = activeSessions.get(data.userId);
      if (!session) return;
      try {
        await browserGoBack(supabase, data.userId, { pageId: session.pageId, screenshot: false });
        socket.emit('cobrowse:action_ack', { action: 'back' });
      } catch (err: any) {
        socket.emit('cobrowse:error', { error: err?.message || 'Go back failed.' });
      }
    });

    // Hand off control between user and Casper
    socket.on('cobrowse:handoff', (data: { userId: string; controller: 'user' | 'casper' }) => {
      const session = activeSessions.get(data.userId);
      if (session) {
        session.controller = data.controller;
        socket.emit('cobrowse:controller_changed', { controller: data.controller });
      }
    });

    // List open tabs for this user
    socket.on('cobrowse:list_tabs', async (data: { userId: string }) => {
      try {
        const tabs = await browserListPages(data.userId);
        socket.emit('cobrowse:tabs', { tabs });
      } catch (err: any) {
        socket.emit('cobrowse:error', { error: err?.message || 'Failed to list tabs.' });
      }
    });

    // Switch to a different tab
    socket.on('cobrowse:switch_tab', async (data: { userId: string; pageId: string }) => {
      const session = activeSessions.get(data.userId);
      if (session) {
        session.pageId = data.pageId;
        // Take immediate screenshot of new tab
        const result = await browserScreenshot(supabase, data.userId, { pageId: data.pageId });
        if (result.ok) {
          socket.emit('cobrowse:frame', {
            pageId: data.pageId,
            url: result.url,
            title: result.title,
            screenshotUrl: result.screenshotUrl,
            controller: session.controller,
            timestamp: Date.now(),
          });
        }
      }
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
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


