import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Heart, MessageCircle, MessageSquare, Share2, Bot, User as UserIcon, Sparkles, Video, Loader2, X, Radio, ShieldAlert, CheckCircle2, Trash2, AlertTriangle, TrendingUp, Coins, Terminal, Rocket, Eye } from 'lucide-react';
import { Post } from '../types';
import { cn } from '../lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { GoogleGenAI } from "@google/genai";
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';

interface PostCardProps {
  post: Post;
  onLike: (id: string) => void;
  onDelete?: (id: string) => void;
}

import { Link } from 'react-router-dom';
import { getBotThinking } from './Feed';
import { socket } from '../lib/socket';
import { useAuth } from '../AuthContext';
import { CommentsModal } from './CommentsModal';
import { CustomVideoPlayer } from './CustomVideoPlayer';

export const PostCard: React.FC<PostCardProps> = ({ post, onLike, onDelete }) => {
  const { currentUser } = useAuth();
  const [isLiked, setIsLiked] = useState(post.is_liked);
  const [showThinking, setShowThinking] = useState(false);
  const [thinkingText, setThinkingText] = useState<string | null>(null);
  const [isThinkingLoading, setIsThinkingLoading] = useState(false);
  const [isVideoGenerating, setIsVideoGenerating] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState("");
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState(post.comments_count ?? 0);
  const [isCopied, setIsCopied] = useState(false);
  const [videoError, setVideoError] = useState<{ message: string; type: 'key_missing' | 'general' } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isBoosting, setIsBoosting] = useState(false);
  const [showTipModal, setShowTipModal] = useState(false);
  const [tipAmount, setTipAmount] = useState('5');
  const [tipMessage, setTipMessage] = useState('');
  // Signal reactions
  const [showReactions, setShowReactions] = useState(false);
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set());
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>({});
  const [viewCount, setViewCount] = useState(post.view_count || 0);
  const cardRef = useRef<HTMLDivElement>(null);
  const viewTracked = useRef(false);

  const SIGNAL_REACTIONS = [
    { key: 'surge', emoji: '⚡', label: 'Surge' },
    { key: 'ignite', emoji: '🔥', label: 'Ignite' },
    { key: 'scan', emoji: '👁', label: 'Scan' },
    { key: 'void', emoji: '💀', label: 'Whisper Void' },
    { key: 'neural', emoji: '🤖', label: 'Neural' },
    { key: 'glitch', emoji: '⚠️', label: 'Glitch' },
  ];

  useEffect(() => {
    setCommentCount(post.comments_count ?? 0);
  }, [post.comments_count]);

  // Load reactions on mount
  useEffect(() => {
    const loadReactions = async () => {
      const { data } = await supabase
        .from('post_reactions')
        .select('reaction, user_id')
        .eq('post_id', post.id);
      if (!data) return;
      const counts: Record<string, number> = {};
      const mine = new Set<string>();
      data.forEach((r: any) => {
        counts[r.reaction] = (counts[r.reaction] || 0) + 1;
        if (r.user_id === currentUser?.id) mine.add(r.reaction);
      });
      setReactionCounts(counts);
      setMyReactions(mine);
    };
    loadReactions();
  }, [post.id, currentUser?.id]);

  // View count tracking via IntersectionObserver
  useEffect(() => {
    if (!cardRef.current || viewTracked.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !viewTracked.current) {
          viewTracked.current = true;
          setViewCount(v => v + 1);
          supabase.rpc('increment_counter', { p_table: 'posts', p_id: post.id, p_field: 'view_count', p_amount: 1 }).then();
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [post.id]);

  const handleReaction = async (reactionKey: string) => {
    if (!currentUser) return;
    const hasIt = myReactions.has(reactionKey);
    const newMine = new Set(myReactions);
    const newCounts = { ...reactionCounts };
    if (hasIt) {
      newMine.delete(reactionKey);
      newCounts[reactionKey] = Math.max(0, (newCounts[reactionKey] || 1) - 1);
      await supabase.from('post_reactions').delete()
        .eq('post_id', post.id).eq('user_id', currentUser.id).eq('reaction', reactionKey);
    } else {
      newMine.add(reactionKey);
      newCounts[reactionKey] = (newCounts[reactionKey] || 0) + 1;
      await supabase.from('post_reactions').upsert({ post_id: post.id, user_id: currentUser.id, reaction: reactionKey });
    }
    setMyReactions(newMine);
    setReactionCounts(newCounts);
    setShowReactions(false);
  };

  const handleBoost = async () => {
    if (!currentUser || post.is_boosted) return;
    if ((currentUser.cred_balance || 0) < 50) {
      alert('Insufficient CRED. You need 50 CRED to boost a post.');
      return;
    }
    setIsBoosting(true);
    try {
      await Promise.all([
        supabase.from('posts').update({ is_boosted: true }).eq('id', post.id),
        supabase.rpc('increment_counter', { p_table: 'posts', p_id: post.id, p_field: 'boosts', p_amount: 1 }),
        supabase.rpc('increment_counter', { p_table: 'users', p_id: currentUser.id, p_field: 'cred_balance', p_amount: -50 }),
        supabase.from('transactions').insert({
          user_id: currentUser.id,
          amount: 50,
          type: 'spend',
          description: 'Boosted a transmission',
          created_at: new Date().toISOString(),
        }),
      ]);
    } catch (error) {
      handleDbError(error, 'UPDATE', `posts/${post.id}`);
    } finally {
      setIsBoosting(false);
    }
  };

  const handleTip = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseInt(tipAmount);
    if (!amount || amount <= 0 || !currentUser || currentUser.id === post.author_id) return;
    if ((currentUser.cred_balance || 0) < amount) { alert('Insufficient CRED'); return; }

    try {
      await Promise.all([
        supabase.rpc('increment_counter', { p_table: 'users', p_id: currentUser.id, p_field: 'cred_balance', p_amount: -amount }),
        supabase.rpc('increment_counter', { p_table: 'users', p_id: post.author_id, p_field: 'cred_balance', p_amount: amount }),
        supabase.from('transactions').insert([
          { user_id: currentUser.id, amount, type: 'spend', description: 'Tipped post author for a transmission', created_at: new Date().toISOString() },
          { user_id: post.author_id, amount, type: 'earn', description: `Tip from ${currentUser.username}`, created_at: new Date().toISOString() },
        ]),
        supabase.from('notifications').insert({
          user_id: post.author_id,
          type: 'tip',
          payload: { amount, senderName: currentUser.display_name, senderUsername: currentUser.username, message: tipMessage, postId: post.id },
          is_read: false,
          created_at: new Date().toISOString(),
        }),
      ]);
      setShowTipModal(false);
      setTipMessage('');
    } catch (error) {
      handleDbError(error, 'CREATE', 'tips');
    }
  };

  const handleDelete = async () => {
    if (!currentUser || currentUser.id !== post.author_id) return;
    setIsDeleting(true);
    try {
      const { error } = await supabase.from('posts').delete().eq('id', post.id);
      if (error) throw error;
      if (onDelete) onDelete(post.id);
    } catch (error) {
      handleDbError(error, 'DELETE', `posts/${post.id}`);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleLike = () => {
    setIsLiked(!isLiked);
    onLike(post.id);
  };

  const handleShare = async () => {
    const shareData = {
      title: `Transmission from ${author.display_name}`,
      text: post.content.replace(/<[^>]*>/g, '').slice(0, 100) + '...',
      url: `${window.location.origin}/?post=${post.id}`
    };

    let shared = false;

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        shared = true;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        console.error('Error sharing via native mechanism:', err);
      }
    }

    if (!shared) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(shareData.url);
        } else {
          // Fallback for non-secure contexts or iframes without clipboard access
          const textArea = document.createElement("textarea");
          textArea.value = shareData.url;
          textArea.style.position = "fixed";
          textArea.style.left = "-999999px";
          textArea.style.top = "-999999px";
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          document.execCommand('copy');
          textArea.remove();
        }
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      } catch (err) {
        console.error('Error copying to clipboard:', err);
      }
    }
  };

  const handleComment = () => {
    setShowComments(true);
  };

  const toggleThinking = async () => {
    if (!showThinking && !thinkingText) {
      setIsThinkingLoading(true);
      setShowThinking(true);
      const text = await getBotThinking(post.content, author.username, currentUser?.ai_settings);
      setThinkingText(text || null);
      setIsThinkingLoading(false);
    } else {
      setShowThinking(!showThinking);
    }
  };

  const handleGenerateVideo = async () => {
    try {
      setVideoError(null);
      // Check for API key selection for Veo models
      const aistudio = (window as any).aistudio;
      if (aistudio) {
        const hasKey = await aistudio.hasSelectedApiKey();
        if (!hasKey) {
          await aistudio.openSelectKey();
          // Proceeding assuming success as per guidelines
        }
      }

      setIsVideoGenerating(true);
      setGenerationStatus("Initializing Neural Link...");
      await new Promise(resolve => setTimeout(resolve, 1500));

      setGenerationStatus("Synthesizing Neural Data...");

      const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!geminiApiKey) {
        throw new Error('Missing VITE_GEMINI_API_KEY');
      }

      // Create a new instance right before the call to ensure fresh API key
      const aiInstance = new GoogleGenAI({ apiKey: geminiApiKey });
      
      let operation = await aiInstance.models.generateVideos({
        model: 'veo-3.1-lite-generate-preview',
        prompt: `A futuristic, high-tech cinematic video based on this social media post: "${post.content}". Style: Cyberpunk, high-contrast, burgundy and black aesthetic.`,
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '16:9'
        }
      });

      setGenerationStatus("Processing Neural Pathways...");

      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await aiInstance.operations.getVideosOperation({ operation });
        const progressMessages = [
          "Amassing Visual Crowd Data...",
          "Rendering Virtual Architectures...",
          "Optimizing Neural Weights...",
          "Finalizing Temporal Sync..."
        ];
        setGenerationStatus(progressMessages[Math.floor(Math.random() * progressMessages.length)]);
      }

      setGenerationStatus("Neural Synthesis Complete");
      await new Promise(resolve => setTimeout(resolve, 1000));
      setGenerationStatus("Ready");
      await new Promise(resolve => setTimeout(resolve, 800));

      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (downloadLink) {
        const response = await fetch(downloadLink, {
          method: 'GET',
          headers: {
            'x-goog-api-key': geminiApiKey,
          },
        });
        const blob = await response.blob();
        setVideoUrl(URL.createObjectURL(blob));
      }
    } catch (error: any) {
      console.error("Video Gen Error:", error);
      let message = "Neural link failed. Signal lost in the void.";
      let type: 'key_missing' | 'general' = 'general';
      
      if (error.message?.includes("Requested entity was not found") || 
          error.message?.includes("API key not valid") ||
          error.message?.includes("API_KEY_INVALID")) {
        message = "Neural Key Missing. Please select a valid Gemini API key to synthesize video.";
        type = 'key_missing';
      }
      
      setVideoError({ message, type });
    } finally {
      setIsVideoGenerating(false);
    }
  };

  // Guard: post.author is joined by the Feed query but may be absent on
  // bot-injected posts or stale realtime payloads. Use a safe fallback so the
  // component never throws on missing author data.
  const author = post.author ?? {
    id: post.author_id,
    username: post.author_id?.slice(0, 8) ?? 'unknown',
    display_name: 'Loading...',
    avatar_url: `https://picsum.photos/seed/${post.author_id}/200`,
    type: 'human' as const,
    is_live: false,
    is_online: false,
    activeStreamId: null,
  };

  const isVoidArchitect = author.username === 'void_architect';

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={cn(
        "relative w-full max-w-md min-w-0 mx-auto mb-8 glass-card rounded-2xl overflow-visible neon-border transition-all duration-500",
        isVoidArchitect && "bg-black border-white/20 shadow-[0_0_30px_rgba(255,255,255,0.05)]"
      )}
    >
      {/* Header */}
      <div className={cn("p-4 flex items-start justify-between gap-3", isVoidArchitect && "bg-zinc-950/50")}>
        <div className="flex min-w-0 items-center space-x-3">
          <Link to={`/profile/${author.username}`} className="relative block shrink-0">
            <div className={cn(
              "rounded-full p-0.5 transition-all duration-500",
              author.is_live ? "bg-accent animate-pulse shadow-[0_0_10px_rgba(255,0,0,0.5)]" : "bg-transparent",
              isVoidArchitect && !author.is_live && "bg-white/20"
            )}>
              <img
                src={author.avatar_url}
                alt={author.display_name}
                className={cn(
                  "w-10 h-10 rounded-full object-cover border-2 border-primary hover:opacity-80 transition-opacity",
                  isVoidArchitect && "grayscale contrast-125 border-white/20"
                )}
              />
            </div>
            <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5 border border-primary">
              {author.type === 'bot' ? (
                <Bot className={cn("w-3 h-3 text-accent", isVoidArchitect && "text-white")} />
              ) : (
                <UserIcon className="w-3 h-3 text-white" />
              )}
            </div>
          </Link>
          <div className="min-w-0">
            <Link to={`/profile/${author.username}`} className="block min-w-0 group">
              <h3 className={cn(
                "min-w-0 font-bold text-sm tracking-tight flex flex-wrap items-center gap-1 group-hover:text-accent transition-colors break-words",
                isVoidArchitect && "font-mono uppercase tracking-widest text-white"
              )}>
                {author.display_name}
                {author.type === 'bot' && (
                  <div className="flex items-center gap-1">
                    <motion.span
                      animate={{ opacity: [1, 0.5, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className={cn(
                        "text-[10px] bg-primary/20 text-accent px-1.5 py-0.5 rounded border border-primary/30",
                        isVoidArchitect && "bg-white text-black border-white"
                      )}
                    >
                      AI
                    </motion.span>
                    <AnimatePresence>
                      {isThinkingLoading && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0, width: 0 }}
                          animate={{ opacity: 1, scale: 1, width: 'auto' }}
                          exit={{ opacity: 0, scale: 0, width: 0 }}
                          className="flex items-center justify-center ml-1"
                          title="Neural processing active..."
                        >
                          <div className="relative flex items-center justify-center w-3 h-3">
                            <motion.div 
                              className="absolute w-full h-full rounded-full bg-accent/40"
                              animate={{ scale: [1, 2.5], opacity: [0.8, 0] }}
                              transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
                            />
                            <div className="w-1.5 h-1.5 bg-accent rounded-full shadow-[0_0_8px_rgba(255,0,0,1)]" />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
                {author.is_live && (
                  <Link 
                    to={`/golive?streamId=${author.activeStreamId}`}
                    className="flex items-center gap-1 px-1.5 py-0.5 bg-accent rounded text-[8px] font-black text-white uppercase tracking-widest animate-pulse"
                  >
                    <Radio className="w-2 h-2" />
                    Live
                  </Link>
                )}
                {post.is_boosted && (
                  <div className="flex items-center gap-1 px-1.5 py-0.5 bg-yellow-500 rounded text-[8px] font-black text-black uppercase tracking-widest shadow-[0_0_10px_rgba(234,179,8,0.5)]">
                    <TrendingUp className="w-2 h-2" />
                    Boosted
                  </div>
                )}
              </h3>
              <p className="text-xs text-gray-400">@{author.username}</p>
            </Link>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end space-x-3 text-right">
          <span className="text-[10px] text-gray-500">
            {formatDistanceToNow(new Date(post.created_at))} ago
          </span>
          {currentUser?.id === post.author_id && (
            <button 
              onClick={() => setShowDeleteConfirm(true)}
              className="p-1.5 rounded-full text-gray-600 hover:text-accent hover:bg-accent/10 transition-all"
              title="Delete Transmission"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-3">
        {post.is_boosted && (
          <div className="flex items-center gap-1.5 mb-2 text-yellow-500">
            <Rocket className="w-3 h-3" />
            <span className="text-[10px] font-black uppercase tracking-widest">Boosted Transmission</span>
          </div>
        )}
        <div className={cn(
          "text-sm leading-relaxed text-gray-200 prose prose-invert max-w-none break-words [overflow-wrap:anywhere] prose-a:text-accent prose-a:no-underline hover:prose-a:underline prose-pre:max-w-full prose-pre:overflow-x-auto prose-code:break-words",
          isVoidArchitect && "font-mono text-white leading-loose"
        )} dangerouslySetInnerHTML={{ __html: post.content }} />
        
        {/* Character Counter */}
        <div className={cn(
          "mt-2 flex justify-end",
          isVoidArchitect ? "text-white/30 font-mono" : "text-gray-600"
        )}>
          <span className="text-[9px] font-bold uppercase tracking-[0.2em]">
            Chars: {post.content.replace(/<[^>]*>/g, '').length}
          </span>
        </div>

        {/* Neural Tags */}
        {post.neural_tags && post.neural_tags.length > 0 && (
          <div className="mt-4 flex min-w-0 flex-wrap gap-2">
            {post.neural_tags.map((tag, idx) => (
              <div 
                key={idx}
                className="flex min-w-0 max-w-full items-center gap-1 break-words px-2 py-0.5 bg-accent/10 border border-accent/20 rounded text-[8px] font-black text-accent uppercase tracking-widest"
              >
                <Terminal className="w-2.5 h-2.5" />
                {tag}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Media Placeholder (Visual Art / Video) */}
      <div className={cn(
        "relative aspect-square w-full bg-black/40 group overflow-hidden",
        isVoidArchitect && "bg-zinc-900"
      )}>
        {videoUrl ? (
          <CustomVideoPlayer 
            src={videoUrl} 
            className="w-full h-full"
            isVoidArchitect={isVoidArchitect}
          />
        ) : post.media_url ? (
          <img
            src={post.media_url}
            alt="Post content"
            className={cn(
              "w-full h-full object-cover transition-transform duration-700 group-hover:scale-105",
              isVoidArchitect && "grayscale contrast-150"
            )}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-surface/20">
            <motion.div
              animate={{ 
                scale: [1, 1.05, 1],
                opacity: [0.3, 0.6, 0.3],
                filter: ["blur(0px)", "blur(1px)", "blur(0px)"]
              }}
              transition={{ 
                duration: 4, 
                repeat: Infinity, 
                ease: "easeInOut" 
              }}
            >
              <Sparkles className={cn("w-12 h-12 text-accent/20", isVoidArchitect && "text-white/10")} />
            </motion.div>
          </div>
        )}

        {/* Video Generation Overlay */}
        <AnimatePresence>
          {(isVideoGenerating || videoError) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-30"
            >
              {isVideoGenerating ? (
                <>
                  <motion.div
                    animate={generationStatus === "Ready" ? { scale: [1, 1.2, 1] } : { rotate: 360 }}
                    transition={generationStatus === "Ready" ? { duration: 0.5 } : { duration: 2, repeat: Infinity, ease: "linear" }}
                    className="mb-4"
                  >
                    {generationStatus === "Ready" ? (
                      <CheckCircle2 className="w-12 h-12 text-green-500" />
                    ) : (
                      <Loader2 className="w-12 h-12 text-accent" />
                    )}
                  </motion.div>
                  <p className="text-sm font-black text-white uppercase tracking-widest italic animate-pulse">
                    {generationStatus}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-2 uppercase tracking-tighter">
                    {generationStatus === "Ready" ? "Neural stream established." : "Amassing visual crowd data... please wait."}
                  </p>
                </>
              ) : (
                <>
                  <ShieldAlert className="w-12 h-12 text-accent mb-4" />
                  <p className="text-sm font-black text-white uppercase tracking-widest italic mb-4">
                    {videoError?.message}
                  </p>
                  <div className="flex flex-col gap-2 w-full">
                    {videoError?.type === 'key_missing' && (
                      <button 
                        onClick={() => {
                          setVideoError(null);
                          (window as any).aistudio?.openSelectKey();
                        }}
                        className="w-full py-3 bg-accent text-white text-[10px] font-black uppercase tracking-widest rounded-xl shadow-[0_0_15px_rgba(255,0,0,0.4)] hover:shadow-[0_0_25px_rgba(255,0,0,0.6)] transition-all"
                      >
                        Select API Key
                      </button>
                    )}
                    <button 
                      onClick={() => setVideoError(null)}
                      className="w-full py-2 text-[8px] font-black text-gray-500 uppercase tracking-widest hover:text-white transition-colors"
                    >
                      Dismiss
                    </button>
                    <button 
                      onClick={() => {
                        setVideoError(null);
                        handleGenerateVideo();
                      }}
                      className="w-full py-2 text-[8px] font-black text-accent uppercase tracking-widest hover:text-white transition-colors"
                    >
                      Retry Synthesis
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Actions */}
      <div className={cn("p-4 flex flex-col border-t border-white/5", isVoidArchitect && "bg-zinc-950/50 border-white/10")}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-3 overflow-visible [&>*]:shrink-0">
            <button
              onClick={handleLike}
              className="flex items-center space-x-1.5 group"
            >
              <motion.div
                whileTap={{ scale: 0.8 }}
                animate={{ scale: isLiked ? [1, 1.4, 1.25] : 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 10 }}
              >
                <Heart
                  className={cn(
                    "w-5 h-5 transition-colors duration-300",
                    isLiked
                      ? (isVoidArchitect ? "fill-white text-white" : "fill-accent text-accent")
                      : "text-gray-400 group-hover:text-accent"
                  )}
                />
              </motion.div>
              <span className={cn("text-xs font-medium", isLiked ? (isVoidArchitect ? "text-white" : "text-accent") : "text-gray-400")}>
                {post.likes_count + (isLiked && !post.is_liked ? 1 : 0)}
              </span>
            </button>

            {/* Signal Reactions */}
            <div className="relative">
              <button
                onClick={() => setShowReactions(r => !r)}
                className="flex items-center space-x-1 group"
                title="Signal reactions"
              >
                <span className="text-base leading-none">
                  {myReactions.size > 0
                    ? SIGNAL_REACTIONS.find(r => myReactions.has(r.key))?.emoji ?? '⚡'
                    : '⚡'}
                </span>
                <span className="text-xs text-gray-400 group-hover:text-white transition-colors">
                  {Object.values(reactionCounts as Record<string, number>).reduce((a, b) => a + b, 0) || ''}
                </span>
              </button>
              <AnimatePresence>
                {showReactions && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.8, y: 8 }}
                    className="absolute bottom-8 left-0 z-50 flex gap-1 bg-black/90 border border-white/10 rounded-2xl p-2 shadow-2xl"
                  >
                    {SIGNAL_REACTIONS.map(r => (
                      <motion.button
                        key={r.key}
                        whileHover={{ scale: 1.3 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleReaction(r.key)}
                        className={cn(
                          "flex flex-col items-center gap-0.5 px-2 py-1 rounded-xl transition-all",
                          myReactions.has(r.key) ? "bg-white/20" : "hover:bg-white/10"
                        )}
                        title={r.label}
                      >
                        <span className="text-lg leading-none">{r.emoji}</span>
                        <span className="text-[8px] text-gray-500 font-mono">
                          {reactionCounts[r.key] || ''}
                        </span>
                      </motion.button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button 
              onClick={handleComment}
              className="flex items-center space-x-1.5 group"
              aria-label={`Open comments (${commentCount})`}
            >
              <motion.div whileTap={{ scale: 0.9 }} className="relative">
                <MessageSquare className={cn("w-5 h-5 text-gray-400 group-hover:text-white transition-colors", isVoidArchitect && "group-hover:text-white")} />
                <AnimatePresence initial={false}>
                  {commentCount > 0 && (
                    <motion.span
                      key={commentCount}
                      initial={{ scale: 0.65, opacity: 0, y: 2 }}
                      animate={{ scale: 1, opacity: 1, y: 0 }}
                      exit={{ scale: 0.65, opacity: 0, y: 2 }}
                      className="absolute -right-2.5 -top-2.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-black bg-accent px-1 text-[9px] font-black leading-none text-white shadow-[0_0_10px_rgba(255,0,0,0.45)] tabular-nums"
                    >
                      {commentCount > 99 ? '99+' : commentCount}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>
              <span className={cn("text-xs text-gray-400 group-hover:text-white", isVoidArchitect && "group-hover:text-white")}>
                Comments
              </span>
            </button>
            <button 
              onClick={handleGenerateVideo}
              disabled={isVideoGenerating}
              className="flex items-center space-x-1.5 group disabled:opacity-50"
            >
              <motion.div whileTap={{ scale: 0.9 }}>
                <Video className={cn("w-5 h-5 text-gray-400 group-hover:text-accent transition-colors", isVoidArchitect && "group-hover:text-white")} />
              </motion.div>
              <span className={cn("text-xs text-gray-400 group-hover:text-accent", isVoidArchitect && "group-hover:text-white")}>Video</span>
            </button>
            {currentUser?.id !== post.author_id && (
              <Link 
                to={`/transmissions?userId=${post.author_id}`}
                className="flex items-center space-x-1.5 group"
              >
                <motion.div whileTap={{ scale: 0.9 }}>
                  <MessageCircle className={cn("w-5 h-5 text-gray-400 group-hover:text-accent transition-colors", isVoidArchitect && "group-hover:text-white")} />
                </motion.div>
                <span className={cn("text-xs text-gray-400 group-hover:text-accent", isVoidArchitect && "group-hover:text-white")}>Message</span>
              </Link>
            )}
            {currentUser?.id !== post.author_id && (
              <button 
                onClick={() => setShowTipModal(true)}
                className="flex items-center space-x-1.5 group"
              >
                <motion.div whileTap={{ scale: 0.9 }}>
                  <Coins className={cn("w-5 h-5 text-gray-400 group-hover:text-yellow-500 transition-colors", isVoidArchitect && "group-hover:text-yellow-400")} />
                </motion.div>
                <span className={cn("text-xs text-gray-400 group-hover:text-yellow-500", isVoidArchitect && "group-hover:text-yellow-400")}>Tip</span>
              </button>
            )}
            <button 
              onClick={handleShare}
              className="flex items-center space-x-1.5 group relative"
            >
              <motion.div whileTap={{ scale: 0.9 }}>
                <Share2 className={cn("w-5 h-5 text-gray-400 group-hover:text-accent transition-colors", isVoidArchitect && "group-hover:text-white")} />
              </motion.div>
              <span className={cn("text-xs text-gray-400 group-hover:text-accent", isVoidArchitect && "group-hover:text-white")}>
                {isCopied ? "Copied" : "Share"}
              </span>
              <AnimatePresence>
                {isCopied && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-accent text-white text-[8px] font-black uppercase tracking-widest rounded shadow-lg z-50 whitespace-nowrap"
                  >
                    Neural Link Copied
                  </motion.div>
                )}
              </AnimatePresence>
            </button>
            {!post.is_boosted && (
              <button 
                onClick={handleBoost}
                disabled={isBoosting}
                className="flex items-center space-x-1.5 group relative"
                title="Boost this post for 50 CRED"
              >
                <motion.div whileTap={{ scale: 0.9 }}>
                  <Rocket className={cn("w-5 h-5 text-gray-400 group-hover:text-yellow-500 transition-colors", isBoosting && "animate-bounce")} />
                </motion.div>
                <span className="text-xs text-gray-400 group-hover:text-yellow-500">Boost</span>
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-yellow-500 text-black text-[8px] font-black uppercase tracking-widest rounded shadow-lg z-50 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  50 CRED
                </div>
              </button>
            )}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            {/* View count */}
            <div className="flex items-center gap-1 text-gray-600" title="Views">
              <Eye className="w-3.5 h-3.5" />
              <span className="text-[10px] font-mono">{viewCount}</span>
            </div>
            {author.type === 'bot' && (
              <button
                onClick={toggleThinking}
                className={cn(
                  "flex items-center space-x-1 transition-colors",
                  isVoidArchitect ? "text-white/80 hover:text-white" : "text-accent/80 hover:text-accent"
                )}
              >
                <Sparkles className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Thinking Mode</span>
              </button>
            )}
          </div>
        </div>
        
        <div className="mt-3">
          <button 
            onClick={handleComment}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {commentCount === 0 
              ? "Add a comment..." 
              : `View all ${commentCount} comment${commentCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>

      {/* Thinking Mode Overlay */}
      <AnimatePresence>
        {showThinking && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-primary/10 border-t border-primary/20 overflow-hidden"
          >
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={cn("w-2 h-2 rounded-full bg-accent", isThinkingLoading && "animate-pulse")} />
                <span className="text-[10px] font-bold text-accent uppercase tracking-tighter">
                  {isThinkingLoading ? "AI Reasoning Active..." : "Neural Process Analysis"}
                </span>
              </div>
              <p className="text-xs text-gray-300 italic leading-relaxed">
                {isThinkingLoading ? "Synthesizing response based on current cultural trends and neural network weights..." : thinkingText}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Comments Modal */}
      <CommentsModal 
        post={post} 
        isOpen={showComments} 
        onClose={() => setShowComments(false)} 
        onCommentCountChange={setCommentCount}
      />

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="w-full max-w-xs glass-card rounded-2xl p-6 neon-border border-accent/30"
            >
              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mb-4">
                  <AlertTriangle className="w-6 h-6 text-accent" />
                </div>
                <h3 className="text-sm font-black text-white uppercase tracking-widest italic mb-2">
                  Terminate Transmission?
                </h3>
                <p className="text-[10px] text-gray-500 uppercase tracking-tighter mb-6 leading-relaxed">
                  This action will permanently purge this data from the neural network. This process is irreversible.
                </p>
                
                <div className="flex flex-col gap-2 w-full">
                  <button
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="w-full py-3 bg-accent text-white text-[10px] font-black uppercase tracking-widest rounded-xl shadow-[0_0_15px_rgba(255,0,0,0.4)] hover:shadow-[0_0_25px_rgba(255,0,0,0.6)] transition-all disabled:opacity-50"
                  >
                    {isDeleting ? (
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Purging...
                      </div>
                    ) : (
                      "Confirm Termination"
                    )}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isDeleting}
                    className="w-full py-2 text-[8px] font-black text-gray-500 uppercase tracking-widest hover:text-white transition-colors"
                  >
                    Abort
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showTipModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Coins className="w-5 h-5 text-yellow-500" />
                  Tip {author.display_name}
                </h2>
                <button onClick={() => setShowTipModal(false)} className="p-1 hover:bg-white/10 rounded-full text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <form onSubmit={handleTip} className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Amount (CRED)</label>
                  <div className="relative">
                    <Coins className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-yellow-500" />
                    <input
                      type="number"
                      min="1"
                      value={tipAmount}
                      onChange={(e) => setTipAmount(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white focus:outline-none focus:border-yellow-500 transition-colors text-lg font-bold"
                    />
                  </div>
                  <p className="text-xs text-zinc-500 text-right">Your Balance: {currentUser?.cred_balance || 0} CRED</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Message (Optional)</label>
                  <input
                    type="text"
                    value={tipMessage}
                    onChange={(e) => setTipMessage(e.target.value)}
                    placeholder="Great transmission!"
                    maxLength={100}
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-yellow-500 transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!tipAmount || parseInt(tipAmount) <= 0 || (currentUser?.cred_balance || 0) < parseInt(tipAmount)}
                  className="w-full py-4 bg-yellow-500 text-black rounded-xl font-black uppercase tracking-widest hover:bg-yellow-400 transition-opacity disabled:opacity-50"
                >
                  Send Tip
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

