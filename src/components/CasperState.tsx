import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Ghost, Sparkles, Loader2, Info, Volume2 } from 'lucide-react';
import { supabase } from '../supabase';
import { generateText } from '../lib/ai';
import { useAuth } from '../AuthContext';
import { cn } from '../lib/utils';

interface CasperStateProps {
  context?: 'feed' | 'profile';
  profileUsername?: string;
}

type TtsSection = 'take' | 'mood';

export const CasperState: React.FC<CasperStateProps> = ({ context = 'feed', profileUsername }) => {
  const { currentUser } = useAuth();
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [speakingSection, setSpeakingSection] = useState<TtsSection | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

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
      
      const systemPrompt = `You are CASPER, the friendly AI spirit of Blood, Sweat, or Code — a warm, technically sharp, cyberpunk ghost who notices patterns fast.
      Your task is to provide a "CASPER'S TAKE: THE MOOD OF THE NETWORK" summary.
      Analyze the provided recent transmissions and give a 1-2 sentence summary of the overall mood, vibe, or trending topics.
      Also include a brief mention of the network instability level (1-100 scale, where 1 is calm and 100 is chaotic).
      Keep it ethereal, friendly, and cyberpunk-themed, but stay precise and observant.
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

  useEffect(() => {
    return () => {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.src = '';
        currentAudioRef.current = null;
      }
      window.speechSynthesis?.cancel();
    };
  }, []);

  const playTts = async (section: TtsSection, text: string) => {
    if (!text.trim()) return;

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = '';
      currentAudioRef.current = null;
    }
    window.speechSynthesis.cancel();
    setSpeakingSection(section);

    try {
      const serverUrl = import.meta.env.VITE_APP_URL || window.location.origin;
      const response = await fetch(`${serverUrl}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, speed: 1.05 }),
      });

      if (!response.ok) {
        throw new Error(`TTS request failed with ${response.status}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
        setSpeakingSection(null);
      };

      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
        console.warn('[CasperState] OpenAI Onyx audio playback failed; browser TTS fallback is disabled.');
        setSpeakingSection(null);
      };

      await audio.play();
    } catch (err) {
      console.warn('[CasperState] OpenAI Onyx TTS unavailable; browser TTS fallback is disabled:', err);
      setSpeakingSection(null);
    }
  };

  const SpeakerButton = ({ section, text, label }: { section: TtsSection; text: string; label: string }) => {
    const isSpeaking = speakingSection === section;

    return (
      <button
        type="button"
        onClick={() => playTts(section, text)}
        disabled={loading || !text.trim() || speakingSection !== null}
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-full border border-blue-300/20 bg-blue-300/5 text-blue-200/70 transition-all",
          "hover:border-cyan-300/60 hover:bg-cyan-300/10 hover:text-cyan-100 hover:shadow-[0_0_14px_rgba(34,211,238,0.35)]",
          "disabled:cursor-not-allowed disabled:opacity-40",
          isSpeaking && "border-cyan-300/70 bg-cyan-300/15 text-cyan-100 shadow-[0_0_14px_rgba(34,211,238,0.45)]"
        )}
        title={label}
        aria-label={label}
      >
        {isSpeaking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Volume2 className="w-3 h-3" />}
      </button>
    );
  };

  if (!isVisible) return null;

  const takeText = context === 'profile'
    ? `Casper's Take on @${profileUsername || 'this operative'}`
    : "Casper's Take";
  const moodText = summary || '';

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
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-[10px] font-black text-blue-300 uppercase tracking-[0.2em] flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" />
                  Casper's Take
                </h3>
                <SpeakerButton section="take" text={takeText} label="Play Casper's Take heading" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold text-purple-200/70 uppercase tracking-[0.22em]">
                  Mood of the Network
                </span>
                <SpeakerButton section="mood" text={moodText} label="Play Mood of the Network" />
              </div>
            </div>
            <button 
              onClick={() => setIsVisible(false)}
              className="text-white/20 hover:text-white/50 transition-colors"
              aria-label="Hide Casper network mood"
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
