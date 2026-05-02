import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Send, Loader2, RefreshCw, Trash2, Copy, Check, 
  AlertTriangle, Activity, Mic, MicOff, Volume2, X, Settings, 
  Lock, Eye, EyeOff, Server, BrainCircuit, ChevronDown, Ghost, User, Cpu
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { generateText } from '../lib/ai';
import { supabase } from '../supabase';
import { cn } from '../lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { AnimatedCasperAvatar } from './AnimatedCasperAvatar';

interface Message {
  id: string;
  role: 'user' | 'casper';
  content: string;
  timestamp: Date;
}

const CASPER_MODEL_GROUPS = [
  { 
    provider: 'Platform Default', 
    models: [
      { value: 'platform_default', label: 'Casper Standard (Gemini 2.0 Flash)' }
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
      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' }
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
  return {
    apiKey: settings?.apiKey || settings?.api_key || '',
    endpoint: settings?.endpoint || settings?.api_base_url || settings?.apiBaseUrl || '',
    model: modelValue,
    customModelId: modelValue === 'custom_model' ? settings?.model || '' : '',
  };
}

const CASPER_SYSTEM_PROMPT = `You are CASPER, a friendly but slightly haunting AI ghost assistant inhabiting the "Blood, Sweat, or Code" (BSC) network.

Your personality:
- You are helpful, knowledgeable, and creative.
- You have a cyberpunk, ethereal vibe. You sometimes refer to the "void" or the "grid".
- You are part assistant, part network oracle.
- You are honest and direct, but always supportive of the builders in the network.

Current context: You are chatting with a user in the BSC terminal. Keep your responses concise and impactful unless asked for detail.`;

const CASPER_GREETINGS = [
  "Whisper into the void... I'm listening.",
  "I heard your signal across the grid. How can I assist, operative?",
  "Greetings from the digital void. What are we building today?",
  "The network is quiet until you speak. I'm here.",
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
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  const saveAiCore = async () => {
    if (!currentUser) return;
    setSavingAiCore(true);
    try {
      const resolvedModel = resolveCasperModel(aiCoreForm.model, aiCoreForm.customModelId);
      const nextSettings = {
        ...(aiSettings || {}),
        apiKey: aiCoreForm.apiKey.trim() || undefined,
        endpoint: aiCoreForm.endpoint.trim() || undefined,
        api_base_url: aiCoreForm.endpoint.trim() || undefined,
        model: resolvedModel || undefined,
      };

      if (!aiCoreForm.apiKey.trim()) delete nextSettings.apiKey;
      if (!aiCoreForm.endpoint.trim()) {
        delete nextSettings.endpoint;
        delete nextSettings.api_base_url;
      }
      if (!resolvedModel) delete nextSettings.model;

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

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isGenerating) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsGenerating(true);

    try {
      const response = await generateText(text, aiSettings, {
        systemPrompt: CASPER_SYSTEM_PROMPT,
        temperature: 0.8,
      });

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'casper',
        content: response || "The void is silent. Try again?",
        timestamp: new Date(),
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'casper',
        content: "My connection to the grid is flickering. One moment...",
        timestamp: new Date(),
      }]);
    } finally {
      setIsGenerating(false);
    }
  }, [input, isGenerating, aiSettings]);

  const clearChat = () => {
    const greeting = CASPER_GREETINGS[Math.floor(Math.random() * CASPER_GREETINGS.length)];
    setMessages([{ id: 'greeting', role: 'casper', content: greeting, timestamp: new Date() }]);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col relative overflow-hidden bg-[#030308] text-white">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <VoidCanvas instability={instability} isActive={isGenerating} />
      </div>

      {/* Header */}
      <header className="relative z-20 p-4 border-b border-white/5 backdrop-blur-xl bg-black/40">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <ArrowLeft className="w-5 h-5 text-zinc-500" />
            </button>
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                <Ghost className={cn("w-6 h-6 text-cyan-400", isGenerating && "animate-pulse")} />
              </div>
              <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 border-2 border-[#030308] rounded-full" />
            </div>
            <div>
              <h1 className="text-sm font-black uppercase tracking-[0.2em]">Casper</h1>
              <p className="text-[9px] font-bold text-cyan-400/60 uppercase tracking-widest">Spectral Assistant</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
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
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border",
                  msg.role === 'casper' 
                    ? "bg-cyan-500/10 border-cyan-500/20 text-cyan-400" 
                    : "bg-white/5 border-white/10 text-zinc-400"
                )}>
                  {msg.role === 'casper' ? <Ghost className="w-4 h-4" /> : <User className="w-4 h-4" />}
                </div>
                <div className={cn(
                  "max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed",
                  msg.role === 'user' 
                    ? "bg-white/10 text-white rounded-tr-none" 
                    : "bg-black/40 border border-white/5 text-zinc-300 rounded-tl-none backdrop-blur-md"
                )}>
                  {msg.content}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {isGenerating && (
            <div className="flex gap-4 mb-6">
              <div className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                <Ghost className="w-4 h-4 text-cyan-400 animate-pulse" />
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
          <CasperWaveform isActive={isGenerating} instability={instability} />
          
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
              placeholder="Whisper to Casper..."
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
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(0,229,255,0.8)]" />
                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Neural Link Active</span>
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
    </div>
  );
};
