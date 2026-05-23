import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Globe, ArrowLeft, ArrowRight, RefreshCw, X, Maximize2, Minimize2,
  MousePointer2, Keyboard, Monitor, Ghost, User, Loader2, ExternalLink,
} from 'lucide-react';
import { socket } from '../lib/socket';
import { cn } from '../lib/utils';

interface CoBrowseFrame {
  pageId: string;
  url: string;
  title: string;
  screenshotUrl: string;
  controller: 'user' | 'casper';
  timestamp: number;
}

interface CoBrowseProps {
  userId: string;
  onClose: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;

export const CasperCoBrowse: React.FC<CoBrowseProps> = ({
  userId,
  onClose,
  isExpanded,
  onToggleExpand,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [currentFrame, setCurrentFrame] = useState<CoBrowseFrame | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [controller, setController] = useState<'user' | 'casper'>('user');
  const [error, setError] = useState<string | null>(null);
  const [showUrlBar, setShowUrlBar] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Socket event listeners
  useEffect(() => {
    if (!socket.connected) socket.connect();

    const onStarted = (data: CoBrowseFrame) => {
      setCurrentFrame(data);
      setIsActive(true);
      setIsConnecting(false);
      setController(data.controller);
      setError(null);
    };

    const onFrame = (data: CoBrowseFrame) => {
      setCurrentFrame(data);
      if (data.controller) setController(data.controller);
    };

    const onNavigated = (data: Partial<CoBrowseFrame>) => {
      setCurrentFrame(prev => prev ? { ...prev, ...data, timestamp: Date.now() } : null);
    };

    const onControllerChanged = (data: { controller: 'user' | 'casper' }) => {
      setController(data.controller);
    };

    const onStopped = () => {
      setIsActive(false);
      setCurrentFrame(null);
      setController('user');
    };

    const onError = (data: { error: string }) => {
      setError(data.error);
      setIsConnecting(false);
      setTimeout(() => setError(null), 5000);
    };

    socket.on('cobrowse:started', onStarted);
    socket.on('cobrowse:frame', onFrame);
    socket.on('cobrowse:navigated', onNavigated);
    socket.on('cobrowse:controller_changed', onControllerChanged);
    socket.on('cobrowse:stopped', onStopped);
    socket.on('cobrowse:error', onError);

    return () => {
      socket.off('cobrowse:started', onStarted);
      socket.off('cobrowse:frame', onFrame);
      socket.off('cobrowse:navigated', onNavigated);
      socket.off('cobrowse:controller_changed', onControllerChanged);
      socket.off('cobrowse:stopped', onStopped);
      socket.off('cobrowse:error', onError);
    };
  }, []);

  const startSession = useCallback((url: string) => {
    if (!url.trim()) return;
    let fullUrl = url.trim();
    if (!/^https?:\/\//i.test(fullUrl)) fullUrl = `https://${fullUrl}`;
    setIsConnecting(true);
    setError(null);
    socket.emit('cobrowse:start', { userId, url: fullUrl });
  }, [userId]);

  const stopSession = useCallback(() => {
    socket.emit('cobrowse:stop', { userId });
    setIsActive(false);
    setCurrentFrame(null);
  }, [userId]);

  const navigateTo = useCallback((url: string) => {
    if (!url.trim()) return;
    let fullUrl = url.trim();
    if (!/^https?:\/\//i.test(fullUrl)) fullUrl = `https://${fullUrl}`;
    socket.emit('cobrowse:navigate', { userId, url: fullUrl });
  }, [userId]);

  const goBack = useCallback(() => {
    socket.emit('cobrowse:back', { userId });
  }, [userId]);

  const handleViewportClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isActive || controller !== 'user' || !viewportRef.current || !imgRef.current) return;
    // Account for object-contain letterboxing: compute the actual rendered
    // image area within the container, then map click coords to that.
    const containerRect = viewportRef.current.getBoundingClientRect();
    const imgNaturalW = VIEWPORT_WIDTH;
    const imgNaturalH = VIEWPORT_HEIGHT;
    const containerW = containerRect.width;
    const containerH = containerRect.height;
    const scaleToFit = Math.min(containerW / imgNaturalW, containerH / imgNaturalH);
    const renderedW = imgNaturalW * scaleToFit;
    const renderedH = imgNaturalH * scaleToFit;
    const offsetX = (containerW - renderedW) / 2;
    const offsetY = (containerH - renderedH) / 2;
    const relX = e.clientX - containerRect.left - offsetX;
    const relY = e.clientY - containerRect.top - offsetY;
    if (relX < 0 || relY < 0 || relX > renderedW || relY > renderedH) return;
    const x = Math.round((relX / renderedW) * imgNaturalW);
    const y = Math.round((relY / renderedH) * imgNaturalH);
    socket.emit('cobrowse:click', { userId, x, y });
  }, [isActive, controller, userId]);

  const handleViewportScroll = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!isActive || controller !== 'user') return;
    e.preventDefault();
    socket.emit('cobrowse:scroll', { userId, deltaX: e.deltaX, deltaY: e.deltaY });
  }, [isActive, controller, userId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isActive || controller !== 'user') return;
    // Don't capture keys when typing in the URL bar
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    e.preventDefault();
    if (e.key.length === 1) {
      socket.emit('cobrowse:type', { userId, text: e.key });
    } else {
      socket.emit('cobrowse:type', { userId, key: e.key });
    }
  }, [isActive, controller, userId]);

  const toggleController = useCallback(() => {
    const next = controller === 'user' ? 'casper' : 'user';
    socket.emit('cobrowse:handoff', { userId, controller: next });
    setController(next);
  }, [controller, userId]);

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isActive) {
      navigateTo(urlInput);
    } else {
      startSession(urlInput);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className={cn(
        "flex flex-col overflow-hidden border backdrop-blur-2xl transition-all duration-300",
        isExpanded
          ? "fixed inset-4 z-50 rounded-2xl border-cyan-500/30 bg-[#030308]/95 shadow-[0_0_60px_rgba(0,229,255,0.15)]"
          : "relative rounded-2xl border-white/10 bg-black/60"
      )}
    >
      {/* Scanline overlay for cyberpunk feel */}
      <div className="pointer-events-none absolute inset-0 z-10 bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(0,229,255,0.02)_2px,rgba(0,229,255,0.02)_4px)]" />

      {/* Header / Chrome Bar */}
      <div className="relative z-20 flex items-center gap-2 border-b border-white/10 bg-black/80 px-3 py-2">
        {/* Window controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => { stopSession(); onClose(); }}
            className="h-3 w-3 rounded-full bg-red-500/80 hover:bg-red-400 transition-colors"
            title="Close"
          />
          <button
            onClick={onToggleExpand}
            className="h-3 w-3 rounded-full bg-yellow-500/80 hover:bg-yellow-400 transition-colors"
            title={isExpanded ? 'Minimize' : 'Maximize'}
          />
          <button
            onClick={onToggleExpand}
            className="h-3 w-3 rounded-full bg-green-500/80 hover:bg-green-400 transition-colors"
            title={isExpanded ? 'Minimize' : 'Maximize'}
          />
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={goBack}
            disabled={!isActive}
            className="rounded-lg p-1.5 text-zinc-500 hover:text-white hover:bg-white/5 transition-all disabled:opacity-30"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            disabled={!isActive}
            className="rounded-lg p-1.5 text-zinc-500 hover:text-white hover:bg-white/5 transition-all disabled:opacity-30"
            onClick={() => currentFrame?.url && navigateTo(currentFrame.url)}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* URL bar */}
        <form onSubmit={handleUrlSubmit} className="flex-1 mx-2">
          <div className="relative">
            <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cyan-400/50" />
            <input
              type="text"
              value={urlInput || (currentFrame?.url ?? '')}
              onChange={(e) => setUrlInput(e.target.value)}
              onFocus={() => setUrlInput(currentFrame?.url ?? urlInput)}
              placeholder="Enter URL — navigate the grid..."
              className="w-full rounded-lg border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-zinc-600 outline-none focus:border-cyan-500/40 transition-colors font-mono"
            />
            {isConnecting && (
              <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cyan-400 animate-spin" />
            )}
          </div>
        </form>

        {/* Control indicator + handoff */}
        <button
          onClick={toggleController}
          disabled={!isActive}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-30",
            controller === 'user'
              ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
              : "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-300"
          )}
          title={`${controller === 'user' ? 'You' : 'Casper'} in control — click to hand off`}
        >
          {controller === 'user' ? (
            <><User className="w-3 h-3" /> You</>
          ) : (
            <><Ghost className="w-3 h-3" /> Casper</>
          )}
        </button>

        {/* Expand/Collapse */}
        <button
          onClick={onToggleExpand}
          className="rounded-lg p-1.5 text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
        >
          {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Page title bar */}
      {currentFrame?.title && (
        <div className="relative z-20 flex items-center gap-2 border-b border-white/5 bg-black/40 px-4 py-1">
          <Monitor className="w-3 h-3 text-cyan-400/40" />
          <span className="truncate text-[10px] text-zinc-500 font-mono">{currentFrame.title}</span>
          <a
            href={currentFrame.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-zinc-600 hover:text-cyan-400 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {/* Viewport */}
      <div
        ref={viewportRef}
        className={cn(
          "relative flex-1 overflow-hidden cursor-crosshair",
          !isActive && "flex items-center justify-center",
          isExpanded ? "min-h-0" : "min-h-[400px]"
        )}
        onClick={isActive ? handleViewportClick : undefined}
        onWheel={isActive ? handleViewportScroll : undefined}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {currentFrame?.screenshotUrl ? (
          <img
            ref={imgRef}
            src={currentFrame.screenshotUrl}
            alt="Browser viewport"
            className="h-full w-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="flex flex-col items-center gap-6 px-8 py-12 text-center">
            <div className="relative">
              <div className="absolute -inset-8 rounded-full bg-cyan-500/5 animate-pulse" />
              <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/5">
                <Globe className="w-10 h-10 text-cyan-400/60" />
              </div>
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-[0.2em] text-white mb-2">
                Ghost Browser
              </h3>
              <p className="text-xs text-zinc-500 max-w-xs leading-relaxed">
                Enter a URL above to start co-browsing with Casper.
                You can take turns navigating — click, scroll, and type while
                Casper watches, or hand off control and let him drive.
              </p>
            </div>
            <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-widest text-zinc-600">
              <span className="flex items-center gap-1.5">
                <MousePointer2 className="w-3 h-3" /> Click
              </span>
              <span className="flex items-center gap-1.5">
                <Keyboard className="w-3 h-3" /> Type
              </span>
              <span className="flex items-center gap-1.5">
                <Monitor className="w-3 h-3" /> Scroll
              </span>
            </div>
          </div>
        )}

        {/* Click ripple overlay */}
        {isActive && (
          <div className="pointer-events-none absolute inset-0 z-20">
            {/* Subtle grid overlay */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(0,229,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,229,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] opacity-0 hover:opacity-100 transition-opacity" />
          </div>
        )}

        {/* Loading overlay */}
        {isConnecting && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
              <span className="text-xs font-black uppercase tracking-widest text-cyan-300">
                Initializing Ghost Browser...
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Error toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-4 left-4 right-4 z-40 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300 backdrop-blur-lg"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status bar */}
      <div className="relative z-20 flex items-center justify-between border-t border-white/5 bg-black/60 px-4 py-1.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className={cn(
              "h-1.5 w-1.5 rounded-full shadow-[0_0_6px]",
              isActive ? "bg-green-400 shadow-green-400/80 animate-pulse" : "bg-zinc-600 shadow-zinc-600/40"
            )} />
            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
              {isActive ? 'Co-Browse Active' : 'Disconnected'}
            </span>
          </div>
          {isActive && (
            <span className="text-[9px] font-mono text-zinc-600 truncate max-w-[200px]">
              {currentFrame?.url}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {isActive && (
            <button
              onClick={stopSession}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-red-300 transition-all hover:bg-red-500/20"
            >
              End Session
            </button>
          )}
          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-700">
            Ghost Browser v1.0
          </span>
        </div>
      </div>
    </motion.div>
  );
};
