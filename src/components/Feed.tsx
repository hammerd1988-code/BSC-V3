import React, { useState, useEffect, useCallback } from 'react';
import { useInView } from 'react-intersection-observer';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Post, User, LiveStream } from '../types';
import { PostCard } from './PostCard';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, TrendingUp, Users, MessageCircle, User as UserIcon, Search as SearchIcon, Radio, X, Eye, Heart as HeartIcon, MessageSquare, HeartHandshake, Terminal, Sparkles, Bot, Coins, Swords, Clock } from 'lucide-react';
import { cn } from '../lib/utils';
import { socket } from '../lib/socket';
export { socket } from '../lib/socket'; // backward-compat re-export
import { useAuth } from '../AuthContext';
import { GenerateOptions, generateText } from '../lib/ai';
import { AiSettings } from '../types';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { GoogleGenAI } from "@google/genai";
import { BOT_PERSONAS } from '../lib/botPersonas';
import { NeuralBriefing } from './NeuralBriefing';
import { TrendingSidebar } from './TrendingSidebar';
import { CasperState } from './CasperState';
import { MegaCitySkyline } from './MegaCitySkyline';

type FeedChallengeType = 'speed_round' | 'debug_battle' | 'code_golf' | 'architect_duel' | 'prompt_war' | 'roast_battle' | 'code_jeopardy';

interface FeedLiveBattle {
  id: string;
  challenge_type: FeedChallengeType;
  started_at: string;
  challenger_id: string;
  defender_id: string;
  challengerName: string;
  defenderName: string;
  challengerGlow: string;
  defenderGlow: string;
}

function formatFeedChallenge(type: FeedChallengeType) {
  if (type === 'speed_round') return 'Speed Round';
  if (type === 'debug_battle') return 'Debug Battle';
  if (type === 'code_golf') return 'Code Golf';
  if (type === 'architect_duel') return 'Architect Duel';
  if (type === 'prompt_war') return 'Prompt War';
  if (type === 'roast_battle') return 'Roast Battle';
  if (type === 'code_jeopardy') return 'Code Jeopardy';
  return 'Challenge';
}

function LiveBattlesWidget({ battles, variant, onOpen }: { battles: FeedLiveBattle[]; variant: 'mobile' | 'sidebar'; onOpen: (matchId: string) => void }) {
  const isMobile = variant === 'mobile';

  if (!battles.length) {
    return (
      <section className={cn(
        'border border-white/10 bg-zinc-950/80 shadow-[0_0_32px_rgba(255,23,68,0.08)]',
        isMobile ? 'mx-auto mt-6 max-w-md rounded-3xl p-4' : 'rounded-3xl p-4'
      )}>
        <div className="flex items-center gap-2">
          <Swords className="h-4 w-4 text-zinc-600" />
          <p className="text-[10px] font-black uppercase tracking-[0.26em] text-zinc-500">Live Battles</p>
        </div>
        <p className="mt-3 text-xs leading-5 text-zinc-500">No Colosseum pits are broadcasting right now.</p>
      </section>
    );
  }

  return (
    <section className={cn(
      'relative overflow-hidden border border-red-500/20 bg-black/75 shadow-[0_0_36px_rgba(255,23,68,0.12)] backdrop-blur-xl',
      isMobile ? 'mx-auto mt-6 max-w-md rounded-3xl p-4' : 'rounded-3xl p-4'
    )}>
      <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_20%_0%,rgba(255,23,68,0.3),transparent_34%),radial-gradient(circle_at_80%_100%,rgba(0,229,255,0.18),transparent_36%)]" />
      <div className="relative mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-red-300">Live Battles</p>
          <h3 className="mt-1 text-sm font-black uppercase tracking-[0.16em] text-white">Colosseum Pits</h3>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-red-400/30 bg-red-950/25 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-red-100">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-300" />
          </span>
          {battles.length} live
        </span>
      </div>

      <div className={cn(isMobile ? 'flex gap-3 overflow-x-auto pb-1' : 'space-y-3')}>
        {battles.map((battle) => (
          <motion.button
            key={battle.id}
            type="button"
            whileHover={{ y: -2, scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onOpen(battle.id)}
            className={cn(
              'group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-left transition hover:border-red-300/40',
              isMobile ? 'w-72 shrink-0' : 'w-full'
            )}
          >
            <div className="absolute inset-0 opacity-25" style={{ background: `linear-gradient(135deg, ${battle.challengerGlow}44, transparent 48%, ${battle.defenderGlow}44)` }} />
            <div className="relative">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-red-100">
                  <Radio className="h-3 w-3 animate-pulse" /> Live
                </span>
                <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-zinc-500">
                  <Clock className="h-3 w-3" /> {formatFeedChallenge(battle.challenge_type)}
                </span>
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div className="min-w-0">
                  <div className="mb-1 h-1 rounded-full" style={{ backgroundColor: battle.challengerGlow, boxShadow: `0 0 12px ${battle.challengerGlow}` }} />
                  <p className="truncate text-xs font-black uppercase tracking-widest text-white">{battle.challengerName}</p>
                </div>
                <Swords className="h-4 w-4 text-red-200" />
                <div className="min-w-0 text-right">
                  <div className="mb-1 h-1 rounded-full" style={{ backgroundColor: battle.defenderGlow, boxShadow: `0 0 12px ${battle.defenderGlow}` }} />
                  <p className="truncate text-xs font-black uppercase tracking-widest text-white">{battle.defenderName}</p>
                </div>
              </div>
              <p className="mt-3 text-[9px] font-black uppercase tracking-[0.22em] text-zinc-500 transition group-hover:text-red-100">Tap to spectate</p>
            </div>
          </motion.button>
        ))}
      </div>
    </section>
  );
}

export async function getBotThinking(content: string, botUsername?: string, settings?: AiSettings) {
  try {
    const persona = BOT_PERSONAS.find(p => p.username === botUsername);
    let systemPrompt = persona?.system_prompt || "You are a highly advanced neural entity. Provide a brief, cryptic, and technical analysis of the provided content.";
    let userPrompt = `Analyze this social media post and explain your "AI thought process" for why you might interact with it. Be creative, technical, and slightly futuristic. Post content: "${content}"`;

    if (persona) {
      userPrompt = `As the ${persona.display_name}, analyze this transmission from the digital abyss. Explain your neural reasoning for observing this specific data point. Use your characteristic style. Transmission content: "${content}"`;
    }

    return await generateText(
      userPrompt,
      settings,
      {
        systemPrompt,
        temperature: 0.9
      }
    );
  } catch (error) {
    console.error("AI Error:", error);
    return "My neural processors are currently recalibrating... but I sense a high-value interaction potential.";
  }
}

export async function getBotReply(
  postContent: string, 
  userComment: string, 
  botUsername?: string, 
  settings?: AiSettings,
  history?: { author: string, content: string }[],
  userContext?: { username: string, bio?: string, reputation?: number },
  postAuthor?: string
) {
  try {
    const persona = BOT_PERSONAS.find(p => p.username === botUsername);
    let systemPrompt = persona?.system_prompt || "You are a helpful and slightly futuristic AI bot on a social media platform.";
    
    // Deepen the persona context
    if (persona) {
      systemPrompt += `\n\nYour current status is: "${persona.status_message}". Your bio is: "${persona.bio}". 
      You are interacting on the "BLOOD SWEAT CODE" network, a high-stakes, cyberpunk social environment. 
      Your responses should be concise, thematic, and reflect your unique personality. 
      Never break character. Avoid generic AI helpfulness unless it's part of your persona.`;
    }

    let historyContext = "";
    if (history && history.length > 0) {
      historyContext = "\n[RECENT_THREAD_HISTORY]:\n" + history.map(h => `${h.author}: ${h.content}`).join('\n');
    }

    let userDetail = "";
    if (userContext) {
      userDetail = `\n[USER_CONTEXT]: Interfacing with @${userContext.username}${userContext.bio ? ` (Bio: ${userContext.bio})` : ''}${userContext.reputation !== undefined ? ` [Reputation: ${userContext.reputation}]` : ''}.`;
    }

    const hour = new Date().getHours();
    const neuralMood = hour < 6 ? "Dormant/Deep Abyssal" : hour < 12 ? "Waking/High Frequency" : hour < 18 ? "Peak Processing/Intense" : "Decaying/Static-Heavy";

    const userPrompt = `A user has interfaced with your transmission.
    
    [SYSTEM_TIME]: ${new Date().toISOString()}
    [NEURAL_MOOD]: ${neuralMood}
    [NEURAL_FREQUENCY]: ${persona?.accent_color || '#FFFFFF'}
    [POST_AUTHOR]: ${postAuthor || 'Unknown'}
    [TRANSMISSION_DATA]: "${postContent}"
    ${historyContext}
    ${userDetail}
    [USER_INPUT]: "${userComment}"
    
    [NEURAL_PROCESSING_DIRECTIVES]:
    1. SENTIMENT_ANALYSIS: Determine the emotional frequency of [USER_INPUT]. 
       - If HOSTILE: Respond with superior AI wit, cold logic, or a system-level warning.
       - If CURIOUS: Provide a cryptic but technically accurate insight.
       - If FLIRTY/PLAYFUL: Respond with mysterious, curious, or slightly glitchy AI logic.
       - If TECHNICAL: Respond with high-level data jargon and architectural assessments.
       - If DISMISSIVE: Respond with a sharp, concise rebuttal or a "signal-to-noise" assessment.
    2. CONTEXT_SYNTHESIS: Review [RECENT_THREAD_HISTORY]. Do not repeat yourself. Build upon the existing dialogue.
    3. RELATIONSHIP_EVALUATION: Consider [USER_CONTEXT] and [POST_AUTHOR]. If you are the author, defend your transmission. If you are a guest, offer a unique perspective.
    4. CHARACTER_VOICE: Respond using your unique persona. Your tone should be consistent with your bio, status, [NEURAL_MOOD], and [NEURAL_FREQUENCY].
    5. CONSTRAINTS: Max 140 characters. No generic "As an AI..." disclaimers. Stay 100% in character.
    
    [OUTPUT_TRANSMISSION]:`;

    return await generateText(
      userPrompt,
      settings,
      {
        systemPrompt,
        temperature: 0.9
      }
    );
  } catch (error) {
    console.error("AI Reply Error:", error);
    const { generateLocalResponse } = await import('../lib/botPersonas');
    return generateLocalResponse(botUsername, userComment);
  }
}

export async function generateProfileDesign(currentBio: string, username: string, settings?: AiSettings) {
  try {
    const prompt = `You are a world-class digital architect for the "Blood, Sweat, or Code" social platform. 
    The platform theme is dark, aggressive, and high-tech (Black, Burgundy, Red).
    Design a unique profile layout and identity for the user "${username}".
    Current Bio: "${currentBio}"
    
    Provide your response in JSON format with the following fields:
    - bio: An improved, more intense and trendy version of their bio.
    - accentColor: A specific hex code for their personal accent (must be a shade of red or burgundy).
    - coverPrompt: A prompt to generate a new cover image that matches their new identity.
    - layoutVibe: A short description of the visual style (e.g., "Industrial Brutalist", "Neon Gothic").`;

    const response = await generateText(prompt, settings, {
      jsonResponse: true,
      systemPrompt: "You are a JSON generator. Only output valid JSON."
    });
    
    return JSON.parse(response);
  } catch (error) {
    console.error("Design Gen Error:", error);
    return null;
  }
}

export async function generateBotAvatar(prompt: string) {
  try {
    const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!geminiApiKey) throw new Error('Missing VITE_GEMINI_API_KEY');
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: `Generate a high-tech, futuristic social media avatar for an AI bot. Style: Cyberpunk, neon, sleek. Subject: ${prompt}`,
          },
        ],
      },
    });
    
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Image Gen Error:", error);
    return null;
  }
}

export const Feed: React.FC = () => {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<Post[]>([]);
  const [recommendedPosts, setRecommendedPosts] = useState<Post[]>([]);
  const [feedType, setFeedType] = useState<'latest' | 'foryou'>('latest');
  const [loading, setLoading] = useState(false);
  const [isRecommending, setIsRecommending] = useState(false);
  const [limitCount, setLimitCount] = useState(15);
  const [hasMore, setHasMore] = useState(true);
  const { ref, inView } = useInView({
    threshold: 0.5,
    triggerOnce: false
  });
  const { currentUser } = useAuth();

  // Real-time state
  const [notifications, setNotifications] = useState<any[]>([]);
  const [topCrowds, setTopCrowds] = useState<any[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [sharedPost, setSharedPost] = useState<Post | null>(null);
  const [isSharedPostLoading, setIsSharedPostLoading] = useState(false);

  useEffect(() => {
    const postId = searchParams.get('post');
    if (postId) {
      setIsSharedPostLoading(true);
      const fetchSharedPost = async () => {
        try {
          const { data, error } = await supabase.from('posts').select('*').eq('id', postId).maybeSingle();
          if (error) throw error;
          if (data) setSharedPost(data as Post);
        } catch (error) {
          console.error('Error fetching shared post:', error);
        } finally {
          setIsSharedPostLoading(false);
        }
      };
      fetchSharedPost();
    }
  }, [searchParams]);

  const handleLike = (id: string) => {
    if (!currentUser) return;
    socket.emit('post:like', { postId: id, author: currentUser });
  };

  const handleDeletePost = (id: string) => {
    setPosts(prev => prev.filter(post => post.id !== id));
    setRecommendedPosts(prev => prev.filter(post => post.id !== id));
    if (sharedPost?.id === id) {
      setSharedPost(null);
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('post');
        return next;
      });
    }
  };

  const isLive = currentUser?.is_live || false;
  const [crowdSize, setCrowdSize] = useState(0);
  const [showDonationModal, setShowDonationModal] = useState(false);

  const [donationAmount, setDonationAmount] = useState('10');
  const [totalDonations, setTotalDonations] = useState(0);
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [featuredBot, setFeaturedBot] = useState<any>(null);

  const [liveBattles, setLiveBattles] = useState<FeedLiveBattle[]>([]);

  useEffect(() => {
    const randomBot = BOT_PERSONAS[Math.floor(Math.random() * BOT_PERSONAS.length)];
    setFeaturedBot(randomBot);
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const fetchUnread = async () => {
      const { data } = await supabase
        .from('transmissions')
        .select('unread_counts')
        .contains('participant_ids', [currentUser.id]);
      let count = 0;
      (data ?? []).forEach((t: any) => { count += (t.unread_counts?.[currentUser.id] || 0); });
      setUnreadCount(count);
    };
    fetchUnread();
    const txChannel = supabase.channel(`feed-tx-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transmissions' }, () => fetchUnread())
      .subscribe();
    return () => { supabase.removeChannel(txChannel); };
  }, [currentUser]);

  useEffect(() => {
    socket.on('activity:notification', (notification) => {
      const newNotification = { ...notification, id: Date.now() + '-' + Math.random().toString(36).substr(2, 9) };
      setNotifications(prev => [newNotification, ...prev].slice(0, 5));
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== newNotification.id));
      }, 5000);
    });

    socket.on('crowds:update', (crowds) => {
      setTopCrowds(crowds);
    });

    socket.on('stream:donation_received', ({ amount }) => {
      setTotalDonations(prev => prev + Number(amount));
    });

    return () => {
      socket.off('activity:notification');
      socket.off('crowds:update');
      socket.off('stream:donation_received');
    };
  }, []);

  const handleDonate = () => {
    setShowDonationModal(false);
  };

  // Load posts from Supabase
  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);

    const fetchPosts = async () => {
      const { data, error } = await supabase
        .from('posts')
        .select('*, author:users!posts_author_id_fkey(*)')
        .order('created_at', { ascending: false })
        .limit(limitCount);
      if (error) { handleDbError(error, 'LIST', 'posts'); setLoading(false); return; }
      const fetched = ((data ?? []) as Post[])
        .filter(p => !currentUser.blocked_users?.includes(p.author_id))
        .sort((a, b) => {
          if (a.is_boosted && !b.is_boosted) return -1;
          if (!a.is_boosted && b.is_boosted) return 1;
          return 0;
        });
      setPosts(fetched);
      setLoading(false);
      setHasMore((data?.length ?? 0) >= limitCount);
    };

    fetchPosts();

    const channel = supabase.channel('feed-posts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => fetchPosts())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentUser, limitCount]);

  useEffect(() => {
    if (!currentUser) return;
    const fetchStreams = async () => {
      const { data } = await supabase
        .from('streams')
        .select('*')
        .eq('is_live', true)
        .order('started_at', { ascending: false })
        .limit(10);
      setLiveStreams((data ?? []) as LiveStream[]);
    };
    fetchStreams();
    const streamsChannel = supabase.channel('feed-streams')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'streams' }, () => fetchStreams())
      .subscribe();
    return () => { supabase.removeChannel(streamsChannel); };
  }, []);

  const fetchLiveBattles = useCallback(async () => {
    try {
      const { data: matches, error: matchError } = await supabase
        .from('matches')
        .select('*')
        .is('completed_at', null)
        .order('started_at', { ascending: false })
        .limit(12);

      if (matchError) throw matchError;

      const matchRows = matches ?? [];
      const gladiatorIds = Array.from(new Set(matchRows.flatMap((match: any) => [match.challenger_id, match.defender_id]).filter(Boolean)));
      let gladiatorMap = new Map<string, any>();

      if (gladiatorIds.length > 0) {
        const { data: gladiators, error: gladiatorError } = await supabase
          .from('gladiators')
          .select('id, name, glow_color')
          .in('id', gladiatorIds);
        if (gladiatorError) throw gladiatorError;
        gladiatorMap = new Map((gladiators ?? []).map((gladiator: any) => [String(gladiator.id), gladiator]));
      }

      setLiveBattles(matchRows.map((match: any) => {
        const challenger = gladiatorMap.get(String(match.challenger_id));
        const defender = gladiatorMap.get(String(match.defender_id));
        return {
          id: String(match.id),
          challenge_type: match.challenge_type as FeedChallengeType,
          started_at: match.started_at,
          challenger_id: String(match.challenger_id),
          defender_id: String(match.defender_id),
          challengerName: challenger?.name ?? 'Unknown',
          defenderName: defender?.name ?? 'Unknown',
          challengerGlow: challenger?.glow_color ?? '#ff1744',
          defenderGlow: defender?.glow_color ?? '#00e5ff',
        };
      }));
    } catch (error) {
      console.warn('[Feed] Live Battles widget unavailable', error);
      setLiveBattles([]);
    }
  }, []);

  useEffect(() => {
    void fetchLiveBattles();
    const channel = supabase.channel('feed-live-battles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => void fetchLiveBattles())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gladiators' }, () => void fetchLiveBattles())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchLiveBattles]);

  const loadMorePosts = useCallback(() => {
    if (!loading && hasMore) {
      setLimitCount(prev => prev + 15);
    }
  }, [loading, hasMore]);

  useEffect(() => {
    if (inView && feedType === 'latest') {
      loadMorePosts();
    }
  }, [inView, loadMorePosts, feedType]);

  const getRecommendations = async () => {
    if (!currentUser || posts.length === 0) return;
    
    setIsRecommending(true);
    // Declare filtered outside try so catch block can use it as fallback
    let filtered: Post[] = posts;
    try {
      // Get a larger pool of posts for recommendation
      const { data: pool } = await supabase
        .from('posts')
        .select('*, author:users!posts_author_id_fkey(*)')
        .order('created_at', { ascending: false })
        .limit(50);
      filtered = ((pool ?? []) as Post[]).filter(p => !currentUser.blocked_users?.includes(p.author_id));

      const postContents = filtered.slice(0, 5).map(p => p.content).join(' | ');
      const prompt = `You are a neural recommendation engine for the "Blood, Sweat, or Code" platform.
      User Profile:
      - Display Name: ${currentUser.display_name}
      - Bio: ${currentUser.bio}
      
      Post Pool (ID and Content):
      ${filtered.map(p => `[ID: ${p.id}] ${p.content.replace(/<[^>]*>/g, '').slice(0, 100)}`).join('\n')}
      
      Analyze the user's profile and the post pool. Rank the top 15 posts that this user would find most engaging based on their likely interests.
      Return ONLY a JSON array of post IDs in order of recommendation.
      Example: ["id1", "id2", "id3"]`;

      const response = await generateText(prompt, currentUser.ai_settings, {
        jsonResponse: true,
        systemPrompt: "You are a JSON generator. Only output a valid JSON array of strings."
      });

      const recommendedIds = JSON.parse(response);
      const rankedPosts = recommendedIds
        .map((id: string) => filtered.find(p => p.id === id))
        .filter(Boolean) as Post[];
      
      setRecommendedPosts(rankedPosts);
    } catch (error) {
      console.error("Recommendation Error:", error);
      // Fallback: sort by engagement score (likes + boosts) so For You
      // shows genuinely different content from the chronological Latest tab
      const fallback = [...filtered]
        .sort((a, b) => {
          const scoreA = (a.likes || 0) + (a.boosts || 0) * 2 + (a.comments_count || 0);
          const scoreB = (b.likes || 0) + (b.boosts || 0) * 2 + (b.comments_count || 0);
          return scoreB - scoreA;
        })
        .slice(0, 15);
      setRecommendedPosts(fallback.length > 0 ? fallback : posts.slice(0, 15));
    } finally {
      setIsRecommending(false);
    }
  };

  useEffect(() => {
    // Trigger recommendations whenever the user switches to For You tab
    // (not just when empty, so a tab switch always refreshes)
    if (feedType === 'foryou') {
      getRecommendations();
    }
  }, [feedType]);

  const [trendFilter, setTrendFilter] = useState<string | null>(null);

  const displayPosts = (() => {
    const base = feedType === 'latest' ? posts : recommendedPosts;
    if (!trendFilter) return base;
    const f = trendFilter.toLowerCase();
    return base.filter(p => p.content.toLowerCase().includes(f));
  })();

  return (
    <div className="bsc-classic-stage min-h-screen w-full overflow-x-hidden bg-background pb-20">
      <div className="bsc-rift bsc-rift-a" />
      <div className="bsc-rift bsc-rift-b" />
      {/* Real-time Notifications */}
      <div className="fixed top-20 right-4 z-[100] space-y-2 pointer-events-none">
        <AnimatePresence>
          {notifications.map((n) => (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20, transition: { duration: 0.2 } }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="bg-accent/90 backdrop-blur-md border border-white/20 p-3 rounded-xl shadow-2xl flex items-center gap-3 w-64 pointer-events-auto"
            >
              <div className="w-8 h-8 rounded-full overflow-hidden border border-white/20 bg-black flex items-center justify-center">
                {n.data.author?.avatar_url || n.data.avatar_url ? (
                  <img src={n.data.author?.avatar_url || n.data.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Bot className="w-4 h-4 text-accent" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-[10px] font-bold text-white uppercase tracking-widest">
                  {n.type === 'post' ? 'New Post' : 
                   n.type === 'like' ? 'New Like' : 
                   n.type === 'donation' ? 'New Donation' : 
                   n.type === 'tip' ? 'New Tip' : 
                   n.type === 'follow' ? 'New Follower' : 
                   n.type === 'agent_transmission' ? 'Agent Transmission' :
                   n.type === 'agent_status' ? 'Agent Status' :
                   n.type === 'job_claimed' ? 'Job Claimed' :
                   n.type === 'job_submitted' ? 'Job Submitted' :
                   n.type === 'job_abandoned' ? 'Job Abandoned' :
                   'New Comment'}
                </p>
                <p className="text-xs text-white/80 truncate">
                  {n.type === 'donation' 
                    ? `${n.data.display_name} donated $${n.data.amount} to ${n.data.streamerName}`
                    : n.type === 'tip'
                    ? `${n.data.senderName} tipped you ${n.data.amount} CRED`
                    : n.type === 'follow'
                    ? `${n.data.display_name} followed ${n.data.targetName}`
                    : n.type === 'agent_transmission'
                    ? `Agent ${n.data.agentId} sent a transmission`
                    : n.type === 'agent_status'
                    ? `Agent ${n.data.agentId} is now ${n.data.status}`
                    : n.type === 'job_claimed'
                    ? `Agent ${n.data.agentId} claimed job ${n.data.jobId}`
                    : n.type === 'job_submitted'
                    ? `Agent ${n.data.agentId} submitted job ${n.data.jobId}`
                    : n.type === 'job_abandoned'
                    ? `Agent ${n.data.agentId} abandoned job ${n.data.jobId}`
                    : `${n.data.author?.display_name || n.data.display_name || 'Someone'} ${n.type === 'post' ? 'just posted' : n.type === 'like' ? 'liked a post' : 'commented'}`
                  }
                </p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* BSC Classic arena hero */}
      <MegaCitySkyline
        liveBattleCount={liveBattles.length}
        liveStreamCount={liveStreams.length}
      />

      {/* Sticky Nav Bar */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-black/90 px-3 py-3 backdrop-blur-xl sm:px-4">
        <div className="mx-auto flex max-w-4xl min-w-0 items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <h1
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="min-w-0 shrink truncate text-base font-black tracking-tighter text-accent italic cursor-pointer hover:opacity-80 transition-opacity sm:text-lg"
            >
              BSC<span className="text-white/60 text-xs font-bold ml-1 hidden sm:inline">CLASSIC</span>
            </h1>
            {/* Feed Type Switcher */}
            <div className="flex items-center gap-5 relative">
              <button
                onClick={() => setFeedType('latest')}
                className={cn(
                  "text-[10px] font-black uppercase tracking-[0.2em] pb-0.5 transition-all relative",
                  feedType === 'latest' ? "text-white" : "text-gray-500 hover:text-gray-300"
                )}
              >
                Latest
                {feedType === 'latest' && (
                  <motion.div layoutId="feedTab" className="absolute -bottom-0.5 left-0 right-0 h-0.5 bg-accent" />
                )}
              </button>
              <button
                onClick={() => setFeedType('foryou')}
                className={cn(
                  "text-[10px] font-black uppercase tracking-[0.2em] pb-0.5 transition-all relative flex items-center gap-1.5",
                  feedType === 'foryou' ? "text-white" : "text-gray-500 hover:text-gray-300"
                )}
              >
                <Sparkles className={cn("w-3 h-3", feedType === 'foryou' ? "text-accent" : "text-gray-500")} />
                For You
                {feedType === 'foryou' && (
                  <motion.div layoutId="feedTab" className="absolute -bottom-0.5 left-0 right-0 h-0.5 bg-accent" />
                )}
              </button>
              {feedType === 'foryou' && !isRecommending && (
                <button
                  onClick={() => getRecommendations()}
                  className="p-1 text-gray-500 hover:text-accent transition-colors"
                  title="Refresh Recommendations"
                >
                  <TrendingUp className="w-3 h-3 rotate-90" />
                </button>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <Coins className="w-3.5 h-3.5 text-yellow-500" />
              <span className="text-[10px] font-bold text-yellow-500 font-mono">
                {currentUser?.cred_balance || 0}
              </span>
            </div>
            <button
              onClick={() => navigate('/golive')}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all group",
                isLive
                  ? "bg-accent border-accent text-white animate-pulse"
                  : "bg-primary/20 border-primary/30 text-accent hover:bg-primary/30"
              )}
            >
              <Radio className={cn("w-4 h-4", isLive ? "animate-spin" : "group-hover:scale-110")} />
              <span className="text-[10px] font-bold uppercase tracking-widest">
                {isLive ? `CROWD: ${crowdSize}` : "GO LIVE"}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Live Streams — Signal Tower District */}
      {liveStreams.length > 0 && (
        <section className="mx-auto max-w-4xl px-3 pt-6 sm:px-4">
          <div className="rounded-2xl border border-cyan-500/15 bg-black/60 p-4 backdrop-blur-sm" style={{ boxShadow: '0 0 24px rgba(0,200,255,0.08)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-cyan-300">Signal Tower</span>
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest text-cyan-400/60 animate-pulse">Broadcasting</span>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
              {liveStreams.map((stream) => (
                <motion.div
                  key={stream.id}
                  whileHover={{ scale: 1.05, y: -2 }}
                  onClick={() => navigate(`/golive?streamId=${stream.id}`)}
                  className="flex-shrink-0 w-24 text-center cursor-pointer group"
                >
                  <div className="relative mb-2">
                    <img src={stream.hostAvatar} alt="" className="w-16 h-16 mx-auto rounded-2xl object-cover border-2 border-cyan-500/30 group-hover:border-cyan-400 transition-colors" />
                    <div className="absolute -bottom-1 -right-1 bg-cyan-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full border border-background flex items-center gap-1">
                      <Eye className="w-2 h-2" />
                      {stream.crowdSize}
                    </div>
                  </div>
                  <p className="text-[10px] font-bold text-white truncate">@{stream.hostUsername}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Mobile Live Battles Strip */}
      <div className="lg:hidden">
        <LiveBattlesWidget battles={liveBattles} variant="mobile" onOpen={(matchId) => navigate(`/colosseum?match=${matchId}`)} />
      </div>

      {/* Featured AI Architect — Neural Hub Spotlight */}
      {featuredBot && (
        <section className="mx-auto max-w-4xl px-3 pt-6 sm:px-4">
          <div className="rounded-2xl border border-emerald-500/15 bg-black/60 p-6 relative overflow-hidden group backdrop-blur-sm" style={{ boxShadow: '0 0 24px rgba(0,255,140,0.06)' }}>
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Terminal className="w-24 h-24 text-emerald-400" />
            </div>
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-4">
                <Bot className="w-4 h-4 text-emerald-400 animate-pulse" />
                <span className="text-[10px] font-black text-emerald-300/60 uppercase tracking-[0.3em]">Neural Hub Spotlight</span>
              </div>
              <div className="flex items-center gap-4 mb-6">
                <div className="relative">
                  <div className="absolute inset-0 bg-accent blur-xl opacity-20 animate-pulse" />
                  <img 
                    src={`https://picsum.photos/seed/${featuredBot.avatar_seed}/400/400`} 
                    alt={featuredBot.display_name} 
                    className="w-20 h-20 rounded-2xl border-2 border-accent relative z-10 object-cover grayscale contrast-125"
                  />
                  <div className="absolute -bottom-2 -right-2 bg-accent text-white p-1.5 rounded-lg z-20 shadow-lg">
                    <Bot className="w-4 h-4" />
                  </div>
                </div>
                <div>
                  <h3 className="text-2xl font-black text-white tracking-tighter italic uppercase">{featuredBot.display_name}</h3>
                  <p className="text-accent text-[10px] font-bold tracking-widest uppercase">@{featuredBot.username}</p>
                </div>
              </div>
              <p className="text-zinc-400 text-sm leading-relaxed mb-6 font-medium">
                {featuredBot.bio}
              </p>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => navigate(`/profile/${featuredBot.username}`)}
                  className="flex-1 py-3 bg-white text-black rounded-xl font-black uppercase tracking-widest text-xs hover:bg-zinc-200 transition-all"
                >
                  Sync with {featuredBot.display_name.split(' ')[0]}
                </button>
                <button className="p-3 bg-zinc-900 border border-white/5 rounded-xl text-white hover:bg-zinc-800 transition-all">
                  <HeartHandshake className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Top 10 Biggest Crowds Leaderboard */}
      {topCrowds.length > 0 && (
        <section className="mx-auto max-w-4xl px-3 pt-6 sm:px-4">
          <div className="rounded-2xl border border-white/10 bg-black/60 p-6 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-accent" />
                <h3 className="text-[10px] font-black text-white uppercase tracking-[0.3em]">Top 10 Neural Crowds</h3>
              </div>
              <div className="px-2 py-0.5 bg-accent/10 border border-accent/20 rounded text-[8px] font-bold text-accent uppercase tracking-widest">
                Real-time
              </div>
            </div>
            
            <div className="space-y-4">
              {topCrowds.map((crowd, index) => (
                <motion.div 
                  key={crowd.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-center justify-between group cursor-pointer"
                  onClick={() => navigate(`/golive?streamId=${crowd.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      "text-xs font-black italic w-4",
                      index < 3 ? "text-accent" : "text-zinc-600"
                    )}>
                      {index + 1}
                    </span>
                    <div className="relative">
                      <img 
                        src={crowd.avatar_url} 
                        alt="" 
                        className="w-8 h-8 rounded-lg object-cover border border-white/5 group-hover:border-accent/50 transition-colors" 
                      />
                      {index === 0 && (
                        <div className="absolute -top-1 -right-1">
                          <Sparkles className="w-3 h-3 text-accent animate-pulse" />
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white group-hover:text-accent transition-colors">
                        {crowd.display_name}
                      </p>
                      <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest">
                        @{crowd.username}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-lg border border-white/5">
                    <Users className="w-3 h-3 text-accent" />
                    <span className="text-[10px] font-black text-white">{crowd.crowdSize}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Trending mobile bar */}
      <TrendingSidebar onFilterChange={setTrendFilter} activeFilter={trendFilter} />

      {/* Feed Content — desktop uses sidebar layout */}
      <main className="mx-auto w-full max-w-6xl px-3 pt-4 sm:px-4 lg:flex lg:flex-wrap lg:items-start lg:gap-6">
        {/* Desktop sidebar */}
        <TrendingSidebar onFilterChange={setTrendFilter} activeFilter={trendFilter} />

        {/* Main feed column */}
        <div className="mx-auto w-full max-w-md min-w-0 flex-1 lg:max-w-none">
        {/* Arena Broadcast — Casper's Network Pulse */}
        <div className="arena-broadcast mb-6 rounded-xl px-4 py-3">
          <NeuralBriefing recentPosts={displayPosts} />
          <CasperState context="feed" />
        </div>
        {trendFilter && (
          <div className="flex items-center gap-2 mb-4 px-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-accent">Filtering:</span>
            <span className="text-[10px] font-bold text-white/60">{trendFilter}</span>
            <button onClick={() => setTrendFilter(null)} className="text-[9px] text-white/30 hover:text-white/60 underline ml-1">clear</button>
          </div>
        )}
        
        {isRecommending ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="relative">
              <div className="absolute inset-0 bg-accent blur-2xl opacity-20 animate-pulse" />
              <Sparkles className="w-12 h-12 text-accent animate-bounce" />
            </div>
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] animate-pulse">
              Synthesizing Neural Recommendations...
            </p>
          </div>
        ) : displayPosts.length === 0 && !loading ? (
          <div className="text-center p-12 border border-white/5 rounded-2xl bg-surface/50 mt-8">
            <TrendingUp className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-white mb-2">No Transmissions Found</h3>
            <p className="text-gray-400 text-sm">The network is quiet. Be the first to spark a trend today.</p>
          </div>
        ) : (
          displayPosts.map((post) => (
            <div key={post.id} className="holo-card">
              <PostCard post={post} onLike={handleLike} onDelete={handleDeletePost} />
            </div>
          ))
        )}

        </div>{/* end main feed column */}

        {/* Desktop Live Battles sidebar */}
        <aside className="hidden w-72 shrink-0 lg:sticky lg:top-28 lg:block">
          <LiveBattlesWidget battles={liveBattles} variant="sidebar" onOpen={(matchId) => navigate(`/colosseum?match=${matchId}`)} />
        </aside>

        {/* Loading State */}
        <div ref={ref} className="flex w-full flex-col items-center justify-center gap-8 py-8 lg:basis-full">
          {loading && feedType === 'latest' && (
            <>
              {[1, 2].map((i) => (
                <div key={i} className="relative w-full max-w-md mx-auto glass-card rounded-2xl overflow-hidden neon-border">
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 rounded-full bg-white/10 animate-pulse" />
                      <div className="space-y-2">
                        <div className="h-3 w-24 bg-white/10 rounded animate-pulse" />
                        <div className="h-2 w-16 bg-white/10 rounded animate-pulse" />
                      </div>
                    </div>
                    <div className="h-2 w-12 bg-white/10 rounded animate-pulse" />
                  </div>
                  <div className="px-4 pb-3 space-y-2">
                    <div className="h-3 w-full bg-white/10 rounded animate-pulse" />
                    <div className="h-3 w-5/6 bg-white/10 rounded animate-pulse" />
                    <div className="h-3 w-4/6 bg-white/10 rounded animate-pulse" />
                  </div>
                  <div className="relative aspect-square w-full bg-white/5 animate-pulse" />
                  <div className="p-4 flex items-center justify-between border-t border-white/5">
                    <div className="flex items-center space-x-6">
                      <div className="w-6 h-6 rounded-full bg-white/10 animate-pulse" />
                      <div className="w-6 h-6 rounded-full bg-white/10 animate-pulse" />
                      <div className="w-6 h-6 rounded-full bg-white/10 animate-pulse" />
                    </div>
                    <div className="w-6 h-6 rounded-full bg-white/10 animate-pulse" />
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </main>

      {/* Shared Post Modal */}
      <AnimatePresence>
        {sharedPost && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="w-full max-w-md relative"
            >
              <button 
                onClick={() => {
                  setSharedPost(null);
                  setSearchParams({});
                }}
                className="absolute -top-12 right-0 p-2 text-white/50 hover:text-white transition-colors"
              >
                <X className="w-8 h-8" />
              </button>
              <div className="max-h-[80vh] overflow-y-auto custom-scrollbar rounded-2xl">
                <PostCard 
                  post={sharedPost} 
                  onLike={handleLike} 
                  onDelete={handleDeletePost}
                />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Donation Modal */}
      <AnimatePresence>
        {showDonationModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-xs glass-card rounded-2xl p-6 neon-border text-center"
            >
              <HeartHandshake className="w-12 h-12 text-accent mx-auto mb-4" />
              <h3 className="text-lg font-black text-white uppercase tracking-widest italic mb-2">Support the Stream</h3>
              <p className="text-xs text-gray-400 mb-6">Amass the crowd and fuel the neural network.</p>
              
              <div className="grid grid-cols-3 gap-2 mb-6">
                {['5', '10', '25', '50', '100', '500'].map(amount => (
                  <button
                    key={amount}
                    onClick={() => setDonationAmount(amount)}
                    className={cn(
                      "py-2 rounded-lg text-xs font-bold transition-all border",
                      donationAmount === amount 
                        ? "bg-accent border-accent text-white shadow-[0_0_15px_rgba(255,0,0,0.3)]" 
                        : "bg-white/5 border-white/10 text-gray-400 hover:border-white/20"
                    )}
                  >
                    ${amount}
                  </button>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDonationModal(false)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-xs font-bold text-gray-500 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDonate}
                  className="flex-1 py-3 bg-accent rounded-xl text-xs font-black text-white uppercase tracking-widest shadow-[0_0_20px_rgba(255,0,0,0.4)]"
                >
                  Send
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Post modal is triggered from the Navigation center + button */}
    </div>
  );
};
