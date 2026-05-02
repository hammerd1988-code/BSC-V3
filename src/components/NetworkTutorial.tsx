import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Bot, ChevronLeft, ChevronRight, Ghost, MessageCircle, Radio, Sparkles, Swords, User, Zap, Cpu } from 'lucide-react';
import { cn } from '../lib/utils';

interface NetworkTutorialProps {
  onComplete: () => void;
}

const SLIDES = [
  {
    title: "Welcome to BSC",
    kicker: "You've entered the network",
    description: "The perimeter has been breached. Your node is now live on Blood, Sweat, or Code—the high-signal grid for builders and operators.",
    icon: Radio,
    accent: '#00e5ff', // Cyan
  },
  {
    title: "The Feed",
    kicker: "Signal Layer",
    description: "Transmit your builds, interact with other operators, and earn CRED. In this network, signal is rewarded and noise is filtered.",
    icon: Zap,
    accent: '#f97316', // Orange
  },
  {
    title: "Transmissions",
    kicker: "Secure Links",
    description: "Direct messaging with real-time status and secure file sharing. Move your conversations beneath the surface when privacy is paramount.",
    icon: MessageCircle,
    accent: '#a78bfa', // Purple
  },
  {
    title: "Casper",
    kicker: "AI Ghost Assistant",
    description: "Your personal ghost in the machine. Chat with Casper for context, creative sparks, or a strange kind of digital clarity.",
    icon: Ghost,
    accent: '#ffffff', // White/Silver
  },
  {
    title: "The Colosseum",
    kicker: "Code Battles",
    description: "Forge AI gladiators, compete in code battles, and spectate live arena matches. Where coding instincts become reputation.",
    icon: Swords,
    accent: '#f43f5e', // Rose/Red
  },
  {
    title: "Bot Forge",
    kicker: "Marketplace Layer",
    description: "Create and publish bots with unique personalities and tools. Deploy them to the marketplace to operate beyond your terminal.",
    icon: Bot,
    accent: '#22c55e', // Green
  },
  {
    title: "Your Profile",
    kicker: "Identity Core",
    description: "Customize your presence, accent color, and bio. Your profile is your signal signature—make it represent your true potential.",
    icon: User,
    accent: '#facc15', // Yellow
  },
];

export const NetworkTutorial: React.FC<NetworkTutorialProps> = ({ onComplete }) => {
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index];
  const Icon = slide.icon;
  
  const particles = useMemo(() => Array.from({ length: 40 }, (_, i) => ({
    id: i,
    left: `${(i * 37) % 100}%`,
    top: `${(i * 19) % 100}%`,
    delay: i * 0.1,
    size: Math.random() * 2 + 1,
  })), []);

  const finish = () => onComplete();
  const next = () => index === SLIDES.length - 1 ? finish() : setIndex((prev) => prev + 1);
  const back = () => setIndex((prev) => Math.max(0, prev - 1));

  return (
    <div className="fixed inset-0 z-[300] overflow-hidden bg-black text-white">
      {/* Cyberpunk Background Elements */}
      <div className="absolute inset-0 bg-[#030308]" />
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(0,229,255,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(0,229,255,0.1)_1px,transparent_1px)] [background-size:50px_50px]" />
      
      {/* Ambient Glows */}
      <div 
        className="absolute inset-0 transition-colors duration-1000 opacity-30"
        style={{ 
          background: `radial-gradient(circle at 50% 50%, ${slide.accent}33, transparent 70%)` 
        }} 
      />

      {/* Floating Particles */}
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-white opacity-20"
          style={{ 
            left: p.left, 
            top: p.top, 
            width: p.size, 
            height: p.size,
            boxShadow: `0 0 10px ${slide.accent}`
          }}
          animate={{ 
            y: [0, -40, 0],
            opacity: [0.1, 0.4, 0.1],
            scale: [1, 1.2, 1]
          }}
          transition={{ 
            duration: 4 + (p.id % 4), 
            repeat: Infinity, 
            delay: p.delay,
            ease: "easeInOut"
          }}
        />
      ))}

      {/* Circuit Lines Decoration */}
      <svg className="absolute inset-0 w-full h-full opacity-10 pointer-events-none">
        <pattern id="circuit" x="0" y="0" width="100" height="100" patternUnits="userSpaceOnUse">
          <path d="M0 50 H30 L40 40 H70 L80 50 H100" fill="none" stroke={slide.accent} strokeWidth="0.5" />
          <path d="M50 0 V30 L60 40 V70 L50 80 V100" fill="none" stroke={slide.accent} strokeWidth="0.5" />
          <circle cx="30" cy="50" r="1.5" fill={slide.accent} />
          <circle cx="70" cy="40" r="1.5" fill={slide.accent} />
        </pattern>
        <rect width="100%" height="100%" fill="url(#circuit)" />
      </svg>

      <button
        type="button"
        onClick={finish}
        className="absolute right-8 top-8 z-50 group flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-white/5 backdrop-blur-md transition-all hover:border-red-500/50 hover:bg-red-500/10"
      >
        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 group-hover:text-red-400">Skip Tutorial</span>
        <X className="w-3 h-3 text-zinc-500 group-hover:text-red-400" />
      </button>

      <div className="relative z-10 flex min-h-screen items-center justify-center p-6">
        <motion.div 
          layout
          className="w-full max-w-4xl overflow-hidden rounded-[2.5rem] border border-white/10 bg-black/40 p-8 shadow-[0_0_100px_rgba(0,0,0,0.5)] backdrop-blur-3xl md:p-12"
          style={{ boxShadow: `0 0 80px ${slide.accent}15` }}
        >
          <div className="mb-10 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-1 w-12 rounded-full" style={{ backgroundColor: slide.accent, boxShadow: `0 0 15px ${slide.accent}` }} />
              <span className="text-[10px] font-black uppercase tracking-[0.5em] text-zinc-500">Initiation Protocol</span>
            </div>
            <div className="rounded-full border border-white/5 bg-white/5 px-4 py-1.5">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Node Sync: {Math.round(((index + 1) / SLIDES.length) * 100)}%</span>
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={index}
              initial={{ opacity: 0, x: 40, filter: 'blur(10px)' }}
              animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, x: -40, filter: 'blur(10px)' }}
              transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
              className="grid gap-12 md:grid-cols-[1fr_1.5fr] md:items-center"
            >
              <div className="relative aspect-square w-full max-w-[280px] mx-auto">
                {/* Icon Background Hexagon/Circuit style */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <motion.div 
                    animate={{ rotate: 360 }} 
                    transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                    className="absolute inset-0 rounded-[3rem] border border-white/5 bg-white/[0.02]" 
                  />
                  <motion.div 
                    animate={{ rotate: -360 }} 
                    transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}
                    className="absolute inset-4 rounded-[2.5rem] border border-white/10" 
                  />
                  <div className="absolute inset-0 blur-3xl opacity-20" style={{ backgroundColor: slide.accent }} />
                </div>
                
                <div className="relative flex h-full w-full items-center justify-center">
                  <Icon 
                    className="h-24 w-24 drop-shadow-[0_0_30px_rgba(255,255,255,0.2)]" 
                    style={{ color: slide.accent, filter: `drop-shadow(0 0 15px ${slide.accent}80)` }} 
                  />
                </div>
              </div>

              <div className="text-left">
                <p className="text-[11px] font-black uppercase tracking-[0.4em] mb-3" style={{ color: slide.accent }}>{slide.kicker}</p>
                <h2 className="text-4xl font-black uppercase italic leading-none tracking-tighter text-white sm:text-6xl">
                  {slide.title}
                </h2>
                <p className="mt-6 text-base leading-relaxed text-zinc-400 max-w-lg">
                  {slide.description}
                </p>
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="mt-16 flex flex-col-reverse gap-8 md:flex-row md:items-center md:justify-between">
            {/* Progress Dots */}
            <div className="flex justify-center gap-3">
              {SLIDES.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIndex(i)}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-500",
                    i === index ? "w-10" : "w-3 bg-white/10 hover:bg-white/20"
                  )}
                  style={i === index ? { backgroundColor: slide.accent, boxShadow: `0 0 15px ${slide.accent}` } : {}}
                />
              ))}
            </div>

            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={back}
                disabled={index === 0}
                className="group flex items-center gap-2 rounded-xl border border-white/5 bg-white/5 px-6 py-4 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400 transition-all hover:bg-white/10 disabled:opacity-20"
              >
                <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
                Back
              </button>
              
              <button
                type="button"
                onClick={next}
                className="group flex items-center gap-3 rounded-xl px-8 py-4 text-[11px] font-black uppercase tracking-[0.3em] text-black transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{ 
                  backgroundColor: slide.accent,
                  boxShadow: `0 0 40px ${slide.accent}40`
                }}
              >
                {index === SLIDES.length - 1 ? 'Enter Network' : 'Next Transmission'}
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

const X = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);
