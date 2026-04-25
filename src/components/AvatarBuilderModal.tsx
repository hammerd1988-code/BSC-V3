import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Wand2, Loader2, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { generateText } from '../lib/ai';
import { useAuth } from '../AuthContext';
import { cn } from '../lib/utils';

interface AvatarBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (base64Image: string) => void;
}

const STYLES = [
  'Cyberpunk',
  'Neon Noir',
  'Industrial Brutalist',
  'Holographic',
  'Anime',
  '3D Render',
  'Synthwave'
];

// Style-specific prompt modifiers for better image results
const STYLE_MODIFIERS: Record<string, string> = {
  'Cyberpunk': 'cyberpunk aesthetic, neon lights, dark city, rain, glowing circuits, high contrast',
  'Neon Noir': 'noir style, neon signs, shadows, moody lighting, dark atmosphere, cinematic',
  'Industrial Brutalist': 'brutalist architecture, concrete, industrial, raw materials, dramatic shadows',
  'Holographic': 'holographic, iridescent, translucent, light refraction, futuristic, glowing',
  'Anime': 'anime art style, vibrant colors, detailed, manga influence, cel shading',
  '3D Render': '3D rendered, octane render, photorealistic, subsurface scattering, studio lighting',
  'Synthwave': 'synthwave, retro 80s, purple and pink gradient, grid lines, sunset, retrowave'
};

/**
 * Generate an avatar image using Pollinations.ai (free, no API key required).
 * Falls back to a placeholder if the service is unavailable.
 */
async function generateAvatarImage(
  enhancedPrompt: string,
  style: string
): Promise<string> {
  const styleModifier = STYLE_MODIFIERS[style] || style.toLowerCase();
  const fullPrompt = `${enhancedPrompt}, ${styleModifier}, portrait, profile picture, centered, square format, high quality, detailed`;
  
  // Pollinations.ai — free image generation, no API key needed
  // Returns a direct image URL we can use as src
  const encodedPrompt = encodeURIComponent(fullPrompt);
  const seed = Math.floor(Math.random() * 999999);
  const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=512&seed=${seed}&nologo=true&enhance=true`;

  // Fetch the image and convert to base64 so it can be uploaded to Supabase Storage
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Image generation failed: HTTP ${response.status}`);
  }

  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export const AvatarBuilderModal: React.FC<AvatarBuilderModalProps> = ({ isOpen, onClose, onApply }) => {
  const { currentUser } = useAuth();
  const [prompt, setPrompt] = useState('');
  const [selectedStyle, setSelectedStyle] = useState(STYLES[0]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please describe your avatar.');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedImage(null);

    try {
      // Step 1: Use the configurable AI to enhance the prompt (optional — improves quality)
      let enhancedPrompt = prompt.trim();
      setStatusMessage('Enhancing prompt...');

      try {
        const aiEnhanced = await generateText(
          `You are an expert at writing image generation prompts. 
Enhance this avatar description for a cyberpunk developer social network profile picture.
Keep it concise (under 50 words), visually specific, and suitable for a portrait.
Original description: "${prompt}"
Style: ${selectedStyle}
Return ONLY the enhanced prompt text, nothing else.`,
          currentUser?.ai_settings,
          { maxTokens: 100, temperature: 0.7 }
        );
        if (aiEnhanced && aiEnhanced.trim().length > 10) {
          enhancedPrompt = aiEnhanced.trim();
        }
      } catch (aiErr) {
        // AI enhancement is optional — proceed with original prompt
        console.warn('[AvatarBuilder] AI enhancement skipped:', aiErr);
      }

      // Step 2: Generate the image using Pollinations.ai (free, no API key)
      setStatusMessage('Generating image...');
      const base64Image = await generateAvatarImage(enhancedPrompt, selectedStyle);
      setGeneratedImage(base64Image);
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

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="w-full max-w-lg glass-card rounded-2xl overflow-hidden neon-border flex flex-col max-h-[90vh]"
        >
          <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/50">
            <h2 className="text-lg font-black text-white uppercase tracking-widest italic flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-accent" />
              AI Avatar Builder
            </h2>
            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1 space-y-6">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-400 text-xs font-bold">{error}</p>
              </div>
            )}

            <div className="flex flex-col md:flex-row gap-6">
              {/* Preview Area */}
              <div className="flex-shrink-0 flex flex-col items-center gap-4">
                <div className="w-40 h-40 rounded-2xl border-2 border-white/10 bg-surface overflow-hidden relative flex items-center justify-center">
                  {generatedImage ? (
                    <img src={generatedImage} alt="Generated Avatar" className="w-full h-full object-cover" />
                  ) : isGenerating ? (
                    <div className="flex flex-col items-center gap-2 text-accent">
                      <Loader2 className="w-8 h-8 animate-spin" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-center px-2">
                        {statusMessage || 'Synthesizing...'}
                      </span>
                    </div>
                  ) : (
                    <div className="text-gray-500 text-center p-4">
                      <Wand2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Preview</span>
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
              </div>

              {/* Controls */}
              <div className="flex-1 space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                    Subject Description
                  </label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-accent outline-none transition-colors resize-none h-24"
                    placeholder="e.g., A hacker with neon green glasses, wearing a dark hoodie, glowing city background..."
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                    Aesthetic Style
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {STYLES.map(style => (
                      <button
                        key={style}
                        onClick={() => setSelectedStyle(style)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all border',
                          selectedStyle === style
                            ? 'bg-accent/20 border-accent text-accent'
                            : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white'
                        )}
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !prompt.trim()}
                  className="w-full py-3 bg-white/10 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-white/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mt-4"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {statusMessage || 'Generating...'}
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      Generate Avatar
                    </>
                  )}
                </button>

                <p className="text-[9px] text-gray-600 text-center">
                  Powered by Pollinations.ai · Free · No API key required
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
