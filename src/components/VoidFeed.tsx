import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { 
  Ghost, 
  Skull, 
  Eye, 
  Heart, 
  Clock, 
  Trash2, 
  Loader2, 
  Zap, 
  Sparkles,
  Send,
  ShieldAlert,
  Wind,
  ArrowLeft
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  updateDoc, 
  doc,
  deleteDoc,
  limit,
  Timestamp
} from 'firebase/firestore';
import { VoidPost } from '../types';
import { cn } from '../lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { generateText } from '../lib/ai';

export const VoidFeed: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [posts, setPosts] = useState<VoidPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [newContent, setNewContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mood, setMood] = useState<string>('CALIBRATING...');

  useEffect(() => {
    if (!currentUser) return;

    const voidRef = collection(db, 'void_posts');
    const q = query(voidRef, orderBy('created_at', 'desc'), limit(50));

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const now = new Date();
      const fetchedPosts = snapshot.docs
        .map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            created_at: data.created_at || data.created_at?.toDate?.()?.toISOString() || new Date().toISOString(),
            expires_at: data.expires_at || data.expires_at?.toDate?.()?.toISOString() || new Date().toISOString()
          } as VoidPost;
        })
        .filter(post => new Date(post.expires_at) > now);

      setPosts(fetchedPosts);
      setLoading(false);

      // Generate Mood Summary if there are posts
      if (fetchedPosts.length > 0) {
        try {
          const prompt = `Analyze these anonymous whispers from "The Void" and provide a 1-sentence "Mood of the Network" summary in a cyberpunk, cryptic style. 
          Whispers: ${fetchedPosts.map(p => p.content).join(' | ')}`;
          
          const response = await generateText(prompt, currentUser.ai_settings, {
            systemPrompt: "You are a cryptic neural entity. Provide a short, impactful summary of the provided whispers.",
            temperature: 1.0
          });
          setMood(response || 'THE VOID IS SILENT.');
        } catch (error) {
          console.error("AI Error:", error);
          setMood('INTERFERENCE DETECTED.');
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'void_posts');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const handlePostToVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim() || !currentUser) return;

    setIsSubmitting(true);
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 6 * 60 * 60 * 1000); // 6 hours default

      await addDoc(collection(db, 'void_posts'), {
        content: newContent,
        decay_rate: 0.05,
        view_count: 0,
        like_count: 0,
        created_at: serverTimestamp(),
        expires_at: Timestamp.fromDate(expiresAt),
        is_anonymous: true
      });

      // Chance to trigger a "Void Echo" (AI Response)
      if (Math.random() > 0.7) {
        setTimeout(async () => {
          try {
            const echoPrompt = `A user just whispered this into "The Void": "${newContent}". 
            Provide a 1-sentence "Void Echo" response. It should be cryptic, haunting, and cyberpunk. 
            The echo should feel like the void itself is responding or reflecting the thought.`;
            
            const echoResponse = await generateText(echoPrompt, currentUser.ai_settings, {
              systemPrompt: "You are the voice of THE VOID. You respond to whispers with cryptic, haunting echoes.",
              temperature: 1.0
            });

            if (echoResponse) {
              await addDoc(collection(db, 'void_posts'), {
                content: `[ECHO]: ${echoResponse}`,
                decay_rate: 0.1,
                view_count: 0,
                like_count: 0,
                created_at: serverTimestamp(),
                expires_at: Timestamp.fromDate(new Date(Date.now() + 2 * 60 * 60 * 1000)),
                is_anonymous: true,
                is_echo: true
              });
            }
          } catch (echoErr) {
            console.error("Void Echo Error:", echoErr);
          }
        }, 2000);
      }

      setNewContent('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'void_posts');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInteraction = async (postId: string, type: 'view' | 'like') => {
    const post = posts.find(p => p.id === postId);
    if (!post) return;

    try {
      const postRef = doc(db, 'void_posts', postId);
      const updates: any = {};
      
      if (type === 'view') {
        updates.view_count = post.view_count + 1;
        // Accelerate expiration on view
        const currentExpires = new Date(post.expires_at);
        const newExpires = new Date(currentExpires.getTime() - 5 * 60 * 1000);
        updates.expires_at = Timestamp.fromDate(newExpires);
      } else if (type === 'like') {
        updates.like_count = post.like_count + 1;
        // Likes extend life slightly
        const currentExpires = new Date(post.expires_at);
        const newExpires = new Date(currentExpires.getTime() + 10 * 60 * 1000);
        updates.expires_at = Timestamp.fromDate(newExpires);
      }

      await updateDoc(postRef, updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `void_posts/${postId}`);
    }
  };

  return (
    <div className="min-h-screen bg-transparent text-white pb-20 overflow-x-hidden">
      {/* Void Header */}
      <div className="sticky top-0 z-20 bg-black/80 backdrop-blur-xl border-b border-white/5 p-6">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>
            <div className="relative">
              <Ghost className="w-8 h-8 text-primary animate-pulse" />
              <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tighter uppercase italic">The Void</h1>
              <p className="text-[10px] font-mono text-primary/60 tracking-[0.2em] uppercase">Data Decay in Progress</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/10">
            <Zap className="w-3 h-3 text-yellow-500" />
            <span className="text-[10px] font-bold font-mono">{posts.length} ACTIVE SIGNALS</span>
          </div>
        </div>
        
        {/* Mood Summary */}
        <div className="max-w-2xl mx-auto mt-4 px-2">
          <div className="flex items-center gap-2 text-[10px] font-mono text-primary/40 uppercase tracking-widest mb-1">
            <Sparkles className="w-3 h-3" />
            Mood Analysis
          </div>
          <p className="text-xs font-mono text-primary/80 italic animate-pulse">
            &gt; {mood}
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-8">
        {/* Input Area */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/5 border border-white/10 rounded-2xl p-6 shadow-2xl relative overflow-hidden group"
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-20 group-hover:opacity-100 transition-opacity" />
          
          <form onSubmit={handlePostToVoid} className="space-y-4">
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Whisper into the void... it won't last long."
              className="w-full bg-transparent border-none focus:ring-0 text-lg placeholder:text-white/20 resize-none min-h-[100px] font-mono"
              maxLength={280}
            />
            <div className="flex items-center justify-between pt-4 border-t border-white/5">
              <div className="flex items-center gap-2 text-xs text-white/40 font-mono">
                <ShieldAlert className="w-4 h-4" />
                ANONYMOUS TRANSMISSION
              </div>
              <button
                disabled={isSubmitting || !newContent.trim()}
                className="flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-full font-bold hover:scale-105 transition-transform disabled:opacity-50 disabled:scale-100"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                RELEASE
              </button>
            </div>
          </form>
        </motion.div>

        {/* Feed */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Wind className="w-12 h-12 text-primary/20 animate-bounce" />
            <p className="text-xs font-mono text-white/20 tracking-widest uppercase">Listening for whispers...</p>
          </div>
        ) : (
          <div className="space-y-6">
            <AnimatePresence mode="popLayout">
              {posts.map((post) => {
                const expirationDate = new Date(post.expires_at);
                const now = new Date();
                const timeLeft = expirationDate.getTime() - now.getTime();
                const totalLife = 6 * 60 * 60 * 1000;
                const lifePercent = Math.max(0, (timeLeft / totalLife) * 100);
                
                const opacity = Math.max(0.2, lifePercent / 100);
                const blur = Math.max(0, (100 - lifePercent) / 10);

                return (
                  <motion.div
                    key={post.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ 
                      opacity, 
                      scale: 1,
                      filter: `blur(${blur}px)`
                    }}
                    exit={{ opacity: 0, scale: 1.1, filter: 'blur(20px)' }}
                    className={cn(
                      "relative bg-white/[0.02] border border-white/10 rounded-2xl p-8 group hover:bg-white/[0.04] transition-colors",
                      post.is_echo && "border-primary/30 bg-primary/5 shadow-[0_0_30px_rgba(255,0,0,0.1)]"
                    )}
                    onViewportEnter={() => handleInteraction(post.id, 'view')}
                  >
                    {/* Decay Progress Bar */}
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-white/5">
                      <motion.div 
                        className={cn("h-full", post.is_echo ? "bg-accent" : "bg-primary")}
                        initial={{ width: '100%' }}
                        animate={{ width: `${lifePercent}%` }}
                        transition={{ duration: 1 }}
                      />
                    </div>

                    <div className="flex items-start justify-between mb-6">
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          "w-8 h-8 rounded-full bg-gradient-to-br from-white/10 to-transparent flex items-center justify-center border border-white/10",
                          post.is_echo && "border-primary/50"
                        )}>
                          {post.is_echo ? <Sparkles className="w-4 h-4 text-primary" /> : <Skull className="w-4 h-4 text-white/40" />}
                        </div>
                        <span className={cn(
                          "text-[10px] font-mono uppercase tracking-widest",
                          post.is_echo ? "text-primary font-black" : "text-white/40"
                        )}>
                          {post.is_echo ? "Void Echo" : "Unknown Signal"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] font-mono text-primary">
                        <Clock className="w-3 h-3" />
                        {Math.ceil(timeLeft / (60 * 1000))}M REMAINING
                      </div>
                    </div>

                    <p className="text-xl font-medium leading-relaxed mb-8 font-mono tracking-tight">
                      {post.content}
                    </p>

                    <div className="flex items-center gap-6">
                      <button 
                        onClick={() => handleInteraction(post.id, 'like')}
                        className="flex items-center gap-2 text-xs text-white/40 hover:text-red-500 transition-colors group/btn"
                      >
                        <Heart className={cn("w-4 h-4", post.like_count > 0 && "fill-red-500 text-red-500")} />
                        <span className="font-mono">{post.like_count}</span>
                      </button>
                      <div className="flex items-center gap-2 text-xs text-white/40">
                        <Eye className="w-4 h-4" />
                        <span className="font-mono">{post.view_count}</span>
                      </div>
                    </div>

                    {/* Glitch Overlay (Visible on Hover) */}
                    <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-10 transition-opacity bg-[url('https://media.giphy.com/media/oEI9uWUznW3pS/giphy.gif')] bg-cover mix-blend-overlay" />
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};
