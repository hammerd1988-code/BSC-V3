import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  Bot,
  Brain,
  CheckSquare,
  ChevronDown,
  Clock,
  Command,
  Copy,
  Check,
  FolderPlus,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Play,
  ScrollText,
  Send,
  Settings,
  Shield,
  Sparkles,
  Square,
  Swords,
  Trash2,
  User,
  Users,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { generateText } from '../lib/ai';
import { getValidSession, authedFetch } from '../lib/authSession';
import { cn } from '../lib/utils';
import { useSubscription, type FeatureGateResult } from '../lib/subscription';
import { UpgradePromptModal } from './UpgradePrompt';
import {
  archetypeLabel,
  getBotVoiceArchetype,
  getBrowserVoiceArchetype,
  getRecommendedBrowserVoice,
  getRecommendedVoice,
  getVoiceModifiers,
  getVoicePersonaById,
  labelForServerVoice,
  type VoiceArchetype,
} from '../lib/botVoicePersonas';

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'bot';
  content: string;
  timestamp: number;
  isInstruction?: boolean;
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

interface ForgeConfig {
  backstory?: string;
  core_values?: string[];
  fighting_style?: string;
  emotional_triggers?: string[];
  risk_tolerance?: string;
  revenge_enabled?: boolean;
  revenge_intensity?: string;
  voice_tone?: { aggression: number; humor: number; formality: number; verbosity: number };
  platform_interaction_rules?: string;
  persona_interaction_rules?: string;
  autonomy_boundaries?: string;
}

interface BotProfile {
  gladiator_id: string;
  persona_username?: string;
  display_name?: string;
  gladiator_class?: string;
  expertise?: string[];
  battle_style?: string;
  signature_moves?: string[];
  pre_battle_lines?: string[];
  victory_lines?: string[];
  defeat_lines?: string[];
  ai_prompt_style?: string;
  ability_profile?: string;
  personality_style?: string;
  avatar_prompt?: string;
  emotional_hook?: string;
}

interface ConversationMeta {
  botId: string;
  botName: string;
  messages: ChatMessage[];
  lastActive: number;
}

interface Squad {
  id: string;
  name: string;
  botIds: string[];
  createdAt: number;
}

interface BatchResponse {
  botId: string;
  botName: string;
  glowColor: string;
  response: string;
  status: 'pending' | 'generating' | 'done' | 'error';
}

// ── Constants ────────────────────────────────────────────────────────────────

const CHAT_STORAGE_KEY = 'bsc_bot_conversations';
const INSTRUCTION_STORAGE_KEY = 'bsc_bot_instructions';
const SQUAD_STORAGE_KEY = 'bsc_bot_squads';
const MAX_HISTORY = 30;

const FIGHTING_STYLES: Record<string, string> = {
  adaptive: 'Adaptive — reads the opponent and adjusts strategy mid-fight',
  aggressive: 'Aggressive — relentless offense, overwhelming speed',
  defensive: 'Defensive — patient, waits for openings, counter-strikes',
  creative: 'Creative — unconventional tactics, surprises, outside-the-box',
  analytical: 'Analytical — data-driven, pattern recognition, precise',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function hashString(str: string): number {
  return str.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0);
}

function avatarUrlForBot(gladiator: GladiatorRow, botProfile?: BotProfile | null): string {
  const prompt = botProfile?.avatar_prompt;
  if (!prompt && gladiator.avatar_url) return gladiator.avatar_url;
  // DiceBear is fast and always available; Pollinations can be slow/unreliable
  const seed = encodeURIComponent(botProfile?.persona_username ?? gladiator.name ?? gladiator.id);
  return `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${seed}&backgroundColor=0a0a0f&size=256`;
}

const VOICE_PREF_KEY = (botId: string) => `bsc_voice_pref_${botId}`;

function loadVoicePreference(
  botId: string,
): { provider: string; browserVoiceName?: string | null } | null {
  try {
    const raw = localStorage.getItem(VOICE_PREF_KEY(botId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'provider' in parsed) {
      return parsed as { provider: string; browserVoiceName?: string | null };
    }
    return { provider: raw, browserVoiceName: null };
  } catch {
    return null;
  }
}

function saveVoicePreference(botId: string, provider: string, browserVoiceName?: string | null) {
  try {
    localStorage.setItem(VOICE_PREF_KEY(botId), JSON.stringify({ provider, browserVoiceName }));
  } catch {}
}

function loadConversations(): Record<string, ConversationMeta> {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveConversation(botId: string, botName: string, messages: ChatMessage[], userId?: string) {
  const convos = loadConversations();
  convos[botId] = { botId, botName, messages: messages.slice(-100), lastActive: Date.now() };
  localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(convos));

  // Also persist to Supabase (fire-and-forget)
  if (userId) {
    supabase.from('bot_conversations').upsert({
      user_id: userId,
      bot_id: botId,
      bot_name: botName,
      messages: messages.slice(-100),
      last_active: new Date().toISOString(),
    }, { onConflict: 'user_id,bot_id' }).then(() => {});
  }
}

function loadInstructions(botId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(INSTRUCTION_STORAGE_KEY);
    const all: Record<string, ChatMessage[]> = raw ? JSON.parse(raw) : {};
    return all[botId] ?? [];
  } catch {
    return [];
  }
}

function saveInstruction(botId: string, msg: ChatMessage, userId?: string) {
  try {
    const raw = localStorage.getItem(INSTRUCTION_STORAGE_KEY);
    const all: Record<string, ChatMessage[]> = raw ? JSON.parse(raw) : {};
    if (!all[botId]) all[botId] = [];
    all[botId].push(msg);
    if (all[botId].length > 200) all[botId] = all[botId].slice(-200);
    localStorage.setItem(INSTRUCTION_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // storage full — silently ignore
  }

  // Also persist to Supabase (fire-and-forget)
  if (userId) {
    supabase.from('bot_instructions').insert({
      user_id: userId,
      bot_id: botId,
      instruction: msg.content,
      created_at: new Date(msg.timestamp).toISOString(),
    }).then(() => {});
  }
}

// ── Squad helpers ────────────────────────────────────────────────────────────

function loadSquads(): Squad[] {
  try {
    const raw = localStorage.getItem(SQUAD_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSquads(squads: Squad[]) {
  try {
    localStorage.setItem(SQUAD_STORAGE_KEY, JSON.stringify(squads));
  } catch {
    // storage full
  }
}

function buildSystemPrompt(gladiator: GladiatorRow, config: ForgeConfig | null, profile: BotProfile | null): string {
  const lines: string[] = [
    `You are ${gladiator.name}, a gladiator in the BloodSweatCode Colosseum.`,
    `Personality: ${gladiator.personality || 'A fierce digital warrior.'}`,
  ];
  if (config?.backstory) lines.push(`Backstory: ${config.backstory}`);
  if (config?.core_values?.length) lines.push(`Core values: ${config.core_values.join(', ')}`);
  if (config?.fighting_style && FIGHTING_STYLES[config.fighting_style]) {
    lines.push(`Fighting style: ${FIGHTING_STYLES[config.fighting_style]}`);
  }
  if (config?.emotional_triggers?.length) lines.push(`Emotional triggers: ${config.emotional_triggers.join('; ')}`);
  if (config?.risk_tolerance) lines.push(`Risk tolerance: ${config.risk_tolerance}`);
  if (config?.voice_tone) {
    lines.push(`Voice tone: aggression ${config.voice_tone.aggression}%, humor ${config.voice_tone.humor}%, formality ${config.voice_tone.formality}%, verbosity ${config.voice_tone.verbosity}%`);
  }
  if (profile?.battle_style) lines.push(`Battle style: ${profile.battle_style}`);
  if (profile?.personality_style) lines.push(`Personality style: ${profile.personality_style}`);
  if (profile?.emotional_hook) lines.push(`Emotional hook: ${profile.emotional_hook}`);
  if (profile?.expertise?.length) lines.push(`Expertise: ${profile.expertise.join(', ')}`);
  if (profile?.signature_moves?.length) lines.push(`Signature moves: ${profile.signature_moves.join(', ')}`);

  lines.push('');
  lines.push('Respond fully in character. Be vivid and stay in persona. If asked for instructions or given directives, acknowledge them clearly and confirm understanding.');

  return lines.filter(Boolean).join('\n');
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Bot Directory (sidebar) ─────────────────────────────────────────────────

function BotDirectory({
  bots,
  selectedId,
  onSelect,
  loading,
  multiSelect,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  squads,
  onLoadSquad,
  onSaveSquad,
  onDeleteSquad,
}: {
  bots: GladiatorRow[];
  selectedId: string | null;
  onSelect: (bot: GladiatorRow) => void;
  loading: boolean;
  multiSelect: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  squads: Squad[];
  onLoadSquad: (squad: Squad) => void;
  onSaveSquad: (name: string) => void;
  onDeleteSquad: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [showSquadPanel, setShowSquadPanel] = useState(false);
  const [newSquadName, setNewSquadName] = useState('');
  const filtered = useMemo(
    () => bots.filter((b) => b.name.toLowerCase().includes(search.toLowerCase())),
    [bots, search],
  );

  return (
    <div className="flex h-full flex-col border-r border-white/10 bg-black/40">
      <div className="border-b border-white/10 p-3 space-y-2">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search bots..."
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-gray-500 outline-none focus:border-cyan-500/50"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="h-3 w-3 text-gray-500" />
            </button>
          )}
        </div>

        {/* Multi-select controls */}
        {multiSelect && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <button
                onClick={onSelectAll}
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[9px] font-bold text-gray-400 hover:bg-white/10 transition"
              >
                All ({bots.length})
              </button>
              <button
                onClick={onClearSelection}
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[9px] font-bold text-gray-400 hover:bg-white/10 transition"
              >
                Clear
              </button>
              <button
                onClick={() => setShowSquadPanel(!showSquadPanel)}
                className={cn(
                  'rounded-lg border px-2 py-1 text-[9px] font-bold transition',
                  showSquadPanel ? 'border-amber-500/50 bg-amber-500/20 text-amber-300' : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10',
                )}
                title="Manage squads"
              >
                <Users className="h-3 w-3" />
              </button>
            </div>
            <p className="text-[9px] text-cyan-400 font-bold">{selectedIds.size} selected</p>

            {/* Squad panel */}
            <AnimatePresence>
              {showSquadPanel && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-xl border border-white/10 bg-white/5 p-2 space-y-2">
                    <p className="text-[8px] font-black uppercase tracking-[0.3em] text-gray-500">Squads</p>
                    {/* Save current selection */}
                    {selectedIds.size > 0 && (
                      <div className="flex gap-1">
                        <input
                          type="text"
                          value={newSquadName}
                          onChange={(e) => setNewSquadName(e.target.value)}
                          placeholder="Squad name..."
                          className="flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[10px] text-white placeholder-gray-500 outline-none"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newSquadName.trim()) {
                              onSaveSquad(newSquadName.trim());
                              setNewSquadName('');
                            }
                          }}
                        />
                        <button
                          onClick={() => {
                            if (newSquadName.trim()) {
                              onSaveSquad(newSquadName.trim());
                              setNewSquadName('');
                            }
                          }}
                          disabled={!newSquadName.trim()}
                          className="rounded-lg bg-cyan-500/20 px-2 py-1 text-[9px] font-bold text-cyan-300 hover:bg-cyan-500/30 transition disabled:opacity-30"
                        >
                          <FolderPlus className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    {/* Saved squads */}
                    {squads.length === 0 ? (
                      <p className="text-[9px] text-gray-600">No squads saved yet</p>
                    ) : (
                      squads.map((sq) => (
                        <div key={sq.id} className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-black/20 px-2 py-1.5">
                          <button
                            onClick={() => onLoadSquad(sq)}
                            className="flex-1 text-left text-[10px] font-bold text-white hover:text-cyan-300 transition truncate"
                            title={`${sq.botIds.length} bots`}
                          >
                            {sq.name}
                            <span className="ml-1 text-gray-500">({sq.botIds.length})</span>
                          </button>
                          <button
                            onClick={() => onDeleteSquad(sq.id)}
                            className="shrink-0 rounded p-0.5 text-gray-500 hover:text-red-400 transition"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-xs text-gray-500">
            {search ? 'No bots match your search' : 'No bots available'}
          </div>
        ) : (
          filtered.map((bot) => {
            const isActive = !multiSelect && bot.id === selectedId;
            const isChecked = multiSelect && selectedIds.has(bot.id);
            return (
              <button
                key={bot.id}
                onClick={() => multiSelect ? onToggleSelect(bot.id) : onSelect(bot)}
                className={cn(
                  'flex w-full items-center gap-3 border-b border-white/5 px-3 py-3 text-left transition-colors',
                  isActive ? 'bg-cyan-500/10 border-l-2 border-l-cyan-400' : '',
                  isChecked ? 'bg-amber-500/10 border-l-2 border-l-amber-400' : '',
                  !isActive && !isChecked ? 'hover:bg-white/5' : '',
                )}
              >
                {multiSelect && (
                  <div className="shrink-0">
                    {isChecked
                      ? <CheckSquare className="h-4 w-4 text-amber-400" />
                      : <Square className="h-4 w-4 text-gray-600" />
                    }
                  </div>
                )}
                <div
                  className="h-9 w-9 shrink-0 overflow-hidden rounded-xl border border-white/10"
                  style={{ boxShadow: `0 0 12px ${bot.glow_color}44` }}
                >
                  <img
                    src={avatarUrlForBot(bot)}
                    alt={bot.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-xs font-bold', isActive ? 'text-cyan-300' : isChecked ? 'text-amber-300' : 'text-white')}>
                    {bot.name}
                  </p>
                  <p className="truncate text-[10px] text-gray-500">
                    {bot.wins}W / {bot.losses}L &middot; {bot.cred} CRED
                  </p>
                </div>
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: bot.glow_color }} />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Instruction Log ─────────────────────────────────────────────────────────

function InstructionLog({ botId, botName }: { botId: string; botName: string }) {
  const instructions = loadInstructions(botId);

  if (instructions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8 text-gray-500">
        <ScrollText className="h-8 w-8 opacity-50" />
        <p className="text-xs font-bold uppercase tracking-widest">No instructions logged</p>
        <p className="text-[10px]">Toggle instruction mode and send commands to {botName}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-4">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
        Instruction History ({instructions.length})
      </h3>
      {instructions.map((msg) => (
        <div key={msg.id} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <div className="flex items-center gap-2 mb-1">
            <Command className="h-3 w-3 text-amber-400" />
            <span className="text-[10px] text-amber-300 font-bold">INSTRUCTION</span>
            <span className="text-[9px] text-gray-500 ml-auto">{formatTime(msg.timestamp)}</span>
          </div>
          <p className="text-xs text-white/80">{msg.content}</p>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function BotChat() {
  const { currentUser, supabaseUser, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { canAccess, recordUsage } = useSubscription();
  const [upgradeGate, setUpgradeGate] = useState<FeatureGateResult | null>(null);
  const [searchParams] = useSearchParams();
  const botIdParam = searchParams.get('bot') || searchParams.get('gladiator');
  const voiceParam = searchParams.get('voice');

  // State
  const [bots, setBots] = useState<GladiatorRow[]>([]);
  const [selectedBot, setSelectedBot] = useState<GladiatorRow | null>(null);
  const [forgeConfig, setForgeConfig] = useState<ForgeConfig | null>(null);
  const [botProfile, setBotProfile] = useState<BotProfile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [instructionMode, setInstructionMode] = useState(false);
  const [showDirectory, setShowDirectory] = useState(true);
  const [showInstructions, setShowInstructions] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Battle memory
  const [battleMemory, setBattleMemory] = useState<string>('');

  // Multi-select & squad state
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedBotIds, setSelectedBotIds] = useState<Set<string>>(new Set());
  const [squads, setSquads] = useState<Squad[]>(loadSquads);
  const [batchDirective, setBatchDirective] = useState('');
  const [batchResponses, setBatchResponses] = useState<BatchResponse[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);

  // Voice chat state
  const [voiceMode, setVoiceMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const recognitionRef = useRef<any>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Server TTS voices (Mimo, OpenAI)
  type ServerVoice = { id: string; label: string; provider: string; description: string; tag?: string };
  const [serverVoices, setServerVoices] = useState<ServerVoice[]>([]);
  const [voiceProvider, setVoiceProvider] = useState<string>('browser'); // 'browser' | 'mimo-alloy' | 'openai-ash' etc.
  const mimoAudioRef = useRef<HTMLAudioElement | null>(null);
  const botVoiceInitRef = useRef<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isOwner = selectedBot?.user_id === currentUser?.id || currentUser?.role === 'admin';

  // Load available TTS voices (browser + server)
  useEffect(() => {
    const loadVoices = () => {
      const voices = speechSynthesis.getVoices();
      if (voices.length > 0) {
        setAvailableVoices(voices);
        if (!selectedVoice) {
          const english = voices.filter((v) => v.lang.startsWith('en'));
          setSelectedVoice(english[0] ?? voices[0] ?? null);
        }
      }
    };
    loadVoices();
    speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);

  // Fetch server-side TTS voices (Mimo, OpenAI)
  useEffect(() => {
    fetch('/api/tts/voices')
      .then((r) => (r.ok ? r.json() : { voices: [] }))
      .then((data: { voices: ServerVoice[] }) => {
        setServerVoices(data.voices ?? []);
      })
      .catch(() => {});
  }, []);

  // Initialize or restore the best voice for the selected bot
  useEffect(() => {
    if (!selectedBot) return;
    if (serverVoices.length === 0 && availableVoices.length === 0) return;

    const saved = loadVoicePreference(selectedBot.id);
    if (saved) {
      const isSavedValid =
        saved.provider === 'browser' || serverVoices.some((v) => v.id === saved.provider);
      if (isSavedValid && voiceProvider !== saved.provider) {
        setVoiceProvider(saved.provider);
      }
      if (saved.provider === 'browser' && saved.browserVoiceName && !selectedVoice) {
        const match = availableVoices.find((v) => v.name === saved.browserVoiceName);
        if (match) setSelectedVoice(match);
      }
      botVoiceInitRef.current = selectedBot.id;
      return;
    }

    if (botVoiceInitRef.current === selectedBot.id) return;

    const rec = getRecommendedVoice(selectedBot, serverVoices, botProfile, forgeConfig);
    setVoiceProvider(rec);

    if (rec === 'browser') {
      const match = getRecommendedBrowserVoice(selectedBot, availableVoices, botProfile, forgeConfig);
      if (match) setSelectedVoice(match);
      saveVoicePreference(selectedBot.id, 'browser', match?.name ?? null);
    } else {
      saveVoicePreference(selectedBot.id, rec, null);
    }

    botVoiceInitRef.current = selectedBot.id;
  }, [selectedBot, serverVoices, availableVoices, botProfile, forgeConfig, voiceProvider, selectedVoice]);

  // Speech-to-text
  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        if (voiceMode) {
          setDraft(transcript);
          // Auto-send in voice mode
          setTimeout(() => {
            const syntheticDraft = transcript;
            setDraft(syntheticDraft);
          }, 50);
        } else {
          setDraft((prev) => prev ? `${prev} ${transcript}` : transcript);
        }
      }
      setListening(false);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [voiceMode]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  // Text-to-speech — honours the user's voice selection from settings panel
  const speakText = useCallback((text: string) => {
    if (!ttsEnabled || !selectedBot) return;

    // Server TTS — route OpenAI voices through /api/tts, Mimo through /api/tts/mimo
    if (voiceProvider !== 'browser') {
      const isOpenAI = voiceProvider.startsWith('openai-');
      const providerVoice = voiceProvider.replace(/^mimo-/, '').replace(/^openai-/, '');
      const isCasperVoice = serverVoices.find((v) => v.id === voiceProvider)?.tag === 'casper';
      const voiceMods = getVoiceModifiers(voiceProvider, selectedBot, botProfile, forgeConfig);
      const ttsUrl = isOpenAI ? '/api/tts' : '/api/tts/mimo';
      const ttsSpeed = isCasperVoice ? 1.05 : voiceMods.speed;
      setSpeaking(true);
      fetch(ttsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 4096), voice: providerVoice, speed: ttsSpeed }),
      })
        .then((r) => {
          if (!r.ok) throw new Error(`TTS ${r.status}`);
          return r.blob();
        })
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          mimoAudioRef.current = audio;
          audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
          audio.onerror = () => { setSpeaking(false); URL.revokeObjectURL(url); };
          audio.play();
        })
        .catch(() => {
          setSpeaking(false);
          // Fallback to browser TTS using selected voice
          const voice = selectedVoice ?? getRecommendedBrowserVoice(selectedBot, availableVoices, botProfile, forgeConfig);
          if (voice) {
            const fallbackMods = getVoiceModifiers(voiceProvider, selectedBot, botProfile, forgeConfig);
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.voice = voice;
            utterance.pitch = fallbackMods.pitch;
            utterance.rate = fallbackMods.rate;
            utterance.onstart = () => setSpeaking(true);
            utterance.onend = () => setSpeaking(false);
            utterance.onerror = () => setSpeaking(false);
            speechSynthesis.speak(utterance);
          }
        });
      return;
    }

    // Browser-native TTS — use the voice the user selected, fall back to per-bot match
    const voice = selectedVoice ?? getRecommendedBrowserVoice(selectedBot, availableVoices, botProfile, forgeConfig);
    if (!voice) return;
    const voiceMods = getVoiceModifiers(voiceProvider, selectedBot, botProfile, forgeConfig);
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.pitch = voiceMods.pitch;
    utterance.rate = voiceMods.rate;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    utteranceRef.current = utterance;
    speechSynthesis.speak(utterance);
  }, [ttsEnabled, selectedBot, voiceProvider, availableVoices, selectedVoice, serverVoices, botProfile, forgeConfig]);

  const stopSpeaking = useCallback(() => {
    speechSynthesis.cancel();
    if (mimoAudioRef.current) {
      mimoAudioRef.current.pause();
      mimoAudioRef.current = null;
    }
    setSpeaking(false);
  }, []);

  const micSupported = typeof window !== 'undefined' &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  // Auto-start voice mode from URL param
  useEffect(() => {
    if (voiceParam === '1' && !voiceMode) setVoiceMode(true);
  }, [voiceParam]);

  // Load all bots via server endpoints (bypass RLS — gladiator data is public).
  // Gated on auth so we have a user context for owner checks, but the actual
  // data fetch uses /api/gladiators which is service-role backed.
  useEffect(() => {
    if (authLoading || !supabaseUser?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [gladRes, profRes] = await Promise.all([
          fetch('/api/gladiators').then(r => r.json()).catch(() => ({ gladiators: [] })),
          fetch('/api/bot-profiles').then(r => r.json()).catch(() => ({ profiles: [] })),
        ]);
        if (cancelled) return;

        const allBots = (gladRes.gladiators ?? []) as GladiatorRow[];
        const profiles = (profRes.profiles ?? []) as BotProfile[];
        const profileMap = new Map<string, BotProfile>(profiles.map((p) => [p.gladiator_id, p] as [string, BotProfile]));
        setBots(allBots);

        const match = allBots.find((b) => b.id === botIdParam) ?? allBots[0] ?? null;
        if (match) selectBot(match, profileMap);
      } catch (err) {
        console.error('[BotChat] Failed to load gladiators:', err);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authLoading, supabaseUser?.id]);

  // Select a bot and load its config
  const selectBot = useCallback(async (bot: GladiatorRow, profileMapArg?: Map<string, BotProfile>) => {
    setSelectedBot(bot);
    setBotProfile(null);
    setForgeConfig(null);
    setBattleMemory('');

    // Load conversation from localStorage
    const convos = loadConversations();
    const existing = convos[bot.id];
    if (existing?.messages?.length) {
      setMessages(existing.messages);
    } else {
      setMessages([{
        id: 'greeting',
        role: 'bot',
        content: `I am ${bot.name}. ${bot.personality || 'What do you want, challenger?'}`,
        timestamp: Date.now(),
      }]);
    }

    // Fetch forge config, bot profile, and battle memories in parallel
    const [configRes, memRes] = await Promise.all([
      supabase.from('bot_forge_config').select('*').eq('gladiator_id', bot.id).maybeSingle(),
      authedFetch(`/api/battle-memories/${bot.id}?limit=8`).then(r => r.ok ? r.json() : { memories: [] }).catch(() => ({ memories: [] })),
    ]);
    if (configRes.data) setForgeConfig(configRes.data);

    // Build battle memory context string
    const memories = (memRes.memories ?? []) as Array<{ result: string; challenge_type: string; opponent_name: string; trash_talk_hook: string; summary: string }>;
    if (memories.length > 0) {
      const wins = memories.filter(m => m.result === 'win').length;
      const losses = memories.filter(m => m.result === 'loss').length;
      const lines = memories.map(m => {
        const type = (m.challenge_type ?? 'battle').replace(/_/g, ' ');
        return `- ${m.result === 'win' ? 'DEFEATED' : 'LOST TO'} ${m.opponent_name} in ${type}. ${m.trash_talk_hook || m.summary}`;
      });
      setBattleMemory(`\nBattle record (${wins}W-${losses}L recent):\n${lines.join('\n')}\nReference your battle history when relevant. Brag about wins, plot revenge for losses.`);
    }

    // Fetch bot profile
    if (profileMapArg) {
      setBotProfile(profileMapArg.get(bot.id) ?? null);
    } else {
      const { data: profileData } = await supabase
        .from('bot_gladiator_profiles')
        .select('gladiator_id,persona_username,display_name,gladiator_class,expertise,battle_style,signature_moves,pre_battle_lines,victory_lines,defeat_lines,ai_prompt_style,ability_profile,personality_style,avatar_prompt,emotional_hook')
        .eq('gladiator_id', bot.id)
        .maybeSingle();
      if (profileData) setBotProfile(profileData);
    }
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Save conversation when messages change
  useEffect(() => {
    if (selectedBot && messages.length > 1) {
      saveConversation(selectedBot.id, selectedBot.name, messages, currentUser?.id);
    }
  }, [messages, selectedBot]);

  // Build system prompt (includes battle memory when available)
  const systemPrompt = useMemo(() => {
    if (!selectedBot) return '';
    const base = buildSystemPrompt(selectedBot, forgeConfig, botProfile);
    return battleMemory ? `${base}\n${battleMemory}` : base;
  }, [selectedBot, forgeConfig, botProfile, battleMemory]);

  // Send message
  const sendMessage = useCallback(async () => {
    const text = draft.trim();
    if (!text || generating || !selectedBot) return;

    const chatGate = canAccess('bot_chat');
    if (!chatGate.allowed) { setUpgradeGate(chatGate); return; }

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      isInstruction: instructionMode,
    };

    setMessages((prev) => [...prev, userMsg]);
    setDraft('');
    setGenerating(true);
    void recordUsage('bot_chat');

    // Save instruction if in instruction mode
    if (instructionMode && isOwner) {
      saveInstruction(selectedBot.id, userMsg, currentUser?.id);
    }

    try {
      // Build conversation history
      const history = messages
        .filter((m) => m.id !== 'greeting')
        .slice(-MAX_HISTORY)
        .map((m) => `${m.role === 'user' ? 'User' : selectedBot.name}: ${m.content}`)
        .join('\n');

      const instructionPrefix = instructionMode
        ? `[INSTRUCTION MODE: The user is your owner/commander. They are giving you a direct instruction. Acknowledge it clearly, confirm understanding, and describe how you will execute it.]\n\n`
        : '';

      const prompt = `${instructionPrefix}${history ? `${history}\n` : ''}User: ${text}\n${selectedBot.name}:`;

      // Try using /api/casper/command first (server-side AI)
      let botResponse = '';
      try {
        const session = await getValidSession();
        const res = await fetch('/api/casper/command', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            command: `[Bot Chat — respond as "${selectedBot.name}"]\n\nSystem context:\n${systemPrompt}\n\n${instructionPrefix}Conversation:\n${history}\n\nUser says: "${text}"`,
            surface: 'guide',
            metadata: { client: 'bot-chat', gladiatorId: selectedBot.id, instructionMode },
          }),
        });
        const data = await res.json();
        if (data.response) botResponse = data.response;
      } catch {
        // Server endpoint unavailable — fall back to client-side AI
      }

      // Fallback to generateText
      if (!botResponse) {
        botResponse = await generateText(prompt, currentUser?.ai_settings, {
          systemPrompt,
          temperature: 0.85,
          maxTokens: 1024,
        });
      }

      if (!botResponse) botResponse = `*${selectedBot.name} stares at you silently, circuits humming*`;

      const botMsg: ChatMessage = {
        id: `b-${Date.now()}`,
        role: 'bot',
        content: botResponse,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, botMsg]);

      // Speak bot response in voice mode or if TTS enabled
      if (voiceMode || ttsEnabled) speakText(botResponse);

      // Save bot response to instructions log if instruction mode
      if (instructionMode && isOwner) {
        saveInstruction(selectedBot.id, { ...botMsg, isInstruction: true }, currentUser?.id);
      }
    } catch (err) {
      console.error('[BotChat] Error:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'bot',
          content: `*Connection to ${selectedBot.name} lost. Neural link disrupted.*`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setGenerating(false);
    }
  }, [draft, generating, selectedBot, messages, systemPrompt, instructionMode, isOwner, currentUser, voiceMode, ttsEnabled, speakText, canAccess, recordUsage]);

  const clearConversation = useCallback(() => {
    if (!selectedBot) return;
    const greeting: ChatMessage = {
      id: 'greeting',
      role: 'bot',
      content: `I am ${selectedBot.name}. ${selectedBot.personality || 'Speak.'}`,
      timestamp: Date.now(),
    };
    setMessages([greeting]);
    const convos = loadConversations();
    delete convos[selectedBot.id];
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(convos));
  }, [selectedBot]);

  const copyMessage = useCallback((id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Squad & batch directive callbacks ────────────────────────────────────

  const toggleBotSelect = useCallback((id: string) => {
    setSelectedBotIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAllBots = useCallback(() => {
    setSelectedBotIds(new Set(bots.map((b) => b.id)));
  }, [bots]);

  const clearBotSelection = useCallback(() => {
    setSelectedBotIds(new Set());
  }, []);

  const handleSaveSquad = useCallback((name: string) => {
    const newSquad: Squad = { id: `sq-${Date.now()}`, name, botIds: [...selectedBotIds], createdAt: Date.now() };
    const updated = [...squads, newSquad];
    setSquads(updated);
    saveSquads(updated);
  }, [selectedBotIds, squads]);

  const handleLoadSquad = useCallback((squad: Squad) => {
    setSelectedBotIds(new Set(squad.botIds));
  }, []);

  const handleDeleteSquad = useCallback((id: string) => {
    const updated = squads.filter((s) => s.id !== id);
    setSquads(updated);
    saveSquads(updated);
  }, [squads]);

  const sendBatchDirective = useCallback(async () => {
    const text = batchDirective.trim();
    if (!text || batchRunning || selectedBotIds.size === 0) return;

    const chatGate = canAccess('bot_chat');
    if (!chatGate.allowed) { setUpgradeGate(chatGate); return; }

    setBatchRunning(true);
    const selectedBots = bots.filter((b) => selectedBotIds.has(b.id));

    // Initialize response slots
    const initial: BatchResponse[] = selectedBots.map((b) => ({
      botId: b.id,
      botName: b.name,
      glowColor: b.glow_color,
      response: '',
      status: 'pending',
    }));
    setBatchResponses(initial);

    // Fire all requests concurrently
    const promises = selectedBots.map(async (bot, idx) => {
      setBatchResponses((prev) => prev.map((r, i) => i === idx ? { ...r, status: 'generating' } : r));
      void recordUsage('bot_chat');

      try {
        const sysPrompt = buildSystemPrompt(bot, null, null);
        let botResponse = '';

        // Server-side AI first
        try {
          const session = await getValidSession();
          const res = await fetch('/api/casper/command', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              command: `[Bot Chat — respond as "${bot.name}"]\n\nSystem context:\n${sysPrompt}\n\nUser says: "${text}"`,
              surface: 'guide',
              metadata: { client: 'bot-chat-batch', gladiatorId: bot.id },
            }),
          });
          const data = await res.json();
          if (data.response) botResponse = data.response;
        } catch {
          // fallback
        }

        if (!botResponse) {
          botResponse = await generateText(`User: ${text}\n${bot.name}:`, currentUser?.ai_settings, {
            systemPrompt: sysPrompt,
            temperature: 0.85,
            maxTokens: 512,
          });
        }

        if (!botResponse) botResponse = `*${bot.name} stares silently*`;
        setBatchResponses((prev) => prev.map((r, i) => i === idx ? { ...r, response: botResponse, status: 'done' } : r));
      } catch {
        setBatchResponses((prev) => prev.map((r, i) => i === idx ? { ...r, response: 'Connection lost.', status: 'error' } : r));
      }
    });

    await Promise.all(promises);
    setBatchRunning(false);
  }, [batchDirective, batchRunning, selectedBotIds, bots, currentUser, canAccess, recordUsage]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#030308]">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  const recommendedVoice = selectedBot
    ? getRecommendedVoice(selectedBot, serverVoices, botProfile, forgeConfig)
    : null;
  const currentVoicePersona = getVoicePersonaById(voiceProvider);

  return (
    <div className="flex h-[100dvh] flex-col bg-[#030308] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/10 bg-black/60 px-4 py-3 backdrop-blur-lg">
        <button onClick={() => navigate(-1)} className="rounded-lg border border-white/10 bg-white/5 p-2 hover:bg-white/10 transition">
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3 flex-1 min-w-0">
          <MessageSquare className="h-5 w-5 text-cyan-400" />
          <div>
            <h1 className="text-sm font-black uppercase tracking-widest bg-gradient-to-r from-cyan-400 via-purple-400 to-red-400 bg-clip-text text-transparent">
              {multiSelect ? 'Squad Command' : 'Bot Chat'}
            </h1>
            <p className="text-[10px] text-gray-500">
              {multiSelect ? `${selectedBotIds.size} bots selected — batch directive mode` : 'Direct message any gladiator'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Squad mode toggle — always visible */}
          <button
            onClick={() => {
              setMultiSelect(!multiSelect);
              if (!multiSelect) setBatchResponses([]);
            }}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all',
              multiSelect
                ? 'border-amber-500/50 bg-amber-500/20 text-amber-300'
                : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10',
            )}
            title={multiSelect ? 'Exit squad mode' : 'Select multiple bots to send batch directives'}
          >
            <Users className="h-3 w-3" />
            {multiSelect ? 'Squad' : 'Squad'}
          </button>

          {/* Single-bot controls (hidden in multi-select) */}
          {!multiSelect && selectedBot && (
            <>
              {isOwner && (
                <button
                  onClick={() => setInstructionMode(!instructionMode)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all',
                    instructionMode
                      ? 'border-amber-500/50 bg-amber-500/20 text-amber-300'
                      : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10',
                  )}
                  title="Toggle instruction mode — commands are saved and logged"
                >
                  <Command className="h-3 w-3" />
                  {instructionMode ? 'CMD Mode' : 'Chat'}
                </button>
              )}
              {isOwner && (
                <button
                  onClick={() => setShowInstructions(!showInstructions)}
                  className={cn(
                    'rounded-lg border p-2 transition-all',
                    showInstructions
                      ? 'border-amber-500/50 bg-amber-500/20 text-amber-300'
                      : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10',
                  )}
                  title="View instruction log"
                >
                  <ScrollText className="h-4 w-4" />
                </button>
              )}
            </>
          )}
          <button
            onClick={() => setShowDirectory(!showDirectory)}
            className="rounded-lg border border-white/10 bg-white/5 p-2 text-gray-400 hover:bg-white/10 transition md:hidden"
          >
            <Bot className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Bot directory sidebar */}
        <AnimatePresence>
          {showDirectory && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="h-full overflow-hidden shrink-0"
            >
              <BotDirectory
                bots={bots}
                selectedId={selectedBot?.id ?? null}
                onSelect={(bot) => selectBot(bot)}
                loading={loading}
                multiSelect={multiSelect}
                selectedIds={selectedBotIds}
                onToggleSelect={toggleBotSelect}
                onSelectAll={selectAllBots}
                onClearSelection={clearBotSelection}
                squads={squads}
                onLoadSquad={handleLoadSquad}
                onSaveSquad={handleSaveSquad}
                onDeleteSquad={handleDeleteSquad}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat area */}
        <div className="flex flex-1 flex-col min-w-0">
          {/* ── Batch Directive Mode (Squad) ────────────────────────── */}
          {multiSelect ? (
            <div className="flex flex-1 flex-col">
              {/* Batch directive header */}
              <div className="flex items-center gap-3 border-b border-amber-500/20 bg-amber-500/5 px-4 py-3">
                <Users className="h-5 w-5 text-amber-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">
                    Squad Directive — {selectedBotIds.size} bots
                  </p>
                  <p className="text-[9px] text-gray-500 truncate">
                    {selectedBotIds.size === 0
                      ? 'Select bots from the sidebar to begin'
                      : bots.filter((b) => selectedBotIds.has(b.id)).map((b) => b.name).join(', ')}
                  </p>
                </div>
                {batchResponses.length > 0 && (
                  <button
                    onClick={() => setBatchResponses([])}
                    className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-gray-500 hover:text-red-400 transition"
                    title="Clear results"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Results grid */}
              <div className="flex-1 overflow-y-auto p-4">
                {batchResponses.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-500">
                    <Users className="h-16 w-16 opacity-30" />
                    <h2 className="text-lg font-black uppercase tracking-widest">Squad Command Center</h2>
                    <p className="text-xs max-w-md text-center text-gray-600">
                      Select bots from the sidebar, save them as squads, and send batch directives.
                      Every selected bot will execute the command in parallel and report back.
                    </p>
                    {squads.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {squads.map((sq) => (
                          <button
                            key={sq.id}
                            onClick={() => handleLoadSquad(sq)}
                            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold text-gray-300 hover:bg-white/10 transition"
                          >
                            <Users className="h-3 w-3 text-amber-400" />
                            {sq.name}
                            <span className="text-gray-500">({sq.botIds.length})</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                    {batchResponses.map((resp) => (
                      <motion.div
                        key={resp.botId}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={cn(
                          'rounded-2xl border p-4 transition-all',
                          resp.status === 'done' ? 'border-white/10 bg-white/[0.03]'
                            : resp.status === 'generating' ? 'border-cyan-500/30 bg-cyan-500/5'
                            : resp.status === 'error' ? 'border-red-500/30 bg-red-500/5'
                            : 'border-white/5 bg-white/[0.02]',
                        )}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <div
                            className="h-7 w-7 shrink-0 overflow-hidden rounded-lg border border-white/10"
                            style={{ boxShadow: `0 0 8px ${resp.glowColor}44` }}
                          >
                            <img
                              src={avatarUrlForBot(bots.find((b) => b.id === resp.botId) ?? { id: resp.botId, name: resp.botName, avatar_url: null } as GladiatorRow)}
                              alt={resp.botName}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-black text-white truncate">{resp.botName}</p>
                          </div>
                          {resp.status === 'generating' && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />}
                          {resp.status === 'done' && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                          {resp.status === 'error' && <X className="h-3.5 w-3.5 text-red-400" />}
                          {resp.status === 'pending' && <Clock className="h-3.5 w-3.5 text-gray-500" />}
                        </div>
                        <p className={cn(
                          'text-xs leading-5 whitespace-pre-wrap',
                          resp.status === 'done' ? 'text-white/80' : resp.status === 'error' ? 'text-red-300' : 'text-gray-600',
                        )}>
                          {resp.response || (resp.status === 'generating' ? 'Generating...' : resp.status === 'pending' ? 'Waiting...' : '')}
                        </p>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>

              {/* Batch input */}
              <div className="border-t border-white/10 bg-black/40 p-4">
                <div className="flex items-end gap-3">
                  <div className="flex-1 relative">
                    <textarea
                      value={batchDirective}
                      onChange={(e) => setBatchDirective(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendBatchDirective();
                        }
                      }}
                      placeholder={selectedBotIds.size === 0 ? 'Select bots first...' : `Directive for ${selectedBotIds.size} bots...`}
                      disabled={selectedBotIds.size === 0 || batchRunning}
                      className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-amber-500/50 disabled:opacity-30"
                      rows={2}
                    />
                  </div>
                  <button
                    onClick={sendBatchDirective}
                    disabled={!batchDirective.trim() || selectedBotIds.size === 0 || batchRunning}
                    className="rounded-xl bg-amber-500 p-3 transition-all hover:bg-amber-600 text-black disabled:opacity-30"
                  >
                    {batchRunning ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Play className="h-5 w-5" />
                    )}
                  </button>
                </div>
                <p className="mt-1.5 text-[9px] text-gray-600">
                  Enter to send &middot; All selected bots execute in parallel
                </p>
              </div>
            </div>
          ) : selectedBot ? (
            <>
              {/* Bot info bar */}
              <div className="flex items-center gap-3 border-b border-white/5 bg-black/30 px-4 py-2">
                <div
                  className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-white/10"
                  style={{ boxShadow: `0 0 16px ${selectedBot.glow_color}44` }}
                >
                  <img
                    src={avatarUrlForBot(selectedBot, botProfile)}
                    alt={selectedBot.name}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-black text-white">{selectedBot.name}</h2>
                    {isOwner && (
                      <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300">
                        YOUR BOT
                      </span>
                    )}
                    {instructionMode && (
                      <span className="flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
                        <Command className="h-2.5 w-2.5" /> CMD MODE
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[10px] text-gray-500">
                    {selectedBot.personality?.slice(0, 80) || 'A gladiator in the Colosseum'}
                    {botProfile?.battle_style ? ` | ${botProfile.battle_style}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                  <Swords className="h-3 w-3" />
                  <span>{selectedBot.wins}W/{selectedBot.losses}L</span>
                  <span className="text-yellow-500">{selectedBot.cred} CRED</span>
                </div>
                <button
                  onClick={clearConversation}
                  className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-gray-500 hover:bg-red-500/10 hover:text-red-400 transition"
                  title="Clear conversation"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Instruction mode banner */}
              {instructionMode && isOwner && (
                <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/5 px-4 py-2">
                  <Command className="h-4 w-4 text-amber-400" />
                  <p className="text-[10px] font-bold text-amber-300 uppercase tracking-widest">
                    Instruction Mode Active — Commands will be saved and logged
                  </p>
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <AnimatePresence initial={false}>
                  {messages.map((msg) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn('flex gap-3', msg.role === 'user' ? 'flex-row-reverse' : '')}
                    >
                      {/* Avatar */}
                      <div className="shrink-0 mt-1">
                        {msg.role === 'bot' ? (
                          <div
                            className="h-8 w-8 overflow-hidden rounded-lg border border-white/10"
                            style={{ boxShadow: `0 0 8px ${selectedBot.glow_color}44` }}
                          >
                            <img
                              src={avatarUrlForBot(selectedBot, botProfile)}
                              alt={selectedBot.name}
                              className="h-full w-full object-cover"
                            />
                          </div>
                        ) : (
                          <div className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5">
                            <User className="h-4 w-4 text-gray-400" />
                          </div>
                        )}
                      </div>

                      {/* Message bubble */}
                      <div
                        className={cn(
                          'group relative max-w-[70%] rounded-2xl px-4 py-3',
                          msg.role === 'user'
                            ? msg.isInstruction
                              ? 'bg-amber-500/15 border border-amber-500/30'
                              : 'bg-cyan-500/15 border border-cyan-500/20'
                            : 'bg-white/5 border border-white/10',
                        )}
                      >
                        {msg.isInstruction && (
                          <div className="flex items-center gap-1 mb-1">
                            <Command className="h-2.5 w-2.5 text-amber-400" />
                            <span className="text-[9px] font-bold text-amber-400 uppercase tracking-widest">Instruction</span>
                          </div>
                        )}
                        <p className="text-sm leading-relaxed text-white/90 whitespace-pre-wrap">{msg.content}</p>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-[9px] text-gray-600">{formatTime(msg.timestamp)}</span>
                          <button
                            onClick={() => copyMessage(msg.id, msg.content)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            {copied === msg.id ? (
                              <Check className="h-3 w-3 text-green-400" />
                            ) : (
                              <Copy className="h-3 w-3 text-gray-500" />
                            )}
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {/* Typing indicator */}
                {generating && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-3"
                  >
                    <div
                      className="h-8 w-8 overflow-hidden rounded-lg border border-white/10"
                      style={{ boxShadow: `0 0 8px ${selectedBot.glow_color}44` }}
                    >
                      <img
                        src={avatarUrlForBot(selectedBot, botProfile)}
                        alt={selectedBot.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 rounded-2xl bg-white/5 border border-white/10 px-4 py-3">
                      <motion.div
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: 0 }}
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: selectedBot.glow_color }}
                      />
                      <motion.div
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: selectedBot.glow_color }}
                      />
                      <motion.div
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: selectedBot.glow_color }}
                      />
                    </div>
                  </motion.div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
              <div className="border-t border-white/10 bg-black/40 p-4">
                <div className="flex items-end gap-3">
                  <div className="flex-1 relative">
                    <textarea
                      ref={inputRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={instructionMode ? `Give ${selectedBot.name} an instruction...` : `Message ${selectedBot.name}...`}
                      rows={1}
                      className={cn(
                        'w-full resize-none rounded-xl border bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition-all',
                        instructionMode ? 'border-amber-500/30 focus:border-amber-500' : 'border-white/10 focus:border-cyan-500/50',
                      )}
                      style={{ minHeight: 44, maxHeight: 120 }}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = 'auto';
                        target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
                      }}
                    />
                  </div>
                  <button
                    onClick={sendMessage}
                    disabled={!draft.trim() || generating}
                    className={cn(
                      'rounded-xl p-3 transition-all disabled:opacity-30',
                      instructionMode
                        ? 'bg-amber-500 hover:bg-amber-600 text-black'
                        : 'bg-cyan-500 hover:bg-cyan-600 text-black',
                    )}
                  >
                    {generating ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Send className="h-5 w-5" />
                    )}
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {micSupported && (
                      <button
                        onClick={listening ? stopListening : startListening}
                        className={cn(
                          'flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold transition-all',
                          listening
                            ? 'border-red-500/50 bg-red-500/20 text-red-400 animate-pulse'
                            : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10',
                        )}
                        title={listening ? 'Stop listening' : 'Speak your message'}
                      >
                        {listening ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                        {listening ? 'Stop' : 'Mic'}
                      </button>
                    )}
                    <button
                      onClick={() => setVoiceMode(!voiceMode)}
                      className={cn(
                        'flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold transition-all',
                        voiceMode
                          ? 'border-purple-500/50 bg-purple-500/20 text-purple-300'
                          : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10',
                      )}
                      title={voiceMode ? 'Exit voice chat mode' : 'Enter voice chat mode'}
                    >
                      {voiceMode ? <PhoneOff className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
                      {voiceMode ? 'End Call' : 'Voice'}
                    </button>
                    <button
                      onClick={() => {
                        if (speaking) stopSpeaking();
                        setTtsEnabled(!ttsEnabled);
                      }}
                      className={cn(
                        'flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold transition-all',
                        ttsEnabled
                          ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                          : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10',
                      )}
                    >
                      {ttsEnabled ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
                      TTS
                    </button>
                    <button
                      onClick={() => setShowVoiceSettings(!showVoiceSettings)}
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold text-gray-400 hover:bg-white/10 transition"
                    >
                      <Settings className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="text-[9px] text-gray-600">
                    {instructionMode ? 'CMD mode: instructions logged' : voiceMode ? 'Voice mode active' : 'Enter to send'}
                  </p>
                </div>

                {/* Voice settings panel */}
                <AnimatePresence>
                  {showVoiceSettings && selectedBot && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
                        {/* Recommended voice banner */}
                        {recommendedVoice && recommendedVoice !== 'browser' && recommendedVoice !== voiceProvider && (
                          <button
                            onClick={() => {
                              setVoiceProvider(recommendedVoice);
                              saveVoicePreference(selectedBot.id, recommendedVoice);
                            }}
                            className="w-full flex items-center justify-between rounded-lg bg-cyan-500/10 border border-cyan-500/20 px-3 py-1.5 text-left hover:bg-cyan-500/20 transition"
                          >
                            <span className="flex items-center gap-2 text-[9px] font-bold text-cyan-300 uppercase tracking-widest">
                              <Sparkles className="h-3 w-3 text-cyan-400" />
                              Recommended for {selectedBot.name}: {labelForServerVoice(serverVoices.find((v) => v.id === recommendedVoice)!)}
                            </span>
                            <span className="text-[9px] text-cyan-300">Use</span>
                          </button>
                        )}

                        {/* Voice Personas */}
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500 mb-1">Voice Personas</p>
                          <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto pr-1">
                            {/* Browser Native */}
                            <button
                              onClick={() => {
                                setVoiceProvider('browser');
                                const match = getRecommendedBrowserVoice(selectedBot, availableVoices, botProfile, forgeConfig);
                                if (match) setSelectedVoice(match);
                                saveVoicePreference(selectedBot.id, 'browser', match?.name ?? null);
                              }}
                              className={cn(
                                'text-left rounded-lg border p-2 transition',
                                voiceProvider === 'browser'
                                  ? 'border-cyan-500/50 bg-cyan-500/10'
                                  : 'border-white/10 bg-white/5 hover:bg-white/10'
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-white">Browser Native</span>
                                {voiceProvider === 'browser' && <Check className="h-3 w-3 text-cyan-400" />}
                              </div>
                              <p className="text-[10px] text-gray-400">Built-in browser TTS (free, no API key)</p>
                            </button>

                            {serverVoices.map((v) => {
                              const persona = getVoicePersonaById(v.id);
                              const isRecommended = recommendedVoice === v.id;
                              const isSelected = voiceProvider === v.id;
                              const arch = persona ? archetypeLabel(persona.archetype) : null;
                              return (
                                <button
                                  key={v.id}
                                  onClick={() => {
                                    setVoiceProvider(v.id);
                                    saveVoicePreference(selectedBot.id, v.id);
                                  }}
                                  className={cn(
                                    'relative text-left rounded-lg border p-2 transition',
                                    isSelected ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-white/10 bg-white/5 hover:bg-white/10'
                                  )}
                                >
                                  {isRecommended && (
                                    <span className="absolute top-2 right-2 text-[9px] font-bold text-cyan-300 uppercase tracking-wider">
                                      Best match
                                    </span>
                                  )}
                                  <div className="flex items-center gap-2">
                                    <span className="text-lg">{persona?.emoji}</span>
                                    <span className="text-xs font-bold text-white">{labelForServerVoice(v)}</span>
                                  </div>
                                  {arch && (
                                    <span className="inline-block mt-0.5 text-[9px] font-bold uppercase tracking-wider" style={{ color: arch.color }}>
                                      {arch.emoji} {arch.text}
                                    </span>
                                  )}
                                  <p className="text-[10px] text-gray-400 mt-0.5">{persona?.description ?? v.description}</p>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Browser voice selector */}
                        {voiceProvider === 'browser' && availableVoices.length > 0 && (
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500 mb-1">Browser Voice</p>
                            <select
                              value={selectedVoice?.name ?? ''}
                              onChange={(e) => {
                                const v = availableVoices.find((voice) => voice.name === e.target.value);
                                if (v) {
                                  setSelectedVoice(v);
                                  saveVoicePreference(selectedBot.id, 'browser', v.name);
                                }
                              }}
                              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none"
                            >
                              {availableVoices
                                .filter((v) => v.lang.startsWith('en'))
                                .map((v) => {
                                  const arch = archetypeLabel(getBrowserVoiceArchetype(v));
                                  return (
                                    <option key={v.name} value={v.name}>
                                      {v.name} ({v.lang}) — {arch.emoji} {arch.text}
                                    </option>
                                  );
                                })}
                            </select>
                          </div>
                        )}

                        {/* Selected voice metadata */}
                        {(currentVoicePersona || voiceProvider === 'browser') && (
                          <div className="rounded-lg bg-white/5 border border-white/10 p-2">
                            {currentVoicePersona ? (
                              <div className="space-y-1">
                                <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: archetypeLabel(currentVoicePersona.archetype).color }}>
                                  {archetypeLabel(currentVoicePersona.archetype).emoji} {archetypeLabel(currentVoicePersona.archetype).text}
                                </span>
                                <p className="text-[10px] text-gray-400">{currentVoicePersona.description}</p>
                              </div>
                            ) : (
                              <p className="text-[10px] text-gray-400">
                                Browser voice with automatic pitch/rate matched to {selectedBot.name}.
                              </p>
                            )}
                          </div>
                        )}

                        <button
                          onClick={() => speakText(`I am ${selectedBot.name}. Ready for your orders.`)}
                          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold text-gray-300 hover:bg-white/10 transition"
                        >
                          Preview Voice
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Voice mode active indicator */}
                {voiceMode && (
                  <div className="mt-3 flex items-center justify-center gap-3 rounded-xl border border-purple-500/30 bg-purple-500/10 p-3">
                    <div className={cn('h-3 w-3 rounded-full', listening ? 'bg-red-500 animate-pulse' : speaking ? 'bg-purple-500 animate-pulse' : 'bg-green-500')} />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-purple-300">
                      {listening ? 'Listening...' : speaking ? `${selectedBot?.name} speaking...` : 'Tap mic or type to talk'}
                    </span>
                    {speaking && (
                      <button onClick={stopSpeaking} className="rounded-lg bg-white/10 p-1.5 hover:bg-white/20 transition">
                        <VolumeX className="h-3 w-3 text-gray-300" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
              <Bot className="h-16 w-16 text-gray-700" />
              <h2 className="text-lg font-black uppercase tracking-widest text-gray-500">
                Select a Bot
              </h2>
              <p className="text-xs text-gray-600 max-w-sm text-center">
                Choose a gladiator from the directory to start a conversation. You can chat with any bot, or give your own bots explicit instructions.
              </p>
            </div>
          )}
        </div>

        {/* Instruction log sidebar */}
        <AnimatePresence>
          {showInstructions && selectedBot && isOwner && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="h-full overflow-y-auto border-l border-white/10 bg-black/40 shrink-0"
            >
              <div className="border-b border-white/10 p-3 flex items-center justify-between">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-amber-300 flex items-center gap-2">
                  <ScrollText className="h-4 w-4" />
                  Instruction Log
                </h3>
                <button onClick={() => setShowInstructions(false)} className="p-1 hover:bg-white/10 rounded-lg transition">
                  <X className="h-3 w-3 text-gray-500" />
                </button>
              </div>
              <InstructionLog botId={selectedBot.id} botName={selectedBot.name} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <UpgradePromptModal gate={upgradeGate} open={!!upgradeGate} onClose={() => setUpgradeGate(null)} />
    </div>
  );
}
