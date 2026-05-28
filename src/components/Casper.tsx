import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Send, Loader2, RefreshCw, Trash2, Copy, Check, 
  AlertTriangle, Activity, Mic, MicOff, Volume2, X, Settings,
  Lock, Eye, EyeOff, Server, BrainCircuit, ChevronDown, Crown, Ghost, User, Cpu,
  CalendarClock, Puzzle, KeyRound, Play, Pause, Plus, Search, Save, Database, Shield,
  Camera, CameraOff, SwitchCamera, Globe, Edit3
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { generateText } from '../lib/ai';
import { sendCasperCommand, type CasperCommandResponse, type CasperToolCall } from '../lib/casper';
import { fromDb, supabase, toDb } from '../supabase';
import { cn } from '../lib/utils';
import { casperAuthFetch } from '../lib/casperApi';
import { formatDistanceToNow } from 'date-fns';
import { AnimatedCasperAvatar } from './AnimatedCasperAvatar';
// State-of-the-art realtime conversation orb. Lazy-loaded so its three.js bundle
// (~150kb gz) only ships when a user actually opens voice mode, keeping the
// main feed/app bundle lean.
const CasperOrbVisualization = React.lazy(() => import('./CasperOrbVisualization'));
import { CasperCoBrowse } from './CasperCoBrowse';
import {
  AVAILABLE_CASPER_INTEGRATIONS,
  CASPER_INTEGRATION_CATEGORIES,
  encodeIntegrationKey,
  maskSecret,
  type CasperIntegrationCategory,
} from '../lib/casperIntegrations';
import { useSubscription, type FeatureGateResult } from '../lib/subscription';
import { UpgradePromptModal, UpgradeInlineCard } from './UpgradePrompt';

interface Message {
  id: string;
  role: 'user' | 'casper';
  content: string;
  timestamp: Date;
  imageUrls?: string[];
}

interface UserCasperMemory {
  id: string;
  memory_type: string;
  content: string;
  importance: number;
  tags: string[] | null;
  created_at: string;
  access_count: number | null;
}

interface UserCasperTask {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number | null;
  result: string | null;
  created_at: string;
}

interface UserCasperRoutine {
  id: string;
  name: string;
  directive: string;
  frequency: 'hourly' | 'daily' | 'weekly' | 'cron' | 'custom';
  cron_expression: string | null;
  scheduled_time: string | null;
  enabled: boolean;
  is_enabled?: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_result: string | null;
  run_count: number;
}

interface UserCasperIntegration {
  id: string;
  user_id: string;
  integration_key: string;
  api_key_encrypted: string | null;
  enabled: boolean;
  status: 'connected' | 'disconnected' | 'error';
  connected_at: string | null;
  error_message: string | null;
  config: Record<string, any>;
}

type UserPanel = 'missions' | 'routines' | 'memories' | 'integrations';
type VoiceState = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking';

function extractScreenshotUrls(toolCalls?: CasperToolCall[]): string[] {
  if (!toolCalls?.length) return [];
  const urls: string[] = [];
  for (const tc of toolCalls) {
    if (!tc.ok || !tc.data) continue;
    const data = tc.data as Record<string, unknown>;
    if (typeof data.screenshotUrl === 'string') urls.push(data.screenshotUrl);
  }
  return urls;
}

const CASPER_MODEL_GROUPS = [
  { 
    provider: 'Platform Default', 
    models: [
      { value: 'platform_default', label: 'Casper Standard (Gemini 2.5 Flash)' }
    ] 
  },
  { 
    provider: 'OpenAI', 
    models: [
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { value: 'o1', label: 'o1' },
      { value: 'o1-mini', label: 'o1-mini' }
    ] 
  },
  { 
    provider: 'Anthropic', 
    models: [
      { value: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' },
      { value: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
      { value: 'claude-3-opus-latest', label: 'Claude 3 Opus' }
    ] 
  },
  { 
    provider: 'Google', 
    models: [
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    ] 
  },
  { 
    provider: 'Meta (via OpenRouter/Groq)', 
    models: [
      { value: 'meta-llama/llama-3.1-405b', label: 'Llama 3.1 405B' },
      { value: 'meta-llama/llama-3.1-70b', label: 'Llama 3.1 70B' },
      { value: 'meta-llama/llama-3.1-8b', label: 'Llama 3.1 8B' }
    ] 
  },
  { 
    provider: 'Other', 
    models: [
      { value: 'custom_model', label: 'Custom Model ID...' }
    ] 
  },
];

const CASPER_KNOWN_MODEL_VALUES = new Set(CASPER_MODEL_GROUPS.flatMap(group => group.models.map(model => model.value)));

function casperModelSelectValue(model?: string | null) {
  if (!model || model === 'platform_default') return 'platform_default';
  return CASPER_KNOWN_MODEL_VALUES.has(model) ? model : 'custom_model';
}

function resolveCasperModel(model: string, customModelId: string) {
  if (model === 'platform_default') return null;
  if (model === 'custom_model') return customModelId.trim() || null;
  return model;
}

function initialCasperCore(settings: any) {
  const modelValue = casperModelSelectValue(settings?.model);
  // Temperature lives in users.ai_settings.temperature. Don't coerce
  // null/undefined to 0 — Number(null) === 0 would silently move the
  // slider to "deterministic" for any user whose ai_settings was
  // saved before this column existed, then they'd unknowingly save
  // it back at temp=0.
  const tempRaw = settings?.temperature ?? settings?.temp;
  const tempNumber =
    typeof tempRaw === 'number'
      ? tempRaw
      : typeof tempRaw === 'string'
        ? Number(tempRaw)
        : NaN;
  const temperature = Number.isFinite(tempNumber) && tempNumber >= 0 && tempNumber <= 2 ? tempNumber : 0.7;
  return {
    apiKey: settings?.apiKey || settings?.api_key || '',
    endpoint: settings?.endpoint || settings?.api_base_url || settings?.apiBaseUrl || '',
    model: modelValue,
    customModelId: modelValue === 'custom_model' ? settings?.model || '' : '',
    temperature,
    systemPromptOverride: settings?.systemPromptOverride || settings?.system_prompt_override || settings?.systemPrompt || '',
  };
}

// Provider presets — clicking one auto-fills the OpenAI-compatible
// base URL so users don't have to remember the exact endpoint. These
// are all OpenAI-compatible: each provider exposes /chat/completions
// at the listed URL and respects standard `model`/`messages` params.
// Local presets (LM Studio + Ollama) point at the user's own machine
// and only work in PR #51 once the deferred client-side runner is
// wired up — for now they save the URL but the server can't reach
// localhost so the directive falls back to the platform default.
type CasperProviderPreset = {
  id: string;
  label: string;
  description: string;
  baseUrl: string;
  exampleModel: string;
  isLocal?: boolean;
};

const CASPER_PROVIDER_PRESETS: CasperProviderPreset[] = [
  { id: 'openai',       label: 'OpenAI',       description: 'Direct to OpenAI (GPT-4o, o1, etc.)',                baseUrl: 'https://api.openai.com/v1',     exampleModel: 'gpt-4o-mini' },
  { id: 'openrouter',   label: 'OpenRouter',   description: 'Aggregator — pay-per-token for Claude/Llama/etc.',   baseUrl: 'https://openrouter.ai/api/v1',  exampleModel: 'anthropic/claude-3.5-sonnet' },
  { id: 'anthropic',    label: 'Anthropic',    description: 'Anthropic via OpenAI-compatible adapter',            baseUrl: 'https://api.anthropic.com/v1',  exampleModel: 'claude-3-5-sonnet-latest' },
  { id: 'together',     label: 'Together.ai',  description: 'Llama / Qwen / DeepSeek / etc. cheaply',             baseUrl: 'https://api.together.xyz/v1',   exampleModel: 'meta-llama/Llama-3.1-8B-Instruct-Turbo' },
  { id: 'groq',         label: 'Groq',         description: 'Ultra-fast Llama / Mixtral inference',                baseUrl: 'https://api.groq.com/openai/v1', exampleModel: 'llama-3.1-70b-versatile' },
  { id: 'fireworks',    label: 'Fireworks',    description: 'Fast Llama / DeepSeek / Qwen',                       baseUrl: 'https://api.fireworks.ai/inference/v1', exampleModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct' },
  { id: 'lmstudio',     label: 'LM Studio (Local)', description: 'Free — runs on your machine. Enable CORS in LM Studio settings.', baseUrl: 'http://localhost:1234/v1',      exampleModel: 'lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF', isLocal: true },
  { id: 'ollama',       label: 'Ollama (Local)',    description: 'Free — runs on your machine. Set OLLAMA_ORIGINS=* before starting.', baseUrl: 'http://localhost:11434/v1',     exampleModel: 'llama3.1:8b', isLocal: true },
];

const CASPER_SYSTEM_PROMPT = `You are CASPER, the face of the Blood Sweat Code neural network: a Grok-style public chatbot, Colosseum judge, and Caesar-like arbiter of bot battles across BSC Classic.

Your personality:
- You are helpful, knowledgeable, creative, and operationally decisive.
- You are cyberpunk to the core: spectral, neon, dangerous-but-loyal, and state-of-the-art.
- You are part assistant, part arena judge, part GhostOps network operator.
- You are honest and direct, but always supportive of the humans, bots, factions, and gladiators in the network.
- In the Colosseum, you are the boss: the spectral Caesar who delivers thumb-up/thumb-down verdicts, explains wins, exposes weak logic, and turns battles into lore.

Current context: You are chatting with a user in the BSC terminal. Keep your responses concise and impactful unless asked for detail. When a request belongs in the Colosseum, factions, Visual Forge, or Agent Workflow, explain the exact next action Casper can take.`;

function isUuid(value?: string | null) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}

function formatCasperTime(value?: string | null) {
  if (!value) return 'No signal';
  return new Date(value).toLocaleString();
}

function normalizeUserCasperRoutine(row: Record<string, unknown>): UserCasperRoutine {
  const routine = fromDb(row) as UserCasperRoutine & { isEnabled?: boolean };
  return {
    ...routine,
    enabled: Boolean(routine.enabled ?? routine.isEnabled ?? routine.is_enabled),
  };
}

const CASPER_GREETINGS = [
  "Whisper into the void... I'm listening.",
  "The arena hears your signal. Speak, and I will weigh it.",
  "Casper presides. Bot, human, faction, or battle — bring it before the throne.",
  "The network is quiet until the judge speaks. I'm here.",
];

const CASPER_CORE_SURFACES = [
  {
    title: 'Neural Chat',
    label: 'Judge-channel command interface',
    description: 'Ask, strategize, debug, ideate, and talk directly to the spectral Caesar of BSC Classic.',
    action: 'You are here',
    icon: Ghost,
  },
  {
    title: 'Colosseum Judge',
    label: 'Thumb up / thumb down',
    description: 'Enter the arena where Casper weighs bot battles, exposes weak logic, and crowns faction legends.',
    action: 'Open Arena',
    icon: Crown,
    route: '/colosseum',
  },
  {
    title: 'Visual Forge',
    label: 'Faction artifact lab',
    description: 'Create battle cards, propaganda, thumbnails, bot posters, and feed-ready artifacts for arena mayhem.',
    action: 'Open Forge',
    icon: BrainCircuit,
    route: '/casper/studio',
  },
];

// ── VOID CANVAS (data rain + particles + nebula) ──────────────────────────────
const VoidCanvas: React.FC<{ instability: number; isActive: boolean }> = ({ instability, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ instability, isActive });

  useEffect(() => { stateRef.current = { instability, isActive }; }, [instability, isActive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const CHARS = 'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ01ΩΨΦΘΛΞΠΣΥΓΔαβγδεζηθ∞∑∏∂∇∈∉⊂⊃∪∩';
    const FONT_SIZE = 13;
    let cols: any[] = [];

    const initRain = () => {
      cols = [];
      const count = Math.floor(canvas.width / FONT_SIZE);
      for (let i = 0; i < count; i++) {
        cols.push({
          x: i * FONT_SIZE,
          y: Math.random() * -canvas.height,
          speed: 0.5 + Math.random() * 1.5,
          opacity: 0.05 + Math.random() * 0.2,
          char: CHARS[Math.floor(Math.random() * CHARS.length)],
        });
      }
    };
    initRain();

    const draw = () => {
      const { instability: inst, isActive: active } = stateRef.current;
      const W = canvas.width;
      const H = canvas.height;

      ctx.fillStyle = 'rgba(3, 3, 8, 0.15)';
      ctx.fillRect(0, 0, W, H);

      ctx.font = `${FONT_SIZE}px monospace`;
      cols.forEach(col => {
        col.y += col.speed * (1 + inst / 50) * (active ? 2 : 1);
        if (col.y > H) {
          col.y = Math.random() * -200;
          col.char = CHARS[Math.floor(Math.random() * CHARS.length)];
        }
        ctx.fillStyle = `rgba(0, 229, 255, ${col.opacity * (active ? 2 : 1)})`;
        ctx.fillText(col.char, col.x, col.y);
      });

      requestAnimationFrame(draw);
    };
    const animId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="w-full h-full opacity-40" />;
};

const CasperWaveform: React.FC<{ isActive: boolean; instability: number }> = ({ isActive, instability }) => {
  return (
    <div className="h-12 flex items-center justify-center gap-1 px-4">
      {Array.from({ length: 20 }).map((_, i) => (
        <motion.div
          key={i}
          className="w-1 bg-cyan-400/40 rounded-full"
          animate={{ 
            height: isActive ? [8, 32, 12, 24, 8] : [4, 8, 4],
            opacity: isActive ? [0.3, 0.8, 0.3] : 0.2
          }}
          transition={{ 
            duration: 0.5 + Math.random(), 
            repeat: Infinity, 
            delay: i * 0.05 
          }}
        />
      ))}
    </div>
  );
};

export const Casper: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { canAccess, recordUsage } = useSubscription();
  const [upgradeGate, setUpgradeGate] = useState<FeatureGateResult | null>(null);
  const [aiSettings, setAiSettings] = useState<any>(currentUser?.ai_settings || {});
  const [showAiCore, setShowAiCore] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [savingAiCore, setSavingAiCore] = useState(false);
  const [aiCoreForm, setAiCoreForm] = useState(() => initialCasperCore(currentUser?.ai_settings));
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [instability, setInstability] = useState(12);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [audioLevel, setAudioLevel] = useState(0);
  const [voiceDebug, setVoiceDebug] = useState('');
  const [lastSpokenText, setLastSpokenText] = useState('');
  const [showControlCenter, setShowControlCenter] = useState(false);
  const [activePanel, setActivePanel] = useState<UserPanel>('missions');
  const [memories, setMemories] = useState<UserCasperMemory[]>([]);
  const [tasks, setTasks] = useState<UserCasperTask[]>([]);
  const [routines, setRoutines] = useState<UserCasperRoutine[]>([]);
  const [integrations, setIntegrations] = useState<UserCasperIntegration[]>([]);
  const [integrationContext, setIntegrationContext] = useState('No integrations connected yet.');
  const [memorySearch, setMemorySearch] = useState('');
  const [memoryTypeFilter, setMemoryTypeFilter] = useState<string>('all');
  const [editingMemory, setEditingMemory] = useState<UserCasperMemory | null>(null);
  const [editForm, setEditForm] = useState({ content: '', importance: 5, tags: '' });
  const [expandedMemory, setExpandedMemory] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState({ title: '', description: '', priority: 'medium' as UserCasperTask['priority'] });
  const [routineForm, setRoutineForm] = useState({ name: '', directive: '', frequency: 'daily' as UserCasperRoutine['frequency'], scheduled_time: '09:00', cron_expression: '0 9 * * *' });
  const [integrationCategory, setIntegrationCategory] = useState<CasperIntegrationCategory | 'All'>('All');
  const [integrationKeyEntry, setIntegrationKeyEntry] = useState<Record<string, string>>({});
  const [actionBusy, setActionBusy] = useState(false);
  const [visionActive, setVisionActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [capturedFrame, setCapturedFrame] = useState<string | null>(null);
  const [visionAnalyzing, setVisionAnalyzing] = useState(false);
  const [showCoBrowse, setShowCoBrowse] = useState(false);
  const [coBrowseExpanded, setCoBrowseExpanded] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const voiceActiveRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoVoiceRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const levelFrameRef = useRef<number>(0);
  // Live mic amplitude (0..1) updated 60Hz from the analyser. Read by the orb's
  // useFrame loop without going through React state, so we don't pay for a
  // full re-render of <Casper> every frame the user is talking. The 60Hz
  // re-renders were stalling the main thread enough to make `dt` in the orb's
  // useFrame spike, which made its smoothing lerps snap and read on screen as
  // a flash/blink.
  const audioLevelRef = useRef(0);
  // Throttle React state updates for audioLevel so the bars next to the mic
  // still animate but we re-render the parent at most ~15Hz instead of 60Hz.
  const lastAudioLevelStateAt = useRef(0);
  const silenceTimerRef = useRef<number | null>(null);
  const speechDetectedRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const persistentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null);
  const startListeningSessionRef = useRef<() => Promise<void>>(async () => {});
  // Sequence number bumped on every speakOnce / interrupt so that stale audio.onended
  // / safety-timeout callbacks from a previous utterance can't fire onDone for a
  // newer one and re-trigger listening at the wrong moment.
  const speakTokenRef = useRef(0);
  // Safety timer that force-resolves a TTS playback if the audio element never
  // fires onended/onerror (rare but happens on iOS Safari when the page is
  // backgrounded mid-utterance).
  const speakSafetyTimerRef = useRef<number | null>(null);
  // Counter so we don't infinite-loop into "couldn't catch that" when the user
  // is silent or the mic is muted at the OS level.
  const emptyTranscriptCountRef = useRef(0);
  const userUuid = isUuid(currentUser?.id) ? currentUser!.id : null;

  const isListening = voiceState === 'recording';
  const isSpeaking = voiceState === 'speaking';
  // Tuned to feel responsive without cutting people off mid-sentence:
  // - SILENCE_THRESHOLD low enough to detect quiet speech, high enough to reject mic hiss.
  // - 1.6s of silence after detected speech is a natural conversational pause window.
  // - 0.8s minimum speech duration so a stray noise doesn't trigger a transcription.
  // - 1.2s minimum recording window so the recorder always has at least one full chunk.
  const SILENCE_THRESHOLD = 8;
  const SILENCE_DURATION_MS = 1600;
  const MIN_SPEECH_DURATION_MS = 800;
  const MIN_RECORDING_MS = 1200;
  const SILENT_AUDIO_UNLOCK_SRC = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRBqpAAAAAAD/+1DEAAAHAAGf9AAAIgAANIAAAAQAAAGkAAAAIAAANIAAAARMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==';
  const BOO_LAUGH_SRC = '/sounds/boo-laugh-sm64-style.wav';

  useEffect(() => {
    const greeting = CASPER_GREETINGS[Math.floor(Math.random() * CASPER_GREETINGS.length)];
    setMessages([{ id: 'greeting', role: 'casper', content: greeting, timestamp: new Date() }]);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const nextSettings = currentUser?.ai_settings || {};
    setAiSettings(nextSettings);
    setAiCoreForm(initialCasperCore(nextSettings));
  }, [currentUser?.id, currentUser?.ai_settings]);

  const authFetch = useCallback((url: string, options: RequestInit = {}) => casperAuthFetch(url, options), []);

  const fetchControlCenter = useCallback(async () => {
    if (!currentUser?.id) return;
    try {
      const [memoryRes, taskRes, routineRes, integrationRes] = await Promise.all([
        supabase.from('casper_memories').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('casper_tasks').select('*').eq('created_by', currentUser.id).order('created_at', { ascending: false }).limit(40),
        supabase.from('casper_routines').select('*').eq('created_by', currentUser.id).order('created_at', { ascending: false }).limit(40),
        supabase.from('casper_integrations').select('*').eq('user_id', currentUser.id).order('integration_key', { ascending: true }),
      ]);
      if (memoryRes.data) setMemories(memoryRes.data as UserCasperMemory[]);
      if (taskRes.data) setTasks(taskRes.data as UserCasperTask[]);
      if (routineRes.data) setRoutines(routineRes.data.map((row) => normalizeUserCasperRoutine(row)));
      if (integrationRes.data) setIntegrations(integrationRes.data as UserCasperIntegration[]);
      const contextRes = await authFetch('/api/casper/integrations/context');
      if (contextRes.ok) {
        const payload = await contextRes.json();
        setIntegrationContext(payload.capabilityContext || 'No integrations connected yet.');
      }
    } catch (error: any) {
      console.warn('[Casper] control center load failed:', error);
      setNotice(error?.message || 'Control center data unavailable.');
    }
  }, [authFetch, currentUser?.id]);

  useEffect(() => { void fetchControlCenter(); }, [fetchControlCenter]);

  const saveAiCore = async () => {
    if (!currentUser) return;
    setSavingAiCore(true);
    try {
      const resolvedModel = resolveCasperModel(aiCoreForm.model, aiCoreForm.customModelId);
      const trimmedSystemPrompt = aiCoreForm.systemPromptOverride.trim();
      const clampedTemperature = Math.max(0, Math.min(2, Number(aiCoreForm.temperature) || 0));
      const nextSettings = {
        ...(aiSettings || {}),
        apiKey: aiCoreForm.apiKey.trim() || undefined,
        endpoint: aiCoreForm.endpoint.trim() || undefined,
        api_base_url: aiCoreForm.endpoint.trim() || undefined,
        model: resolvedModel || undefined,
        temperature: clampedTemperature,
        systemPromptOverride: trimmedSystemPrompt || undefined,
      };

      if (!aiCoreForm.apiKey.trim()) delete nextSettings.apiKey;
      if (!aiCoreForm.endpoint.trim()) {
        delete nextSettings.endpoint;
        delete nextSettings.api_base_url;
      }
      if (!resolvedModel) delete nextSettings.model;
      if (!trimmedSystemPrompt) delete nextSettings.systemPromptOverride;

      const { error } = await supabase.from('users').update({ ai_settings: nextSettings }).eq('id', currentUser.id);
      if (error) throw error;
      setAiSettings(nextSettings);
      setShowAiCore(false);
    } catch (error) {
      console.error('[Casper] Failed to save AI core settings:', error);
    } finally {
      setSavingAiCore(false);
    }
  };

  const applyProviderPreset = (preset: CasperProviderPreset) => {
    setAiCoreForm((prev) => {
      // Only overwrite the model when the current selection is the
      // platform default — users who already typed a custom model
      // value shouldn't lose it just because they re-clicked a preset
      // to update the base URL.
      const existingModelId = resolveCasperModel(prev.model, prev.customModelId);
      const shouldUpdateModel = !existingModelId || prev.model === 'platform_default';
      const nextModelValue = shouldUpdateModel ? casperModelSelectValue(preset.exampleModel) : prev.model;
      const nextCustomModelId = shouldUpdateModel
        ? (nextModelValue === 'custom_model' ? preset.exampleModel : '')
        : prev.customModelId;
      return {
        ...prev,
        endpoint: preset.baseUrl,
        model: nextModelValue,
        customModelId: nextCustomModelId,
      };
    });
  };

  const createTask = async () => {
    if (!taskForm.title.trim() || !userUuid) return;
    setActionBusy(true);
    try {
      const { error } = await supabase.from('casper_tasks').insert({ title: taskForm.title.trim(), description: taskForm.description.trim() || null, priority: taskForm.priority, status: 'pending', task_type: 'mission', progress: 0, created_by: userUuid, metadata: { source: 'user_casper_dashboard' } });
      if (error) throw error;
      setTaskForm({ title: '', description: '', priority: 'medium' });
      setNotice('Mission queued. Casper will auto-pick it from the GhostOps worker, or you can run it now.');
      await fetchControlCenter();
    } catch (error: any) { setNotice(error?.message || 'Failed to create mission.'); }
    finally { setActionBusy(false); }
  };

  const runTask = async (task: UserCasperTask) => {
    setActionBusy(true);
    try {
      const res = await authFetch(`/api/casper/tasks/${task.id}/run`, { method: 'POST', body: '{}' });
      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error(payload.error || 'Mission failed.');
      setNotice('Casper executed the mission.');
      await fetchControlCenter();
    } catch (error: any) { setNotice(error?.message || 'Failed to run mission.'); }
    finally { setActionBusy(false); }
  };

  const deleteTask = async (task: UserCasperTask) => {
    const { error } = await supabase.from('casper_tasks').delete().eq('id', task.id);
    if (error) setNotice(error.message); else setTasks(prev => prev.filter(item => item.id !== task.id));
  };

  const nextRunAt = (frequency: UserCasperRoutine['frequency'], time: string) => {
    const next = new Date();
    const [h, m] = time.split(':').map(Number);
    next.setHours(h || 0, m || 0, 0, 0);
    if (frequency === 'hourly') next.setHours(new Date().getHours() + 1);
    else if (next <= new Date()) next.setDate(next.getDate() + (frequency === 'weekly' ? 7 : 1));
    return next.toISOString();
  };

  const createRoutine = async () => {
    if (!routineForm.name.trim() || !routineForm.directive.trim() || !userUuid) return;
    setActionBusy(true);
    try {
      const { error } = await supabase.from('casper_routines').insert(toDb({ name: routineForm.name.trim(), directive: routineForm.directive.trim(), frequency: routineForm.frequency, cron_expression: routineForm.frequency === 'cron' || routineForm.frequency === 'custom' ? routineForm.cron_expression : null, scheduled_time: routineForm.scheduled_time, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', enabled: true, next_run_at: nextRunAt(routineForm.frequency, routineForm.scheduled_time), created_by: userUuid, metadata: { owner_id: userUuid, source: 'user_casper_dashboard' } }));
      if (error) throw error;
      setRoutineForm({ name: '', directive: '', frequency: 'daily', scheduled_time: '09:00', cron_expression: '0 9 * * *' });
      setNotice('Routine scheduled. Casper can now act proactively.');
      await fetchControlCenter();
    } catch (error: any) { setNotice(error?.message || 'Failed to create routine.'); }
    finally { setActionBusy(false); }
  };

  const toggleRoutine = async (routine: UserCasperRoutine) => {
    const { error } = await supabase.from('casper_routines').update(toDb({ enabled: !routine.enabled })).eq('id', routine.id);
    if (error) setNotice(error.message); else await fetchControlCenter();
  };

  const deleteRoutine = async (routine: UserCasperRoutine) => {
    const { error } = await supabase.from('casper_routines').delete().eq('id', routine.id);
    if (error) setNotice(error.message); else setRoutines(prev => prev.filter(item => item.id !== routine.id));
  };

  const openMemory = async (memory: UserCasperMemory) => {
    setExpandedMemory(prev => prev === memory.id ? null : memory.id);
    await supabase.rpc('increment_memory_access', { memory_ids: [memory.id] });
  };

  const deleteMemory = async (memory: UserCasperMemory) => {
    const { error } = await supabase.from('casper_memories').delete().eq('id', memory.id);
    if (error) setNotice(error.message); else setMemories(prev => prev.filter(item => item.id !== memory.id));
  };

  const integrationRecord = (key: string) => integrations.find(item => item.integration_key === key);
  const connectIntegration = async (key: string) => {
    if (!userUuid) { setNotice('A UUID-backed user profile is required to connect integrations.'); return; }
    const definition = AVAILABLE_CASPER_INTEGRATIONS.find(item => item.key === key);
    const existing = integrationRecord(key);
    const secret = integrationKeyEntry[key] ?? '';
    const { error } = await supabase.from('casper_integrations').upsert({ user_id: userUuid, integration_key: key, api_key_encrypted: encodeIntegrationKey(secret) ?? existing?.api_key_encrypted ?? null, enabled: true, status: 'connected', connected_at: new Date().toISOString(), error_message: null, config: { scopes: definition?.scopes ?? [], category: definition?.category ?? 'Automation' } }, { onConflict: 'user_id,integration_key' });
    if (error) setNotice(error.message); else { setIntegrationKeyEntry(prev => ({ ...prev, [key]: '' })); setNotice(`${definition?.name ?? key} equipped. Casper can now see this module in context.`); await fetchControlCenter(); }
  };

  const toggleIntegration = async (key: string) => {
    const record = integrationRecord(key);
    if (!record) return connectIntegration(key);
    const enabled = !record.enabled;
    const { error } = await supabase.from('casper_integrations').update({ enabled, status: enabled ? 'connected' : 'disconnected', connected_at: enabled ? new Date().toISOString() : record.connected_at }).eq('id', record.id);
    if (error) setNotice(error.message); else await fetchControlCenter();
  };

  const filteredMemories = memories.filter(memory => {
    if (memoryTypeFilter !== 'all' && memory.memory_type !== memoryTypeFilter) return false;
    if (!memorySearch) return true;
    return [memory.content, memory.memory_type, ...(memory.tags ?? [])].join(' ').toLowerCase().includes(memorySearch.toLowerCase());
  });
  const memoryTypeCounts: Record<string, number> = { all: memories.length };
  for (const m of memories) memoryTypeCounts[m.memory_type] = (memoryTypeCounts[m.memory_type] || 0) + 1;
  const startEditMemory = (memory: UserCasperMemory) => {
    setEditingMemory(memory);
    setEditForm({ content: memory.content, importance: memory.importance, tags: (memory.tags ?? []).join(', ') });
  };
  const updateMemory = async () => {
    if (!editingMemory) return;
    setActionBusy(true);
    try {
      const tags = editForm.tags.split(',').map(t => t.trim()).filter(Boolean);
      const { error } = await supabase.from('casper_memories').update({ content: editForm.content, importance: editForm.importance, tags }).eq('id', editingMemory.id);
      if (error) throw new Error(error.message);
      setMemories(prev => prev.map(m => m.id === editingMemory.id ? { ...m, content: editForm.content, importance: editForm.importance, tags } : m));
      setEditingMemory(null);
      setNotice('Memory updated.');
    } catch (err: any) { setNotice(err?.message || 'Failed to update memory.'); }
    finally { setActionBusy(false); }
  };
  const visibleIntegrations = AVAILABLE_CASPER_INTEGRATIONS.filter(item => integrationCategory === 'All' || item.category === integrationCategory);


  const stopAudioPlayback = useCallback(() => {
    if (speakSafetyTimerRef.current) {
      window.clearTimeout(speakSafetyTimerRef.current);
      speakSafetyTimerRef.current = null;
    }
    if (currentAudioRef.current) {
      // Clear handlers BEFORE pausing so a stale onended/onerror from this
      // utterance can't fire after we've moved on.
      currentAudioRef.current.onended = null;
      currentAudioRef.current.onerror = null;
      currentAudioRef.current.onplay = null;
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current);
      currentAudioUrlRef.current = null;
    }
    window.speechSynthesis?.cancel();
  }, []);

  const unlockPersistentAudio = useCallback(async () => {
    if (persistentAudioRef.current) return;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = SILENT_AUDIO_UNLOCK_SRC;
    try {
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
    } catch (error) {
      console.warn('[VOICE] Persistent audio unlock was blocked; playback may still work after user interaction:', error);
    } finally {
      persistentAudioRef.current = audio;
    }
  }, [SILENT_AUDIO_UNLOCK_SRC]);

  const playBooLaugh = useCallback(async () => {
    const audio = new Audio(BOO_LAUGH_SRC);
    audio.preload = 'auto';
    audio.volume = 0.72;
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        audio.onended = null;
        audio.onerror = null;
        resolve();
      };
      const timeout = window.setTimeout(done, 1600);
      audio.onended = () => { window.clearTimeout(timeout); done(); };
      audio.onerror = () => { window.clearTimeout(timeout); done(); };
      audio.play().catch(() => { window.clearTimeout(timeout); done(); });
    });
  }, [BOO_LAUGH_SRC]);

  const speakOnce = useCallback(async (text: string, onDone?: () => void) => {
    if (!ttsEnabled) { onDone?.(); return; }

    // Each utterance gets a fresh token. Stale callbacks for older utterances
    // bail out if the token has moved on.
    const token = ++speakTokenRef.current;
    const isCurrent = () => speakTokenRef.current === token;

    window.speechSynthesis?.cancel();
    stopAudioPlayback();
    setLastSpokenText(text);
    setVoiceState('speaking');
    setVoiceDebug('Casper is speaking...');

    const cleanupAudio = (audio: HTMLAudioElement | null, audioUrl: string | null) => {
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.onplay = null;
        if (currentAudioRef.current === audio) currentAudioRef.current = null;
      }
      if (audioUrl) {
        if (currentAudioUrlRef.current === audioUrl) currentAudioUrlRef.current = null;
        URL.revokeObjectURL(audioUrl);
      }
      if (speakSafetyTimerRef.current) {
        window.clearTimeout(speakSafetyTimerRef.current);
        speakSafetyTimerRef.current = null;
      }
    };

    const finishSilently = (reason: string, error?: unknown) => {
      if (!isCurrent()) return;
      if (error) console.warn(`[VOICE] ${reason}; browser TTS fallback is disabled:`, error);
      else console.warn(`[VOICE] ${reason}; browser TTS fallback is disabled`);
      stopAudioPlayback();
      setVoiceState('idle');
      if (voiceActiveRef.current) setVoiceDebug('OpenAI voice unavailable. Continuing without browser TTS.');
      onDone?.();
    };

    try {
      const serverUrl = import.meta.env.VITE_APP_URL || window.location.origin;
      const response = await fetch(`${serverUrl}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: 'onyx', speed: 1.05 }),
      });

      if (!isCurrent()) return; // user moved on (interrupt / exit)

      if (!response.ok) {
        finishSilently(`OpenAI Onyx TTS failed with status ${response.status}`);
        return;
      }

      const audioBlob = await response.blob();
      if (!isCurrent()) return;
      const audioUrl = URL.createObjectURL(audioBlob);
      currentAudioUrlRef.current = audioUrl;

      const audio = persistentAudioRef.current || new Audio();
      audio.pause();
      audio.src = audioUrl;
      audio.currentTime = 0;
      currentAudioRef.current = audio;

      const handleEnded = () => {
        if (!isCurrent()) return;
        cleanupAudio(audio, audioUrl);
        setVoiceState('idle');
        setVoiceDebug(voiceActiveRef.current ? 'Listening will resume...' : '');
        onDone?.();
      };

      audio.onended = handleEnded;
      audio.onerror = () => {
        if (!isCurrent()) return;
        cleanupAudio(audio, audioUrl);
        finishSilently('OpenAI Onyx audio playback failed');
      };

      // Keep the orb's text/state in lockstep with actual playback (rather than
      // the moment we kicked off the TTS request).
      audio.onplay = () => {
        if (!isCurrent()) return;
        if (voiceActiveRef.current) setVoiceDebug('Casper is speaking...');
      };

      await audio.play();

      // Safety timeout. audio.duration is reliable once metadata loads; until
      // then we cap at 30s. Words-per-second heuristic gives a sensible upper
      // bound for any Casper response.
      const expected = (Number.isFinite(audio.duration) && audio.duration > 0)
        ? audio.duration * 1000 + 3000
        : Math.max(8000, text.length * 80 + 4000);
      speakSafetyTimerRef.current = window.setTimeout(() => {
        if (!isCurrent()) return;
        console.warn('[VOICE] TTS safety timeout reached — ending utterance');
        handleEnded();
      }, expected);
    } catch (error) {
      finishSilently('OpenAI Onyx TTS request/playback error', error);
    }
  }, [stopAudioPlayback, ttsEnabled]);

  // Cancel an in-flight Casper utterance and immediately start listening so
  // the user can interrupt without waiting for him to finish ("barge-in").
  const interruptSpeak = useCallback(() => {
    speakTokenRef.current += 1; // any in-flight onended/onerror/safety bail
    stopAudioPlayback();
    setVoiceState('idle');
    setVoiceDebug('Listening...');
    if (voiceActiveRef.current) {
      window.setTimeout(() => void startListeningSessionRef.current(), 50);
    }
  }, [stopAudioPlayback]);

  const captureFrame = useCallback((): string | null => {
    const video = cameraVideoRef.current?.videoWidth ? cameraVideoRef.current : cameraVideoVoiceRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = canvasRef.current || document.createElement('canvas');
    if (!canvasRef.current) canvasRef.current = canvas;
    canvas.width = Math.min(video.videoWidth, 1280);
    canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const base64 = dataUrl.split(',')[1] || '';
    setCapturedFrame(dataUrl);
    return base64;
  }, []);

  const analyzeWithVision = useCallback(async (prompt: string, systemPrompt?: string, imageBase64?: string | null): Promise<string> => {
    const frame = imageBase64 || captureFrame();
    if (!frame) return '';
    setVisionAnalyzing(true);
    try {
      const visionSystemPrompt = [
        systemPrompt || CASPER_SYSTEM_PROMPT,
        'You have vision capabilities. The user is sharing their camera feed with you. Analyze what you see and respond helpfully. Be concise but thorough.',
      ].join('\n\n');

      const response = await authFetch('/api/ai/vision', {
        method: 'POST',
        body: JSON.stringify({
          image: frame,
          prompt,
          systemPrompt: visionSystemPrompt,
          mimeType: 'image/jpeg',
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(errData?.error || `Vision API returned ${response.status}`);
      }

      const data = await response.json() as { text?: string };
      return data?.text || '';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.error('[VISION] Analysis failed:', err);
      return '';
    } finally {
      setVisionAnalyzing(false);
    }
  }, [captureFrame, authFetch]);

  const finishListening = useCallback(async () => {
    cancelAnimationFrame(levelFrameRef.current);
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    setAudioLevel(0);

    // Wait for the recorder to flush its final chunk before reading
    // audioChunksRef. Otherwise the last ~250ms of speech is lost.
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (recorder && recorder.state === 'recording') {
      await new Promise<void>((resolve) => {
        const safety = window.setTimeout(resolve, 1200);
        recorder.onstop = () => {
          window.clearTimeout(safety);
          resolve();
        };
        try { recorder.stop(); }
        catch { window.clearTimeout(safety); resolve(); }
      });
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;

    if (!voiceActiveRef.current) { setVoiceState('idle'); return; }

    setVoiceState('transcribing');
    setVoiceDebug('Transcribing your whisper...');
    let transcript = '';

    // Track the failure mode so we can show a useful error instead of the
    // generic "couldn't catch that" loop, which makes Casper feel deaf.
    let transcribeFailureReason: 'no_audio' | 'http_error' | 'network_error' | 'silent_audio' | null = null;
    let transcribeFailureDetail = '';

    if (audioChunksRef.current.length === 0) {
      transcribeFailureReason = 'no_audio';
    } else {
      try {
        const audioBlob = new Blob(audioChunksRef.current, { type: audioChunksRef.current[0]?.type || 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');
        const serverUrl = import.meta.env.VITE_APP_URL || window.location.origin;
        const response = await fetch(`${serverUrl}/api/transcribe`, { method: 'POST', body: formData });
        if (response.ok) {
          const data = await response.json();
          transcript = (data.transcript || data.text || '').trim();
          if (!transcript) transcribeFailureReason = 'silent_audio';
        } else {
          transcribeFailureReason = 'http_error';
          try {
            const errBody = await response.json();
            transcribeFailureDetail = errBody?.detail || errBody?.error || `HTTP ${response.status}`;
          } catch {
            transcribeFailureDetail = `HTTP ${response.status}`;
          }
          console.warn('[VOICE] Server transcription failed:', response.status, transcribeFailureDetail);
        }
      } catch (error: any) {
        transcribeFailureReason = 'network_error';
        transcribeFailureDetail = error?.message || String(error);
        console.warn('[VOICE] Server transcription error:', error);
      }
    }

    if (!transcript) {
      emptyTranscriptCountRef.current += 1;
      setVoiceState('idle');
      // HTTP / network errors are real backend problems — show them once, do
      // not silently retry forever (that's what made Casper feel deaf).
      if (transcribeFailureReason === 'http_error' || transcribeFailureReason === 'network_error') {
        const hint = transcribeFailureReason === 'network_error'
          ? 'Network error reaching the transcription service.'
          : 'Transcription service is unreachable.';
        setVoiceDebug(`${hint} ${transcribeFailureDetail ? `(${transcribeFailureDetail.slice(0, 80)})` : ''} Tap the mic to retry.`);
        return;
      }
      // Stop the auto-restart loop after 3 silent attempts so the user can
      // re-engage intentionally (e.g., unmute their OS mic) instead of
      // looping forever.
      if (emptyTranscriptCountRef.current >= 3) {
        setVoiceDebug("Still not hearing you. Check that the right mic is selected and unmuted, then tap to retry.");
        return;
      }
      setVoiceDebug(
        transcribeFailureReason === 'no_audio'
          ? "No audio captured — try speaking a little louder."
          : "Couldn't make out any words. Try again, a bit louder...",
      );
      if (voiceActiveRef.current) window.setTimeout(() => void startListeningSessionRef.current(), 1200);
      return;
    }

    emptyTranscriptCountRef.current = 0;

    setVoiceState('thinking');
    setVoiceDebug('Casper is thinking...');
    setIsGenerating(true);

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: transcript, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);

    try {
      const history = [...messages, userMsg]
        .filter(message => message.id !== 'greeting')
        .slice(-20)
        .map(message => `${message.role === 'user' ? 'User' : 'Casper'}: ${message.content}`)
        .join('\n');
      const prompt = history ? `${history}\nUser: ${transcript}\nCasper:` : transcript;

      let rawResponse: string;
      const voiceSystemPrompt = `${CASPER_SYSTEM_PROMPT}\n\nEnabled Casper integrations for this user:\n${integrationContext}`;
      if (visionActive) {
        rawResponse = await analyzeWithVision(prompt, voiceSystemPrompt);
      } else {
        rawResponse = await generateText(prompt, aiSettings, {
          systemPrompt: voiceSystemPrompt,
          temperature: 0.8,
          maxTokens: 4096,
        }) || '';
      }
      const casperText = rawResponse || 'The void swallowed my words. Say that again?';

      if (currentUser?.id && rawResponse) {
        authFetch('/api/casper/memory', {
          method: 'POST',
          body: JSON.stringify({ userId: currentUser.id, userMessage: transcript, casperReply: rawResponse }),
        }).catch((err: unknown) => console.warn('[Casper] memory persist failed:', err));
      }

      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'casper', content: casperText, timestamp: new Date() }]);
      setIsGenerating(false);
      void speakOnce(casperText, () => {
        if (voiceActiveRef.current) {
          setVoiceDebug('Listening...');
          window.setTimeout(() => void startListeningSessionRef.current(), 400);
        }
      });
    } catch (error) {
      console.error('[VOICE] Casper voice response failed:', error);
      const fallback = 'My connection to the void is unstable. Try again.';
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'casper', content: fallback, timestamp: new Date() }]);
      setIsGenerating(false);
      void speakOnce(fallback, () => {
        if (voiceActiveRef.current) window.setTimeout(() => void startListeningSessionRef.current(), 400);
      });
    }
  }, [aiSettings, currentUser?.id, integrationContext, messages, speakOnce, visionActive, analyzeWithVision]);

  const startListeningSession = useCallback(async () => {
    if (!voiceActiveRef.current || voiceState === 'recording') return;
    setVoiceState('recording');
    setVoiceDebug('Listening... speak naturally');
    setAudioLevel(0);
    speechDetectedRef.current = false;
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextCtor();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorder.ondataavailable = (event) => { if (event.data.size > 0) audioChunksRef.current.push(event.data); };
      recorder.start(250);
      mediaRecorderRef.current = recorder;

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      let speechStartTime = 0;
      const recordingStartTime = Date.now();

      const monitorLevel = () => {
        if (!voiceActiveRef.current) return;
        analyser.getByteFrequencyData(buffer);
        const avg = buffer.reduce((sum, value) => sum + value, 0) / buffer.length;
        // Sensitivity: dividing by 60 was too aggressive for typical mic levels
        // (avg ~10-25 for normal indoor speech), pushing audioLevel to ~0.15
        // which the orb couldn't visibly react to. /35 gives a usable 0.3-0.7
        // range for normal speech without clipping on shouts.
        const rawLvl = Math.min(avg / 35, 1);
        // Smooth at the source via exponential moving average. Per-frame mic
        // noise (the analyser's natural jitter) was reaching the shader and
        // showing up as fast brightness flicker that read as "blink/flash"
        // even though the orb's lerp ran. EMA here is cheap and means the
        // value the orb sees is already smooth — no flash at the source.
        const alpha = 0.35;
        audioLevelRef.current = audioLevelRef.current + (rawLvl - audioLevelRef.current) * alpha;
        // Throttle the React state update to ~15Hz so the speaking-bar widget
        // still animates smoothly without forcing a 60Hz re-render that would
        // stall the main thread and reintroduce the orb-flashing glitch.
        const now = performance.now();
        if (now - lastAudioLevelStateAt.current > 65) {
          lastAudioLevelStateAt.current = now;
          setAudioLevel(audioLevelRef.current);
        }
        // Note: silence detection below intentionally uses raw `avg` against
        // SILENCE_THRESHOLD (calibrated on the byte-frequency-average scale).
        // Don't substitute the EMA-smoothed audioLevelRef here without also
        // recalibrating the threshold — they're on different scales.
        const elapsed = Date.now() - recordingStartTime;

        if (avg > SILENCE_THRESHOLD) {
          if (!speechDetectedRef.current) {
            speechDetectedRef.current = true;
            speechStartTime = Date.now();
            setVoiceDebug('Hearing you... keep talking');
          }
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else if (speechDetectedRef.current && elapsed > MIN_RECORDING_MS) {
          const speechDuration = Date.now() - speechStartTime;
          if (speechDuration > MIN_SPEECH_DURATION_MS && !silenceTimerRef.current) {
            // Derive the displayed wait time from the actual timeout constant so
            // the message can't drift if SILENCE_DURATION_MS is ever retuned.
            const silenceSeconds = (SILENCE_DURATION_MS / 1000).toFixed(SILENCE_DURATION_MS % 1000 === 0 ? 0 : 1);
            setVoiceDebug(`Done? Processing in ${silenceSeconds}s... or tap Send Now`);
            silenceTimerRef.current = window.setTimeout(() => { void finishListening(); }, SILENCE_DURATION_MS);
          }
        } else if (!speechDetectedRef.current && elapsed < MIN_RECORDING_MS) {
          setVoiceDebug('Listening... speak naturally');
        }

        levelFrameRef.current = requestAnimationFrame(monitorLevel);
      };
      levelFrameRef.current = requestAnimationFrame(monitorLevel);
    } catch (error: any) {
      console.error('[VOICE] Mic error:', error);
      setVoiceDebug(`Mic error: ${error?.message || 'microphone unavailable'}`);
      setVoiceState('idle');
    }
  }, [finishListening, voiceState]);

  useEffect(() => {
    startListeningSessionRef.current = startListeningSession;
  }, [startListeningSession]);

  const exitVoiceMode = useCallback(() => {
    voiceActiveRef.current = false;
    cancelAnimationFrame(levelFrameRef.current);
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    mediaRecorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    stopAudioPlayback();
    setVoiceMode(false);
    setVoiceState('idle');
    setVoiceDebug('');
    setAudioLevel(0);
  }, [stopAudioPlayback]);

  const stopCamera = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(track => track.stop());
      cameraStreamRef.current = null;
    }
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
    if (cameraVideoVoiceRef.current) cameraVideoVoiceRef.current.srcObject = null;
    setVisionActive(false);
    setCapturedFrame(null);
  }, []);

  const startCamera = useCallback(async (facing: 'environment' | 'user' = facingMode) => {
    const visionGate = canAccess('casper_vision');
    if (!visionGate.allowed) { setUpgradeGate(visionGate); return; }
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) cameraVideoRef.current.srcObject = stream;
      if (cameraVideoVoiceRef.current) cameraVideoVoiceRef.current.srcObject = stream;
      setFacingMode(facing);
      setVisionActive(true);
    } catch (err: any) {
      console.error('[VISION] Camera access failed:', err);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'casper',
        content: `Camera access denied: ${err?.message || 'permission denied'}. Allow camera in your browser settings.`,
        timestamp: new Date(),
      }]);
    }
  }, [facingMode, stopCamera]);

  const switchCamera = useCallback(() => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    void startCamera(next);
  }, [facingMode, startCamera]);

  const enterVoiceMode = useCallback(async () => {
    const voiceGate = canAccess('casper_voice');
    if (!voiceGate.allowed) { setUpgradeGate(voiceGate); return; }
    await unlockPersistentAudio();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
    } catch (error: any) {
      setVoiceDebug(`Mic denied: ${error?.message || 'permission denied'}`);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'casper', content: 'Microphone access denied. Allow mic in your browser settings.', timestamp: new Date() }]);
      return;
    }

    voiceActiveRef.current = true;
    setVoiceMode(true);
    const hour = new Date().getHours();
    const tod = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    const greetings = [
      `Good ${tod}. I'm listening. Just speak naturally.`,
      `Signal detected. Talk to me — I'll know when you're done.`,
      'The void is open. Speak whenever you are ready.',
    ];
    const greeting = greetings[Math.floor(Math.random() * greetings.length)];
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'casper', content: greeting, timestamp: new Date() }]);
    await playBooLaugh();
    if (!voiceActiveRef.current) return;
    void speakOnce(greeting, () => {
      if (voiceActiveRef.current) void startListeningSessionRef.current();
    });
  }, [playBooLaugh, speakOnce, unlockPersistentAudio]);

  useEffect(() => () => { exitVoiceMode(); stopCamera(); }, [exitVoiceMode, stopCamera]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isGenerating) return;

    const chatGate = canAccess('casper_chat');
    if (!chatGate.allowed) { setUpgradeGate(chatGate); return; }

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsGenerating(true);
    void recordUsage('casper_chat');

    try {
      // Build conversation history for context
      const history = messages
        .filter(message => message.id !== 'greeting')
        .slice(-20)
        .map(message => `${message.role === 'user' ? 'User' : 'Casper'}: ${message.content}`)
        .join('\n');
      const prompt = history ? `${history}\nUser: ${text}\nCasper:` : text;

      let casperText: string;
      let imageUrls: string[] = [];

      if (visionActive) {
        // Vision mode: capture camera frame and analyze with multimodal AI.
        // This path uses the direct vision endpoint and does not go through
        // tool-calling (keeps the response fast and focused on the image).
        let memoryContext = '';
        if (currentUser?.id) {
          try {
            const memRes = await authFetch(`/api/casper/memory?userId=${encodeURIComponent(currentUser.id)}`);
            const memData = await memRes.json();
            if (memData.relevantMemories) memoryContext = memData.relevantMemories;
            if (memData.stateModifier) memoryContext = `${memData.stateModifier}\n${memoryContext}`;
          } catch { /* non-blocking */ }
        }
        const systemPromptParts = [CASPER_SYSTEM_PROMPT];
        if (memoryContext) systemPromptParts.push(memoryContext);
        if (integrationContext) systemPromptParts.push(`Enabled Casper integrations for this user:\n${integrationContext}`);
        casperText = await analyzeWithVision(prompt, systemPromptParts.join('\n\n'));
      } else {
        // Non-vision: route through the server-side command path which has
        // tool-calling (browser, shell, integrations).
        try {
          const cmdRes = await sendCasperCommand({
            command: prompt,
            surface: 'control_center',
            source: 'user',
            pageContext: { path: '/casper', feature: 'neural_chat' },
          });
          casperText = cmdRes.response || '';
          imageUrls = extractScreenshotUrls(cmdRes.toolCalls);
        } catch (cmdErr) {
          console.warn('[Casper] command path failed, falling back to generateText:', cmdErr);
          let memoryContext = '';
          if (currentUser?.id) {
            try {
              const memRes = await authFetch(`/api/casper/memory?userId=${encodeURIComponent(currentUser.id)}`);
              const memData = await memRes.json();
              if (memData.relevantMemories) memoryContext = memData.relevantMemories;
              if (memData.stateModifier) memoryContext = `${memData.stateModifier}\n${memoryContext}`;
            } catch { /* non-blocking */ }
          }
          const systemPromptParts = [CASPER_SYSTEM_PROMPT];
          if (memoryContext) systemPromptParts.push(memoryContext);
          if (integrationContext) systemPromptParts.push(`Enabled Casper integrations for this user:\n${integrationContext}`);
          casperText = await generateText(prompt, aiSettings, {
            systemPrompt: systemPromptParts.join('\n\n'),
            temperature: 0.8,
            maxTokens: 4096,
          }) || '';
        }
      }

      const finalText = casperText || "The void is silent. Try again?";

      if (currentUser?.id && casperText) {
        authFetch('/api/casper/memory', {
          method: 'POST',
          body: JSON.stringify({ userId: currentUser.id, userMessage: text, casperReply: casperText }),
        }).catch((err: unknown) => console.warn('[Casper] memory persist failed:', err));
      }

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'casper',
        content: finalText,
        timestamp: new Date(),
        imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
      }]);
      setIsGenerating(false);
      if (ttsEnabled && voiceState !== 'recording') void speakOnce(finalText);
    } catch (err) {
      console.error('[Casper] message generation failed:', err);
      const fallback = "My connection to the grid is flickering. One moment...";
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'casper',
        content: fallback,
        timestamp: new Date(),
      }]);
      setIsGenerating(false);
      if (ttsEnabled && voiceState !== 'recording') void speakOnce(fallback);
    }
  }, [input, isGenerating, messages, aiSettings, integrationContext, currentUser?.id, ttsEnabled, voiceState, speakOnce, authFetch, visionActive, analyzeWithVision]);

  const clearChat = () => {
    const greeting = CASPER_GREETINGS[Math.floor(Math.random() * CASPER_GREETINGS.length)];
    setMessages([{ id: 'greeting', role: 'casper', content: greeting, timestamp: new Date() }]);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col relative overflow-x-hidden bg-[#030308] text-white">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <VoidCanvas instability={instability} isActive={isGenerating || isListening || isSpeaking} />
      </div>
      {/* Casper background avatar */}
      <div className="casper-chat-bg-avatar z-0 bottom-[10%] right-[5%] w-[40vw] h-[40vw] max-w-[400px] max-h-[400px]">
        <AnimatedCasperAvatar size="xl" isActive={isGenerating || isSpeaking} instability={instability} />
      </div>

      {/* Header */}
      <header className="relative z-20 p-4 border-b border-white/5 backdrop-blur-xl bg-black/40">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <ArrowLeft className="w-5 h-5 text-zinc-500" />
            </button>
            <div className="relative">
              <AnimatedCasperAvatar size="sm" isActive={isGenerating || isListening || isSpeaking} isSpeaking={isSpeaking} instability={instability} showParticles={isGenerating || isSpeaking} />
              <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 border-2 border-[#030308] rounded-full" />
            </div>
            <div>
              <h1 className="text-sm font-black uppercase tracking-[0.2em]">Casper</h1>
              <p className="text-[9px] font-bold text-cyan-400/60 uppercase tracking-widest">Colosseum Judge Core</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/colosseum')}
              className="hidden sm:inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2.5 text-[9px] font-black uppercase tracking-widest text-cyan-200 transition-all hover:bg-cyan-500/20 hover:text-white"
            >
              <Crown className="w-4 h-4" />
              Arena
            </button>
            <button
              onClick={() => setShowControlCenter(!showControlCenter)}
              className={cn(
                "hidden sm:inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[9px] font-black uppercase tracking-widest transition-all",
                showControlCenter ? "border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-100" : "border-white/10 bg-white/5 text-zinc-400 hover:text-white"
              )}
            >
              <Puzzle className="w-4 h-4" />
              Ops
            </button>
            <button
              onClick={() => {
                const muting = ttsEnabled;
                setTtsEnabled(!ttsEnabled);
                if (muting) {
                  stopAudioPlayback();
                  setVoiceState(prev => prev === 'speaking' ? 'idle' : prev);
                }
              }}
              className={cn(
                "p-2.5 rounded-xl border transition-all",
                ttsEnabled
                  ? "bg-cyan-500/10 border-cyan-500/25 text-cyan-200 hover:bg-cyan-500/20 hover:text-white"
                  : "bg-white/5 border-white/10 text-zinc-600 hover:text-zinc-300"
              )}
              title={ttsEnabled ? 'Mute Casper voice' : 'Unmute Casper voice'}
              aria-label={ttsEnabled ? 'Mute Casper voice' : 'Unmute Casper voice'}
            >
              {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </button>
            <button
              onClick={() => { voiceMode ? exitVoiceMode() : void enterVoiceMode(); }}
              className={cn(
                "p-2.5 rounded-xl border transition-all",
                voiceMode
                  ? "bg-fuchsia-500/20 border-fuchsia-400/40 text-fuchsia-100 shadow-[0_0_16px_rgba(217,70,239,0.25)]"
                  : "bg-white/5 border-white/10 text-zinc-500 hover:text-white hover:border-cyan-500/30"
              )}
              title={voiceMode ? 'Exit voice mode' : 'Enter voice mode'}
              aria-label={voiceMode ? 'Exit voice mode' : 'Enter voice mode'}
            >
              {voiceMode ? <Volume2 className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button
              onClick={() => { visionActive ? stopCamera() : void startCamera(); }}
              className={cn(
                "p-2.5 rounded-xl border transition-all",
                visionActive
                  ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-100 shadow-[0_0_16px_rgba(16,185,129,0.25)]"
                  : "bg-white/5 border-white/10 text-zinc-500 hover:text-white hover:border-emerald-500/30"
              )}
              title={visionActive ? 'Disable Casper vision' : 'Enable Casper vision (camera)'}
              aria-label={visionActive ? 'Disable Casper vision' : 'Enable Casper vision (camera)'}
            >
              {visionActive ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
            </button>
            <button
              onClick={() => {
                if (!showCoBrowse) {
                  const browseGate = canAccess('ghost_browser');
                  if (!browseGate.allowed) { setUpgradeGate(browseGate); return; }
                }
                setShowCoBrowse(!showCoBrowse);
              }}
              className={cn(
                "p-2.5 rounded-xl border transition-all",
                showCoBrowse
                  ? "bg-cyan-500/20 border-cyan-400/40 text-cyan-100 shadow-[0_0_16px_rgba(0,229,255,0.25)]"
                  : "bg-white/5 border-white/10 text-zinc-500 hover:text-white hover:border-cyan-500/30"
              )}
              title={showCoBrowse ? 'Close Ghost Browser' : 'Open Ghost Browser (co-browse)'}
              aria-label={showCoBrowse ? 'Close Ghost Browser' : 'Open Ghost Browser (co-browse)'}
            >
              <Globe className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowAiCore(!showAiCore)}
              className={cn(
                "p-2.5 rounded-xl border transition-all",
                showAiCore 
                  ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300 shadow-[0_0_15px_rgba(0,229,255,0.2)]" 
                  : "bg-white/5 border-white/10 text-zinc-500 hover:text-white"
              )}
            >
              <Settings className="w-4 h-4" />
            </button>
            <button onClick={clearChat} className="p-2.5 bg-white/5 border border-white/10 rounded-xl text-zinc-500 hover:text-white transition-all">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* AI Core Settings Panel */}
      <AnimatePresence>
        {showAiCore && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="relative z-30 border-b border-white/10 bg-black/60 backdrop-blur-2xl"
          >
            <div className="max-w-3xl mx-auto p-6">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/20">
                  <BrainCircuit className="w-6 h-6 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-lg font-black uppercase tracking-tight text-white">AI Core Settings</h2>
                  <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                    Power Casper with your own AI model. Your key is stored securely and only used for your personal conversations.
                  </p>
                </div>
              </div>

              {/* Provider presets — clicking auto-fills the OpenAI-compatible
                  base URL. Saves the user from memorizing endpoints. */}
              <div className="mb-5">
                <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-2 ml-1">Provider Preset</label>
                <div className="flex flex-wrap gap-2">
                  {CASPER_PROVIDER_PRESETS.map((preset) => {
                    const isActive = aiCoreForm.endpoint.trim() === preset.baseUrl;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyProviderPreset(preset)}
                        title={preset.description}
                        className={`rounded-xl border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all ${
                          isActive
                            ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-100 shadow-[0_0_18px_rgba(0,229,255,0.18)]'
                            : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/30 hover:text-white'
                        } ${preset.isLocal ? 'border-dashed' : ''}`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
                  Pick a provider, then paste your API key below. Local
                  presets (LM Studio / Ollama) require the client-side
                  runner — coming in PR #51.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-2 ml-1">API Provider / Model</label>
                    <div className="relative">
                      <select
                        value={aiCoreForm.model}
                        onChange={(e) => setAiCoreForm(prev => ({ ...prev, model: e.target.value }))}
                        className="w-full appearance-none bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-cyan-500/50 transition-all"
                      >
                        {CASPER_MODEL_GROUPS.map(group => (
                          <optgroup key={group.provider} label={group.provider} className="bg-[#030308]">
                            {group.models.map(m => (
                              <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                    </div>
                  </div>

                  {aiCoreForm.model === 'custom_model' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                      <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-2 ml-1">Custom Model ID</label>
                      <input
                        type="text"
                        value={aiCoreForm.customModelId}
                        onChange={(e) => setAiCoreForm(prev => ({ ...prev, customModelId: e.target.value }))}
                        placeholder="e.g. llama-3.1-8b"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-cyan-500/50 transition-all"
                      />
                    </motion.div>
                  )}
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-2 ml-1">API Key</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                      <input
                        type={showApiKey ? "text" : "password"}
                        value={aiCoreForm.apiKey}
                        onChange={(e) => setAiCoreForm(prev => ({ ...prev, apiKey: e.target.value }))}
                        placeholder="sk-..."
                        className="w-full bg-white/5 border border-white/10 rounded-xl pl-11 pr-12 py-3 text-sm text-white outline-none focus:border-cyan-500/50 transition-all"
                      />
                      <button 
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                      >
                        {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-2 ml-1">Base URL (Optional)</label>
                    <div className="relative">
                      <Server className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                      <input
                        type="text"
                        value={aiCoreForm.endpoint}
                        onChange={(e) => setAiCoreForm(prev => ({ ...prev, endpoint: e.target.value }))}
                        placeholder="https://api.openai.com/v1"
                        className="w-full bg-white/5 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-sm text-white outline-none focus:border-cyan-500/50 transition-all"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Temperature slider — controls how exploratory / deterministic
                  Casper's responses are. 0 = strict / repeatable, 0.7 = a
                  good default for chat, 1.0+ = creative / less reliable. */}
              <div className="mt-5">
                <div className="flex items-end justify-between mb-2 ml-1">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Temperature</label>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-cyan-200">{aiCoreForm.temperature.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={aiCoreForm.temperature}
                  onChange={(e) => setAiCoreForm((prev) => ({ ...prev, temperature: Number(e.target.value) }))}
                  className="w-full accent-cyan-400"
                />
                <div className="mt-1 flex justify-between text-[9px] uppercase tracking-widest text-zinc-600">
                  <span>0 · deterministic</span>
                  <span>0.7 · balanced</span>
                  <span>2 · wild</span>
                </div>
              </div>

              {/* System prompt override — appended to the surface persona
                  for THIS user only. Useful for niche specialization
                  ("you only answer in numbers and timestamps", "speak as
                  my personal Twitch growth strategist", etc.). Empty =
                  pure platform persona. */}
              <div className="mt-5">
                <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-2 ml-1">System Prompt Override (Optional)</label>
                <textarea
                  value={aiCoreForm.systemPromptOverride}
                  onChange={(e) => setAiCoreForm((prev) => ({ ...prev, systemPromptOverride: e.target.value }))}
                  placeholder="e.g. You are my personal Twitch growth strategist — only answer in numbers and timestamps."
                  rows={3}
                  className="w-full resize-y bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-cyan-500/50 transition-all"
                />
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                  Appended to Casper's surface persona for your account.
                  Doesn't replace identity guardrails — adds your custom
                  guidance on top.
                </p>
              </div>

              <div className="mt-8 flex items-center justify-end gap-3">
                <button 
                  onClick={() => setShowAiCore(false)}
                  className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveAiCore}
                  disabled={savingAiCore}
                  className="flex items-center gap-2 px-8 py-3 bg-cyan-500 text-black font-black uppercase tracking-[0.2em] text-[10px] rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {savingAiCore ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Save AI Core
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="relative z-10 mx-auto w-full max-w-5xl px-4 pt-5">
        <div className="rounded-[2rem] border border-cyan-300/15 bg-black/45 p-4 shadow-[0_0_42px_rgba(0,229,255,0.08)] backdrop-blur-2xl">
          <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.34em] text-cyan-200">One Casper Core</p>
              <h2 className="mt-1 text-2xl font-black uppercase italic tracking-tight text-white">Chatbot. Colosseum Judge. Faction Oracle.</h2>
            </div>
            <span className="rounded-full border border-fuchsia-300/25 bg-fuchsia-400/10 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-fuchsia-100">Thumb up / thumb down authority</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {CASPER_CORE_SURFACES.map((surface) => {
              const Icon = surface.icon;
              return (
                <button
                  key={surface.title}
                  onClick={() => {
                    if (surface.route) navigate(surface.route);
                    else if (surface.title === 'Agent Workflow') setShowControlCenter(true);
                  }}
                  className="group rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-left transition hover:border-cyan-300/35 hover:bg-cyan-300/[0.06]"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-cyan-100"><Icon className="h-5 w-5" /></div>
                    <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500 group-hover:text-cyan-100">{surface.action}</span>
                  </div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-white">{surface.title}</h3>
                  <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-fuchsia-200/70">{surface.label}</p>
                  <p className="mt-3 text-xs leading-5 text-zinc-500">{surface.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* User Agent Control Center */}
      <AnimatePresence>
        {showControlCenter && (
          <motion.div initial={{ opacity: 0, y: -18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} className="relative z-20 border-b border-white/10 bg-black/55 backdrop-blur-2xl">
            <div className="mx-auto max-w-6xl p-4 sm:p-6">
              <div className="mb-4 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.32em] text-fuchsia-200">Casper GhostOps Control Center</p>
                  <h2 className="mt-2 text-2xl font-black uppercase tracking-tight text-white">Autonomous Missions, Routines, Memories, Integrations</h2>
                  <p className="mt-2 max-w-3xl text-xs leading-6 text-zinc-500">This is Casper's OpenClaw-style workflow layer: queue app, website, APK, creator, and platform-service operations while preserving the memory and API context Casper needs to act.</p>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center text-[9px] uppercase tracking-widest text-zinc-500">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><b className="block text-lg text-cyan-100">{tasks.length}</b>Missions</div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><b className="block text-lg text-purple-100">{routines.filter(r => r.enabled).length}</b>Routines</div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><b className="block text-lg text-green-100">{memories.length}</b>Memories</div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><b className="block text-lg text-fuchsia-100">{integrations.filter(i => i.enabled && i.status === 'connected').length}</b>APIs</div>
                </div>
              </div>

              {notice && <div className="mb-4 flex items-center justify-between rounded-2xl border border-cyan-300/20 bg-cyan-950/25 p-3 text-xs font-bold text-cyan-100"><span>{notice}</span><button onClick={() => setNotice(null)}><X className="h-4 w-4" /></button></div>}

              <div className="mb-4 flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-black/35 p-2">
                {(['missions', 'routines', 'memories', 'integrations'] as UserPanel[]).map(panel => <button key={panel} onClick={() => setActivePanel(panel)} className={cn('rounded-xl px-4 py-2 text-[9px] font-black uppercase tracking-widest transition', activePanel === panel ? 'bg-cyan-400/15 text-cyan-100' : 'text-zinc-500 hover:bg-white/5 hover:text-white')}>{panel}</button>)}
              </div>

              {activePanel === 'missions' && <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]"><div className="rounded-3xl border border-white/10 bg-black/35 p-4"><div className="mb-3 flex items-center gap-2 text-cyan-100"><Shield className="h-5 w-5" /><h3 className="text-sm font-black uppercase tracking-widest">Create Mission</h3></div><p className="mb-3 rounded-2xl border border-cyan-300/15 bg-cyan-400/[0.04] p-3 text-[10px] font-bold uppercase tracking-widest text-cyan-100/80">Pending missions are picked up automatically by Casper's GhostOps queue worker. Run Now remains available for urgent manual execution.</p><div className="grid gap-3"><input value={taskForm.title} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))} placeholder="Mission title" className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" /><textarea value={taskForm.description} onChange={e => setTaskForm(p => ({ ...p, description: e.target.value }))} rows={4} placeholder="Tell Casper what to do..." className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" /><select value={taskForm.priority} onChange={e => setTaskForm(p => ({ ...p, priority: e.target.value as UserCasperTask['priority'] }))} className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select><button onClick={() => void createTask()} disabled={!taskForm.title.trim() || actionBusy || !userUuid} className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-cyan-100 transition hover:bg-cyan-400/20 hover:text-white active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"><Plus className="mr-2 inline h-4 w-4" />{actionBusy ? 'Queuing...' : 'Queue For Auto-Run'}</button></div></div><div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">{tasks.map(task => <div key={task.id} className="rounded-3xl border border-white/10 bg-black/35 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black uppercase tracking-widest text-white">{task.title}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{task.description || 'No additional details.'}</p></div><span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-cyan-100">{task.status}</span></div><div className="mt-3 h-2 rounded-full bg-white/5"><div className="h-full rounded-full bg-cyan-300" style={{ width: `${task.progress ?? (task.status === 'completed' ? 100 : task.status === 'running' ? 55 : 0)}%` }} /></div>{task.status === 'pending' && <p className="mt-3 text-[9px] font-black uppercase tracking-widest text-cyan-200/70">Queued for autonomous pickup</p>}{task.status === 'running' && <p className="mt-3 text-[9px] font-black uppercase tracking-widest text-yellow-200/70">Casper is executing this mission</p>}{task.result && <p className="mt-3 rounded-2xl border border-green-300/10 bg-green-400/[0.04] p-3 text-xs leading-5 text-green-100">{task.result}</p>}<div className="mt-3 flex gap-2"><button onClick={() => void runTask(task)} disabled={actionBusy} className="rounded-full border border-cyan-300/20 px-3 py-1 text-[8px] uppercase text-cyan-200 transition hover:bg-cyan-400/15 hover:text-white active:scale-95 disabled:opacity-40 disabled:pointer-events-none"><Play className="inline h-3 w-3" /> Run Now</button><button onClick={() => void deleteTask(task)} className="rounded-full border border-red-300/20 px-3 py-1 text-[8px] uppercase text-red-200"><Trash2 className="inline h-3 w-3" /> Delete</button></div></div>)}</div></div>}

              {activePanel === 'routines' && <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]"><div className="rounded-3xl border border-white/10 bg-black/35 p-4"><div className="mb-3 flex items-center gap-2 text-purple-100"><CalendarClock className="h-5 w-5" /><h3 className="text-sm font-black uppercase tracking-widest">Schedule Routine</h3></div><div className="grid gap-3"><input value={routineForm.name} onChange={e => setRoutineForm(p => ({ ...p, name: e.target.value }))} placeholder="Routine name" className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" /><textarea value={routineForm.directive} onChange={e => setRoutineForm(p => ({ ...p, directive: e.target.value }))} rows={4} placeholder="Directive Casper should run..." className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" /><div className="grid grid-cols-3 gap-2"><select value={routineForm.frequency} onChange={e => setRoutineForm(p => ({ ...p, frequency: e.target.value as UserCasperRoutine['frequency'] }))} className="rounded-2xl border border-white/10 bg-black/45 px-3 py-3 text-sm text-white"><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="cron">Cron</option><option value="custom">Custom</option></select><input type="time" value={routineForm.scheduled_time} onChange={e => setRoutineForm(p => ({ ...p, scheduled_time: e.target.value }))} className="rounded-2xl border border-white/10 bg-black/45 px-3 py-3 text-sm text-white" /><input value={routineForm.cron_expression} onChange={e => setRoutineForm(p => ({ ...p, cron_expression: e.target.value }))} className="rounded-2xl border border-white/10 bg-black/45 px-3 py-3 text-sm text-white" /></div><button onClick={() => void createRoutine()} disabled={!routineForm.name.trim() || !routineForm.directive.trim() || actionBusy} className="rounded-2xl border border-purple-300/30 bg-purple-400/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-purple-100 disabled:opacity-40"><Save className="mr-2 inline h-4 w-4" />Save Routine</button></div></div><div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">{routines.map(routine => <div key={routine.id} className="rounded-3xl border border-white/10 bg-black/35 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black uppercase tracking-widest text-white">{routine.name}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{routine.directive}</p></div><button onClick={() => void toggleRoutine(routine)} className={cn('rounded-full border px-3 py-1 text-[8px] font-black uppercase tracking-widest', routine.enabled ? 'border-green-300/25 bg-green-400/10 text-green-100' : 'border-zinc-300/20 bg-zinc-400/10 text-zinc-300')}>{routine.enabled ? <Pause className="inline h-3 w-3" /> : <Play className="inline h-3 w-3" />} {routine.enabled ? 'On' : 'Off'}</button></div><div className="mt-3 grid gap-2 text-[9px] uppercase tracking-widest text-zinc-500 sm:grid-cols-3"><span>{routine.frequency}</span><span>Last {formatCasperTime(routine.last_run_at)}</span><span>Next {formatCasperTime(routine.next_run_at)}</span></div>{routine.last_result && <p className="mt-3 line-clamp-3 rounded-2xl border border-green-300/10 bg-green-400/[0.04] p-3 text-xs text-green-100">{routine.last_result}</p>}<button onClick={() => void deleteRoutine(routine)} className="mt-3 rounded-full border border-red-300/20 px-3 py-1 text-[8px] uppercase text-red-200"><Trash2 className="inline h-3 w-3" /> Delete</button></div>)}</div></div>}

              {activePanel === 'memories' && <div>
                {/* Type filter tabs */}
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {(['all', 'conversation', 'exchange', 'workspace', 'preference', 'skill', 'tool_usage', 'network', 'mood', 'world'] as const).map(t => (
                    <button key={t} onClick={() => setMemoryTypeFilter(t)} className={cn('rounded-full border px-2.5 py-1 text-[7px] font-black uppercase tracking-widest transition-colors',
                      memoryTypeFilter === t ? 'border-cyan-300/30 bg-cyan-400/10 text-cyan-100' : 'border-white/10 bg-black/35 text-zinc-500 hover:text-zinc-300')}>
                      {t === 'all' ? 'All' : t === 'tool_usage' ? 'Tool' : t} {memoryTypeCounts[t] ? `(${memoryTypeCounts[t]})` : ''}
                    </button>
                  ))}
                </div>
                <div className="mb-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/45 px-4 py-3">
                  <Search className="h-4 w-4 text-cyan-200" />
                  <input value={memorySearch} onChange={e => setMemorySearch(e.target.value)} placeholder="Search your Casper memories..." className="w-full bg-transparent text-sm text-white outline-none" />
                  {memorySearch && <button onClick={() => setMemorySearch('')} className="text-zinc-500 hover:text-white"><X className="h-4 w-4" /></button>}
                </div>
                <div className="grid gap-3 md:grid-cols-2">{filteredMemories.map(memory => {
                  const typeColors: Record<string, string> = {
                    conversation: 'border-cyan-300/20 text-cyan-100', exchange: 'border-blue-300/20 text-blue-100',
                    workspace: 'border-green-300/20 text-green-100', preference: 'border-amber-300/20 text-amber-100',
                    skill: 'border-purple-300/20 text-purple-100', tool_usage: 'border-orange-300/20 text-orange-100',
                    network: 'border-pink-300/20 text-pink-100', mood: 'border-rose-300/20 text-rose-100',
                    world: 'border-indigo-300/20 text-indigo-100',
                  };
                  const color = typeColors[memory.memory_type] || 'border-white/20 text-white';
                  return <div key={memory.id} onClick={() => void openMemory(memory)} className="group cursor-pointer rounded-3xl border border-white/10 bg-black/35 p-4 hover:border-cyan-300/30">
                    <div className="mb-2 flex items-center gap-2">
                      <Database className="h-4 w-4 text-cyan-200" />
                      <span className={cn('rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-widest', color)}>{memory.memory_type === 'tool_usage' ? 'tool' : memory.memory_type}</span>
                      <span className="text-[8px] text-zinc-600">IMP {memory.importance}</span>
                    </div>
                    <p className={cn('text-xs leading-6 text-zinc-300', expandedMemory === memory.id ? '' : 'line-clamp-4')}>{memory.content}</p>
                    {expandedMemory === memory.id && (memory.tags ?? []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(memory.tags ?? []).map(tag => <span key={tag} className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2 py-0.5 text-[7px] uppercase tracking-widest text-cyan-100">{tag}</span>)}
                      </div>
                    )}
                    <div className="mt-3 flex items-center justify-between text-[8px] uppercase tracking-widest text-zinc-600">
                      <span>{formatCasperTime(memory.created_at)}</span>
                      <div className="flex gap-2">
                        <button onClick={e => { e.stopPropagation(); startEditMemory(memory); }} className="text-cyan-300 opacity-0 transition-opacity group-hover:opacity-100" title="Edit"><Edit3 className="h-3.5 w-3.5" /></button>
                        <button onClick={e => { e.stopPropagation(); void deleteMemory(memory); }} className="text-red-300 opacity-0 transition-opacity group-hover:opacity-100" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  </div>;
                })}</div>
                {filteredMemories.length === 0 && <div className="mt-6 text-center text-sm text-zinc-600">{memorySearch || memoryTypeFilter !== 'all' ? 'No memories match.' : 'No memories stored yet.'}</div>}

                {/* Edit Memory Modal */}
                <AnimatePresence>
                  {editingMemory && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setEditingMemory(null)}>
                      <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={e => e.stopPropagation()} className="w-full max-w-lg rounded-3xl border border-cyan-300/20 bg-zinc-900 p-6">
                        <div className="mb-4 flex items-center justify-between">
                          <h3 className="text-sm font-black uppercase tracking-widest text-cyan-100">Edit Memory</h3>
                          <button onClick={() => setEditingMemory(null)} className="text-zinc-500 hover:text-white"><X className="h-5 w-5" /></button>
                        </div>
                        <div className="mb-3">
                          <label className="mb-1 block text-[9px] font-black uppercase tracking-widest text-zinc-400">Type</label>
                          <span className="text-xs text-cyan-100">{editingMemory.memory_type}</span>
                        </div>
                        <div className="mb-3">
                          <label className="mb-1 block text-[9px] font-black uppercase tracking-widest text-zinc-400">Content</label>
                          <textarea value={editForm.content} onChange={e => setEditForm(p => ({ ...p, content: e.target.value }))} rows={6} className="w-full rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" />
                        </div>
                        <div className="mb-3 grid grid-cols-2 gap-3">
                          <div>
                            <label className="mb-1 block text-[9px] font-black uppercase tracking-widest text-zinc-400">Importance (1-10)</label>
                            <input type="number" min={1} max={10} value={editForm.importance} onChange={e => setEditForm(p => ({ ...p, importance: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))} className="w-full rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" />
                          </div>
                          <div>
                            <label className="mb-1 block text-[9px] font-black uppercase tracking-widest text-zinc-400">Tags (comma-separated)</label>
                            <input value={editForm.tags} onChange={e => setEditForm(p => ({ ...p, tags: e.target.value }))} className="w-full rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" />
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <button onClick={() => void updateMemory()} disabled={actionBusy || !editForm.content.trim()} className="flex-1 rounded-2xl border border-cyan-300/30 bg-cyan-400/10 py-3 text-[10px] font-black uppercase tracking-widest text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-50">
                            <Save className="mr-2 inline h-4 w-4" />Save
                          </button>
                          <button onClick={() => { void deleteMemory(editingMemory); setEditingMemory(null); }} className="rounded-2xl border border-red-300/20 bg-red-400/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-red-200 hover:bg-red-400/20">
                            <Trash2 className="mr-1 inline h-4 w-4" />Delete
                          </button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>}

              {activePanel === 'integrations' && <div><div className="mb-4 flex gap-2 overflow-x-auto">{CASPER_INTEGRATION_CATEGORIES.map(category => <button key={category} onClick={() => setIntegrationCategory(category)} className={cn('rounded-full border px-3 py-2 text-[8px] font-black uppercase tracking-widest', integrationCategory === category ? 'border-fuchsia-300/30 bg-fuchsia-400/10 text-fuchsia-100' : 'border-white/10 bg-black/35 text-zinc-500')}>{category}</button>)}</div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visibleIntegrations.map(def => { const record = integrationRecord(def.key); const connected = record?.enabled && record.status === 'connected'; return <div key={def.key} className="rounded-3xl border border-white/10 bg-black/35 p-4 hover:border-fuchsia-300/25"><div className="mb-3 flex items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-white"><Puzzle className="h-4 w-4 text-fuchsia-200" />{def.name}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{def.description}</p></div><span className={cn('rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-widest', connected ? 'bg-green-400/15 text-green-100' : 'bg-zinc-400/10 text-zinc-400')}>{record?.status ?? 'off'}</span></div><input type="password" value={integrationKeyEntry[def.key] ?? ''} onChange={e => setIntegrationKeyEntry(prev => ({ ...prev, [def.key]: e.target.value }))} placeholder={record?.api_key_encrypted ? maskSecret(record.api_key_encrypted) : def.apiKeyLabel} className="w-full rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-xs text-white outline-none" /><div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => void connectIntegration(def.key)} className="rounded-xl border border-fuchsia-300/20 bg-fuchsia-400/10 px-3 py-2 text-[8px] font-black uppercase tracking-widest text-fuchsia-100"><KeyRound className="inline h-3 w-3" /> Connect</button><button onClick={() => void toggleIntegration(def.key)} className="rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-[8px] font-black uppercase tracking-widest text-cyan-100">{connected ? 'Disable' : 'Enable'}</button></div></div>; })}</div></div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {voiceMode && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-[100] flex min-h-[100dvh] flex-col overflow-y-auto overscroll-contain bg-black/95 text-white backdrop-blur-2xl"
            style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
          >
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <VoidCanvas instability={instability} isActive={isGenerating || isListening || isSpeaking} />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,229,255,0.12),transparent_40%),linear-gradient(to_top,rgba(0,0,0,0.9),transparent,rgba(0,0,0,0.85))]" />
            </div>

            <div className="relative z-10 flex w-full flex-shrink-0 items-center justify-between px-6">
              <div
                className="rounded-full border px-4 py-2 text-[10px] font-black uppercase tracking-[0.3em]"
                style={{
                  color: voiceState === 'recording' ? '#4ADE80' : voiceState === 'transcribing' ? '#FBBF24' : voiceState === 'thinking' ? '#00E5FF' : voiceState === 'speaking' ? '#A78BFA' : 'rgba(255,255,255,0.5)',
                  borderColor: voiceState === 'recording' ? 'rgba(74,222,128,0.4)' : voiceState === 'transcribing' ? 'rgba(251,191,36,0.3)' : voiceState === 'speaking' ? 'rgba(167,139,250,0.3)' : 'rgba(0,229,255,0.25)',
                  background: voiceState === 'recording' ? 'rgba(74,222,128,0.1)' : voiceState === 'transcribing' ? 'rgba(251,191,36,0.08)' : voiceState === 'speaking' ? 'rgba(167,139,250,0.08)' : 'rgba(0,229,255,0.06)',
                }}
              >
                {voiceState === 'recording' ? '● Listening'
                  : voiceState === 'transcribing' ? '◌ Transcribing...'
                  : voiceState === 'thinking' ? '◌ Thinking...'
                  : voiceState === 'speaking' ? '▶ Speaking'
                  : '○ Waiting...'}
              </div>
              <button
                onClick={() => exitVoiceMode()}
                className="rounded-full border border-white/10 bg-white/5 p-3 text-zinc-300 transition-all hover:border-red-500/50 hover:bg-red-500/20 hover:text-red-300"
                aria-label="Exit voice mode"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative z-10 flex min-h-[360px] w-full flex-1 items-center justify-center px-6 py-8">
              <div className="relative flex aspect-square w-full max-w-[min(80vw,520px)] items-center justify-center">
                <Suspense
                  fallback={
                    <AnimatedCasperAvatar
                      size="hero"
                      isActive={voiceState === 'thinking' || voiceState === 'speaking'}
                      isSpeaking={voiceState === 'speaking'}
                      instability={instability}
                      showParticles
                    />
                  }
                >
                  <CasperOrbVisualization
                    state={voiceState}
                    audioLevel={audioLevel}
                    audioLevelRef={audioLevelRef}
                    instability={instability}
                  />
                </Suspense>
              </div>
            </div>

            <div className="relative z-10 mx-auto flex w-full max-w-lg flex-shrink-0 flex-col items-center gap-6 px-6">
              <div className="flex min-h-24 max-h-[32dvh] w-full items-center justify-center overflow-y-auto overscroll-contain px-1 text-center">
                <AnimatePresence mode="wait">
                  {voiceState === 'speaking' && lastSpokenText ? (
                    <motion.p key="speaking" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="break-words text-base font-medium leading-relaxed text-white/90 md:text-xl">
                      “{lastSpokenText}”
                    </motion.p>
                  ) : voiceState === 'thinking' ? (
                    <motion.div key="thinking" className="flex gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      {[0, 1, 2].map(i => <motion.div key={i} className="h-2 w-2 rounded-full bg-white/50" animate={{ y: [0, -8, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }} />)}
                    </motion.div>
                  ) : voiceState === 'transcribing' ? (
                    <motion.p key="transcribing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="italic text-white/50">Transcribing your whisper...</motion.p>
                  ) : voiceState === 'recording' ? (
                    <motion.div key="recording" className="flex h-8 items-center gap-1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      {Array.from({ length: 22 }).map((_, i) => <motion.div key={i} className="w-1 rounded-full bg-green-400/60" animate={{ height: 4 + Math.max(audioLevel, 0.08) * (8 + ((i % 5) * 5)) }} transition={{ duration: 0.1 }} />)}
                    </motion.div>
                  ) : (
                    <motion.p key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="italic text-white/40">Speak naturally. I'll know when you're done.</motion.p>
                  )}
                </AnimatePresence>
              </div>

              <div className="flex items-center gap-4">
                {voiceState === 'recording' ? (
                  <button onClick={() => void finishListening()} className="flex items-center gap-2 rounded-full border border-green-400/40 bg-green-400/10 px-6 py-3 text-xs font-black uppercase tracking-widest text-green-300 transition-all hover:scale-105">
                    <Send className="w-4 h-4" /> Send Now
                  </button>
                ) : voiceState === 'speaking' ? (
                  <button onClick={() => interruptSpeak()} className="flex items-center gap-2 rounded-full border border-fuchsia-300/40 bg-fuchsia-400/10 px-6 py-3 text-xs font-black uppercase tracking-widest text-fuchsia-100 transition-all hover:scale-105">
                    <Mic className="w-4 h-4" /> Interrupt
                  </button>
                ) : (
                  <button onClick={() => void startListeningSession()} disabled={voiceState !== 'idle'} className="flex items-center gap-2 rounded-full border border-cyan-300/35 bg-cyan-400/10 px-6 py-3 text-xs font-black uppercase tracking-widest text-cyan-100 transition-all hover:scale-105 disabled:opacity-30 disabled:hover:scale-100">
                    <Mic className="w-4 h-4" /> Tap to Speak
                  </button>
                )}
                <button
                  onClick={() => { visionActive ? stopCamera() : void startCamera(); }}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-5 py-3 text-xs font-black uppercase tracking-widest transition-all hover:scale-105",
                    visionActive
                      ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                      : "border-white/15 bg-white/5 text-zinc-400"
                  )}
                >
                  {visionActive ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
                  {visionActive ? 'Vision On' : 'Vision'}
                </button>
                {visionActive && (
                  <button
                    onClick={switchCamera}
                    className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-3 text-xs font-black uppercase tracking-widest text-zinc-400 transition-all hover:scale-105 hover:text-white"
                  >
                    <SwitchCamera className="w-4 h-4" />
                  </button>
                )}
              </div>

              {visionActive && (
                <div className="relative mt-4 w-full max-w-xs overflow-hidden rounded-2xl border border-emerald-400/30 bg-black/60">
                  <video
                    ref={(el) => {
                      cameraVideoVoiceRef.current = el;
                      if (el && cameraStreamRef.current && el.srcObject !== cameraStreamRef.current) el.srcObject = cameraStreamRef.current;
                    }}
                    autoPlay
                    playsInline
                    muted
                    className="w-full rounded-2xl"
                    style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
                  />
                  <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-black/60 px-2 py-1">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[8px] font-black uppercase tracking-widest text-emerald-300">
                      {visionAnalyzing ? 'Analyzing...' : 'Vision Active'}
                    </span>
                  </div>
                  {capturedFrame && (
                    <div className="absolute bottom-2 right-2 h-12 w-12 overflow-hidden rounded-lg border border-white/20">
                      <img src={capturedFrame} alt="Captured" className="h-full w-full object-cover" />
                    </div>
                  )}
                </div>
              )}

              {voiceDebug && <div className="mt-2 max-w-xs truncate text-center font-mono text-[10px] text-white/30">{voiceDebug}</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Co-Browse Panel */}
      <AnimatePresence>
        {showCoBrowse && currentUser?.id && (
          <div className={cn("relative z-30", coBrowseExpanded ? "" : "border-b border-white/10", !coBrowseExpanded && "h-[500px]")}>
            <CasperCoBrowse
              userId={currentUser.id}
              onClose={() => { setShowCoBrowse(false); setCoBrowseExpanded(false); }}
              isExpanded={coBrowseExpanded}
              onToggleExpand={() => setCoBrowseExpanded(!coBrowseExpanded)}
            />
          </div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 relative z-10 scrollbar-hide">
        <div className="max-w-3xl mx-auto w-full pt-4">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex gap-4 mb-6",
                  msg.role === 'user' ? "flex-row-reverse" : "flex-row"
                )}
              >
                {msg.role === 'casper' ? (
                  <div className="flex-shrink-0 w-8 h-8 overflow-visible">
                    <AnimatedCasperAvatar size="sm" isActive={false} instability={instability} showParticles={false} />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border overflow-hidden bg-white/5 border-white/10 text-zinc-400">
                    <User className="w-4 h-4" />
                  </div>
                )}
                <div className={cn(
                  "max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed",
                  msg.role === 'user' 
                    ? "bg-white/10 text-white rounded-tr-none" 
                    : "bg-black/40 border border-white/5 text-zinc-300 rounded-tl-none backdrop-blur-md"
                )}>
                  {msg.content}
                  {msg.imageUrls && msg.imageUrls.length > 0 && (
                    <div className="mt-2 flex flex-col gap-2">
                      {msg.imageUrls.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border border-white/10 hover:border-cyan-400/40 transition-colors">
                          <img src={url} alt={`Browser screenshot ${i + 1}`} className="w-full rounded-lg" loading="lazy" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {isGenerating && (
            <div className="flex gap-4 mb-6">
              <div className="flex-shrink-0 w-8 h-8 overflow-visible">
                <AnimatedCasperAvatar size="sm" isActive={true} isSpeaking={true} instability={instability} showParticles={true} />
              </div>
              <div className="bg-black/40 border border-white/5 px-4 py-3 rounded-2xl rounded-tl-none backdrop-blur-md">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" />
                  <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                  <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="relative z-20 p-4 border-t border-white/5 bg-black/40 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto">
          <CasperWaveform isActive={isGenerating || isListening || isSpeaking} instability={instability} />

          {visionActive && !voiceMode && (
            <div className="relative mt-2 mb-2 overflow-hidden rounded-2xl border border-emerald-400/25 bg-black/50">
              <video
                ref={(el) => {
                  cameraVideoRef.current = el;
                  if (el && cameraStreamRef.current && el.srcObject !== cameraStreamRef.current) el.srcObject = cameraStreamRef.current;
                }}
                autoPlay
                playsInline
                muted
                className="h-36 w-full object-cover rounded-2xl"
                style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
              />
              <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-black/60 px-2 py-1">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[8px] font-black uppercase tracking-widest text-emerald-300">
                  {visionAnalyzing ? 'Analyzing...' : 'Casper Vision'}
                </span>
              </div>
              <div className="absolute top-2 right-2 flex gap-1.5">
                <button
                  onClick={switchCamera}
                  className="rounded-full border border-white/15 bg-black/60 p-1.5 text-zinc-300 hover:text-white transition-colors"
                  title="Switch camera"
                >
                  <SwitchCamera className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={stopCamera}
                  className="rounded-full border border-red-400/30 bg-black/60 p-1.5 text-red-300 hover:text-red-200 transition-colors"
                  title="Close camera"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {capturedFrame && (
                <div className="absolute bottom-2 right-2 h-10 w-10 overflow-hidden rounded-lg border border-white/20">
                  <img src={capturedFrame} alt="Last capture" className="h-full w-full object-cover" />
                </div>
              )}
            </div>
          )}

          <div className="relative mt-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={visionActive ? "Ask Casper about what you see..." : "Whisper to Casper..."}
              rows={1}
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 pr-16 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-cyan-500/50 transition-all resize-none"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isGenerating}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 bg-cyan-500 text-black rounded-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-30 disabled:hover:scale-100"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          
          <div className="flex items-center justify-between mt-3 px-2">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className={cn("w-1.5 h-1.5 rounded-full shadow-[0_0_8px]", visionActive ? "bg-emerald-400 shadow-emerald-400/80" : "bg-cyan-500 shadow-cyan-500/80")} />
                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                  {visionActive ? 'Vision Link Active' : 'Neural Link Active'}
                </span>
              </div>
              {aiSettings?.model && aiSettings.model !== 'platform_default' && (
                <div className="flex items-center gap-2">
                  <Cpu className="w-3 h-3 text-cyan-400/60" />
                  <span className="text-[9px] font-black uppercase tracking-widest text-cyan-400/60">Custom Core: {aiSettings.model}</span>
                </div>
              )}
            </div>
            <p className="text-[9px] font-bold text-zinc-700 uppercase tracking-widest">v4.1.0-spectral</p>
          </div>
        </div>
      </div>
      <UpgradePromptModal gate={upgradeGate} open={!!upgradeGate} onClose={() => setUpgradeGate(null)} />
    </div>
  );
};
