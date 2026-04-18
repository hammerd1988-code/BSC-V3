import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Terminal, Loader2, Brain, Zap, ChevronRight } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { generateText } from '../lib/ai';
import { Post } from '../types';
import { cn } from '../lib/utils';

interface NeuralBriefingProps {
  recentPosts: Post[];
}

export const NeuralBriefing: React.FC<NeuralBriefingProps> = ({ recentPosts }) => {
  const { currentUser } = useAuth();
  const [briefing, setBriefing] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const generateBriefing = async () => {
      if (!currentUser || recentPosts.length === 0 || briefing) return;

      setIsLoading(true);
      try {
        const postSummary = recentPosts.slice(0, 5).map(p => p.content).join(' | ');
        const prompt = `You are a personal neural assistant for ${currentUser.display_name}. 
        Analyze the current network activity and provide a 2-sentence "Neural Briefing". 
        Tailor it to be helpful, cryptic, and high-tech. 
        Network Activity: ${postSummary}`;

        const response = await generateText(prompt, currentUser.ai_settings, {
          systemPrompt: "You are a personal AI assistant. Provide a concise, thematic briefing for the user.",
          temperature: 0.8
        });
        setBriefing(response);
      } catch (error) {
        console.error("Briefing Gen Error:", error);
      } finally {
        setIsLoading(false);
      }
    };

    generateBriefing();
  }, [currentUser, recentPosts]);

  if (!currentUser) return null;

  return (
    <motion.div 
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "mb-8 bg-surface/40 border border-white/5 rounded-2xl overflow-hidden transition-all duration-500",
        isExpanded ? "ring-1 ring-accent/30" : "hover:bg-surface/60"
      )}
    >
      <div 
        className="p-4 flex items-center justify-between cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-accent/10 rounded-lg">
            <Brain className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h3 className="text-xs font-black text-white uppercase tracking-widest">Neural Briefing</h3>
            <p className="text-[10px] text-gray-500 uppercase tracking-tighter">Personalized Network Sync</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isLoading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
          <motion.div
            animate={{ rotate: isExpanded ? 90 : 0 }}
            transition={{ duration: 0.3 }}
          >
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/5"
          >
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-4">
                <div className="mt-1">
                  <Zap className="w-4 h-4 text-accent animate-pulse" />
                </div>
                <div className="flex-1">
                  {isLoading ? (
                    <div className="space-y-2">
                      <div className="h-3 bg-white/5 rounded w-full animate-pulse" />
                      <div className="h-3 bg-white/5 rounded w-3/4 animate-pulse" />
                    </div>
                  ) : (
                    <p className="text-sm text-gray-300 leading-relaxed font-mono italic">
                      &gt; {briefing || "Neural link established. No critical updates detected."}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-4 border-t border-white/5 text-[8px] font-black text-gray-600 uppercase tracking-[0.2em]">
                <Terminal className="w-3 h-3" />
                Syncing with Abyssal Core... 100%
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
