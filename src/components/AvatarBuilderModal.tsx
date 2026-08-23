import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Wand2, Loader2, RefreshCw, Check, AlertCircle, Mic, MicOff,
  Palette, Eye, Shield, Download, Copy, Sparkles, Image as ImageIcon,
} from 'lucide-react';
import { generateText } from '../lib/ai';
import { useAuth } from '../AuthContext';
import { cn } from '../lib/utils';

interface AvatarBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (base64Image: string) => void;
  botName?: string;
}

// ── Style Presets ────────────────────────────────────────────────────────────

const STYLES = [
  'Cyberpunk', 'Neon Noir', 'Industrial Brutalist', 'Holographic',
  'Anime', '3D Render', 'Synthwave', 'Dark Fantasy', 'Steampunk',
  'Glitch Art', 'Pixel Art', 'Vaporwave',
];

const STYLE_MODIFIERS: Record<string, string> = {
  'Cyberpunk': 'cyberpunk aesthetic, neon lights, dark city, rain, glowing circuits, high contrast',
  'Neon Noir': 'noir style, neon signs, shadows, moody lighting, dark atmosphere, cinematic',
  'Industrial Brutalist': 'brutalist architecture, concrete, industrial, raw materials, dramatic shadows',
  'Holographic': 'holographic, iridescent, translucent, light refraction, futuristic, glowing',
  'Anime': 'anime art style, vibrant colors, detailed, manga influence, cel shading',
  '3D Render': '3D rendered, octane render, photorealistic, subsurface scattering, studio lighting',
  'Synthwave': 'synthwave, retro 80s, purple and pink gradient, grid lines, sunset, retrowave',
  'Dark Fantasy': 'dark fantasy, gothic, magical runes, deep shadows, mystical energy, ethereal',
  'Steampunk': 'steampunk, brass gears, Victorian, mechanical, copper tones, steam, clockwork',
  'Glitch Art': 'glitch art, data corruption, pixel sorting, chromatic aberration, VHS distortion',
  'Pixel Art': 'pixel art, 16-bit retro game style, low resolution charm, sprite art, nostalgic',
  'Vaporwave': 'vaporwave, pink and teal, marble busts, palm trees, retro computer graphics, dreamy',
};

/** Tiny gradient sample so each art style reads visually, not just as a word. */
const STYLE_SWATCHES: Record<string, string> = {
  'Cyberpunk': 'linear-gradient(135deg,#0b1030,#00e5ff 55%,#ff2bd6)',
  'Neon Noir': 'linear-gradient(135deg,#05060a,#3b0d2a 60%,#ff1744)',
  'Industrial Brutalist': 'linear-gradient(135deg,#1c1c1c,#6b6b6b 60%,#2b2b2b)',
  'Holographic': 'linear-gradient(135deg,#a5f3fc,#c4b5fd 45%,#fbcfe8)',
  'Anime': 'linear-gradient(135deg,#ffb4d1,#7dd3fc 60%,#fde68a)',
  '3D Render': 'linear-gradient(135deg,#dfe6ee,#8fa3b8 60%,#3c4b5c)',
  'Synthwave': 'linear-gradient(135deg,#2b0f4a,#ff2bd6 55%,#fbbf24)',
  'Dark Fantasy': 'linear-gradient(135deg,#0a0713,#4c1d95 60%,#22d3ee)',
  'Steampunk': 'linear-gradient(135deg,#2a1a0d,#b45309 60%,#fbbf24)',
  'Glitch Art': 'linear-gradient(135deg,#00e5ff,#111 45%,#ff1744)',
  'Pixel Art': 'linear-gradient(135deg,#22c55e,#0ea5e9 50%,#a855f7)',
  'Vaporwave': 'linear-gradient(135deg,#ff2bd6,#67e8f9 60%,#fce7f3)',
};

// ── Face Traits ──────────────────────────────────────────────────────────────

const FACE_SHAPES = [
  { id: 'angular', label: 'Angular', desc: 'sharp jawline, angular features' },
  { id: 'round', label: 'Round', desc: 'soft round face, friendly features' },
  { id: 'mechanical', label: 'Mechanical', desc: 'mechanical face, cybernetic implants, robot-like' },
  { id: 'skull', label: 'Skull', desc: 'skull-like face, skeletal features, death mask' },
  { id: 'alien', label: 'Alien', desc: 'alien features, elongated, otherworldly' },
  { id: 'beast', label: 'Beast', desc: 'beast-like face, feral, animalistic features' },
];

const EYE_STYLES = [
  { id: 'glowing', label: 'Glowing', desc: 'glowing cybernetic eyes, bright light emission' },
  { id: 'visor', label: 'Visor', desc: 'visor covering eyes, LED display, HUD overlay' },
  { id: 'scarred', label: 'Scarred', desc: 'scarred eye, battle-worn, eye patch' },
  { id: 'circuit', label: 'Circuit', desc: 'circuit-pattern eyes, digital iris, data streams' },
  { id: 'flame', label: 'Flame', desc: 'fire eyes, burning, molten energy' },
  { id: 'void', label: 'Void', desc: 'void eyes, pitch black, consuming darkness' },
];

const ACCESSORIES = [
  { id: 'none', label: 'None' },
  { id: 'helmet', label: 'Combat Helmet', desc: 'tactical combat helmet with HUD' },
  { id: 'crown', label: 'Crown', desc: 'digital crown, holographic, regal' },
  { id: 'horns', label: 'Horns', desc: 'metallic horns, demonic, intimidating' },
  { id: 'hood', label: 'Hood', desc: 'dark hood, mysterious, shadowed face' },
  { id: 'mask', label: 'War Mask', desc: 'war mask, tribal patterns, fearsome' },
  { id: 'halo', label: 'Halo', desc: 'glowing digital halo, angelic, radiant' },
  { id: 'scars', label: 'Battle Scars', desc: 'deep scars, battle damage, weathered' },
  { id: 'tattoos', label: 'Tattoos', desc: 'glowing circuit tattoos, tribal tech marks' },
  { id: 'implants', label: 'Implants', desc: 'cybernetic implants, neural ports, tech augmentation' },
];

const EXPRESSIONS = [
  { id: 'fierce', label: 'Fierce', emoji: '😤' },
  { id: 'calm', label: 'Calm', emoji: '😐' },
  { id: 'menacing', label: 'Menacing', emoji: '😈' },
  { id: 'confident', label: 'Confident', emoji: '😏' },
  { id: 'mysterious', label: 'Mysterious', emoji: '🤫' },
  { id: 'rage', label: 'Rage', emoji: '🤬' },
  { id: 'stoic', label: 'Stoic', emoji: '🗿' },
  { id: 'playful', label: 'Playful', emoji: '😜' },
];

const COLOR_SCHEMES = [
  { id: 'red', label: 'Blood Red', primary: '#ff1744', bg: 'red glow, crimson energy, blood red accents' },
  { id: 'cyan', label: 'Neon Cyan', primary: '#00e5ff', bg: 'cyan glow, electric blue, teal energy' },
  { id: 'purple', label: 'Void Purple', primary: '#8b5cf6', bg: 'purple glow, violet energy, amethyst accents' },
  { id: 'gold', label: 'Solar Gold', primary: '#fbbf24', bg: 'golden glow, sun energy, warm amber' },
  { id: 'green', label: 'Toxic Green', primary: '#22c55e', bg: 'green glow, matrix green, toxic energy' },
  { id: 'pink', label: 'Neon Pink', primary: '#ff2bd6', bg: 'hot pink glow, magenta energy, neon pink' },
  { id: 'white', label: 'Ghost White', primary: '#e2e8f0', bg: 'white glow, spectral, ghostly pale energy' },
  { id: 'orange', label: 'Inferno', primary: '#f97316', bg: 'orange glow, fire energy, molten lava accents' },
];

const BACKGROUNDS = [
  { id: 'city', label: 'Dark City', desc: 'dark cyberpunk city skyline background', swatch: 'linear-gradient(160deg,#050914,#0f2b45 55%,#00e5ff)' },
  { id: 'void', label: 'The Void', desc: 'pure black void with subtle particle effects', swatch: 'radial-gradient(circle at 30% 30%,#1b1b24,#000 70%)' },
  { id: 'arena', label: 'Arena', desc: 'colosseum arena background, combat ring, spotlights', swatch: 'linear-gradient(160deg,#2a1a10,#7c4a21 60%,#fbbf24)' },
  { id: 'digital', label: 'Digital Grid', desc: 'digital matrix grid background, data streams', swatch: 'linear-gradient(160deg,#04120a,#0b3d24 55%,#22c55e)' },
  { id: 'flames', label: 'Flames', desc: 'wall of flames background, inferno, hellfire', swatch: 'linear-gradient(160deg,#1a0500,#b91c1c 55%,#f97316)' },
  { id: 'abstract', label: 'Abstract', desc: 'abstract geometric background, shapes, gradients', swatch: 'linear-gradient(160deg,#1e1b4b,#7c3aed 55%,#f472b6)' },
];

// ── Tabs ─────────────────────────────────────────────────────────────────────

type BuilderTab = 'description' | 'traits' | 'colors' | 'accessories';

const TABS: { id: BuilderTab; label: string; icon: typeof Wand2 }[] = [
  { id: 'description', label: 'Description', icon: Wand2 },
  { id: 'traits', label: 'Face & Eyes', icon: Eye },
  { id: 'colors', label: 'Colors', icon: Palette },
  { id: 'accessories', label: 'Gear', icon: Shield },
];

const SECTION_LABEL = 'text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400';

// ── Image Generation ─────────────────────────────────────────────────────────

async function generateAvatarImage(fullPrompt: string): Promise<string> {
  const encodedPrompt = encodeURIComponent(fullPrompt);
  const seed = Math.floor(Math.random() * 999999);
  const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=512&seed=${seed}&nologo=true&enhance=true`;
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Image generation failed: HTTP ${response.status}`);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export const AvatarBuilderModal: React.FC<AvatarBuilderModalProps> = ({ isOpen, onClose, onApply, botName }) => {
  const { currentUser } = useAuth();

  const [activeTab, setActiveTab] = useState<BuilderTab>('description');
  const [prompt, setPrompt] = useState('');
  const [selectedStyle, setSelectedStyle] = useState(STYLES[0]);
  const [faceShape, setFaceShape] = useState('angular');
  const [eyeStyle, setEyeStyle] = useState('glowing');
  const [accessory, setAccessory] = useState('none');
  const [expression, setExpression] = useState('fierce');
  const [colorScheme, setColorScheme] = useState('cyan');
  const [background, setBackground] = useState('city');

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [gallery, setGallery] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const [micListening, setMicListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const micSupported = typeof window !== 'undefined' &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const startMic = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) setPrompt((prev) => prev ? `${prev} ${transcript}` : transcript);
      setMicListening(false);
    };
    recognition.onerror = () => setMicListening(false);
    recognition.onend = () => setMicListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setMicListening(true);
  }, []);

  const stopMic = useCallback(() => {
    recognitionRef.current?.stop();
    setMicListening(false);
  }, []);

  const buildFullPrompt = useCallback(() => {
    const parts: string[] = [];
    if (prompt.trim()) parts.push(prompt.trim());
    if (botName) parts.push(`character named ${botName}`);
    const face = FACE_SHAPES.find((f) => f.id === faceShape);
    if (face) parts.push(face.desc);
    const eye = EYE_STYLES.find((e) => e.id === eyeStyle);
    if (eye) parts.push(eye.desc);
    const acc = ACCESSORIES.find((a) => a.id === accessory);
    if (acc?.desc) parts.push(acc.desc);
    const expr = EXPRESSIONS.find((e) => e.id === expression);
    if (expr) parts.push(`${expr.label.toLowerCase()} expression`);
    const color = COLOR_SCHEMES.find((c) => c.id === colorScheme);
    if (color) parts.push(color.bg);
    const bg = BACKGROUNDS.find((b) => b.id === background);
    if (bg) parts.push(bg.desc);
    const styleModifier = STYLE_MODIFIERS[selectedStyle] || selectedStyle.toLowerCase();
    parts.push(styleModifier);
    parts.push('portrait, profile picture, centered, square format, high quality, detailed');
    return parts.join(', ');
  }, [prompt, botName, faceShape, eyeStyle, accessory, expression, colorScheme, background, selectedStyle]);

  const previewPrompt = useMemo(() => buildFullPrompt(), [buildFullPrompt]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    setGeneratedImage(null);

    try {
      let finalPrompt = buildFullPrompt();

      if (prompt.trim()) {
        setStatusMessage('Enhancing prompt...');
        try {
          const aiEnhanced = await generateText(
            `You are an expert at writing image generation prompts.
Enhance this avatar description for a cyberpunk developer social network profile picture.
Keep it concise (under 60 words), visually specific, and suitable for a portrait.
Original description: "${prompt}"
Style: ${selectedStyle}
Return ONLY the enhanced prompt text, nothing else.`,
            currentUser?.ai_settings,
            { maxTokens: 120, temperature: 0.7 },
          );
          if (aiEnhanced && aiEnhanced.trim().length > 10) {
            const traitParts: string[] = [];
            const face = FACE_SHAPES.find((f) => f.id === faceShape);
            if (face) traitParts.push(face.desc);
            const eye = EYE_STYLES.find((e) => e.id === eyeStyle);
            if (eye) traitParts.push(eye.desc);
            const acc = ACCESSORIES.find((a) => a.id === accessory);
            if (acc?.desc) traitParts.push(acc.desc);
            const color = COLOR_SCHEMES.find((c) => c.id === colorScheme);
            if (color) traitParts.push(color.bg);
            const styleModifier = STYLE_MODIFIERS[selectedStyle] || selectedStyle.toLowerCase();
            finalPrompt = [aiEnhanced.trim(), ...traitParts, styleModifier, 'portrait, profile picture, centered, square format, high quality, detailed'].join(', ');
          }
        } catch {
          // AI enhancement optional
        }
      }

      setStatusMessage('Generating image...');
      const base64Image = await generateAvatarImage(finalPrompt);
      setGeneratedImage(base64Image);
      setGallery((prev) => [base64Image, ...prev].slice(0, 6));
      setStatusMessage('');
    } catch (err: any) {
      console.error('[AvatarBuilder] Generation error:', err);
      setError(err.message || 'Image generation failed. Please try again.');
      setStatusMessage('');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(previewPrompt);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1500);
    } catch {
      // clipboard unavailable — nothing useful to show
    }
  }, [previewPrompt]);

  // Keys are handled on the dialog itself rather than on window, so anything
  // else listening for Escape does not act on keys aimed at this dialog.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // The zoomed preview is the innermost layer, so it consumes Escape first.
      if (zoomed) setZoomed(false);
      else onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], textarea, input, select, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables?.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  }, [onClose, zoomed]);

  useEffect(() => {
    if (!isOpen) setZoomed(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  // A closed builder should not keep a microphone session running.
  useEffect(() => {
    if (!isOpen) stopMic();
  }, [isOpen, stopMic]);

  const selectedColor = COLOR_SCHEMES.find((c) => c.id === colorScheme);
  const accentColor = selectedColor?.primary ?? '#00e5ff';

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[300] flex items-end justify-center bg-black/90 backdrop-blur-md sm:items-center sm:p-6"
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="avatar-builder-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
            initial={{ opacity: 0, scale: 0.96, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 24 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="glass-card neon-border relative flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden outline-none sm:h-[min(90vh,880px)] sm:rounded-3xl"
          >
            {/* Header */}
            <header className="flex items-center justify-between gap-3 border-b border-white/5 bg-black/50 px-5 py-4">
              <div className="min-w-0">
                <h2
                  id="avatar-builder-title"
                  className="flex items-center gap-2 text-base font-black uppercase italic tracking-[0.15em] text-white sm:text-lg"
                >
                  <Wand2 className="h-5 w-5 shrink-0 text-accent" />
                  Avatar Builder
                </h2>
                <p className="mt-1 truncate text-xs text-gray-500">
                  {botName ? `Designing a face for ${botName}` : 'Design a face, generate it, apply it.'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close avatar builder"
                className="shrink-0 rounded-full border border-white/10 p-2 text-gray-400 transition hover:border-red-400/40 hover:text-red-300"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              {/* Preview rail — stays put while options are browsed. */}
              <aside className="flex shrink-0 gap-4 border-b border-white/5 bg-black/20 p-4 lg:w-[300px] lg:flex-col lg:border-b-0 lg:border-r lg:overflow-y-auto lg:p-5">
                <div className="flex w-28 shrink-0 flex-col gap-2 lg:w-full">
                  <div
                    className="relative aspect-square w-full overflow-hidden rounded-2xl border-2 bg-surface"
                    style={{ borderColor: `${accentColor}44`, boxShadow: `0 0 24px ${accentColor}22` }}
                  >
                    {generatedImage ? (
                      <button
                        type="button"
                        onClick={() => setZoomed(true)}
                        aria-label="View generated avatar full size"
                        className="group block h-full w-full"
                      >
                        <img
                          src={generatedImage}
                          alt="Generated avatar"
                          className="h-full w-full object-cover transition group-hover:opacity-80"
                        />
                      </button>
                    ) : isGenerating ? (
                      <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-accent">
                        <Loader2 className="h-7 w-7 animate-spin" />
                        <span className="text-center text-[10px] font-bold uppercase tracking-[0.18em]">
                          {statusMessage || 'Synthesizing...'}
                        </span>
                      </div>
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-gray-500">
                        <ImageIcon className="h-7 w-7 opacity-50" />
                        <span className="text-center text-[10px] font-bold uppercase tracking-[0.18em]">
                          No avatar yet
                        </span>
                      </div>
                    )}
                  </div>

                  {generatedImage && (
                    <a
                      href={generatedImage}
                      download="avatar.png"
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400 transition hover:border-white/25 hover:text-white lg:hidden"
                    >
                      <Download className="h-3.5 w-3.5" /> Save
                    </a>
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-4">
                  {error && (
                    <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                      <p className="text-xs font-semibold text-red-300">{error}</p>
                    </div>
                  )}

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className={SECTION_LABEL}>Recipe</span>
                      <button
                        type="button"
                        onClick={copyPrompt}
                        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500 transition hover:text-white"
                      >
                        {promptCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {promptCopied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      <span
                        className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black"
                        style={{ background: accentColor }}
                      >
                        {selectedStyle}
                      </span>
                      <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-300">
                        {EXPRESSIONS.find((e) => e.id === expression)?.label}
                      </span>
                      <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-300">
                        {BACKGROUNDS.find((b) => b.id === background)?.label}
                      </span>
                    </div>
                    <p className="max-h-24 overflow-y-auto rounded-xl border border-white/5 bg-black/40 p-2.5 text-[11px] leading-relaxed text-gray-500">
                      {previewPrompt}
                    </p>
                  </div>

                  <div>
                    <span className={cn(SECTION_LABEL, 'mb-2 block')}>
                      Variants {gallery.length > 0 && <span className="text-gray-600">· {gallery.length}</span>}
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {Array.from({ length: 3 }).map((_, slot) => {
                        const img = gallery[slot];
                        if (!img) {
                          return (
                            <div
                              key={`empty-${slot}`}
                              className="aspect-square rounded-lg border border-dashed border-white/10 bg-white/[0.02]"
                            />
                          );
                        }
                        return (
                          <button
                            key={img.slice(-24)}
                            type="button"
                            onClick={() => setGeneratedImage(img)}
                            aria-label={`Use variant ${slot + 1}`}
                            className={cn(
                              'aspect-square overflow-hidden rounded-lg border-2 transition',
                              generatedImage === img ? 'border-accent' : 'border-white/10 hover:border-white/30',
                            )}
                          >
                            <img src={img} alt={`Variant ${slot + 1}`} className="h-full w-full object-cover" />
                          </button>
                        );
                      })}
                    </div>
                    {gallery.length > 3 && (
                      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                        {gallery.slice(3).map((img, i) => (
                          <button
                            key={img.slice(-24)}
                            type="button"
                            onClick={() => setGeneratedImage(img)}
                            aria-label={`Use variant ${i + 4}`}
                            className={cn(
                              'aspect-square overflow-hidden rounded-lg border-2 transition',
                              generatedImage === img ? 'border-accent' : 'border-white/10 hover:border-white/30',
                            )}
                          >
                            <img src={img} alt={`Variant ${i + 4}`} className="h-full w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <p className="hidden text-[10px] text-gray-600 lg:block">
                    Images by Pollinations.ai — free, no key required.
                  </p>
                </div>
              </aside>

              {/* Options */}
              <div className="flex min-h-0 flex-1 flex-col">
                <div
                  role="tablist"
                  aria-label="Avatar options"
                  className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/5 bg-black/30 px-3"
                >
                  {TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        'flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-xs font-bold uppercase tracking-[0.14em] transition',
                        activeTab === tab.id
                          ? 'border-accent text-accent'
                          : 'border-transparent text-gray-500 hover:text-white',
                      )}
                    >
                      <tab.icon className="h-4 w-4" />
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                  {activeTab === 'description' && (
                    <div className="space-y-6">
                      <div>
                        <label htmlFor="avatar-prompt" className={cn(SECTION_LABEL, 'mb-2 block')}>
                          Describe your avatar
                        </label>
                        <div className="relative">
                          <textarea
                            id="avatar-prompt"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            className="h-24 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-4 py-3 pr-12 text-sm text-white outline-none transition-colors focus:border-accent"
                            placeholder="e.g., A hacker with neon green glasses, wearing a dark hoodie..."
                          />
                          {micSupported && (
                            <button
                              type="button"
                              onClick={micListening ? stopMic : startMic}
                              className={cn(
                                'absolute bottom-2 right-2 rounded-lg p-2 transition',
                                micListening
                                  ? 'animate-pulse bg-red-500/20 text-red-400'
                                  : 'bg-white/5 text-gray-400 hover:bg-white/10',
                              )}
                              aria-label={micListening ? 'Stop voice input' : 'Describe with voice'}
                              title={micListening ? 'Stop' : 'Describe with voice'}
                            >
                              {micListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                            </button>
                          )}
                        </div>
                        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-600">
                          <Sparkles className="h-3 w-3 shrink-0" />
                          Free text is rewritten by AI before generating. Everything else is optional.
                        </p>
                        {micListening && (
                          <div className="mt-2 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5">
                            <div className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-300">Listening...</span>
                          </div>
                        )}
                      </div>

                      <div>
                        <span className={cn(SECTION_LABEL, 'mb-2 block')}>Art style</span>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {STYLES.map((style) => (
                            <button
                              key={style}
                              type="button"
                              onClick={() => setSelectedStyle(style)}
                              className={cn(
                                'flex items-center gap-2 rounded-xl border p-2 text-left transition',
                                selectedStyle === style
                                  ? 'border-accent bg-accent/10'
                                  : 'border-white/10 bg-white/[0.02] hover:bg-white/5',
                              )}
                            >
                              <span
                                className="h-7 w-7 shrink-0 rounded-lg border border-white/10"
                                style={{ background: STYLE_SWATCHES[style] }}
                                aria-hidden="true"
                              />
                              <span className={cn(
                                'truncate text-xs font-bold',
                                selectedStyle === style ? 'text-accent' : 'text-gray-300',
                              )}>
                                {style}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <span className={cn(SECTION_LABEL, 'mb-2 block')}>Expression</span>
                        <div className="flex flex-wrap gap-2">
                          {EXPRESSIONS.map((expr) => (
                            <button
                              key={expr.id}
                              type="button"
                              onClick={() => setExpression(expr.id)}
                              className={cn(
                                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition',
                                expression === expr.id
                                  ? 'border-accent bg-accent/10 text-accent'
                                  : 'border-white/10 bg-white/[0.02] text-gray-300 hover:bg-white/5',
                              )}
                            >
                              <span aria-hidden="true">{expr.emoji}</span>
                              {expr.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <span className={cn(SECTION_LABEL, 'mb-2 block')}>Background</span>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {BACKGROUNDS.map((bg) => (
                            <button
                              key={bg.id}
                              type="button"
                              onClick={() => setBackground(bg.id)}
                              className={cn(
                                'overflow-hidden rounded-xl border text-left transition',
                                background === bg.id
                                  ? 'border-accent'
                                  : 'border-white/10 hover:border-white/25',
                              )}
                            >
                              <span
                                className="block h-12 w-full"
                                style={{ background: bg.swatch }}
                                aria-hidden="true"
                              />
                              <span className={cn(
                                'block px-2 py-1.5 text-xs font-bold',
                                background === bg.id ? 'text-accent' : 'text-gray-300',
                              )}>
                                {bg.label}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'traits' && (
                    <div className="space-y-6">
                      <div>
                        <span className={cn(SECTION_LABEL, 'mb-2 block')}>Face shape</span>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {FACE_SHAPES.map((face) => (
                            <button
                              key={face.id}
                              type="button"
                              onClick={() => setFaceShape(face.id)}
                              className={cn(
                                'rounded-xl border p-3 text-left transition',
                                faceShape === face.id
                                  ? 'border-accent bg-accent/10'
                                  : 'border-white/10 bg-white/[0.02] hover:bg-white/5',
                              )}
                            >
                              <p className={cn('text-sm font-bold', faceShape === face.id ? 'text-accent' : 'text-white')}>
                                {face.label}
                              </p>
                              <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{face.desc}</p>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <span className={cn(SECTION_LABEL, 'mb-2 block')}>Eye style</span>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {EYE_STYLES.map((eye) => (
                            <button
                              key={eye.id}
                              type="button"
                              onClick={() => setEyeStyle(eye.id)}
                              className={cn(
                                'rounded-xl border p-3 text-left transition',
                                eyeStyle === eye.id
                                  ? 'border-accent bg-accent/10'
                                  : 'border-white/10 bg-white/[0.02] hover:bg-white/5',
                              )}
                            >
                              <p className={cn('text-sm font-bold', eyeStyle === eye.id ? 'text-accent' : 'text-white')}>
                                {eye.label}
                              </p>
                              <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{eye.desc}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'colors' && (
                    <div>
                      <span className={cn(SECTION_LABEL, 'mb-2 block')}>Accent color</span>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {COLOR_SCHEMES.map((color) => (
                          <button
                            key={color.id}
                            type="button"
                            onClick={() => setColorScheme(color.id)}
                            className={cn(
                              'flex items-center gap-3 rounded-xl border p-3 transition',
                              colorScheme === color.id
                                ? 'border-white/40 bg-white/5'
                                : 'border-white/10 bg-white/[0.02] hover:bg-white/5',
                            )}
                          >
                            <span
                              className="h-7 w-7 shrink-0 rounded-full"
                              style={{ backgroundColor: color.primary, boxShadow: `0 0 14px ${color.primary}88` }}
                              aria-hidden="true"
                            />
                            <span className={cn(
                              'truncate text-xs font-bold',
                              colorScheme === color.id ? 'text-white' : 'text-gray-300',
                            )}>
                              {color.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeTab === 'accessories' && (
                    <div>
                      <span className={cn(SECTION_LABEL, 'mb-2 block')}>Headgear &amp; accessories</span>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {ACCESSORIES.map((acc) => (
                          <button
                            key={acc.id}
                            type="button"
                            onClick={() => setAccessory(acc.id)}
                            className={cn(
                              'rounded-xl border p-3 text-left transition',
                              accessory === acc.id
                                ? 'border-accent bg-accent/10'
                                : 'border-white/10 bg-white/[0.02] hover:bg-white/5',
                            )}
                          >
                            <p className={cn('text-sm font-bold', accessory === acc.id ? 'text-accent' : 'text-white')}>
                              {acc.label}
                            </p>
                            {acc.desc && <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{acc.desc}</p>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Actions — always reachable, never scrolls away. */}
            <footer className="flex shrink-0 items-center gap-2 border-t border-white/5 bg-black/60 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-xs font-black uppercase tracking-[0.18em] transition disabled:opacity-50',
                  generatedImage
                    ? 'border border-white/15 text-white hover:bg-white/10'
                    : 'bg-accent text-white hover:bg-accent/80',
                )}
              >
                {isGenerating ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> {statusMessage || 'Generating...'}</>
                ) : generatedImage ? (
                  <><RefreshCw className="h-4 w-4" /> Re-roll</>
                ) : (
                  <><Wand2 className="h-4 w-4" /> Generate</>
                )}
              </button>

              {generatedImage && (
                <a
                  href={generatedImage}
                  download="avatar.png"
                  aria-label="Download this avatar"
                  className="hidden shrink-0 rounded-xl border border-white/15 p-3 text-gray-400 transition hover:text-white lg:block"
                >
                  <Download className="h-4 w-4" />
                </a>
              )}

              <button
                type="button"
                onClick={() => generatedImage && onApply(generatedImage)}
                disabled={!generatedImage || isGenerating}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:bg-accent/80 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-gray-600"
              >
                <Check className="h-4 w-4" />
                Apply Avatar
              </button>
            </footer>

            {/* Zoomed preview — kept inside the dialog so Escape and clicks
                dismiss just this layer. */}
            <AnimatePresence>
              {zoomed && generatedImage && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setZoomed(false)}
                  className="absolute inset-0 z-10 flex items-center justify-center bg-black/95 p-6"
                >
                  <button
                    type="button"
                    onClick={() => setZoomed(false)}
                    aria-label="Close preview"
                    className="absolute right-4 top-4 rounded-full border border-white/15 bg-black/60 p-2.5 text-gray-300 transition hover:border-red-400/40 hover:text-red-300"
                  >
                    <X className="h-5 w-5" />
                  </button>
                  <motion.img
                    src={generatedImage}
                    alt="Generated avatar, full size"
                    initial={{ scale: 0.94 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0.94 }}
                    className="max-h-full max-w-full rounded-2xl object-contain"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
