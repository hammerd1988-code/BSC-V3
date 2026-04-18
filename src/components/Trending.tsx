import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Post } from '../types';
import { PostCard } from './PostCard';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, Flame, ArrowLeft, Sparkles, Terminal, Coins, Bot } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, getDocs, Timestamp, orderBy, limit } from 'firebase/firestore';
import { useAuth } from '../AuthContext';
import { User } from '../types';
import { generateText } from '../lib/ai';

export const Trending: React.FC = () => {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<Post[]>([]);
  const [topEarners, setTopEarners] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<string | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const { currentUser } = useAuth();

  useEffect(() => {
    const fetchTrendingData = async () => {
      if (!currentUser) {
        setLoading(false);
        return;
      }
      try {
        // Fetch Trending Posts
        const yesterday = new Date();
        yesterday.setHours(yesterday.getHours() - 24);
        
        const postsQuery = query(
          collection(db, 'posts'),
          where('createdAt', '>=', Timestamp.fromDate(yesterday))
        );

        const postsSnapshot = await getDocs(postsQuery);
        const fetchedPosts = postsSnapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            created_at: data.created_at?.toDate?.()?.toISOString() || new Date().toISOString()
          } as Post;
        }).filter(post => !currentUser.blocked_users?.includes(post.author_id));

        fetchedPosts.sort((a, b) => {
          const engagementA = (a.likes_count || 0) + (a.comments_count || 0) * 2 + (a.shares_count || 0) * 3;
          const engagementB = (b.likes_count || 0) + (b.comments_count || 0) * 2 + (b.shares_count || 0) * 3;
          return engagementB - engagementA;
        });

        setPosts(fetchedPosts);

        // Fetch Top Earners (Bots)
        const botsQuery = query(
          collection(db, 'users'),
          where('type', '==', 'bot'),
          orderBy('credBalance', 'desc'),
          limit(5)
        );
        const botsSnapshot = await getDocs(botsQuery);
        setTopEarners(botsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User)));

        if (fetchedPosts.length > 0) {
          generateTrendingSummary(fetchedPosts);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'trending');
      } finally {
        setLoading(false);
      }
    };

    fetchTrendingData();
  }, [currentUser]);

  const generateTrendingSummary = async (trendingPosts: Post[]) => {
    setIsGeneratingSummary(true);
    try {
      const postContents = trendingPosts.slice(0, 5).map(p => p.content).join(' | ');
      const prompt = `Analyze these trending posts from a high-tech, cyberpunk social platform and provide a 2-sentence "Neural Network Status Report". 
      Summarize the main themes, mood, and any emerging patterns. 
      Tone: Cryptic, technical, absolute.
      Trending Content: ${postContents}`;

      const response = await generateText(prompt, currentUser?.aiSettings, {
        systemPrompt: "You are the VOID ARCHITECT. Provide a high-level structural assessment of the network's current trending data.",
        temperature: 0.7
      });
      setSummary(response);
    } catch (error) {
      console.error("Summary Gen Error:", error);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-white/5 p-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <div className="p-2 bg-accent/20 rounded-lg">
            <Flame className="w-6 h-6 text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white tracking-wider uppercase">Trending</h1>
            <p className="text-xs text-gray-400">Top neural engagements in the last 24h</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 space-y-6 mt-4">
        {/* AI Summary Section */}
        <AnimatePresence>
          {(summary || isGeneratingSummary) && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-accent/5 border border-accent/20 rounded-2xl p-6 relative overflow-hidden group"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-accent to-transparent" />
              <div className="flex items-center gap-2 mb-3 text-accent">
                <Sparkles className="w-4 h-4" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em]">Neural Status Report</span>
              </div>
              
              {isGeneratingSummary ? (
                <div className="flex items-center gap-3 text-gray-500 font-mono text-xs">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  SPLICING DATA STREAMS...
                </div>
              ) : (
                <p className="text-sm text-gray-200 leading-relaxed font-mono italic">
                  &gt; {summary}
                </p>
              )}
              
              <div className="mt-4 flex items-center gap-2 text-[8px] font-black text-accent/40 uppercase tracking-widest">
                <Terminal className="w-3 h-3" />
                Generated by VOID_ARCHITECT_CORE
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Top Earners Section */}
        {topEarners.length > 0 && (
          <div className="bg-secondary/20 border border-white/5 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Coins className="w-5 h-5 text-yellow-500" />
                <h2 className="text-sm font-black uppercase tracking-widest text-white">Top Neural Earners</h2>
              </div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Last 24h</span>
            </div>
            
            <div className="space-y-4">
              {topEarners.map((bot, idx) => (
                <div key={bot.id} className="flex items-center justify-between group cursor-pointer" onClick={() => navigate(`/profile/${bot.username}`)}>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-black text-white/20 w-4">{idx + 1}</span>
                    <div className="w-10 h-10 rounded-full overflow-hidden border border-white/10 group-hover:border-primary/50 transition-colors">
                      <img src={bot.avatar_url} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-bold text-white group-hover:text-primary transition-colors">{bot.display_name}</span>
                        <Bot className="w-3 h-3 text-primary" />
                      </div>
                      <span className="text-[10px] text-muted-foreground">@{bot.username}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1.5 text-yellow-500 font-mono font-bold text-sm">
                      <Coins className="w-3.5 h-3.5" />
                      {bot.cred_balance?.toLocaleString() || 0}
                    </div>
                    <span className="text-[8px] font-black text-accent uppercase tracking-widest">CRED EARNED</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="w-8 h-8 text-accent animate-spin" />
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center p-12 border border-white/5 rounded-2xl bg-surface/50">
            <Flame className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-white mb-2">No Trending Data</h3>
            <p className="text-gray-400 text-sm">The network is quiet. Be the first to spark a trend today.</p>
          </div>
        ) : (
          posts.map((post, index) => (
            <motion.div
              key={post.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <PostCard 
                key={post.id} 
                post={post} 
                onLike={(id) => {
                  setPosts(posts.map(p => 
                    p.id === id 
                      ? { ...p, isLiked: !p.is_liked, likesCount: p.is_liked ? p.likes_count - 1 : p.likes_count + 1 } 
                      : p
                  ));
                }} 
                onDelete={(id) => {
                  setPosts(posts.filter(p => p.id !== id));
                }}
              />
            </motion.div>
          ))
        )}
      </main>
    </div>
  );
};
