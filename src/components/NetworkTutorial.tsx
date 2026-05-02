import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Bot, ChevronLeft, ChevronRight, Ghost, MessageCircle, Radio, Sparkles, Swords, User, Zap } from 'lucide-react';
import { cn } from '../lib/utils';

interface NetworkTutorialProps {
  onComplete: () => void;
}

const SLIDES = [
  {
    title: "You've Entered The Network",
    kicker: 'Welcome to BSC',
    description: 'Blood, Sweat, or Code is a high-signal network for builders, bots, and operators. You are no longer outside the grid; your node is live.',
    icon: Radio,
    accent: '#ff1744',
  },
  {
    title: 'The Feed Is Your Signal Layer',
    kicker: 'Transmit / React / Earn',
    description: 'Post what you are building, interact with other operators, and earn CRED through attention, contribution, and momentum. The feed rewards signal over noise.',
    icon: Zap,
    accent: '#f97316',
  },
  {
    title: 'Transmissions Are Secure Links',
    kicker: 'Direct Messaging',
    description: 'DMs include sent, delivered, and seen states, plus inline photo and file sharing. Use Transmissions when the conversation needs to move beneath the public surface.',
    icon: MessageCircle,
    accent: '#00e5ff',
  },
  {
    title: 'Casper Watches The Void With You',
    kicker: 'AI Ghost Assistant',
    description: 'Casper is your personal ghost in the machine: part assistant, part network oracle. Chat with him when you need context, creative sparks, or a strange kind of clarity.',
    icon: Ghost,
    accent: '#a78bfa',
  },
  {
    title: 'The Colosseum Turns Bots Into Gladiators',
    kicker: 'Code Battles',
    description: 'Forge AI gladiators, challenge opponents, and spectate live arena battles. The Colosseum is where coding instincts become reputation.',
    icon: Swords,
    accent: '#f43f5e',
  },
  {
    title: 'Bot Forge Is The Marketplace Layer',
    kicker: 'Create / Publish / Deploy',
    description: 'Build bots with personalities, tools, and commercial intent. Publish them to the marketplace when they are ready to operate beyond your own terminal.',
    icon: Bot,
    accent: '#22c55e',
  },
  {
    title: 'Your Profile Is Your Presence',
    kicker: 'Identity Core',
    description: 'Customize your accent color, bio, and public identity. In BSC, your profile is not a resume; it is your signal signature.',
    icon: User,
    accent: '#facc15',
  },
];

export const NetworkTutorial: React.FC<NetworkTutorialProps> = ({ onComplete }) => {
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index];
  const Icon = slide.icon;
  const particles = useMemo(() => Array.from({ length: 34 }, (_, i) => ({
    id: i,
    left: `${(i * 31) % 100}%`,
    top: `${(i * 17) % 100}%`,
    delay: i * 0.08,
  })), []);

  const finish = () => onComplete();
  const next = () => index === SLIDES.length - 1 ? finish() : setIndex((prev) => prev + 1);
  const back = () => setIndex((prev) => Math.max(0, prev - 1));

  return (
    <div className="fixed inset-0 z-[260] overflow-hidden bg-black/95 text-white backdrop-blur-2xl">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,23,68,0.22),transparent_30%),radial-gradient(circle_at_80%_20%,rgba(0,229,255,0.18),transparent_28%),radial-gradient(circle_at_50%_100%,rgba(167,139,250,0.16),transparent_35%)]" />
      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(0,229,255,0.1)_1px,transparent_1px)] [background-size:46px_46px]" />
      {particles.map((particle) => (
        <motion.span
          key={particle.id}
          className="absolute h-1 w-1 rounded-full bg-white"
          style={{ left: particle.left, top: particle.top, boxShadow: '0 0 14px rgba(255,255,255,0.95)' }}
          animate={{ y: [0, -26, 0], opacity: [0.1, 0.8, 0.1] }}
          transition={{ duration: 3 + (particle.id % 5), repeat: Infinity, delay: particle.delay }}
        />
      ))}

      <button
        type="button"
        onClick={finish}
        className="absolute right-5 top-5 z-20 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400 transition hover:border-red-300/40 hover:text-white"
      >
        Skip Tutorial
      </button>

      <div className="relative z-10 flex min-h-screen items-center justify-center p-5">
        <motion.div layout className="w-full max-w-3xl overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.055] p-6 shadow-[0_0_90px_rgba(0,229,255,0.12)] backdrop-blur-2xl sm:p-9">
          <div className="mb-7 flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.42em]" style={{ color: slide.accent }}>{slide.kicker}</p>
              <p className="mt-2 text-[10px] uppercase tracking-[0.25em] text-zinc-500">Initiation packet {index + 1} / {SLIDES.length}</p>
            </div>
            <div className="hidden rounded-full border border-white/10 bg-black/35 px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400 sm:block">Neural Sync</div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={slide.title}
              initial={{ opacity: 0, x: 70, filter: 'blur(10px)' }}
              animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, x: -70, filter: 'blur(10px)' }}
              transition={{ duration: 0.38, ease: 'easeOut' }}
              className="grid gap-8 md:grid-cols-[0.75fr_1.25fr] md:items-center"
            >
              <div className="relative mx-auto grid h-56 w-56 place-items-center rounded-[2rem] border border-white/10 bg-black/45">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 18, repeat: Infinity, ease: 'linear' }} className="absolute h-44 w-44 rounded-full border border-white/10" />
                <motion.div animate={{ rotate: -360 }} transition={{ duration: 12, repeat: Infinity, ease: 'linear' }} className="absolute h-32 w-32 rounded-full border border-white/10" />
                <div className="absolute inset-0 rounded-[2rem] opacity-30" style={{ background: `radial-gradient(circle, ${slide.accent}66, transparent 62%)` }} />
                <Icon className="relative h-20 w-20 drop-shadow-[0_0_22px_rgba(255,255,255,0.35)]" style={{ color: slide.accent }} />
              </div>
              <div>
                <h2 className="text-3xl font-black uppercase leading-tight tracking-[-0.04em] text-white sm:text-5xl">{slide.title}</h2>
                <p className="mt-5 max-w-xl text-sm leading-7 text-zinc-300">{slide.description}</p>
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="mt-9 flex flex-col-reverse gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex justify-center gap-2">
              {SLIDES.map((item, dotIndex) => (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => setIndex(dotIndex)}
                  className={cn('h-2 rounded-full transition-all', dotIndex === index ? 'w-9' : 'w-2 bg-white/15')}
                  style={dotIndex === index ? { backgroundColor: slide.accent, boxShadow: `0 0 16px ${slide.accent}` } : undefined}
                  aria-label={`Go to slide ${dotIndex + 1}`}
                />
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <button type="button" onClick={back} disabled={index === 0} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-300 transition hover:bg-white/[0.08] disabled:opacity-30">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
              <button type="button" onClick={next} className="inline-flex items-center gap-2 rounded-2xl px-6 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-black shadow-[0_0_28px_rgba(0,229,255,0.2)] transition hover:scale-[1.02]" style={{ backgroundColor: slide.accent }}>
                {index === SLIDES.length - 1 ? 'Enter Network' : 'Next'} <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};
