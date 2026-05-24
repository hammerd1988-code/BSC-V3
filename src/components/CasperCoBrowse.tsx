import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Globe, ArrowLeft, RefreshCw, Maximize2, Minimize2,
  MousePointer2, Keyboard, Monitor, Ghost, User, Loader2, ExternalLink,
  MessageSquare, Send, Mic, MicOff, Volume2, VolumeX, X,
} from 'lucide-react';
import { socket } from '../lib/socket';
import { cn } from '../lib/utils';
import { sendCasperCommand, type CasperToolCall } from '../lib/casper';

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

interface ChatTurn {
  role: 'user' | 'casper';
  text: string;
  ts: number;
  pending?: boolean;
  error?: boolean;
  toolCalls?: CasperToolCall[];
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Chat panel state
  const [chatOpen, setChatOpen] = useState(true);
  const [chatDraft, setChatDraft] = useState('');
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Voice input
  const [listening, setListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const hasSpeechSupport = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  // TTS
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null);
  const persistentAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);

  // Greeting
  useEffect(() => {
    if (chatTurns.length === 0) {
      setChatTurns([{
        role: 'casper',
        ts: Date.now(),
        text: "Ghost Browser active. Tell me where to go or what to look for — I'm watching the viewport with you.",
      }]);
    }
  }, [chatTurns.length]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatTurns.length, chatBusy]);

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
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
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

  // TTS helpers
  const stopTts = useCallback(() => {
    const audio = persistentAudioRef.current ?? ttsAudioRef.current;
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    ttsAudioRef.current = null;
    if (ttsUrlRef.current) { URL.revokeObjectURL(ttsUrlRef.current); ttsUrlRef.current = null; }
  }, []);

  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    if (!persistentAudioRef.current) { persistentAudioRef.current = new Audio(); persistentAudioRef.current.volume = 1; }
    persistentAudioRef.current.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
    persistentAudioRef.current.play().catch(() => {});
    audioUnlockedRef.current = true;
  }, []);

  const speakText = useCallback(async (text: string) => {
    stopTts();
    try {
      const serverUrl = import.meta.env.VITE_APP_URL || window.location.origin;
      const res = await fetch(`${serverUrl}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 4096), speed: 1.05 }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      ttsUrlRef.current = url;
      const audio = persistentAudioRef.current ?? new Audio();
      ttsAudioRef.current = audio;
      audio.onended = () => { stopTts(); };
      audio.onerror = () => { stopTts(); };
      audio.src = url;
      await audio.play();
    } catch { /* TTS unavailable */ }
  }, [stopTts]);

  useEffect(() => () => { stopTts(); persistentAudioRef.current = null; audioUnlockedRef.current = false; }, [stopTts]);

  // Voice input
  const toggleListening = useCallback(() => {
    if (listening) {
      setVoiceStatus('Decoding...');
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) { setVoiceStatus('Voice not supported'); return; }
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; }

    const baseDraft = chatDraft.trimEnd();
    const recognition = new SpeechRecognitionCtor() as SpeechRecognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    let finalTranscript = '';
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0]?.transcript?.trim() ?? '';
        if (!transcript) continue;
        if (event.results[i].isFinal) {
          finalTranscript = `${finalTranscript ? `${finalTranscript} ` : ''}${transcript}`.trim();
        } else {
          interim = `${interim ? `${interim} ` : ''}${transcript}`.trim();
        }
      }
      const spokenDraft = `${finalTranscript}${finalTranscript && interim ? ' ' : ''}${interim}`.trim();
      setChatDraft(baseDraft && spokenDraft ? `${baseDraft} ${spokenDraft}` : (spokenDraft || baseDraft));
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        setListening(false);
        recognitionRef.current = null;
        setVoiceStatus(finalTranscript.trim() ? 'Voice captured.' : null);
      }
    };
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (recognitionRef.current === recognition) { setListening(false); recognitionRef.current = null; }
      if (event.error === 'no-speech') { setVoiceStatus('No voice detected.'); return; }
      if (event.error === 'not-allowed') { setVoiceStatus('Mic access denied.'); return; }
      setVoiceStatus(`Voice failed: ${event.error}`);
    };

    recognitionRef.current = recognition;
    try {
      setVoiceStatus('Speak now...');
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
      recognitionRef.current = null;
      setVoiceStatus('Unable to start voice input.');
    }
  }, [chatDraft, listening]);

  // Chat send
  const sendChat = useCallback(async () => {
    const text = chatDraft.trim();
    if (!text || chatBusy) return;
    if (ttsEnabled) unlockAudio();
    setChatDraft('');
    setVoiceStatus(null);
    const userTurn: ChatTurn = { role: 'user', text, ts: Date.now() };
    const pendingTurn: ChatTurn = { role: 'casper', text: 'Thinking...', ts: Date.now() + 1, pending: true };
    setChatTurns(prev => [...prev, userTurn, pendingTurn]);
    setChatBusy(true);
    try {
      const browseContext = currentFrame
        ? `[Co-browsing ${currentFrame.url} — "${currentFrame.title || 'untitled'}"]`
        : '[Ghost Browser idle — no page loaded]';
      const result = await sendCasperCommand({
        command: `${browseContext}\n\nUser says: ${text}`,
        surface: 'guide',
        pageContext: { path: '/casper', feature: 'Ghost Browser Co-Browse', description: 'real-time co-browsing with Casper' },
        metadata: { client: 'cobrowse-chat' },
      });
      const casperText = result.response || 'No response.';
      setChatTurns(prev => prev.map(t =>
        t === pendingTurn ? { ...t, text: casperText, pending: false, toolCalls: result.toolCalls?.length ? result.toolCalls : undefined } : t
      ));
      if (ttsEnabled && casperText) void speakText(casperText);
    } catch (err: any) {
      setChatTurns(prev => prev.map(t =>
        t === pendingTurn ? { ...t, text: err?.message || 'Failed.', pending: false, error: true } : t
      ));
    } finally {
      setChatBusy(false);
    }
  }, [chatDraft, chatBusy, currentFrame, ttsEnabled, unlockAudio, speakText]);

  const onChatKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChat(); }
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
          : "relative h-full rounded-2xl border-white/10 bg-black/60"
      )}
    >
      {/* Scanline overlay */}
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

        {/* Navigation */}
        <div className="flex items-center gap-1 ml-2">
          <button onClick={goBack} disabled={!isActive} className="rounded-lg p-1.5 text-zinc-500 hover:text-white hover:bg-white/5 transition-all disabled:opacity-30">
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button disabled={!isActive} className="rounded-lg p-1.5 text-zinc-500 hover:text-white hover:bg-white/5 transition-all disabled:opacity-30" onClick={() => currentFrame?.url && navigateTo(currentFrame.url)}>
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
            {isConnecting && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cyan-400 animate-spin" />}
          </div>
        </form>

        {/* Controller toggle */}
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
          {controller === 'user' ? <><User className="w-3 h-3" /> You</> : <><Ghost className="w-3 h-3" /> Casper</>}
        </button>

        {/* Chat toggle */}
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className={cn(
            "rounded-lg border p-1.5 transition-all",
            chatOpen
              ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
              : "border-white/10 text-zinc-500 hover:text-white hover:bg-white/5"
          )}
          title={chatOpen ? 'Hide chat' : 'Show chat'}
        >
          <MessageSquare className="w-3.5 h-3.5" />
        </button>

        {/* Expand/Collapse */}
        <button onClick={onToggleExpand} className="rounded-lg p-1.5 text-zinc-500 hover:text-white hover:bg-white/5 transition-all">
          {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Page title bar */}
      {currentFrame?.title && (
        <div className="relative z-20 flex items-center gap-2 border-b border-white/5 bg-black/40 px-4 py-1">
          <Monitor className="w-3 h-3 text-cyan-400/40" />
          <span className="truncate text-[10px] text-zinc-500 font-mono">{currentFrame.title}</span>
          <a href={currentFrame.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-zinc-600 hover:text-cyan-400 transition-colors">
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {/* Main content area: viewport + chat sidebar */}
      <div className="relative z-20 flex flex-1 min-h-0 overflow-hidden">
        {/* Viewport */}
        <div
          ref={viewportRef}
          className={cn(
            "relative flex-1 overflow-hidden cursor-crosshair",
            !isActive && "flex items-center justify-center",
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
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-white mb-2">Ghost Browser</h3>
                <p className="text-xs text-zinc-500 max-w-xs leading-relaxed">
                  Enter a URL above to start co-browsing with Casper.
                  You can take turns navigating — click, scroll, and type while
                  Casper watches, or hand off control and let him drive.
                </p>
              </div>
              <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-widest text-zinc-600">
                <span className="flex items-center gap-1.5"><MousePointer2 className="w-3 h-3" /> Click</span>
                <span className="flex items-center gap-1.5"><Keyboard className="w-3 h-3" /> Type</span>
                <span className="flex items-center gap-1.5"><Monitor className="w-3 h-3" /> Scroll</span>
              </div>
            </div>
          )}

          {isActive && (
            <div className="pointer-events-none absolute inset-0 z-20">
              <div className="absolute inset-0 bg-[linear-gradient(rgba(0,229,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,229,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] opacity-0 hover:opacity-100 transition-opacity" />
            </div>
          )}

          {isConnecting && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
                <span className="text-xs font-black uppercase tracking-widest text-cyan-300">Initializing Ghost Browser...</span>
              </div>
            </div>
          )}
        </div>

        {/* Chat sidebar */}
        <AnimatePresence>
          {chatOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: isExpanded ? 340 : 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              className="flex flex-col border-l border-cyan-500/15 bg-[#060a12]/95 overflow-hidden"
              style={{ minWidth: 0 }}
            >
              {/* Chat header */}
              <div className="flex items-center justify-between border-b border-white/5 bg-black/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Ghost className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300/80">Talk to Casper</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !ttsEnabled;
                      setTtsEnabled(next);
                      if (next) unlockAudio();
                      if (!next) stopTts();
                    }}
                    className={cn(
                      'rounded-full border p-1 transition-colors hover:text-white',
                      ttsEnabled ? 'border-cyan-400/40 text-cyan-300' : 'border-white/10 text-zinc-500',
                    )}
                    title={ttsEnabled ? 'Disable voice' : 'Enable voice'}
                  >
                    {ttsEnabled ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={() => setChatOpen(false)}
                    className="rounded-full border border-white/10 p-1 text-zinc-500 hover:text-white transition-colors"
                    title="Hide chat"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {/* Chat messages */}
              <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2 text-xs scrollbar-hide">
                {chatTurns.map((turn, idx) => (
                  <div
                    key={`${turn.ts}-${idx}`}
                    className={cn('flex gap-1.5', turn.role === 'user' ? 'flex-row-reverse' : 'flex-row')}
                  >
                    {turn.role === 'casper' && (
                      <div className="flex-shrink-0 mt-0.5">
                        <Ghost className="w-4 h-4 text-cyan-400/60" />
                      </div>
                    )}
                    <div
                      className={cn(
                        'rounded-xl border px-2.5 py-1.5 leading-relaxed max-w-[90%]',
                        turn.role === 'user'
                          ? 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-50'
                          : turn.error
                            ? 'border-red-500/30 bg-red-500/10 text-red-100'
                            : 'border-cyan-500/15 bg-white/5 text-cyan-50',
                      )}
                    >
                      {turn.pending ? (
                        <span className="inline-flex items-center gap-1.5 text-cyan-200/70">
                          <Loader2 className="h-3 w-3 animate-spin" /> Thinking...
                        </span>
                      ) : (
                        <span className="whitespace-pre-wrap">{turn.text}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Chat input */}
              <form
                className="border-t border-white/10 bg-black/30 p-2"
                onSubmit={(e) => { e.preventDefault(); void sendChat(); }}
              >
                {voiceStatus && (
                  <div className={cn(
                    'mb-1.5 text-[9px] uppercase tracking-widest px-1',
                    listening ? 'text-red-300' : 'text-cyan-300/80',
                  )}>
                    {voiceStatus}
                  </div>
                )}
                <div className="flex items-end gap-1.5">
                  {hasSpeechSupport && (
                    <button
                      type="button"
                      onClick={toggleListening}
                      className={cn(
                        'rounded-lg border p-2 transition-all flex-shrink-0',
                        listening
                          ? 'border-red-400/60 bg-red-500/20 text-red-300 animate-pulse'
                          : 'border-white/10 bg-white/5 text-zinc-400 hover:text-cyan-300 hover:border-cyan-400/40'
                      )}
                      title={listening ? 'Stop' : 'Speak to Casper'}
                      disabled={chatBusy}
                    >
                      {listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                    </button>
                  )}
                  <textarea
                    value={chatDraft}
                    onChange={(e) => setChatDraft(e.target.value)}
                    onKeyDown={onChatKeyDown}
                    placeholder={listening ? 'Listening...' : 'Talk to Casper...'}
                    rows={1}
                    className={cn(
                      'flex-1 resize-none rounded-lg border bg-black/40 px-2.5 py-2 text-xs text-white placeholder-zinc-600 focus:border-cyan-400/60 focus:outline-none',
                      listening ? 'border-red-400/30' : 'border-white/10'
                    )}
                    disabled={chatBusy}
                  />
                  <button
                    type="submit"
                    disabled={chatBusy || chatDraft.trim().length === 0}
                    className="rounded-lg border border-cyan-400/40 bg-cyan-500/20 p-2 text-cyan-200 transition-all hover:bg-cyan-500/30 disabled:opacity-40 flex-shrink-0"
                  >
                    {chatBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Error toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-12 left-4 right-4 z-40 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300 backdrop-blur-lg"
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
            Ghost Browser v2.0
          </span>
        </div>
      </div>
    </motion.div>
  );
};
