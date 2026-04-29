import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Send, Loader2, Bot } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { formatDistanceToNow } from 'date-fns';
import { Post, User } from '../types';
import { getBotReply } from './Feed';
import { BOT_PERSONAS, getBotByUsername } from '../lib/botPersonas';
import { sendPushEvent } from '../lib/notifications';

interface Comment {
  id: string;
  author_id: string;
  content: string;
  created_at: string;
  author?: User;
}

interface CommentsModalProps {
  post: Post;
  isOpen: boolean;
  onClose: () => void;
}

function extractMentionedUsernames(content: string): string[] {
  const matches = content.matchAll(/@([a-zA-Z0-9_]+)/g);
  return Array.from(new Set(Array.from(matches, match => match[1].toLowerCase())));
}

export const CommentsModal: React.FC<CommentsModalProps> = ({ post, isOpen, onClose }) => {
  const { currentUser } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [thinkingBots, setThinkingBots] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen || !currentUser) return;

    setIsLoading(true);

    const fetchComments = async () => {
      const { data, error } = await supabase
        .from('comments')
        .select('*, author:users(id,display_name,avatar_url,username)')
        .eq('post_id', post.id)
        .order('created_at', { ascending: false });
      if (error) { handleDbError(error, 'LIST', 'comments'); setIsLoading(false); return; }
      setComments((data ?? []) as Comment[]);
      setIsLoading(false);
    };

    fetchComments();

    const channel = supabase
      .channel(`comments-${post.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `post_id=eq.${post.id}` }, () => {
        fetchComments();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isOpen, post.id, currentUser]);

  const handlePostComment = async () => {
    if (!newComment.trim() || !currentUser) return;

    setIsSubmitting(true);
    try {
      const commentContent = newComment.trim();
      const { data: insertedComment, error: commentError } = await supabase.from('comments').insert({
        post_id: post.id,
        author_id: currentUser.id,
        content: commentContent,
        created_at: new Date().toISOString(),
      }).select('id').maybeSingle();

      if (commentError) throw commentError;

      // Increment comment count on the post
      await supabase.rpc('increment_counter', { p_table: 'posts', p_id: post.id, p_field: 'comments_count', p_amount: 1 });

      const senderName = currentUser.display_name || currentUser.username || 'Someone';
      const mentionedUsernames = extractMentionedUsernames(commentContent);
      const mentionedHumanUsers: User[] = [];

      if (mentionedUsernames.length > 0) {
        const { data: mentionedUsers, error: mentionedError } = await supabase
          .from('users')
          .select('id,username,display_name,avatar_url,type')
          .in('username', mentionedUsernames);

        if (mentionedError) {
          console.warn('[Comments] Failed to resolve mentioned users:', mentionedError);
        } else {
          mentionedHumanUsers.push(...((mentionedUsers ?? []) as User[]).filter(user => user.type !== 'bot'));
        }
      }

      const commentUrl = `/profile/${post.author.username}`;
      const notifiedMentionIds = new Set<string>();

      mentionedHumanUsers.forEach(user => {
        if (user.id === currentUser.id) return;
        notifiedMentionIds.add(user.id);
        void sendPushEvent({
          recipientUserId: user.id,
          senderId: currentUser.id,
          senderName,
          senderUsername: currentUser.username,
          senderAvatar: currentUser.avatar_url,
          type: 'mention',
          messagePreview: commentContent,
          url: commentUrl,
          postId: post.id,
          commentId: insertedComment?.id,
        });
      });

      if (post.author.id !== currentUser.id && !notifiedMentionIds.has(post.author.id) && post.author.type !== 'bot') {
        void sendPushEvent({
          recipientUserId: post.author.id,
          senderId: currentUser.id,
          senderName,
          senderUsername: currentUser.username,
          senderAvatar: currentUser.avatar_url,
          type: 'comment',
          messagePreview: commentContent,
          url: commentUrl,
          postId: post.id,
          commentId: insertedComment?.id,
        });
      }

      // Handle Bot Replies
      const mentionedBots = BOT_PERSONAS.filter(p => commentContent.toLowerCase().includes(`@${p.username.toLowerCase()}`));
      const isPostAuthorBot = post.author.type === 'bot';
      const botsToReply: User[] = [];
      if (isPostAuthorBot && !mentionedBots.some(p => p.username === post.author.username)) {
        botsToReply.push(post.author);
      }
      mentionedBots.forEach(p => {
        const botUser = getBotByUsername(p.username);
        if (botUser) botsToReply.push(botUser);
      });

      if (botsToReply.length > 0) {
        const history = comments.slice(0, 5).map(c => ({
          author: (c as any).author?.display_name || 'Unknown',
          content: c.content
        })).reverse();
        const userContext = { username: currentUser.username, bio: currentUser.bio, reputation: currentUser.reputation_score };

        botsToReply.forEach((bot, index) => {
          setThinkingBots(prev => [...prev, bot.display_name]);
          setTimeout(async () => {
            try {
              const reply = await getBotReply(
                post.content, commentContent, bot.username, currentUser.ai_settings,
                history, userContext, post.author.display_name
              );
              if (reply) {
                await supabase.from('comments').insert({
                  post_id: post.id,
                  author_id: bot.id,
                  content: reply,
                  created_at: new Date().toISOString(),
                });
                await supabase.rpc('increment_counter', { p_table: 'posts', p_id: post.id, p_field: 'comments_count', p_amount: 1 });
              }
            } catch (err) {
              console.error(`Bot Reply Error (${bot.username}):`, err);
            } finally {
              setThinkingBots(prev => prev.filter(name => name !== bot.display_name));
            }
          }, 2000 + (index * 1500) + Math.random() * 1000);
        });
      }

      setNewComment('');
    } catch (error) {
      handleDbError(error, 'WRITE', `posts/${post.id}/comments`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="w-full sm:max-w-lg bg-surface border border-white/10 sm:rounded-2xl rounded-t-2xl overflow-hidden shadow-2xl flex flex-col max-h-[80vh]"
          >
            <div className="flex items-center justify-between p-4 border-b border-white/10 bg-surface/80 backdrop-blur-md sticky top-0 z-10">
              <h2 className="text-lg font-bold text-white">Comments</h2>
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="w-8 h-8 text-accent animate-spin" />
                  <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Accessing Neural Thread...</p>
                </div>
              ) : comments.length === 0 ? (
                <div className="text-center py-8 text-gray-500 italic">
                  No comments yet. Be the first to initiate a neural link.
                </div>
              ) : (
                comments.map(comment => (
                  <div key={comment.id} className="flex gap-3">
                    <img src={comment.author?.avatar_url || 'https://picsum.photos/seed/default/200'} alt="" className="w-8 h-8 rounded-full border border-white/10" />
                    <div className="flex-1">
                      <div className="bg-black/40 border border-white/5 rounded-2xl rounded-tl-none p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-white text-sm">{comment.author?.display_name || 'Unknown'}</span>
                          <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                            {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-sm text-gray-300">{comment.content}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}

              {thinkingBots.map((name, idx) => (
                <motion.div 
                  key={idx}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex gap-3 items-center"
                >
                  <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center border border-accent/20">
                    <Bot className="w-4 h-4 text-accent animate-pulse" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-accent uppercase tracking-widest animate-pulse">
                      {name} IS PROCESSING...
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="p-4 border-t border-white/10 bg-surface/80 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <img src={currentUser?.avatar_url} alt="" className="w-8 h-8 rounded-full border border-white/10 hidden sm:block" />
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handlePostComment()}
                    placeholder="Transmit your thoughts..."
                    className="w-full bg-black/40 border border-white/10 rounded-full py-3 pl-4 pr-12 text-sm text-white placeholder:text-gray-600 focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
                  />
                  <button
                    onClick={handlePostComment}
                    disabled={isSubmitting || !newComment.trim()}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 bg-accent rounded-full text-white shadow-[0_0_10px_rgba(255,0,0,0.3)] hover:shadow-[0_0_15px_rgba(255,0,0,0.5)] transition-all disabled:opacity-50 disabled:grayscale"
                  >
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
