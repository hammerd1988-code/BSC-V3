import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Cpu,
  Terminal,
  X,
  Zap,
  RefreshCw,
  Send,
  Play,
  CheckCircle2,
  XCircle,
  Loader2,
  Server,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import {
  isDesktopApp,
  getDesktopBridge,
  type ProviderStatus,
  type LocalLlmTarget,
  type CasperRunResult,
  type DesktopUpdateStatus,
} from '../lib/desktop';

/** Minimal shape of an OpenAI-compatible chat completion response. */
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

const PROVIDER_LABELS: Record<string, string> = {
  lmstudio: 'LM Studio',
  ollama: 'Ollama',
  custom: 'Custom',
};

const UPDATE_LABELS: Record<DesktopUpdateStatus['state'], string> = {
  checking: 'Checking for updates…',
  available: 'Update available',
  'not-available': 'Up to date',
  downloaded: 'Update ready — restart to install',
  error: 'Update check failed',
};

/**
 * Desktop-only "Local Forge" control center.
 *
 * Surfaces the native superpowers the Electron shell exposes over
 * `window.bscDesktop` but that the web UI never used: live LM Studio / Ollama
 * status with an in-app test chat, an embedded Casper CLI console, and the
 * app/auto-update status. Renders nothing in a normal browser or mobile app.
 */
export function DesktopControlCenter() {
  const [mounted] = useState(() => isDesktopApp());
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'llm' | 'casper'>('llm');

  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<DesktopUpdateStatus | null>(null);

  // Local LLM state
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [selected, setSelected] = useState<{ target: LocalLlmTarget; model: string } | null>(null);
  const [prompt, setPrompt] = useState('');
  const [chatting, setChatting] = useState(false);
  const [chatReply, setChatReply] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  // Casper CLI state
  const [casperVersion, setCasperVersion] = useState<string | null>(null);
  const [casperArgs, setCasperArgs] = useState('--help');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CasperRunResult | null>(null);
  const [casperError, setCasperError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement | null>(null);

  // App version + auto-update status (subscribe once).
  useEffect(() => {
    if (!mounted) return;
    const bridge = getDesktopBridge();
    if (!bridge) return;
    void bridge.getVersion().then(setVersion).catch(() => undefined);
    const unsub = bridge.onUpdateStatus(setUpdate);
    return unsub;
  }, [mounted]);

  const detect = useCallback(async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setDetecting(true);
    try {
      const found = await bridge.localLlm.detect();
      setProviders(found);
      // Auto-select the first online provider/model so the test chat is ready.
      setSelected((prev) => {
        if (prev) return prev;
        const online = found.find((p) => p.online && p.models.length > 0);
        return online
          ? { target: { provider: online.provider, baseUrl: online.baseUrl }, model: online.models[0] }
          : null;
      });
    } finally {
      setDetecting(false);
    }
  }, []);

  const fetchCasperVersion = useCallback(async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    try {
      setCasperVersion(await bridge.casper.version());
    } catch (err) {
      setCasperVersion(err instanceof Error ? `error: ${err.message}` : 'unavailable');
    }
  }, []);

  // First open: probe local providers + Casper.
  useEffect(() => {
    if (!open) return;
    if (providers === null) void detect();
    if (casperVersion === null) void fetchCasperVersion();
    requestAnimationFrame(() => panelRef.current?.focus());
  }, [open, providers, casperVersion, detect, fetchCasperVersion]);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const sendChat = useCallback(async () => {
    const bridge = getDesktopBridge();
    if (!bridge || !selected || !prompt.trim()) return;
    setChatting(true);
    setChatReply(null);
    setChatError(null);
    try {
      const raw = (await bridge.localLlm.chat({
        target: selected.target,
        model: selected.model,
        messages: [{ role: 'user', content: prompt.trim() }],
      })) as ChatCompletionResponse;
      const content = raw.choices?.[0]?.message?.content;
      if (content) setChatReply(content);
      else setChatError(raw.error?.message ?? 'No content returned by the model.');
    } catch (err) {
      setChatError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatting(false);
    }
  }, [selected, prompt]);

  const runCasper = useCallback(async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    const args = casperArgs.trim().split(/\s+/).filter(Boolean);
    if (args.length === 0) return;
    setRunning(true);
    setResult(null);
    setCasperError(null);
    try {
      setResult(await bridge.casper.run({ args }));
    } catch (err) {
      setCasperError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [casperArgs]);

  if (!mounted) return null;

  const onlineCount = providers?.filter((p) => p.online).length ?? 0;

  return (
    <>
      {/* Launcher — bottom-left so it never collides with the tour launcher. */}
      <AnimatePresence>
        {!open && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setOpen(true)}
            aria-label="Open Local Forge desktop control center"
            className="group fixed bottom-6 left-6 z-[120] overflow-hidden rounded-2xl border border-red-400/30 bg-black/85 px-4 py-3 text-left shadow-[0_0_34px_rgba(255,0,0,0.18)] backdrop-blur-xl"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-red-500/12 via-fuchsia-500/10 to-cyan-500/12 opacity-70" />
            <div className="relative flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-red-400/25 bg-red-500/10 text-red-200 shadow-[0_0_20px_rgba(255,0,0,0.22)]">
                <Cpu className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-[10px] font-black uppercase tracking-[0.28em] text-red-200">
                  Local Forge
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      onlineCount > 0 ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]' : 'bg-zinc-600'
                    }`}
                  />
                  {onlineCount > 0 ? `${onlineCount} LLM online` : 'Local LLM · Casper'}
                </span>
              </span>
            </div>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              ref={panelRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label="Local Forge control center"
              initial={{ opacity: 0, x: -40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="fixed inset-y-0 left-0 z-[131] flex w-full max-w-md flex-col border-r border-red-500/20 bg-[#07070b]/95 shadow-[0_0_60px_rgba(255,0,0,0.18)] outline-none backdrop-blur-2xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between gap-3 border-b border-white/5 px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl border border-red-400/30 bg-red-500/10 text-red-200 shadow-[0_0_20px_rgba(255,0,0,0.25)]">
                    <Zap className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-[0.22em] text-white">Local Forge</h2>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                      Desktop {version ? `v${version}` : ''} · native bridge
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close control center"
                  className="rounded-full border border-white/10 bg-black/60 p-2 text-zinc-400 transition hover:border-red-400/40 hover:text-red-300"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Update banner */}
              {update && (
                <div
                  className={`flex items-center gap-2 px-5 py-2 text-[11px] font-bold uppercase tracking-widest ${
                    update.state === 'downloaded' || update.state === 'available'
                      ? 'bg-emerald-500/10 text-emerald-300'
                      : update.state === 'error'
                        ? 'bg-red-500/10 text-red-300'
                        : 'bg-white/5 text-zinc-400'
                  }`}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {UPDATE_LABELS[update.state]}
                  {update.version ? ` (v${update.version})` : ''}
                </div>
              )}

              {/* Tabs */}
              <div className="flex gap-2 px-5 pt-4">
                <TabButton active={tab === 'llm'} onClick={() => setTab('llm')} icon={<Cpu className="h-4 w-4" />}>
                  Local LLM
                </TabButton>
                <TabButton active={tab === 'casper'} onClick={() => setTab('casper')} icon={<Terminal className="h-4 w-4" />}>
                  Casper CLI
                </TabButton>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {tab === 'llm' ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
                        Inference servers
                      </span>
                      <button
                        type="button"
                        onClick={() => void detect()}
                        disabled={detecting}
                        className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/50 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-300 transition hover:border-cyan-300/40 hover:text-cyan-200 disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3 w-3 ${detecting ? 'animate-spin' : ''}`} />
                        {detecting ? 'Scanning' : 'Rescan'}
                      </button>
                    </div>

                    {providers === null && detecting && (
                      <p className="text-xs text-zinc-500">Scanning localhost for LM Studio &amp; Ollama…</p>
                    )}

                    {providers?.map((p) => (
                      <ProviderCard
                        key={p.provider}
                        status={p}
                        selectedModel={
                          selected && selected.target.provider === p.provider ? selected.model : null
                        }
                        onSelectModel={(model) =>
                          setSelected({ target: { provider: p.provider, baseUrl: p.baseUrl }, model })
                        }
                      />
                    ))}

                    {providers && onlineCount === 0 && (
                      <p className="rounded-xl border border-white/10 bg-black/40 p-3 text-xs leading-relaxed text-zinc-400">
                        No local server detected. Start{' '}
                        <span className="text-cyan-300">LM Studio</span> (port 1234) or{' '}
                        <span className="text-cyan-300">Ollama</span> (port 11434), then hit Rescan.
                      </p>
                    )}

                    {/* Test chat */}
                    <div className="space-y-2 rounded-2xl border border-white/10 bg-black/40 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
                          Test chat
                        </span>
                        {selected && (
                          <span className="truncate text-[10px] font-bold text-cyan-300/80">
                            {PROVIDER_LABELS[selected.target.provider]} · {selected.model}
                          </span>
                        )}
                      </div>
                      <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendChat();
                        }}
                        placeholder={selected ? 'Ask your local model anything…' : 'Select a model above first'}
                        rows={3}
                        disabled={!selected}
                        className="w-full resize-none rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-cyan-300/50 focus:outline-none disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={() => void sendChat()}
                        disabled={!selected || chatting || !prompt.trim()}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-400/30 bg-red-500/15 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-red-100 transition hover:bg-red-500/25 disabled:opacity-40"
                      >
                        {chatting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {chatting ? 'Generating' : 'Send (⌘/Ctrl + ⏎)'}
                      </button>
                      {chatError && (
                        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
                          {chatError}
                        </p>
                      )}
                      {chatReply && (
                        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-cyan-300/20 bg-black/60 p-3 text-xs leading-relaxed text-zinc-200">
                          {chatReply}
                        </pre>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/40 px-3 py-2">
                      <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
                        <Server className="h-3.5 w-3.5" /> Casper CLI
                      </span>
                      <span className="text-xs font-bold text-emerald-300">
                        {casperVersion ?? '…'}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {['--help', '--version', 'config get model'].map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => setCasperArgs(q)}
                          className="rounded-lg border border-white/10 bg-black/50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400 transition hover:border-cyan-300/40 hover:text-cyan-200"
                        >
                          {q}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/60 px-3 py-2 font-mono text-sm">
                      <ChevronRight className="h-4 w-4 shrink-0 text-red-400" />
                      <span className="shrink-0 text-zinc-500">casper</span>
                      <input
                        value={casperArgs}
                        onChange={(e) => setCasperArgs(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void runCasper();
                        }}
                        aria-label="Casper CLI arguments"
                        className="min-w-0 flex-1 bg-transparent text-white placeholder:text-zinc-600 focus:outline-none"
                        placeholder="args…"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => void runCasper()}
                      disabled={running || !casperArgs.trim()}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-400/30 bg-red-500/15 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-red-100 transition hover:bg-red-500/25 disabled:opacity-40"
                    >
                      {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      {running ? 'Running' : 'Run command'}
                    </button>

                    {casperError && (
                      <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
                        {casperError}
                      </p>
                    )}

                    {result && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                          {result.code === 0 ? (
                            <span className="flex items-center gap-1 text-emerald-300">
                              <CheckCircle2 className="h-3.5 w-3.5" /> exit {result.code}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-red-300">
                              <XCircle className="h-3.5 w-3.5" /> exit {result.code ?? 'null'}
                              {result.timedOut ? ' · timed out' : ''}
                            </span>
                          )}
                        </div>
                        {result.stdout && (
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/70 p-3 text-xs leading-relaxed text-zinc-200">
                            {result.stdout}
                          </pre>
                        )}
                        {result.stderr && (
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-red-500/20 bg-black/70 p-3 text-xs leading-relaxed text-red-300/90">
                            {result.stderr}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-black uppercase tracking-widest transition ${
        active
          ? 'border-red-400/40 bg-red-500/15 text-red-100 shadow-[0_0_18px_rgba(255,0,0,0.18)]'
          : 'border-white/10 bg-black/40 text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function ProviderCard({
  status,
  selectedModel,
  onSelectModel,
}: {
  status: ProviderStatus;
  selectedModel: string | null;
  onSelectModel: (model: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-bold text-white">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              status.online ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]' : 'bg-zinc-600'
            }`}
          />
          {PROVIDER_LABELS[status.provider] ?? status.provider}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          {status.online ? `${status.models.length} models` : status.error ?? 'offline'}
        </span>
      </div>
      {status.online && status.models.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {status.models.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onSelectModel(m)}
              aria-pressed={selectedModel === m}
              className={`max-w-full truncate rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                selectedModel === m
                  ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-100'
                  : 'border-white/10 bg-black/50 text-zinc-400 hover:border-cyan-300/30 hover:text-cyan-200'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
