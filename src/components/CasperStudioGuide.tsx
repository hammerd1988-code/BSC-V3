import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Ghost, Send, X, Loader2, Lightbulb, Sparkles, Wand2, ChevronDown, ChevronUp } from 'lucide-react';
import { sendCasperCommand, type CasperCommandResponse } from '../lib/casper';
import { useAuth } from '../AuthContext';
import { cn } from '../lib/utils';

// Proactive tips Casper surfaces contextually in the Studio UI based on
// the current mode and user activity. These are NOT LLM-generated —
// they're deterministic quick-fire suggestions that open a full LLM
// conversation when clicked.
const PROACTIVE_TIPS: Record<string, Array<{ label: string; prompt: string }>> = {
  image: [
    { label: 'Optimize for Instagram Reels cover', prompt: 'What are the best practices for creating a Reels cover image that maximizes saves and shares? Give me a concrete prompt template I can use in the Visual Forge.' },
    { label: 'A/B test thumbnail concepts', prompt: 'Help me design two thumbnail A/B test variants for a coding tutorial video. I need high-contrast, single-subject compositions with < 4 words of text. Give me two specific Visual Forge prompts.' },
    { label: 'Brand-consistent color palette', prompt: 'Suggest a cyberpunk brand color palette (hex codes) that works for thumbnails, social posts, and stream overlays. Show me how to use it with the Visual Forge presets.' },
    { label: 'Batch content for the week', prompt: 'Create a 7-day content image batch plan: one hero image per day with specific Visual Forge prompts, each targeting a different platform (TikTok, IG, YouTube, X, LinkedIn, Twitch, Reddit). Match dimensions and style to each platform.' },
  ],
  video: [
    { label: 'Hook in the first 3 seconds', prompt: 'Write me 5 different 3-second video hook scripts for a developer content creator. Each should use a different pattern-interrupt technique (question, bold claim, visual shock, controversy, curiosity gap). I\'ll use these as text overlays on Visual Forge clips.' },
    { label: 'Shorts → long-form funnel', prompt: 'Design a YouTube Shorts → long-form conversion funnel: what short clip topics (15-30s) would drive viewers to a 12-minute deep-dive tutorial? Give me 3 specific clip/video pairs with Visual Forge prompts for each.' },
    { label: 'Optimal posting schedule', prompt: 'Based on current platform algorithms, what\'s the optimal short-form video posting schedule across TikTok, Instagram Reels, and YouTube Shorts for a developer/creator account? Include time zones, frequency, and batch production tips.' },
    { label: 'Cinematic b-roll prompt pack', prompt: 'Generate 5 cinematic b-roll prompts I can use in Visual Forge for coding/tech content: dark moody terminals, neon UI close-ups, abstract data visualizations, workspace atmosphere shots, and transition loops. Each should be 5-10s duration.' },
  ],
  thumbnail: [
    { label: 'Click-through rate optimization', prompt: 'Analyze the key factors that drive thumbnail CTR on YouTube. Give me 5 specific design rules with examples I can apply in the Thumbnail Creator right now. Focus on contrast, face placement, text weight, and color theory.' },
    { label: 'Template for a series', prompt: 'Design a consistent thumbnail template system for a 10-part tutorial series. I need: base layout, where the episode number goes, how to vary the background while keeping brand recognition, and specific color/font guidance for the Thumbnail Creator.' },
    { label: 'Mobile-first thumbnail check', prompt: 'Most viewers see thumbnails on mobile at ~120px wide. What are the top 5 things I should check to make sure my thumbnails read well at tiny sizes? Give me a mobile-first thumbnail checklist.' },
    { label: 'High-contrast text overlay', prompt: 'What\'s the science behind high-contrast text on thumbnails? Give me specific hex color combos, font size ratios, and stroke/shadow techniques that make text pop at any size. Reference real successful thumbnails.' },
  ],
};

const ENGINEERING_TIPS: Array<{ label: string; prompt: string }> = [
  { label: 'Add a Supabase RLS policy', prompt: 'Walk me through adding a new Row-Level Security policy in Supabase for a table that should only be readable by the owner and admins. Include the SQL migration and TypeScript client code.' },
  { label: 'Optimize React re-renders', prompt: 'Review common React re-render optimization patterns: useMemo, useCallback, React.memo, and when NOT to use them. Give me a checklist I can apply to my Studio components.' },
  { label: 'Set up a cron job with Casper', prompt: 'How do I set up a Casper routine that runs every morning at 9am to auto-generate content suggestions for my upcoming streams? Walk me through the routine creation process.' },
  { label: 'Debug a Supabase realtime subscription', prompt: 'My Supabase realtime subscription isn\'t firing on updates. Walk me through a systematic debugging checklist: RLS policies, channel setup, event filters, and common gotchas.' },
];

interface CasperStudioGuideProps {
  mode: 'image' | 'video' | 'thumbnail';
  className?: string;
}

export function CasperStudioGuide({ mode, className }: CasperStudioGuideProps) {
  const { currentUser } = useAuth();
  const [expanded, setExpanded] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastResponse, setLastResponse] = useState<CasperCommandResponse | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [showEngineering, setShowEngineering] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const tips = useMemo(() => PROACTIVE_TIPS[mode] ?? PROACTIVE_TIPS.image, [mode]);

  // Reset response when mode changes so stale answers don't persist.
  useEffect(() => {
    setLastResponse(null);
    setLastError(null);
  }, [mode]);

  // Focus the input when chat opens.
  useEffect(() => {
    if (chatOpen) inputRef.current?.focus();
  }, [chatOpen]);

  // Scroll to bottom of response area when new response arrives.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lastResponse, lastError, busy]);

  const askCasper = useCallback(async (prompt: string) => {
    if (busy) return;
    setChatOpen(true);
    setBusy(true);
    setLastError(null);
    setLastResponse(null);
    setDraft('');
    try {
      const result = await sendCasperCommand({
        command: prompt,
        surface: 'studio',
        source: currentUser?.role === 'admin' ? 'admin' : 'user',
        pageContext: {
          path: '/casper/studio',
          feature: 'Casper Studio (Visual Forge)',
          description: `User is in ${mode} mode of the content creation studio. Proactive guide tip clicked.`,
        },
      });
      setLastResponse(result);
    } catch (err: any) {
      setLastError(err?.message || 'Casper failed to respond.');
    } finally {
      setBusy(false);
    }
  }, [busy, mode, currentUser?.role]);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || busy) return;
    askCasper(text);
  }, [draft, busy, askCasper]);

  if (!currentUser) return null;

  return (
    <div className={cn('rounded-[2rem] border border-cyan-300/15 bg-gradient-to-br from-cyan-500/[0.06] via-zinc-950/80 to-fuchsia-500/[0.04] backdrop-blur-xl', className)}>
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-2xl bg-cyan-300/10">
            <Ghost className="h-5 w-5 text-cyan-200" />
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-zinc-950 bg-emerald-400" />
          </div>
          <div>
            <h3 className="text-xs font-black uppercase tracking-widest text-white">Casper Guide</h3>
            <p className="text-[9px] font-bold uppercase tracking-widest text-cyan-300/60">Content + Engineering Copilot</p>
          </div>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="space-y-3 px-5 pb-5">
              {/* Mode-specific proactive tips */}
              <div>
                <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-zinc-500">
                  <Lightbulb className="mr-1 inline h-3 w-3 text-yellow-400/70" />
                  {mode} tips
                </p>
                <div className="grid grid-cols-1 gap-1.5">
                  {tips.map((tip) => (
                    <button
                      key={tip.label}
                      onClick={() => askCasper(tip.prompt)}
                      disabled={busy}
                      className="group flex items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left text-[11px] leading-tight text-zinc-300 transition hover:border-cyan-300/20 hover:bg-cyan-300/[0.04] hover:text-white disabled:opacity-50"
                    >
                      <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-cyan-300/40 group-hover:text-cyan-300/70" />
                      {tip.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Engineering tips toggle */}
              <button
                onClick={() => setShowEngineering((prev) => !prev)}
                className="flex w-full items-center gap-2 text-[9px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-300"
              >
                <Wand2 className="h-3 w-3 text-fuchsia-400/50" />
                Engineering tips
                {showEngineering ? <ChevronUp className="ml-auto h-3 w-3" /> : <ChevronDown className="ml-auto h-3 w-3" />}
              </button>
              <AnimatePresence>
                {showEngineering && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="grid grid-cols-1 gap-1.5 overflow-hidden"
                  >
                    {ENGINEERING_TIPS.map((tip) => (
                      <button
                        key={tip.label}
                        onClick={() => askCasper(tip.prompt)}
                        disabled={busy}
                        className="group flex items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left text-[11px] leading-tight text-zinc-300 transition hover:border-fuchsia-300/20 hover:bg-fuchsia-300/[0.04] hover:text-white disabled:opacity-50"
                      >
                        <Wand2 className="mt-0.5 h-3 w-3 shrink-0 text-fuchsia-300/40 group-hover:text-fuchsia-300/70" />
                        {tip.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Inline chat / response area */}
              <AnimatePresence>
                {chatOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2">
                      <div
                        ref={scrollRef}
                        className="max-h-64 overflow-y-auto rounded-2xl border border-white/10 bg-black/50 p-3"
                      >
                        {busy && (
                          <div className="flex items-center gap-2 text-xs text-cyan-200">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Casper is thinking…
                          </div>
                        )}
                        {lastError && (
                          <p className="text-xs text-red-400">{lastError}</p>
                        )}
                        {lastResponse && (
                          <div className="prose prose-invert prose-sm max-w-none text-xs leading-relaxed text-zinc-200 [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_pre]:rounded-xl [&_pre]:bg-white/[0.06] [&_pre]:p-3">
                            <div dangerouslySetInnerHTML={{ __html: renderMarkdownLite(lastResponse.response) }} />
                            {lastResponse.toolCalls && lastResponse.toolCalls.length > 0 && (
                              <div className="mt-2 border-t border-white/10 pt-2">
                                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                                  Tool calls ({lastResponse.toolCalls.length}{lastResponse.toolRounds ? `, ${lastResponse.toolRounds} round${lastResponse.toolRounds === 1 ? '' : 's'}` : ''})
                                </p>
                                <ul className="mt-1 space-y-0.5">
                                  {lastResponse.toolCalls.map((tc, i) => (
                                    <li key={tc.id || i} className="text-[10px] text-zinc-400">
                                      <span className={tc.ok ? 'text-emerald-400' : 'text-red-400'}>{tc.ok ? '✓' : '✗'}</span>{' '}
                                      <span className="font-mono">{tc.name}</span>{' '}
                                      <span className="text-zinc-600">({tc.durationMs}ms)</span>
                                      {tc.error && <span className="ml-1 text-red-400/70">— {tc.error}</span>}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Inline input for follow-up */}
                      <div className="flex items-center gap-2">
                        <input
                          ref={inputRef}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                          placeholder="Ask Casper anything…"
                          disabled={busy}
                          className="flex-1 rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-xs text-white outline-none placeholder:text-zinc-600 focus:border-cyan-300/30 disabled:opacity-50"
                        />
                        <button onClick={handleSend} disabled={busy || !draft.trim()} className="rounded-xl bg-cyan-300/15 p-2 text-cyan-200 transition hover:bg-cyan-300/25 disabled:opacity-30">
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        </button>
                        <button onClick={() => { setChatOpen(false); setLastResponse(null); setLastError(null); }} className="rounded-xl bg-white/5 p-2 text-zinc-500 transition hover:bg-white/10 hover:text-white">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Free-form input when chat is NOT open */}
              {!chatOpen && (
                <div className="flex items-center gap-2">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                    placeholder="Ask Casper about content, growth, or code…"
                    disabled={busy}
                    className="flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none placeholder:text-zinc-600 focus:border-cyan-300/20 disabled:opacity-50"
                  />
                  <button onClick={handleSend} disabled={busy || !draft.trim()} className="rounded-xl bg-cyan-300/15 p-2 text-cyan-200 transition hover:bg-cyan-300/25 disabled:opacity-30">
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Minimal Markdown → HTML renderer for Casper's responses. Handles
// the subset of Markdown that Casper actually produces: headings,
// bold, italic, inline code, fenced code blocks, unordered lists,
// and line breaks. NOT a full Markdown parser — just enough for the
// Studio guide's inline response panel.
function renderMarkdownLite(md: string): string {
  return md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Fenced code blocks (``` ... ```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) =>
      `<pre><code class="language-${lang}">${code.trim()}</code></pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Headings
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    // Line breaks
    .replace(/\n/g, '<br/>');
}
