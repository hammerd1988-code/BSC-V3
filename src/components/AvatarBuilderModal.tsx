import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Wand2, Loader2, RefreshCw, Check } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
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

export const AvatarBuilderModal: React.FC<AvatarBuilderModalProps> = ({ isOpen, onClose, onApply }) => {
  const [prompt, setPrompt] = useState('');
  const [selectedStyle, setSelectedStyle] = useState(STYLES[0]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError("Please describe your avatar.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const fullPrompt = `Generate a high-tech, futuristic social media avatar. Style: ${selectedStyle}. Subject: ${prompt}. Make it suitable for a profile picture, centered, high quality.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              text: fullPrompt,
            },
          ],
        },
      });
      
      let base64Image = null;
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          base64Image = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          break;
        }
      }

      if (base64Image) {
        setGeneratedImage(base64Image);
      } else {
        setError("Failed to generate image. Please try again.");
      }
    } catch (err: any) {
      console.error("Avatar Gen Error:", err);
      setError(err.message || "An error occurred during generation.");
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
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-500 text-xs font-bold uppercase tracking-widest text-center">
                {error}
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
                      <span className="text-[10px] font-bold uppercase tracking-widest">Synthesizing...</span>
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
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Subject Description</label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-accent outline-none transition-colors resize-none h-24"
                    placeholder="e.g., A hacker with neon green glasses, wearing a dark hoodie, glowing city background..."
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Aesthetic Style</label>
                  <div className="flex flex-wrap gap-2">
                    {STYLES.map(style => (
                      <button
                        key={style}
                        onClick={() => setSelectedStyle(style)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all border",
                          selectedStyle === style
                            ? "bg-accent/20 border-accent text-accent"
                            : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white"
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
                      Generating...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      Generate
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
