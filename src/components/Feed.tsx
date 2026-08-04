import React, { useState, useEffect, useCallback } from 'react';
import { useInView } from 'react-intersection-observer';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Post, User, LiveStream } from '../types';
import { PostCard } from './PostCard';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, Plus, TrendingUp, Users, MessageCircle, User as UserIcon, Search as SearchIcon, Radio, X, Eye, Heart as HeartIcon, MessageSquare, HeartHandshake, Terminal, Sparkles, Bot, Coins } from 'lucide-react';
import { cn } from '../lib/utils';
import { socket } from '../lib/socket';
export { socket } from '../lib/socket'; // backward-compat re-export
import { useAuth } from '../AuthContext';
import { generateText } from '../lib/ai';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { CreatePostModal } from './CreatePostModal';
import { BOT_PERSONAS } from '../lib/botPersonas';
import { NeuralBriefing } from './NeuralBriefing';
// Re-export AI helpers from their canonical location for backward-compat imports
export { getBotThinking, getBotReply, performNeuralTask, generateProfileDesign, generateBotAvatar } from '../lib/botAi';

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
          const { data, error } = await supabase.from('posts').select('*, author:users(*)').eq('id', postId).maybeSingle();
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

  const isLive = currentUser?.is_live || false;
  const [crowdSize, setCrowdSize] = useState(0);
  const [showDonationModal, setShowDonationModal] = useState(false);
  const [showCreatePostModal, setShowCreatePostModal] = useState(false);
  const [donationAmount, setDonationAmount] = useState('10');
  const [totalDonations, setTotalDonations] = useState(0);
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [featuredBot, setFeaturedBot] = useState<any>(null);

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
        .select('*, author:users(*)')
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
    try {
      // Get a larger pool of posts for recommendation
      const { data: pool } = await supabase
        .from('posts')
        .select('*, author:users(*)')
        .order('created_at', { ascending: false })
        .limit(50);
      const filtered = ((pool ?? []) as Post[]).filter(p => !currentUser.blocked_users?.includes(p.author_id));

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
      // Fallback to latest if AI fails
      setRecommendedPosts(posts.slice(0, 15));
    } finally {
      setIsRecommending(false);
    }
  };

  useEffect(() => {
    if (feedType === 'foryou' && recommendedPosts.length === 0) {
      getRecommendations();
    }
  }, [feedType, currentUser]);

  const displayPosts = feedType === 'latest' ? posts : recommendedPosts;

  return (
    <div className="min-h-screen bg-background pb-20">
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

      {/* Top Navigation */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-white/5 px-4 py-4">
        <div className="max-w-md mx-auto flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h1 
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="text-xl font-black tracking-tighter text-accent italic cursor-pointer hover:opacity-80 transition-opacity"
            >
              BLOOD<span className="text-white">SWEAT</span>CODE
            </h1>
            <div className="flex items-center space-x-4">
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
              <Link to="/trending">
                <TrendingUp className="w-5 h-5 text-gray-400 hover:text-accent cursor-pointer transition-colors" />
              </Link>
            </div>
          </div>

          {/* Feed Type Switcher */}
          <div className="flex items-center justify-center gap-8 border-t border-white/5 pt-2 relative">
            <button
              onClick={() => setFeedType('latest')}
              className={cn(
                "text-[10px] font-black uppercase tracking-[0.2em] pb-1 transition-all relative",
                feedType === 'latest' ? "text-white" : "text-gray-500 hover:text-gray-300"
              )}
            >
              Latest
              {feedType === 'latest' && (
                <motion.div layoutId="feedTab" className="absolute -bottom-1 left-0 right-0 h-0.5 bg-accent" />
              )}
            </button>
            <button
              onClick={() => setFeedType('foryou')}
              className={cn(
                "text-[10px] font-black uppercase tracking-[0.2em] pb-1 transition-all relative flex items-center gap-1.5",
                feedType === 'foryou' ? "text-white" : "text-gray-500 hover:text-gray-300"
              )}
            >
              <Sparkles className={cn("w-3 h-3", feedType === 'foryou' ? "text-accent" : "text-gray-500")} />
              For You
              {feedType === 'foryou' && (
                <motion.div layoutId="feedTab" className="absolute -bottom-1 left-0 right-0 h-0.5 bg-accent" />
              )}
            </button>
            
            {feedType === 'foryou' && !isRecommending && (
              <button 
                onClick={() => getRecommendations()}
                className="absolute right-0 top-2 p-1 text-gray-500 hover:text-accent transition-colors"
                title="Refresh Recommendations"
              >
                <TrendingUp className="w-3 h-3 rotate-90" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Live Streams Section */}
      {liveStreams.length > 0 && (
        <section className="max-w-md mx-auto pt-6 px-4">
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
              <Radio className="w-4 h-4 text-accent animate-pulse" />
              Live Neural Links
            </div>
            <span className="text-[10px] text-accent font-bold animate-pulse">ACTIVE</span>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
            {liveStreams.map((stream) => (
              <motion.div
                key={stream.id}
                whileHover={{ scale: 1.05 }}
                onClick={() => navigate(`/golive?streamId=${stream.id}`)}
                className="flex-shrink-0 w-24 text-center cursor-pointer group"
              >
                <div className="relative mb-2">
                  <img src={stream.hostAvatar} alt="" className="w-16 h-16 mx-auto rounded-2xl object-cover border-2 border-primary group-hover:border-accent transition-colors" />
                  <div className="absolute -bottom-1 -right-1 bg-accent text-white text-[8px] font-black px-1.5 py-0.5 rounded-full border border-background flex items-center gap-1">
                    <Eye className="w-2 h-2" />
                    {stream.crowdSize}
                  </div>
                </div>
                <p className="text-[10px] font-bold text-white truncate">@{stream.hostUsername}</p>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* Featured AI Architect */}
      {featuredBot && (
        <section className="max-w-md mx-auto pt-6 px-4">
          <div className="bg-zinc-950 border border-white/10 rounded-3xl p-6 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Terminal className="w-24 h-24 text-accent" />
            </div>
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-4 h-4 text-accent animate-pulse" />
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em]">Featured Neural Entity</span>
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
        <section className="max-w-md mx-auto pt-6 px-4">
          <div className="bg-zinc-950 border border-white/10 rounded-3xl p-6">
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

      {/* Feed Content */}
      <main className="max-w-md mx-auto pt-4 px-4">
        <NeuralBriefing recentPosts={displayPosts} />
        
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
            <PostCard key={post.id} post={post} onLike={handleLike} />
          ))
        )}

        {/* Loading State */}
        <div ref={ref} className="py-8 flex flex-col justify-center items-center gap-8 w-full">
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
      {/* Floating Action Button */}
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        whileHover={{ scale: 1.1, boxShadow: "0 0 40px rgba(255,0,0,0.6)" }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setShowCreatePostModal(true)}
        className="fixed bottom-24 right-6 z-50 p-4 bg-accent rounded-full shadow-[0_0_30px_rgba(255,0,0,0.4)] border-2 border-white/10 group"
      >
        <Plus className="w-6 h-6 text-white group-hover:rotate-90 transition-transform duration-300" />
      </motion.button>

      <CreatePostModal 
        isOpen={showCreatePostModal} 
        onClose={() => setShowCreatePostModal(false)} 
        onPostCreated={() => {
          // onSnapshot will handle the update, but we can reset limit if we want to see it immediately
          // or just let it be if it's within the current limit
        }}
      />
    </div>
  );
};
