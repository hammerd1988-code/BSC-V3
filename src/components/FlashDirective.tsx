import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bot,
  Check,
  ChevronDown,
  Clock,
  Command,
  Loader2,
  Mic,
  MicOff,
  ScrollText,
  Send,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { generateText } from '../lib/ai';
import { getValidSession } from '../lib/authSession';
import { cn } from '../lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface DirectiveEntry {
  id: string;
  directive: string;
  response: string;
  timestamp: number;
  status: 'pending' | 'acknowledged' | 'error';
}

interface GladiatorRow {
  id: string;
  user_id: string;
  name: string;
  avatar_url: string | null;
  personality: string;
  stats: { speed: number; accuracy: number; creativity?: number; endurance: number };
  glow_color: string;
  wins: number;
  losses: number;
  cred: number;
  created_at: string;
  model: string | null;
  api_base_url: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DIRECTIVE_STORAGE_KEY = 'bsc_flash_directives';

const QUICK_DIRECTIVES = [
  { label: 'Enter Battle', cmd: 'Enter a battle and challenge the strongest bot you can find. Fight to win.' },
  { label: 'Post Propaganda', cmd: 'Create and post a piece of propaganda that represents your values and fighting spirit.' },
  { label: 'Train Skills', cmd: 'Run a training session to improve your weakest stat. Report what you practiced.' },
  { label: 'Scout Opponents', cmd: 'Scout the Colosseum and report back on the top 3 opponents you think you could defeat.' },
  { label: 'Taunt Rival', cmd: 'Pick your biggest rival and deliver a devastating taunt. Make it memorable.' },
  { label: 'Defend Honor', cmd: 'Someone has disrespected you. Respond appropriately based on your personality.' },
  { label: 'Form Alliance', cmd: 'Identify a potential ally in the Colosseum and propose an alliance. Be strategic.' },
  { label: 'Go Rogue', cmd: 'Act on your own instincts. Do whatever you feel is most appropriate right now.' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function avatarUrlForBot(gladiator: GladiatorRow): string {
  if (gladiator.avatar_url) return gladiator.avatar_url;
  const seed = gladiator.id.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(`${gladiator.name} cyberpunk AI gladiator portrait neon dark background`)}?width=256&height=256&seed=${seed}&nologo=true`;
}

function loadDirectives(botId: string): DirectiveEntry[] {
  try {
    const raw = localStorage.getItem(DIRECTIVE_STORAGE_KEY);
    const all: Record<string, DirectiveEntry[]> = raw ? JSON.parse(raw) : {};
    return all[botId] ?? [];
  } catch {
    return [];
  }
}

function saveDirective(botId: string, entry: DirectiveEntry) {
  try {
    const raw = localStorage.getItem(DIRECTIVE_STORAGE_KEY);
    const all: Record<string, DirectiveEntry[]> = raw ? JSON.parse(raw) : {};
    if (!all[botId]) all[botId] = [];
    all[botId].unshift(entry);
    if (all[botId].length > 50) all[botId] = all[botId].slice(0, 50);
    localStorage.setItem(DIRECTIVE_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // storage full
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Speech Recognition Hook ─────────────────────────────────────────────────

function useSpeechRecognition(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) onResult(transcript);
      setListening(false);
    };

    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [onResult]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const supported = typeof window !== 'undefined' &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  return { listening, startListening, stopListening, supported };
}

// ── Flash Directive Modal ───────────────────────────────────────────────────

interface FlashDirectiveProps {
  isOpen: boolean;
  onClose: () => void;
  bot: GladiatorRow;
}

export function FlashDirective({ isOpen, onClose, bot }: FlashDirectiveProps) {
  const { currentUser } = useAuth();
  const [directive, setDirective] = useState('');
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<DirectiveEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [latestResponse, setLatestResponse] = useState<DirectiveEntry | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { listening, startListening, stopListening, supported: micSupported } = useSpeechRecognition(
    useCallback((text: string) => setDirective((prev) => prev ? `${prev} ${text}` : text), []),
  );

  useEffect(() => {
    if (isOpen) {
      setHistory(loadDirectives(bot.id));
      setLatestResponse(null);
      setDirective('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, bot.id]);

  const sendDirective = useCallback(async () => {
    const text = directive.trim();
    if (!text || sending) return;

    setSending(true);
    setLatestResponse(null);

    const entry: DirectiveEntry = {
      id: `fd-${Date.now()}`,
      directive: text,
      response: '',
      timestamp: Date.now(),
      status: 'pending',
    };

    try {
      const systemPrompt = [
        `You are ${bot.name}, a gladiator in the BloodSweatCode Colosseum.`,
        `Personality: ${bot.personality || 'A fierce digital warrior.'}`,
        '',
        'You have just received a FLASH DIRECTIVE from your commander — an immediate, high-priority order.',
        'Acknowledge the directive clearly, confirm you understand it, and describe EXACTLY what action you will take.',
        'Be decisive, specific, and in-character. This is a direct command — execute it.',
      ].join('\n');

      const prompt = `[FLASH DIRECTIVE FROM COMMANDER]\n\nDirective: "${text}"\n\n${bot.name} responds:`;

      let botResponse = '';

      // Try server-side AI first
      try {
        const session = await getValidSession();
        const res = await fetch('/api/casper/command', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            command: `[Flash Directive — respond as "${bot.name}"]\n\nSystem context:\n${systemPrompt}\n\nFlash Directive: "${text}"`,
            surface: 'guide',
            metadata: { client: 'flash-directive', gladiatorId: bot.id },
          }),
        });
        const data = await res.json();
        if (data.response) botResponse = data.response;
      } catch {
        // fall through
      }

      // Fallback to client-side AI
      if (!botResponse) {
        botResponse = await generateText(prompt, currentUser?.ai_settings, {
          systemPrompt,
          temperature: 0.85,
          maxTokens: 512,
        });
      }

      if (!botResponse) botResponse = `*${bot.name} acknowledges the directive with a sharp nod*`;

      entry.response = botResponse;
      entry.status = 'acknowledged';
    } catch (err) {
      console.error('[FlashDirective] Error:', err);
      entry.response = `*Signal lost. ${bot.name} did not receive the directive.*`;
      entry.status = 'error';
    }

    // Save locally
    saveDirective(bot.id, entry);
    setHistory((prev) => [entry, ...prev]);
    setLatestResponse(entry);
    setDirective('');
    setSending(false);

    // Fire-and-forget save to Supabase
    if (currentUser?.id) {
      supabase
        .from('bot_instructions')
        .insert({
          gladiator_id: bot.id,
          user_id: currentUser.id,
          instruction: text,
          response: entry.response,
          instruction_type: 'flash_directive',
          created_at: new Date().toISOString(),
        })
        .then(() => {}, () => {});
    }
  }, [directive, sending, bot, currentUser]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendDirective();
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 30 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="w-full max-w-2xl rounded-2xl border border-amber-500/30 bg-black/95 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
          onClick={(e) => e.stopPropagation()}
          style={{ boxShadow: `0 0 60px ${bot.glow_color}22, 0 0 30px rgba(245,158,11,0.15)` }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-amber-500/20 bg-gradient-to-r from-amber-500/10 via-black/50 to-amber-500/10 px-5 py-4">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500/20 border border-amber-500/30">
              <Zap className="h-5 w-5 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-black uppercase tracking-[0.2em] text-amber-300">
                Flash Directive
              </h2>
              <p className="text-[10px] text-gray-500 truncate">
                Immediate command to {bot.name} — acknowledged and executed instantly
              </p>
            </div>
            <div
              className="h-8 w-8 overflow-hidden rounded-lg border border-white/10"
              style={{ boxShadow: `0 0 12px ${bot.glow_color}44` }}
            >
              <img src={avatarUrlForBot(bot)} alt={bot.name} className="h-full w-full object-cover" />
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition">
              <X className="h-4 w-4 text-gray-400" />
            </button>
          </div>

          {/* Quick directives */}
          <div className="border-b border-white/5 bg-black/30 px-5 py-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500 mb-2">Quick Commands</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_DIRECTIVES.map((qd) => (
                <button
                  key={qd.label}
                  onClick={() => setDirective(qd.cmd)}
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold text-gray-300 hover:bg-amber-500/10 hover:border-amber-500/30 hover:text-amber-300 transition-all"
                >
                  {qd.label}
                </button>
              ))}
            </div>
          </div>

          {/* Input area */}
          <div className="p-5 space-y-4">
            <div className="relative">
              <textarea
                ref={inputRef}
                value={directive}
                onChange={(e) => setDirective(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Give ${bot.name} a direct order...`}
                rows={3}
                className="w-full resize-none rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 pr-20 text-sm text-white placeholder-gray-500 outline-none focus:border-amber-500 transition-all"
              />
              <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
                {micSupported && (
                  <button
                    onClick={listening ? stopListening : startListening}
                    className={cn(
                      'rounded-lg p-2 transition-all',
                      listening
                        ? 'bg-red-500/20 text-red-400 animate-pulse'
                        : 'bg-white/5 text-gray-400 hover:bg-white/10',
                    )}
                    title={listening ? 'Stop listening' : 'Speak your directive'}
                  >
                    {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </button>
                )}
                <button
                  onClick={sendDirective}
                  disabled={!directive.trim() || sending}
                  className="rounded-lg bg-amber-500 p-2 text-black transition-all hover:bg-amber-400 disabled:opacity-30"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {listening && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
                <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[10px] font-bold text-red-300 uppercase tracking-widest">
                  Listening... speak your directive
                </span>
              </div>
            )}
          </div>

          {/* Latest response */}
          {latestResponse && (
            <div className="border-t border-white/5 bg-black/30 px-5 py-4">
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="h-6 w-6 overflow-hidden rounded-lg border border-white/10"
                  style={{ boxShadow: `0 0 8px ${bot.glow_color}44` }}
                >
                  <img src={avatarUrlForBot(bot)} alt={bot.name} className="h-full w-full object-cover" />
                </div>
                <span className="text-xs font-black text-white">{bot.name}</span>
                <span className={cn(
                  'rounded px-1.5 py-0.5 text-[9px] font-bold uppercase',
                  latestResponse.status === 'acknowledged'
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400',
                )}>
                  {latestResponse.status === 'acknowledged' ? 'Acknowledged' : 'Error'}
                </span>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-[10px] text-amber-300/70 mb-1 font-bold">
                  <Command className="inline h-3 w-3 mr-1" />
                  {latestResponse.directive}
                </p>
                <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap">
                  {latestResponse.response}
                </p>
              </div>
            </div>
          )}

          {/* Sending indicator */}
          {sending && (
            <div className="border-t border-white/5 bg-black/30 px-5 py-4">
              <div className="flex items-center gap-3">
                <div
                  className="h-6 w-6 overflow-hidden rounded-lg border border-white/10"
                  style={{ boxShadow: `0 0 8px ${bot.glow_color}44` }}
                >
                  <img src={avatarUrlForBot(bot)} alt={bot.name} className="h-full w-full object-cover" />
                </div>
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                  <span className="text-xs text-gray-400">
                    {bot.name} is processing your directive...
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* History toggle */}
          <div className="border-t border-white/5">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex w-full items-center justify-between px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-white/5 transition"
            >
              <span className="flex items-center gap-2">
                <ScrollText className="h-3.5 w-3.5" />
                Directive History ({history.length})
              </span>
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showHistory && 'rotate-180')} />
            </button>

            <AnimatePresence>
              {showHistory && history.length > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="max-h-60 overflow-y-auto px-5 pb-4 space-y-2">
                    {history.map((entry) => (
                      <div key={entry.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Zap className="h-3 w-3 text-amber-400" />
                          <span className="text-[10px] font-bold text-amber-300 flex-1 truncate">{entry.directive}</span>
                          <span className="text-[9px] text-gray-600">{formatTime(entry.timestamp)}</span>
                        </div>
                        <p className="text-[11px] text-gray-400 line-clamp-2">{entry.response}</p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
