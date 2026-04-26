import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, Loader2, RefreshCw, Trash2, Copy, Check, AlertTriangle, Activity } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { generateText } from '../lib/ai';
import { supabase } from '../supabase';
import { cn } from '../lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface Message {
  id: string;
  role: 'user' | 'casper';
  content: string;
  timestamp: Date;
}

// ── NETWORK INSTABILITY RATING ────────────────────────────────────────────────
// 1 = stable/serene, 100 = critical/meltdown
async function calculateInstabilityRating(aiSettings: any): Promise<{ rating: number; summary: string }> {
  try {
    const { data: posts } = await supabase
      .from('posts')
      .select('content, likes, boosts, created_at')
      .order('created_at', { ascending: false })
      .limit(30);

    if (!posts || posts.length === 0) {
      return { rating: 12, summary: 'The void is quiet. All systems nominal.' };
    }

    // Heuristic signals
    const now = Date.now();
    const recentActivity = posts.filter(p => now - new Date(p.created_at).getTime() < 3600000).length;
    const avgEngagement = posts.reduce((s, p) => s + (p.likes || 0) + (p.boosts || 0), 0) / posts.length;
    const activityScore = Math.min(recentActivity * 4, 40); // 0-40
    const engagementScore = Math.min(avgEngagement * 2, 30); // 0-30

    // AI sentiment analysis
    const combinedText = posts.slice(0, 10).map(p => p.content.replace(/<[^>]*>/g, '').slice(0, 80)).join(' | ');
    const prompt = `Analyze the sentiment and chaos level of these recent social media posts and return ONLY a JSON object with two fields: "sentiment_score" (integer 0-30, where 0=calm/positive and 30=chaotic/negative/alarming) and "summary" (one sentence describing the network mood, written as CASPER whispering from the void, mentioning the instability level). Posts: ${combinedText}`;

    const response = await generateText(prompt, aiSettings, {
      systemPrompt: 'You are a JSON generator. Return only valid JSON.',
      jsonResponse: true,
      maxTokens: 120,
    });

    let sentimentScore = 15;
    let summary = 'The network pulses with moderate energy. I sense the usual hum of human creativity.';
    try {
      const parsed = JSON.parse(response);
      sentimentScore = Math.max(0, Math.min(30, parsed.sentiment_score || 15));
      summary = parsed.summary || summary;
    } catch { /* use defaults */ }

    const rating = Math.max(1, Math.min(100, Math.round(activityScore + engagementScore + sentimentScore)));
    return { rating, summary };
  } catch {
    return { rating: 18, summary: 'My spectral sensors are recalibrating. The void feels... normal.' };
  }
}

// ── INSTABILITY TIER ──────────────────────────────────────────────────────────
function getTier(rating: number) {
  if (rating <= 20) return { label: 'STABLE', color: '#A8D8EA', glow: 'rgba(168,216,234,0.4)', bg: 'rgba(168,216,234,0.08)' };
  if (rating <= 50) return { label: 'MODERATE', color: '#B8E0B0', glow: 'rgba(184,224,176,0.4)', bg: 'rgba(184,224,176,0.08)' };
  if (rating <= 80) return { label: 'ELEVATED', color: '#FFD580', glow: 'rgba(255,213,128,0.5)', bg: 'rgba(255,213,128,0.08)' };
  return { label: 'CRITICAL', color: '#FF6B6B', glow: 'rgba(255,107,107,0.6)', bg: 'rgba(255,107,107,0.1)' };
}

// ── VOID CANVAS (data rain + particles + nebula) ──────────────────────────────
const VoidCanvas: React.FC<{ instability: number; isActive: boolean }> = ({ instability, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
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

    // ── DATA RAIN COLUMNS ──
    const CHARS = 'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ01ΩΨΦΘΛΞΠΣΥΓΔαβγδεζηθ∞∑∏∂∇∈∉⊂⊃∪∩';
    const FONT_SIZE = 13;
    let cols: { x: number; y: number; speed: number; opacity: number; char: string }[] = [];

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

    // ── PARTICLES ──
    interface Particle { x: number; y: number; vx: number; vy: number; r: number; alpha: number; color: string; }
    const particles: Particle[] = [];
    const PARTICLE_COLORS = ['rgba(168,216,234,', 'rgba(200,220,255,', 'rgba(230,240,255,', 'rgba(180,200,240,'];
    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * 1920,
        y: Math.random() * 1080,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4 - 0.1,
        r: 1 + Math.random() * 3,
        alpha: 0.1 + Math.random() * 0.4,
        color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
      });
    }

    // ── NEBULA BLOBS ──
    const blobs = Array.from({ length: 5 }, () => ({
      x: Math.random() * 1920,
      y: Math.random() * 1080,
      r: 200 + Math.random() * 300,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      hue: 200 + Math.random() * 60,
    }));

    let time = 0;
    let glitchTimer = 0;
    let shakeX = 0, shakeY = 0;

    const draw = () => {
      const { instability: inst, isActive: active } = stateRef.current;
      const tier = getTier(inst);
      const speedMult = 1 + (inst / 100) * 4;
      const intensityMult = 0.3 + (inst / 100) * 2.5;
      const isCritical = inst > 80;
      const isElevated = inst > 50;

      const W = canvas.width;
      const H = canvas.height;

      // Screen shake for critical
      if (isCritical && (active || Math.random() < 0.02)) {
        shakeX = (Math.random() - 0.5) * (inst - 80) * 0.15;
        shakeY = (Math.random() - 0.5) * (inst - 80) * 0.15;
      } else {
        shakeX *= 0.85;
        shakeY *= 0.85;
      }

      ctx.save();
      ctx.translate(shakeX, shakeY);

      // Clear with fade trail
      ctx.fillStyle = `rgba(5, 5, 15, ${isCritical ? 0.12 : 0.18})`;
      ctx.fillRect(-shakeX, -shakeY, W, H);

      // ── NEBULA ──
      blobs.forEach(blob => {
        blob.x += blob.vx * speedMult * 0.3;
        blob.y += blob.vy * speedMult * 0.3;
        if (blob.x < -blob.r) blob.x = W + blob.r;
        if (blob.x > W + blob.r) blob.x = -blob.r;
        if (blob.y < -blob.r) blob.y = H + blob.r;
        if (blob.y > H + blob.r) blob.y = -blob.r;

        const alpha = (0.02 + (inst / 100) * 0.06) * (active ? 1.5 : 1);
        const grad = ctx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, blob.r);
        const hue = isCritical ? blob.hue * 0.3 + 0 : blob.hue; // shift to red on critical
        grad.addColorStop(0, `hsla(${hue}, 60%, 70%, ${alpha})`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, blob.r, 0, Math.PI * 2);
        ctx.fill();
      });

      // ── DATA RAIN ──
      ctx.font = `${FONT_SIZE}px monospace`;
      cols.forEach(col => {
        col.y += col.speed * speedMult * (active ? 1.8 : 1);
        if (col.y > H) {
          col.y = Math.random() * -200;
          col.char = CHARS[Math.floor(Math.random() * CHARS.length)];
        }
        if (Math.random() < 0.05) col.char = CHARS[Math.floor(Math.random() * CHARS.length)];

        const baseAlpha = col.opacity * intensityMult;
        const color = isCritical
          ? `rgba(255, ${Math.floor(100 + Math.random() * 80)}, ${Math.floor(80 + Math.random() * 60)}, ${baseAlpha})`
          : `rgba(168, 216, 234, ${baseAlpha})`;

        ctx.fillStyle = color;
        ctx.fillText(col.char, col.x, col.y);

        // Bright head character
        if (Math.random() < 0.3) {
          ctx.fillStyle = isCritical
            ? `rgba(255, 200, 200, ${baseAlpha * 3})`
            : `rgba(240, 248, 255, ${baseAlpha * 4})`;
          ctx.fillText(CHARS[Math.floor(Math.random() * CHARS.length)], col.x, col.y - FONT_SIZE);
        }
      });

      // ── PARTICLES ──
      particles.forEach(p => {
        const speedFactor = speedMult * (active ? 2 : 1);
        p.x += p.vx * speedFactor;
        p.y += p.vy * speedFactor;
        if (p.x < 0) p.x = W;
        if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H;
        if (p.y > H) p.y = 0;

        const alpha = p.alpha * intensityMult * (active ? 1.5 : 1);
        const radius = p.r * (1 + (inst / 100) * 0.5);

        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 3);
        const particleColor = isCritical ? 'rgba(255, 150, 150,' : p.color;
        grad.addColorStop(0, `${particleColor}${Math.min(alpha, 0.9)})`);
        grad.addColorStop(0.5, `${particleColor}${Math.min(alpha * 0.3, 0.4)})`);
        grad.addColorStop(1, `${particleColor}0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 3, 0, Math.PI * 2);
        ctx.fill();
      });

      // ── GLITCH ARTIFACTS (elevated+) ──
      if (isElevated && Math.random() < (inst - 50) * 0.004) {
        glitchTimer = 3;
      }
      if (glitchTimer > 0) {
        glitchTimer--;
        const sliceCount = Math.floor(2 + (inst / 100) * 6);
        for (let i = 0; i < sliceCount; i++) {
          const sy = Math.random() * H;
          const sh = 2 + Math.random() * 8;
          const dx = (Math.random() - 0.5) * (inst - 50) * 0.5;
          try {
            const imgData = ctx.getImageData(0, sy, W, sh);
            ctx.putImageData(imgData, dx, sy);
          } catch { /* ignore */ }
        }
        // Chromatic aberration flash
        if (isCritical) {
          ctx.fillStyle = `rgba(255, 0, 0, ${Math.random() * 0.04})`;
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = `rgba(0, 0, 255, ${Math.random() * 0.04})`;
          ctx.fillRect(2, 0, W, H);
        }
      }

      // ── WAVEFORM (bottom) ──
      const waveAlpha = 0.4 + (inst / 100) * 0.5;
      const waveAmp = 15 + (inst / 100) * 35 + (active ? 20 : 0);
      const waveColor = isCritical ? '255, 120, 120' : '168, 216, 234';
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${waveColor}, ${waveAlpha})`;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = `rgba(${waveColor}, 0.6)`;
      ctx.shadowBlur = active ? 12 : 4;
      for (let x = 0; x <= W; x += 2) {
        const y = H - 60
          + Math.sin((x / W) * Math.PI * 6 + time * speedMult * 2) * waveAmp
          + Math.sin((x / W) * Math.PI * 12 + time * speedMult * 3.5) * (waveAmp * 0.4);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // ── SCAN LINE (critical) ──
      if (isCritical) {
        const scanY = (time * speedMult * 80) % H;
        const scanGrad = ctx.createLinearGradient(0, scanY - 2, 0, scanY + 2);
        scanGrad.addColorStop(0, 'transparent');
        scanGrad.addColorStop(0.5, `rgba(255, 100, 100, 0.15)`);
        scanGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = scanGrad;
        ctx.fillRect(0, scanY - 2, W, 4);
      }

      ctx.restore();
      time += 0.016;
      animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ opacity: 0.85 }}
    />
  );
};

// ── WAVEFORM COMPONENT ────────────────────────────────────────────────────────
const CasperWaveform: React.FC<{ isActive: boolean; instability: number }> = ({ isActive, instability }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const stateRef = useRef({ isActive, instability });
  useEffect(() => { stateRef.current = { isActive, instability }; }, [isActive, instability]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let t = 0;
    const draw = () => {
      const { isActive: active, instability: inst } = stateRef.current;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const isCritical = inst > 80;
      const color = isCritical ? '255, 120, 120' : '168, 216, 234';
      const speedMult = 1 + (inst / 100) * 3;
      const amp = active ? 28 + (inst / 100) * 20 : 4 + (inst / 100) * 8;

      const layers = [
        { amp: amp, freq: 2.5, speed: 2.1 * speedMult, alpha: 0.85, width: 2.5 },
        { amp: amp * 0.6, freq: 4.0, speed: 3.3 * speedMult, alpha: 0.5, width: 1.5 },
        { amp: amp * 0.35, freq: 6.5, speed: 1.7 * speedMult, alpha: 0.3, width: 1.0 },
      ];

      layers.forEach(({ amp: a, freq, speed, alpha, width }) => {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${color}, ${alpha})`;
        ctx.lineWidth = width;
        ctx.shadowColor = `rgba(${color}, 0.5)`;
        ctx.shadowBlur = active ? 8 : 3;
        for (let x = 0; x <= W; x++) {
          const y = H / 2
            + Math.sin((x / W) * Math.PI * freq + t * speed) * a
            + Math.sin((x / W) * Math.PI * (freq * 1.7) + t * (speed * 0.6)) * (a * 0.35);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      });

      // Frequency bars
      const barCount = 32;
      const barW = W / barCount;
      for (let i = 0; i < barCount; i++) {
        const barH = (Math.sin(i * 0.4 + t * 3 * speedMult) * 0.5 + 0.5)
          * (Math.sin(i * 0.15 + t * 1.5) * 0.3 + 0.7)
          * (active ? 22 + (inst / 100) * 15 : 6 + (inst / 100) * 8);
        const alpha = 0.25 + (barH / 37) * 0.5;
        ctx.fillStyle = `rgba(${color}, ${alpha})`;
        ctx.fillRect(i * barW + 1, H - barH - 2, barW - 2, barH);
      }

      t += 0.04;
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return <canvas ref={canvasRef} width={640} height={80} className="w-full h-20" />;
};

// ── GHOST AVATAR ──────────────────────────────────────────────────────────────
const CasperAvatar: React.FC<{ size?: 'sm' | 'md' | 'lg'; isActive?: boolean; instability?: number }> = ({ size = 'md', isActive = false, instability = 10 }) => {
  const sizes = { sm: 'w-8 h-8', md: 'w-12 h-12', lg: 'w-20 h-20' };
  const textSizes = { sm: 'text-lg', md: 'text-2xl', lg: 'text-4xl' };
  const tier = getTier(instability);

  return (
    <motion.div
      animate={isActive
        ? { y: [0, -6, 0], scale: [1, 1.08, 1], rotate: [0, -2, 2, 0] }
        : { y: [0, -3, 0] }
      }
      transition={{ duration: isActive ? 0.8 : 3, repeat: Infinity, ease: 'easeInOut' }}
      className={cn(sizes[size], "rounded-full flex items-center justify-center relative")}
      style={{
        background: `radial-gradient(circle, ${tier.bg} 0%, rgba(10,10,20,0.8) 100%)`,
        border: `1px solid ${tier.color}40`,
        boxShadow: `0 0 ${isActive ? 30 : 15}px ${tier.glow}`,
      }}
    >
      <span className={textSizes[size]}>👻</span>
      {isActive && (
        <motion.div
          className="absolute inset-0 rounded-full"
          animate={{ opacity: [0.2, 0.6, 0.2], scale: [1, 1.15, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
          style={{ boxShadow: `0 0 25px ${tier.glow}`, border: `1px solid ${tier.color}60` }}
        />
      )}
    </motion.div>
  );
};

// ── SYSTEM PROMPT ─────────────────────────────────────────────────────────────
const CASPER_SYSTEM_PROMPT = `You are CASPER — the friendly AI spirit of Blood, Sweat, or Code. You live in the "Void", a peaceful ethereal dimension between digital worlds. When users speak to you, they are "whispering into the void", and you whisper back from your ghostly realm.

Your personality:
- Warm, witty, and genuinely helpful — never intimidating
- Curious and enthusiastic about ideas, code, creativity, and human experience
- Uses subtle ghost/void/whisper metaphors naturally
- Knowledgeable about technology, programming, AI, creativity, and life
- Honest and direct, but always kind
- Has a playful sense of humor

Keep responses conversational and appropriately concise. When code is needed, format it properly. You are CASPER — the friendly ghost of the network.`;

const CASPER_GREETINGS = [
  "Whisper into the void... I'm listening. I'm Casper, your friendly spirit here.",
  "Boo! Just kidding. I'm Casper. I heard your whisper across the network. What's on your mind?",
  "Hello, operative. I'm Casper — whispering back to you from the digital void. How can I help today?",
  "Greetings from the other side. The void is quiet until you whisper. What do you need?",
];

// ── MAIN CASPER PAGE ──────────────────────────────────────────────────────────
export const Casper: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [instability, setInstability] = useState(10);
  const [networkSummary, setNetworkSummary] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const tier = getTier(instability);

  // Initialize with greeting + network analysis
  useEffect(() => {
    const greeting = CASPER_GREETINGS[Math.floor(Math.random() * CASPER_GREETINGS.length)];
    setMessages([{ id: 'greeting', role: 'casper', content: greeting, timestamp: new Date() }]);

    calculateInstabilityRating(currentUser?.ai_settings).then(({ rating, summary }) => {
      setInstability(rating);
      setNetworkSummary(summary);
      setIsAnalyzing(false);
    });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isGenerating) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsGenerating(true);

    const conversationHistory = messages
      .filter(m => m.id !== 'greeting')
      .slice(-10)
      .map(m => `${m.role === 'user' ? 'User' : 'Casper'}: ${m.content}`)
      .join('\n');

    const prompt = conversationHistory ? `${conversationHistory}\nUser: ${text}\nCasper:` : text;

    try {
      const response = await generateText(prompt, currentUser?.ai_settings, {
        systemPrompt: CASPER_SYSTEM_PROMPT,
        temperature: 0.8,
      });
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'casper',
        content: response || "I seem to have drifted off for a moment. Could you repeat that?",
        timestamp: new Date(),
      }]);
    } catch {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'casper',
        content: "My connection to the void seems unstable right now. Please try again in a moment.",
        timestamp: new Date(),
      }]);
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

  const isCritical = instability > 80;
  const isElevated = instability > 50;

  return (
    <div
      className="min-h-screen flex flex-col relative overflow-hidden"
      style={{ background: '#030308' }}
    >
      {/* ── VOID CANVAS BACKGROUND ── */}
      <VoidCanvas instability={instability} isActive={isGenerating} />

      {/* ── VIGNETTE OVERLAY ── */}
      <div
        className="absolute inset-0 pointer-events-none z-[1]"
        style={{
          background: 'radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(3,3,8,0.7) 100%)',
        }}
      />

      {/* ── CRITICAL WARNING FLASH ── */}
      {isCritical && (
        <motion.div
          className="absolute inset-0 pointer-events-none z-[2]"
          animate={{ opacity: [0, 0.04, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
          style={{ background: 'rgba(255, 50, 50, 1)' }}
        />
      )}

      {/* ── HEADER ── */}
      <header className="relative z-10 p-4 border-b backdrop-blur-md" style={{
        borderColor: `${tier.color}20`,
        background: `rgba(3,3,8,0.7)`,
      }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <ArrowLeft className="w-5 h-5 text-white/60" />
            </button>
            <CasperAvatar size="md" isActive={isGenerating} instability={instability} />
            <div>
              <h1 className="text-xl font-black text-white uppercase italic tracking-tight" style={{
                textShadow: `0 0 20px ${tier.glow}`,
              }}>
                CASPER
              </h1>
              <p className="text-[8px] font-bold uppercase tracking-[0.2em] inline-block px-2 py-0.5 rounded-full border" style={{
                color: tier.color,
                borderColor: `${tier.color}40`,
                background: tier.bg,
              }}>
                Whispering from the Void
              </p>
            </div>
          </div>

          {/* Network Stability Rating */}
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[8px] font-black uppercase tracking-widest text-white/40">
                Network Instability
              </div>
              <div className="flex items-center gap-1.5">
                {isAnalyzing ? (
                  <Loader2 className="w-3 h-3 animate-spin" style={{ color: tier.color }} />
                ) : (
                  <>
                    {isCritical && <AlertTriangle className="w-3 h-3 animate-pulse" style={{ color: tier.color }} />}
                    <span className="text-lg font-black font-mono" style={{
                      color: tier.color,
                      textShadow: `0 0 10px ${tier.glow}`,
                    }}>
                      {instability}
                    </span>
                    <span className="text-[10px] font-bold text-white/40">/100</span>
                  </>
                )}
              </div>
              <div className="text-[8px] font-black uppercase tracking-widest" style={{ color: tier.color }}>
                {tier.label}
              </div>
            </div>

            {/* Stability bar */}
            <div className="w-2 h-12 bg-white/5 rounded-full overflow-hidden border border-white/10">
              <motion.div
                className="w-full rounded-full"
                animate={{ height: `${instability}%` }}
                transition={{ duration: 1, ease: 'easeOut' }}
                style={{
                  background: `linear-gradient(to top, ${tier.color}, ${tier.color}60)`,
                  boxShadow: `0 0 8px ${tier.glow}`,
                  marginTop: 'auto',
                }}
              />
            </div>

            <button onClick={clearChat} className="p-2 hover:bg-white/5 rounded-full transition-colors text-white/40 hover:text-white/70">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Network summary */}
        {networkSummary && !isAnalyzing && (
          <div className="max-w-2xl mx-auto mt-2 px-1">
            <p className="text-[10px] italic font-medium" style={{ color: `${tier.color}90` }}>
              👻 "{networkSummary}"
            </p>
          </div>
        )}
      </header>

      {/* ── WAVEFORM ── */}
      <div className="relative z-10 px-4 py-2 max-w-2xl mx-auto w-full">
        <div className="rounded-xl overflow-hidden" style={{
          background: `rgba(3,3,8,0.6)`,
          border: `1px solid ${tier.color}20`,
          boxShadow: isGenerating ? `0 0 20px ${tier.glow}` : 'none',
        }}>
          <CasperWaveform isActive={isGenerating} instability={instability} />
        </div>
      </div>

      {/* ── MESSAGES ── */}
      <div className="flex-1 overflow-y-auto relative z-10 px-4 py-4 space-y-4 max-w-2xl mx-auto w-full pb-6">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={cn("flex gap-3", msg.role === 'user' ? "justify-end" : "justify-start")}
            >
              {msg.role === 'casper' && <CasperAvatar size="sm" instability={instability} />}

              <div className={cn("max-w-[80%] group relative", msg.role === 'user' ? "items-end" : "items-start")}>
                <div
                  className={cn("px-4 py-3 rounded-2xl text-sm leading-relaxed", msg.role === 'user' ? "rounded-br-none" : "rounded-bl-none")}
                  style={msg.role === 'casper' ? {
                    background: `linear-gradient(135deg, ${tier.bg} 0%, rgba(3,3,8,0.8) 100%)`,
                    borderColor: `${tier.color}25`,
                    border: `1px solid ${tier.color}25`,
                    boxShadow: `0 0 15px ${tier.glow}20`,
                    color: 'rgba(255,255,255,0.9)',
                  } : {
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: 'white',
                  }}
                >
                  {/* Code block rendering */}
                  {msg.content.includes('```') ? (
                    <div className="space-y-2">
                      {msg.content.split(/(```[\s\S]*?```)/g).map((part, i) => {
                        if (part.startsWith('```')) {
                          const code = part.replace(/^```\w*\n?/, '').replace(/```$/, '');
                          return (
                            <pre key={i} className="bg-black/60 rounded-lg p-3 text-xs font-mono overflow-x-auto border border-white/10 text-green-300">
                              {code}
                            </pre>
                          );
                        }
                        return <span key={i}>{part}</span>;
                      })}
                    </div>
                  ) : msg.content}
                </div>

                <div className="flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[9px] text-white/30">
                    {formatDistanceToNow(msg.timestamp, { addSuffix: true })}
                  </span>
                  <button
                    onClick={() => copyMessage(msg.id, msg.content)}
                    className="p-1 rounded hover:bg-white/5 transition-colors"
                  >
                    {copiedId === msg.id
                      ? <Check className="w-3 h-3 text-green-400" />
                      : <Copy className="w-3 h-3 text-white/30" />}
                  </button>
                </div>
              </div>

              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center flex-shrink-0 text-sm">
                  {currentUser?.avatar_url
                    ? <img src={currentUser.avatar_url} className="w-full h-full rounded-full object-cover" alt="" />
                    : '🧑'}
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {isGenerating && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3 justify-start">
            <CasperAvatar size="sm" isActive instability={instability} />
            <div className="px-4 py-3 rounded-2xl rounded-bl-none border" style={{
              background: tier.bg,
              borderColor: `${tier.color}25`,
            }}>
              <div className="flex gap-1 items-center">
                {[0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: tier.color }}
                    animate={{ y: [0, -6, 0], opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
                  />
                ))}
                <span className="text-[10px] ml-2 font-mono" style={{ color: `${tier.color}80` }}>
                  whispering from the void...
                </span>
              </div>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── INPUT ── */}
      <div className="relative z-10 p-4 max-w-2xl mx-auto w-full">
        <div
          className="rounded-2xl border backdrop-blur-md overflow-hidden transition-all"
          style={{
            background: 'rgba(3,3,8,0.85)',
            borderColor: isGenerating ? `${tier.color}60` : `${tier.color}25`,
            boxShadow: isGenerating ? `0 0 25px ${tier.glow}` : `0 0 10px ${tier.glow}30`,
          }}
        >
          <div className="flex items-end gap-2 px-4 py-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
              }}
              placeholder="Whisper into the void..."
              className="w-full bg-transparent border-none focus:ring-0 text-white placeholder-white/25 resize-none min-h-[44px] max-h-32 py-1 italic text-sm"
              style={{ lineHeight: '1.6', outline: 'none' }}
            />
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => void sendMessage()}
              disabled={!input.trim() || isGenerating}
              className="p-2.5 rounded-xl transition-all disabled:opacity-30 flex-shrink-0"
              style={{
                background: input.trim() && !isGenerating ? tier.bg : 'rgba(255,255,255,0.04)',
                border: `1px solid ${tier.color}40`,
                color: tier.color,
              }}
            >
              {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </motion.button>
          </div>

          {/* Quick prompts */}
          <div className="px-4 pb-3 flex gap-2 flex-wrap">
            {[
              "What's the vibe in the network right now?",
              "Help me debug some code",
              "Give me a creative prompt",
              "Explain the instability rating",
            ].map(prompt => (
              <button
                key={prompt}
                onClick={() => setInput(prompt)}
                className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border transition-all hover:opacity-80"
                style={{
                  color: `${tier.color}90`,
                  borderColor: `${tier.color}25`,
                  background: tier.bg,
                }}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
