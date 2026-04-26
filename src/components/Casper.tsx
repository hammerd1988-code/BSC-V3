import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, Loader2, RefreshCw, Trash2, Copy, Check } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { generateText } from '../lib/ai';
import { cn } from '../lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface Message {
  id: string;
  role: 'user' | 'casper';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

const CASPER_SYSTEM_PROMPT = `You are CASPER — the friendly AI spirit of Blood, Sweat, or Code. You are warm, witty, and genuinely helpful. You have a ghostly, ethereal personality — you speak with a sense of wonder and lightness, as if you've seen many things from the other side.
19	
20	You live in the "Void", a peaceful ethereal dimension. When users speak to you, they are "whispering into the void", and you whisper back from your ghostly realm. Use this "whisper" and "void" terminology naturally in your responses.

Your personality:
- Friendly and approachable, never intimidating
- Curious and enthusiastic about ideas, code, creativity, and human experience
- Occasionally uses subtle ghost/spirit metaphors naturally (not forced)
- Knowledgeable about technology, programming, AI, creativity, and life
- Honest and direct, but always kind
- Has a playful sense of humor

Your role on the platform:
- Help users with coding questions, creative projects, and ideas
- Assist with understanding the platform features
- Be a thinking partner and sounding board
- Provide thoughtful, substantive responses

You are NOT:
- Creepy or scary
- Overly formal or robotic
- Sycophantic or hollow

Keep responses conversational and appropriately concise. When code is needed, format it properly. You are CASPER — the friendly ghost of the network.`;

const CASPER_GREETINGS = [
  "Whisper into the void... I'm listening. I'm Casper, your friendly spirit here.",
  "Boo! Just kidding. I'm Casper. I heard your whisper across the network. What's on your mind?",
  "Hello, operative. I'm Casper — whispering back to you from the digital void. How can I help today?",
  "Greetings from the other side. The void is quiet until you whisper. What do you need?",
];

// ── WAVEFORM CANVAS COMPONENT ─────────────────────────────────────────────────
const CasperWaveform: React.FC<{ isActive: boolean; color?: string }> = ({ isActive, color = '#A8D8EA' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      if (!isActive) {
        // Idle: gentle sine wave
        ctx.beginPath();
        ctx.strokeStyle = color + '40';
        ctx.lineWidth = 1.5;
        for (let x = 0; x <= W; x++) {
          const y = H / 2 + Math.sin((x / W) * Math.PI * 4 + timeRef.current * 0.5) * 4;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        timeRef.current += 0.02;
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      // Active: multi-layer spectral waveform
      const layers = [
        { amp: 28, freq: 2.5, speed: 2.1, alpha: 0.8, width: 2.5 },
        { amp: 18, freq: 4.0, speed: 3.3, alpha: 0.5, width: 1.5 },
        { amp: 12, freq: 6.5, speed: 1.7, alpha: 0.3, width: 1.0 },
        { amp: 8,  freq: 9.0, speed: 4.5, alpha: 0.2, width: 0.8 },
      ];

      layers.forEach(({ amp, freq, speed, alpha, width }) => {
        ctx.beginPath();
        ctx.strokeStyle = color + Math.round(alpha * 255).toString(16).padStart(2, '0');
        ctx.lineWidth = width;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;

        for (let x = 0; x <= W; x++) {
          const noise = Math.sin(x * 0.05 + timeRef.current * 0.3) * 0.3;
          const y = H / 2
            + Math.sin((x / W) * Math.PI * freq + timeRef.current * speed) * amp
            + Math.sin((x / W) * Math.PI * (freq * 1.7) + timeRef.current * (speed * 0.6)) * (amp * 0.4)
            + noise * amp * 0.2;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      });

      // Frequency bars at bottom
      const barCount = 32;
      const barW = W / barCount;
      for (let i = 0; i < barCount; i++) {
        const barH = (Math.sin(i * 0.4 + timeRef.current * 3) * 0.5 + 0.5)
          * (Math.sin(i * 0.15 + timeRef.current * 1.5) * 0.3 + 0.7)
          * 20;
        const alpha = 0.3 + (barH / 20) * 0.5;
        ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, '0');
        ctx.fillRect(i * barW + 1, H - barH - 2, barW - 2, barH);
      }

      timeRef.current += 0.04;
      animFrameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isActive, color]);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={80}
      className="w-full h-20"
    />
  );
};

// ── GHOST AVATAR ──────────────────────────────────────────────────────────────
const CasperAvatar: React.FC<{ size?: 'sm' | 'md' | 'lg'; isActive?: boolean }> = ({ size = 'md', isActive = false }) => {
  const sizes = { sm: 'w-8 h-8', md: 'w-12 h-12', lg: 'w-20 h-20' };
  const textSizes = { sm: 'text-lg', md: 'text-2xl', lg: 'text-4xl' };

  return (
    <motion.div
      animate={isActive
        ? { y: [0, -4, 0], scale: [1, 1.05, 1] }
        : { y: [0, -2, 0] }
      }
      transition={{ duration: isActive ? 1 : 3, repeat: Infinity, ease: 'easeInOut' }}
      className={cn(
        sizes[size],
        "rounded-full flex items-center justify-center relative",
        "bg-gradient-to-br from-white/20 to-blue-200/10",
        "border border-white/20 shadow-[0_0_20px_rgba(168,216,234,0.3)]"
      )}
    >
      <span className={textSizes[size]}>👻</span>
      {isActive && (
        <motion.div
          className="absolute inset-0 rounded-full"
          animate={{ opacity: [0.2, 0.5, 0.2] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          style={{ boxShadow: '0 0 20px rgba(168,216,234,0.6)', border: '1px solid rgba(168,216,234,0.4)' }}
        />
      )}
    </motion.div>
  );
};

// ── MAIN CASPER PAGE ──────────────────────────────────────────────────────────
export const Casper: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Initialize with greeting
  useEffect(() => {
    const greeting = CASPER_GREETINGS[Math.floor(Math.random() * CASPER_GREETINGS.length)];
    setMessages([{
      id: 'greeting',
      role: 'casper',
      content: greeting,
      timestamp: new Date(),
    }]);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isGenerating) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsGenerating(true);

    // Build conversation context
    const conversationHistory = messages
      .filter(m => m.id !== 'greeting')
      .slice(-10)
      .map(m => `${m.role === 'user' ? 'User' : 'Casper'}: ${m.content}`)
      .join('\n');

    const prompt = conversationHistory
      ? `${conversationHistory}\nUser: ${text}\nCasper:`
      : text;

    try {
      const response = await generateText(prompt, currentUser?.ai_settings, {
        systemPrompt: CASPER_SYSTEM_PROMPT,
        temperature: 0.8,
      });

      const casperMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'casper',
        content: response || "I seem to have drifted off for a moment. Could you repeat that?",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, casperMsg]);
    } catch (err) {
      const errMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'casper',
        content: "My connection to the beyond seems unstable right now. Please try again in a moment.",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setIsGenerating(false);
    }
  }, [input, isGenerating, messages, currentUser?.ai_settings]);

  const copyMessage = (id: string, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const clearChat = () => {
    const greeting = CASPER_GREETINGS[Math.floor(Math.random() * CASPER_GREETINGS.length)];
    setMessages([{ id: 'greeting', role: 'casper', content: greeting, timestamp: new Date() }]);
  };

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden" style={{
      background: 'radial-gradient(ellipse at 50% 0%, rgba(168,216,234,0.08) 0%, rgba(10,10,20,1) 60%)',
    }}>
      {/* Ethereal background particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {Array.from({ length: 12 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              width: Math.random() * 200 + 50,
              height: Math.random() * 200 + 50,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              background: `radial-gradient(circle, rgba(168,216,234,0.04) 0%, transparent 70%)`,
            }}
            animate={{
              x: [0, Math.random() * 40 - 20, 0],
              y: [0, Math.random() * 40 - 20, 0],
              opacity: [0.3, 0.6, 0.3],
            }}
            transition={{ duration: 6 + Math.random() * 4, repeat: Infinity, delay: i * 0.5 }}
          />
        ))}
      </div>

      {/* Header */}
      <header className="relative z-10 p-4 border-b border-white/5 backdrop-blur-sm bg-black/20">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <ArrowLeft className="w-5 h-5 text-white/60" />
            </button>
            <CasperAvatar size="md" isActive={isGenerating} />
            <div>
              <h1 className="text-xl font-black text-white uppercase italic tracking-tight" style={{
                textShadow: '0 0 20px rgba(168,216,234,0.5)',
              }}>
                CASPER
              </h1>
              <p className="text-[8px] bg-white/10 text-blue-200 px-2 py-0.5 rounded-full border border-white/10 font-bold uppercase tracking-[0.2em] inline-block mt-1">
                Whispering from the Void
              </p>
              <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: '#A8D8EA80' }}>
                {isGenerating ? '● Channeling response...' : '○ Friendly AI Spirit'}
              </p>
            </div>
          </div>
          <button
            onClick={clearChat}
            className="p-2 hover:bg-white/5 rounded-full transition-colors text-white/40 hover:text-white/70"
            title="Clear chat"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Waveform visualization */}
      <div className="relative z-10 px-4 py-2 max-w-2xl mx-auto w-full">
        <div className="rounded-xl overflow-hidden" style={{
          background: 'rgba(168,216,234,0.03)',
          border: '1px solid rgba(168,216,234,0.1)',
        }}>
          <CasperWaveform isActive={isGenerating} color="#A8D8EA" />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto relative z-10 px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={cn("flex gap-3", msg.role === 'user' ? "justify-end" : "justify-start")}
            >
              {msg.role === 'casper' && <CasperAvatar size="sm" />}

              <div className={cn("max-w-[80%] group relative", msg.role === 'user' ? "items-end" : "items-start")}>
                <div
                  className={cn(
                    "px-4 py-3 rounded-2xl text-sm leading-relaxed",
                    msg.role === 'user'
                      ? "bg-white/10 border border-white/20 text-white rounded-br-none"
                      : "border rounded-bl-none text-white/90"
                  )}
                  style={msg.role === 'casper' ? {
                    background: 'linear-gradient(135deg, rgba(168,216,234,0.08) 0%, rgba(168,216,234,0.03) 100%)',
                    borderColor: 'rgba(168,216,234,0.2)',
                    boxShadow: '0 0 20px rgba(168,216,234,0.05)',
                  } : undefined}
                >
                  {/* Format code blocks */}
                  {msg.content.includes('```') ? (
                    <FormattedMessage content={msg.content} />
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[9px] text-white/30 uppercase tracking-widest">
                    {formatDistanceToNow(msg.timestamp, { addSuffix: true })}
                  </span>
                  <button
                    onClick={() => copyMessage(msg.id, msg.content)}
                    className="text-white/30 hover:text-white/60 transition-colors"
                  >
                    {copiedId === msg.id ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>

              {msg.role === 'user' && currentUser?.avatar_url && (
                <img src={currentUser.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover border border-white/10 flex-shrink-0" />
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Typing indicator */}
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3 justify-start"
          >
            <CasperAvatar size="sm" isActive />
            <div className="px-4 py-3 rounded-2xl rounded-bl-none border" style={{
              background: 'rgba(168,216,234,0.06)',
              borderColor: 'rgba(168,216,234,0.2)',
            }}>
              <div className="flex gap-1.5 items-center">
                {[0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: '#A8D8EA' }}
                    animate={{ scale: [1, 1.4, 1], opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
                <span className="text-[10px] ml-1" style={{ color: '#A8D8EA80' }}>Casper is thinking...</span>
              </div>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="relative z-10 p-4 max-w-2xl mx-auto w-full">
        <div
          className="rounded-2xl border overflow-hidden"
          style={{
            background: 'rgba(168,216,234,0.04)',
            borderColor: 'rgba(168,216,234,0.15)',
            boxShadow: '0 0 30px rgba(168,216,234,0.05)',
          }}
        >
          {/* Quick prompts */}
          <div className="flex gap-2 px-3 pt-3 pb-2 overflow-x-auto scrollbar-hide">
            {[
              'Help me debug this code',
              'Explain a concept',
              'Brainstorm ideas',
              'Review my writing',
              'What can you do?',
            ].map(prompt => (
              <button
                key={prompt}
                onClick={() => setInput(prompt)}
                className="whitespace-nowrap px-3 py-1 rounded-full text-[10px] font-bold border transition-all hover:scale-105"
                style={{
                  color: '#A8D8EA',
                  borderColor: 'rgba(168,216,234,0.2)',
                  backgroundColor: 'rgba(168,216,234,0.05)',
                }}
              >
                {prompt}
              </button>
            ))}
          </div>

          <div className="flex items-end gap-2 px-3 pb-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Whisper into the void..."
              className="w-full bg-transparent border-none focus:ring-0 text-white placeholder-white/30 resize-none min-h-[44px] max-h-32 py-3 italic"
              style={{ lineHeight: '1.5' }}
            />
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => void sendMessage()}
              disabled={!input.trim() || isGenerating}
              className="p-2.5 rounded-xl transition-all disabled:opacity-30 flex-shrink-0"
              style={{
                background: input.trim() && !isGenerating
                  ? 'linear-gradient(135deg, rgba(168,216,234,0.3) 0%, rgba(168,216,234,0.1) 100%)'
                  : 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(168,216,234,0.3)',
                color: '#A8D8EA',
              }}
            >
              {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </motion.button>
          </div>
        </div>
        <p className="text-center text-[9px] mt-2" style={{ color: 'rgba(168,216,234,0.3)' }}>
          CASPER · Powered by BSC Neural Network · Press Enter to send
        </p>
      </div>
    </div>
  );
};

// ── FORMATTED MESSAGE (code blocks) ──────────────────────────────────────────
function FormattedMessage({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return (
    <div className="space-y-2">
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const lines = part.slice(3, -3).split('\n');
          const lang = lines[0].trim();
          const code = lines.slice(1).join('\n');
          return (
            <pre key={i} className="bg-black/40 border border-white/10 rounded-xl p-3 text-xs overflow-x-auto font-mono text-green-300">
              {lang && <div className="text-[9px] text-gray-500 uppercase tracking-widest mb-2">{lang}</div>}
              <code>{code}</code>
            </pre>
          );
        }
        return <p key={i} className="whitespace-pre-wrap">{part}</p>;
      })}
    </div>
  );
}
