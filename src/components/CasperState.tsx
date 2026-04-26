import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Ghost, Sparkles, Loader2, Info } from 'lucide-react';
import { supabase } from '../supabase';
import { generateText } from '../lib/ai';
import { useAuth } from '../AuthContext';
import { cn } from '../lib/utils';

interface CasperStateProps {
  context?: 'feed' | 'profile';
  profileUsername?: string;
}

export const CasperState: React.FC<CasperStateProps> = ({ context = 'feed', profileUsername }) => {
  const { currentUser } = useAuth();
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  const fetchAndAnalyze = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      // 1. Fetch recent posts for context
      let postsQuery = supabase
        .from('posts')
        .select('content, created_at')
        .order('created_at', { ascending: false })
        .limit(20);

      if (context === 'profile' && profileUsername) {
        // For profile, get that user's posts
        const { data: userData } = await supabase
          .from('users')
          .select('id')
          .eq('username', profileUsername)
          .single();
        if (userData) {
          postsQuery = postsQuery.eq('author_id', userData.id);
        }
      }

      const { data: posts } = await postsQuery;
      
      if (!posts || posts.length === 0) {
        setSummary(context === 'profile' 
          ? "This operative's neural signal is quiet. No recent transmissions detected." 
          : "The network is quiet today. A peaceful silence in the grid.");
        setLoading(false);
        return;
      }

      // 2. Prepare text for AI analysis
      const combinedText = posts.map(p => p.content).join('\n---\n');
      
      const systemPrompt = `You are CASPER, the friendly AI spirit of Blood, Sweat, or Code. 
      Your task is to provide a "STATE OF THE NETWORK" summary. 
      Analyze the provided recent transmissions and give a 1-2 sentence summary of the overall mood, vibe, or trending topics.
      Keep it ethereal, friendly, and cyberpunk-themed. 
      Be concise. Do not use hashtags. Use a warm, ghostly tone.`;

      const userPrompt = context === 'profile'
        ? `Analyze the recent transmissions from operative @${profileUsername}:\n\n${combinedText}`
        : `Analyze the recent transmissions from the entire network:\n\n${combinedText}`;

      // 3. Generate summary
      const response = await generateText(userPrompt, currentUser.ai_settings, {
        systemPrompt,
        maxTokens: 100,
        temperature: 0.7
      });

      if (response) {
        setSummary(response.trim());
      }
    } catch (err) {
      console.error('Casper analysis error:', err);
      // Fallback
      setSummary(context === 'profile' 
        ? "I'm sensing a complex neural pattern here. Very intriguing." 
        : "The network's vibe is shifting. I can feel the energy in the static.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAndAnalyze();
  }, [context, profileUsername]);

  if (!isVisible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative overflow-hidden rounded-2xl border mb-6",
        "bg-gradient-to-br from-white/5 to-blue-200/5 backdrop-blur-md",
        "border-white/10 shadow-[0_0_30px_rgba(168,216,234,0.05)]"
      )}
    >
      {/* Ghostly background glow */}
      <div className="absolute -top-10 -left-10 w-32 h-32 bg-blue-400/10 blur-3xl rounded-full pointer-events-none" />
      <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-purple-400/10 blur-3xl rounded-full pointer-events-none" />

      <div className="p-4 sm:p-5 flex gap-4 items-start relative z-10">
        <div className="flex-shrink-0 mt-1">
          <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shadow-[0_0_15px_rgba(168,216,234,0.2)]">
            {loading ? (
              <Loader2 className="w-5 h-5 text-blue-300 animate-spin" />
            ) : (
              <Ghost className="w-5 h-5 text-blue-300 animate-pulse" />
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-[10px] font-black text-blue-300 uppercase tracking-[0.2em] flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" />
              Casper's Take: The Mood of the Network
            </h3>
            <button 
              onClick={() => setIsVisible(false)}
              className="text-white/20 hover:text-white/50 transition-colors"
            >
              <Info className="w-3 h-3" />
            </button>
          </div>

          {loading ? (
            <div className="space-y-2 mt-2">
              <div className="h-3 bg-white/5 rounded-full w-3/4 animate-pulse" />
              <div className="h-3 bg-white/5 rounded-full w-1/2 animate-pulse" />
            </div>
          ) : (
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-white/80 leading-relaxed italic font-medium"
            >
              "{summary}"
            </motion.p>
          )}
        </div>
      </div>
      
      {/* Decorative scanning line */}
      <motion.div 
        className="absolute bottom-0 left-0 h-[1px] bg-gradient-to-r from-transparent via-blue-400/30 to-transparent w-full"
        animate={{ x: ['-100%', '100%'] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
      />
    </motion.div>
  );
};
