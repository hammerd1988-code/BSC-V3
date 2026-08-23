import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Ghost,
  TerminalSquare,
  Compass,
  KeyRound,
  MonitorSmartphone,
  Copy,
  Check,
  ChevronRight,
  Radio,
  Code2,
  ServerCog,
  ExternalLink,
} from 'lucide-react';
import { cn } from '../lib/utils';

const DIRECTIVE_LINES = [
  'casper> tail the prod logs on rack-01 and summarize errors',
  'casper> git pull + rebuild the api on my homelab box',
  'casper> ssh into the pi and check disk usage',
  'casper> clone the repo, install deps, run the test suite',
  'casper> upload this file to /srv/app/config on node-7',
];

const INSTALL_CMD = 'curl -fsSL bloodsweatcode.org/install.sh | sh';

const LOCAL_CODER_REPO_URL = 'https://github.com/hammerd1988-code/local-coder';

const LOCAL_CODER_INSTALL_CMD =
  'git clone https://github.com/hammerd1988-code/local-coder && cd local-coder && npm install && npm start';

const LOCAL_CODER_SLIDES = [
  {
    src: '/local-coder/editor.webp',
    label: 'IDE // Casper agent',
    caption: 'Monaco editor + file explorer with Casper riding shotgun — chat, apply diffs, build mode.',
  },
  {
    src: '/local-coder/terminal.webp',
    label: 'Integrated terminal',
    caption: 'Real shells in the browser (xterm + node-pty) right under your code.',
  },
  {
    src: '/local-coder/server-ops.webp',
    label: 'NEO//OPS server deck',
    caption: 'The server interface: live vitals, processes, daemons, network & logs per node.',
  },
];

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);
  return reduced;
}

function GhostDirectiveTicker() {
  const reduced = useReducedMotion();
  const [lineIndex, setLineIndex] = useState(0);
  const [charCount, setCharCount] = useState(reduced ? DIRECTIVE_LINES[0].length : 0);
  const line = DIRECTIVE_LINES[lineIndex];

  useEffect(() => {
    if (reduced) {
      setCharCount(DIRECTIVE_LINES[lineIndex].length);
      const hold = setTimeout(() => setLineIndex((i) => (i + 1) % DIRECTIVE_LINES.length), 4200);
      return () => clearTimeout(hold);
    }
    if (charCount < line.length) {
      const t = setTimeout(() => setCharCount((c) => c + 1), 34);
      return () => clearTimeout(t);
    }
    const hold = setTimeout(() => {
      setCharCount(0);
      setLineIndex((i) => (i + 1) % DIRECTIVE_LINES.length);
    }, 2400);
    return () => clearTimeout(hold);
  }, [charCount, line.length, lineIndex, reduced]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-emerald-400/20 bg-black/80 p-4 font-mono shadow-[0_0_28px_rgba(0,255,136,0.1)]">
      <div className="terminal-data-rain pointer-events-none absolute inset-0 opacity-60" />
      <div className="ghost-grid-scan pointer-events-none absolute inset-0" />
      <div className="relative">
        <div className="mb-3 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-red-500/80" />
          <span className="h-2 w-2 rounded-full bg-yellow-500/80" />
          <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
          <span className="ml-2 text-[9px] font-black uppercase tracking-[0.28em] text-emerald-300/70">
            ghost link // live directive
          </span>
        </div>
        <p className="min-h-[2.5rem] text-xs leading-5 text-emerald-200 sm:text-sm">
          {line.slice(0, charCount)}
          <span className="ghost-terminal-caret ml-0.5 inline-block h-3.5 w-2 translate-y-0.5 bg-emerald-300" />
        </p>
        <p className="mt-2 text-[10px] leading-4 text-zinc-500">
          → routed over the Casper relay → executed on your machine → streamed back live
        </p>
      </div>
    </div>
  );
}

function LocalCoderSpotlight() {
  const reduced = useReducedMotion();
  const [slide, setSlide] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setSlide((s) => (s + 1) % LOCAL_CODER_SLIDES.length), 4500);
    return () => clearInterval(t);
  }, [reduced]);

  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(LOCAL_CODER_INSTALL_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — ignore
    }
  };

  const active = LOCAL_CODER_SLIDES[slide];

  return (
    <div className="relative mt-5 overflow-hidden rounded-2xl border border-cyan-300/20 bg-black/70 p-4 shadow-[0_0_34px_rgba(0,229,255,0.1)] sm:p-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgba(0,229,255,0.1),transparent_38%),radial-gradient(circle_at_100%_100%,rgba(255,0,255,0.08),transparent_40%)]" />

      <div className="relative grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100">
            <Code2 className="h-3.5 w-3.5" /> Local Coder
          </div>
          <h3 className="text-xl font-black uppercase italic tracking-tight text-white sm:text-2xl">
            The coding deck. Casper is the agent.
          </h3>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Local Coder is the self-hosted coding interface: a browser IDE where Casper writes, reviews and
            applies code alongside you — and it's also where the server interface lives, with the NEO//OPS
            control deck watching every node.
          </p>
          <ul className="mt-3 space-y-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-500">
            <li className="flex items-center gap-2">
              <Code2 className="h-3.5 w-3.5 shrink-0 text-cyan-300" /> Monaco IDE + Casper chat, build mode & diff-before-apply
            </li>
            <li className="flex items-center gap-2">
              <TerminalSquare className="h-3.5 w-3.5 shrink-0 text-emerald-300" /> Integrated terminal, git & plugins
            </li>
            <li className="flex items-center gap-2">
              <ServerCog className="h-3.5 w-3.5 shrink-0 text-fuchsia-300" /> NEO//OPS server deck — vitals, processes, daemons, logs
            </li>
          </ul>

          <div className="mt-4 rounded-xl border border-white/10 bg-black/60 p-3">
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-cyan-300/80">
              Install &amp; launch
            </p>
            <button
              type="button"
              onClick={copyCmd}
              title="Copy install command"
              className="group mt-1.5 flex w-full items-center gap-1.5 text-left font-mono text-[10px] leading-4 text-zinc-300 transition hover:text-cyan-200"
            >
              <span className="truncate">{LOCAL_CODER_INSTALL_CMD}</span>
              {copied ? (
                <Check className="h-3 w-3 shrink-0 text-emerald-300" />
              ) : (
                <Copy className="h-3 w-3 shrink-0 text-zinc-500 transition group-hover:text-cyan-300" />
              )}
            </button>
            <p className="mt-1.5 font-mono text-[10px] leading-4 text-zinc-500">
              → UI on localhost:3000 · API on localhost:3001
            </p>
          </div>

          <a
            href={LOCAL_CODER_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-400/15 px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100 transition hover:bg-cyan-400/25 hover:shadow-[0_0_20px_rgba(0,229,255,0.25)]"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Get Local Coder
          </a>
        </div>

        <div className="min-w-0">
          <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/80">
            <div className="relative aspect-[16/10]">
              {LOCAL_CODER_SLIDES.map((s, i) => (
                <img
                  key={s.src}
                  src={s.src}
                  alt={s.label}
                  loading="lazy"
                  className={cn(
                    'absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-700',
                    i === slide ? 'opacity-100' : 'opacity-0'
                  )}
                />
              ))}
            </div>
            <div className="ghost-grid-scan pointer-events-none absolute inset-0" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3 pt-8">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">{active.label}</p>
              <p className="mt-0.5 text-[10px] leading-4 text-zinc-400">{active.caption}</p>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-center gap-2">
            {LOCAL_CODER_SLIDES.map((s, i) => (
              <button
                key={s.src}
                type="button"
                aria-label={`Show ${s.label}`}
                onClick={() => setSlide(i)}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === slide ? 'w-6 bg-cyan-300' : 'w-2.5 bg-white/20 hover:bg-white/40'
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function GhostGridShowcase() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const reduced = useReducedMotion();

  const stations = useMemo(
    () => [
      {
        label: 'Remote Ops',
        path: '/casper/remote',
        icon: Ghost,
        text: 'Possess any machine. Natural-language directives run shell, git, files & SSH on your own hardware.',
        route: '/casper/remote',
        color: 'text-emerald-200',
        border: 'border-emerald-300/25',
        bg: 'bg-emerald-300/10',
        glow: 'shadow-[0_0_24px_rgba(0,255,136,0.12)]',
      },
      {
        label: 'Neural Terminal',
        path: '/terminal',
        icon: TerminalSquare,
        text: 'The coder agent. Clone, install, build and ship from an AI dev terminal with isolated workspaces.',
        route: '/terminal',
        color: 'text-cyan-200',
        border: 'border-cyan-300/25',
        bg: 'bg-cyan-300/10',
        glow: 'shadow-[0_0_24px_rgba(0,229,255,0.12)]',
      },
      {
        label: 'SSH Ghostline',
        path: '/casper/remote',
        icon: KeyRound,
        text: 'Tunnel into servers by directive — execute, SFTP get/put/list — plus the Roaming Ghost mobile SSH app.',
        route: '/casper/remote',
        color: 'text-fuchsia-200',
        border: 'border-fuchsia-300/25',
        bg: 'bg-fuchsia-300/10',
        glow: 'shadow-[0_0_24px_rgba(255,0,255,0.1)]',
      },
      {
        label: 'Local Forge',
        path: '/casper/commands',
        icon: MonitorSmartphone,
        text: 'The desktop shell: local LLMs (LM Studio / Ollama), embedded CLI console & native superpowers.',
        route: '/casper/commands',
        color: 'text-amber-200',
        border: 'border-amber-300/25',
        bg: 'bg-amber-300/10',
        glow: 'shadow-[0_0_24px_rgba(250,204,21,0.1)]',
      },
    ],
    []
  );

  const copyInstall = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — ignore
    }
  };

  return (
    <section className="mx-auto max-w-4xl px-3 pt-6 sm:px-4">
      <div className="ghost-grid-panel relative overflow-hidden rounded-[2rem] border border-emerald-400/15 bg-black/75 p-5 backdrop-blur-xl sm:p-6">
        <div className="ghost-grid-floor pointer-events-none absolute inset-x-0 bottom-0 h-40" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_0%,rgba(0,255,136,0.14),transparent_36%),radial-gradient(circle_at_88%_12%,rgba(0,229,255,0.12),transparent_34%),radial-gradient(circle_at_50%_100%,rgba(255,0,255,0.08),transparent_40%)]" />

        <div className="relative grid gap-5 lg:grid-cols-[1fr_360px] lg:items-center">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.28em] text-emerald-100">
              <Radio className={cn('h-3.5 w-3.5', !reduced && 'animate-pulse')} /> Ghost Grid online
            </div>
            <h2 className="text-2xl font-black uppercase italic tracking-tight text-white sm:text-3xl">
              Your machines. Casper's hands.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
              Link any laptop, homelab or server to the grid and command it from anywhere: remote ops directives,
              an AI coder terminal, SSH tunnels, and a desktop forge with local LLMs.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigate('/casper/remote')}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-400/15 px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-100 transition hover:bg-emerald-400/25 hover:shadow-[0_0_20px_rgba(0,255,136,0.25)]"
              >
                <Ghost className="h-3.5 w-3.5" /> Enter Remote Ops <ChevronRight className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => navigate('/casper/commands')}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-200 transition hover:bg-white/[0.1]"
              >
                <Compass className="h-3.5 w-3.5" /> Command Deck
              </button>
            </div>
          </div>
          <GhostDirectiveTicker />
        </div>

        <div className="relative mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stations.map(({ icon: Icon, ...station }) => (
            <button
              key={station.label}
              type="button"
              onClick={() => navigate(station.path)}
              className={cn(
                'group rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:bg-white/[0.06]',
                station.border,
                station.bg,
                station.glow
              )}
            >
              <Icon className={cn('mb-3 h-5 w-5 transition group-hover:scale-110', station.color)} />
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-white">{station.label}</p>
              <p className="mt-1 text-[10px] leading-4 font-bold uppercase tracking-widest text-zinc-500">
                {station.text}
              </p>
              <p className={cn('mt-2 text-[9px] font-black uppercase tracking-[0.22em] opacity-70', station.color)}>
                {station.route}
              </p>
            </button>
          ))}
        </div>

        <div className="relative mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-400">
            Link a machine in 3 steps
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={copyInstall}
              title="Copy install command"
              className="group rounded-xl border border-white/10 bg-black/60 p-3 text-left transition hover:border-emerald-300/30"
            >
              <p className="text-[9px] font-black uppercase tracking-[0.22em] text-emerald-300/80">01 · Install</p>
              <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] leading-4 text-zinc-300">
                <span className="truncate">{INSTALL_CMD}</span>
                {copied ? (
                  <Check className="h-3 w-3 shrink-0 text-emerald-300" />
                ) : (
                  <Copy className="h-3 w-3 shrink-0 text-zinc-500 transition group-hover:text-emerald-300" />
                )}
              </p>
            </button>
            <button
              type="button"
              onClick={() => navigate('/casper/remote')}
              className="rounded-xl border border-white/10 bg-black/60 p-3 text-left transition hover:border-cyan-300/30"
            >
              <p className="text-[9px] font-black uppercase tracking-[0.22em] text-cyan-300/80">02 · Pair</p>
              <p className="mt-1.5 font-mono text-[10px] leading-4 text-zinc-300">
                casper auth login <span className="text-zinc-500">→ get your XXXX-XXXX code</span>
              </p>
            </button>
            <button
              type="button"
              onClick={() => navigate('/casper/remote')}
              className="rounded-xl border border-white/10 bg-black/60 p-3 text-left transition hover:border-fuchsia-300/30"
            >
              <p className="text-[9px] font-black uppercase tracking-[0.22em] text-fuchsia-300/80">03 · Command</p>
              <p className="mt-1.5 font-mono text-[10px] leading-4 text-zinc-300">
                Approve the code in Remote Ops <span className="text-zinc-500">→ start issuing directives</span>
              </p>
            </button>
          </div>
        </div>

        <LocalCoderSpotlight />
      </div>
    </section>
  );
}
