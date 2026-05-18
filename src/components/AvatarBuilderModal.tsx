import React, { useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Wand2, Loader2, RefreshCw, Check, AlertCircle, Mic, MicOff,
  Palette, Eye, Shield,
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
  { id: 'city', label: 'Dark City', desc: 'dark cyberpunk city skyline background' },
  { id: 'void', label: 'The Void', desc: 'pure black void with subtle particle effects' },
  { id: 'arena', label: 'Arena', desc: 'colosseum arena background, combat ring, spotlights' },
  { id: 'digital', label: 'Digital Grid', desc: 'digital matrix grid background, data streams' },
  { id: 'flames', label: 'Flames', desc: 'wall of flames background, inferno, hellfire' },
  { id: 'abstract', label: 'Abstract', desc: 'abstract geometric background, shapes, gradients' },
];

// ── Tabs ─────────────────────────────────────────────────────────────────────

type BuilderTab = 'description' | 'traits' | 'colors' | 'accessories';

const TABS: { id: BuilderTab; label: string; icon: typeof Wand2 }[] = [
  { id: 'description', label: 'Description', icon: Wand2 },
  { id: 'traits', label: 'Face & Eyes', icon: Eye },
  { id: 'colors', label: 'Colors', icon: Palette },
  { id: 'accessories', label: 'Gear', icon: Shield },
];

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

  const [micListening, setMicListening] = useState(false);
  const recognitionRef = useRef<any>(null);

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

  if (!isOpen) return null;

  const selectedColor = COLOR_SCHEMES.find((c) => c.id === colorScheme);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="w-full max-w-3xl glass-card rounded-2xl overflow-hidden neon-border flex flex-col max-h-[92vh]"
        >
          {/* Header */}
          <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/50">
            <h2 className="text-lg font-black text-white uppercase tracking-widest italic flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-accent" />
              Avatar Builder
              {botName && <span className="text-xs text-gray-400 not-italic">for {botName}</span>}
            </h2>
            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-white/5 bg-black/30">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-3 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2',
                  activeTab === tab.id
                    ? 'border-accent text-accent bg-accent/5'
                    : 'border-transparent text-gray-500 hover:text-white hover:bg-white/5',
                )}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col md:flex-row gap-0">
              {/* Preview + Gallery (left side) */}
              <div className="flex-shrink-0 w-full md:w-56 border-b md:border-b-0 md:border-r border-white/5 p-4 flex flex-col items-center gap-3">
                <div
                  className="w-44 h-44 rounded-2xl border-2 bg-surface overflow-hidden relative flex items-center justify-center"
                  style={{ borderColor: (selectedColor?.primary ?? '#00e5ff') + '44', boxShadow: `0 0 20px ${selectedColor?.primary ?? '#00e5ff'}22` }}
                >
                  {generatedImage ? (
                    <img src={generatedImage} alt="Generated Avatar" className="w-full h-full object-cover" />
                  ) : isGenerating ? (
                    <div className="flex flex-col items-center gap-2 text-accent">
                      <Loader2 className="w-8 h-8 animate-spin" />
                      <span className="text-[9px] font-bold uppercase tracking-widest text-center px-2">
                        {statusMessage || 'Synthesizing...'}
                      </span>
                    </div>
                  ) : (
                    <div className="text-gray-500 text-center p-4">
                      <Wand2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <span className="text-[9px] font-bold uppercase tracking-widest">Preview</span>
                    </div>
                  )}
                </div>

                {generatedImage && (
                  <button
                    onClick={() => onApply(generatedImage)}
                    className="w-full py-2 bg-accent text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-accent/80 transition-colors flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    Apply Avatar
                  </button>
                )}

                {gallery.length > 1 && (
                  <div className="w-full">
                    <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-2">Gallery</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {gallery.map((img, i) => (
                        <button
                          key={i}
                          onClick={() => setGeneratedImage(img)}
                          className={cn(
                            'aspect-square rounded-lg overflow-hidden border-2 transition',
                            generatedImage === img ? 'border-accent' : 'border-white/10 hover:border-white/30',
                          )}
                        >
                          <img src={img} alt={`Variant ${i + 1}`} className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="w-full py-2.5 bg-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isGenerating ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {statusMessage || 'Generating...'}</>
                  ) : (
                    <><RefreshCw className="w-3.5 h-3.5" /> Generate</>
                  )}
                </button>

                <p className="text-[8px] text-gray-600 text-center">
                  Powered by Pollinations.ai · Free
                </p>
              </div>

              {/* Controls (right side) */}
              <div className="flex-1 p-4 space-y-4 min-w-0">
                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-red-400 text-xs font-bold">{error}</p>
                  </div>
                )}

                {/* Tab: Description */}
                {activeTab === 'description' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                        Describe Your Avatar
                      </label>
                      <div className="relative">
                        <textarea
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 pr-12 text-sm text-white focus:border-accent outline-none transition-colors resize-none h-24"
                          placeholder="e.g., A hacker with neon green glasses, wearing a dark hoodie..."
                        />
                        {micSupported && (
                          <button
                            onClick={micListening ? stopMic : startMic}
                            className={cn(
                              'absolute right-2 bottom-2 rounded-lg p-2 transition-all',
                              micListening
                                ? 'bg-red-500/20 text-red-400 animate-pulse'
                                : 'bg-white/5 text-gray-400 hover:bg-white/10',
                            )}
                            title={micListening ? 'Stop' : 'Describe with voice'}
                          >
                            {micListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                      {micListening && (
                        <div className="flex items-center gap-2 mt-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5">
                          <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-[9px] font-bold text-red-300 uppercase tracking-widest">Listening...</span>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                        Art Style
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {STYLES.map((style) => (
                          <button
                            key={style}
                            onClick={() => setSelectedStyle(style)}
                            className={cn(
                              'px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all border',
                              selectedStyle === style
                                ? 'bg-accent/20 border-accent text-accent'
                                : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white',
                            )}
                          >
                            {style}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                        Expression
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {EXPRESSIONS.map((expr) => (
                          <button
                            key={expr.id}
                            onClick={() => setExpression(expr.id)}
                            className={cn(
                              'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all border',
                              expression === expr.id
                                ? 'bg-accent/20 border-accent text-accent'
                                : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10',
                            )}
                          >
                            <span>{expr.emoji}</span>
                            {expr.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                        Background
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {BACKGROUNDS.map((bg) => (
                          <button
                            key={bg.id}
                            onClick={() => setBackground(bg.id)}
                            className={cn(
                              'px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all border',
                              background === bg.id
                                ? 'bg-accent/20 border-accent text-accent'
                                : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10',
                            )}
                          >
                            {bg.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab: Face & Eyes */}
                {activeTab === 'traits' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                        Face Shape
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {FACE_SHAPES.map((face) => (
                          <button
                            key={face.id}
                            onClick={() => setFaceShape(face.id)}
                            className={cn(
                              'rounded-xl border p-3 text-left transition-all',
                              faceShape === face.id
                                ? 'bg-accent/10 border-accent'
                                : 'bg-white/[0.02] border-white/10 hover:bg-white/5',
                            )}
                          >
                            <p className={cn('text-xs font-bold', faceShape === face.id ? 'text-accent' : 'text-white')}>
                              {face.label}
                            </p>
                            <p className="text-[9px] text-gray-500 mt-0.5">{face.desc}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                        Eye Style
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {EYE_STYLES.map((eye) => (
                          <button
                            key={eye.id}
                            onClick={() => setEyeStyle(eye.id)}
                            className={cn(
                              'rounded-xl border p-3 text-left transition-all',
                              eyeStyle === eye.id
                                ? 'bg-accent/10 border-accent'
                                : 'bg-white/[0.02] border-white/10 hover:bg-white/5',
                            )}
                          >
                            <p className={cn('text-xs font-bold', eyeStyle === eye.id ? 'text-accent' : 'text-white')}>
                              {eye.label}
                            </p>
                            <p className="text-[9px] text-gray-500 mt-0.5">{eye.desc}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab: Colors */}
                {activeTab === 'colors' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                        Color Scheme
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {COLOR_SCHEMES.map((color) => (
                          <button
                            key={color.id}
                            onClick={() => setColorScheme(color.id)}
                            className={cn(
                              'flex items-center gap-3 rounded-xl border p-3 transition-all',
                              colorScheme === color.id
                                ? 'border-white/30 bg-white/5'
                                : 'border-white/5 bg-white/[0.02] hover:bg-white/5',
                            )}
                          >
                            <div
                              className="h-6 w-6 rounded-full shrink-0"
                              style={{ backgroundColor: color.primary, boxShadow: `0 0 12px ${color.primary}88` }}
                            />
                            <span className={cn('text-xs font-bold', colorScheme === color.id ? 'text-white' : 'text-gray-400')}>
                              {color.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab: Accessories */}
                {activeTab === 'accessories' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                        Headgear & Accessories
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {ACCESSORIES.map((acc) => (
                          <button
                            key={acc.id}
                            onClick={() => setAccessory(acc.id)}
                            className={cn(
                              'rounded-xl border p-3 text-left transition-all',
                              accessory === acc.id
                                ? 'bg-accent/10 border-accent'
                                : 'bg-white/[0.02] border-white/10 hover:bg-white/5',
                            )}
                          >
                            <p className={cn('text-xs font-bold', accessory === acc.id ? 'text-accent' : 'text-white')}>
                              {acc.label}
                            </p>
                            {acc.desc && <p className="text-[9px] text-gray-500 mt-0.5">{acc.desc}</p>}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
