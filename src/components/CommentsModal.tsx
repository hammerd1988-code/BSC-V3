import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Send, Loader2, Bot, MessageSquare, ShieldAlert } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { formatDistanceToNow } from 'date-fns';
import { Post, User } from '../types';
import { getBotReply } from './Feed';
import { BOT_PERSONAS, getBotByUsername } from '../lib/botPersonas';
import { sendPushEvent } from '../lib/notifications';
import { ReportModal } from './ReportModal';

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
  onCommentCountChange?: React.Dispatch<React.SetStateAction<number>>;
}

function extractMentionedUsernames(content: string): string[] {
  const matches = content.matchAll(/@([a-zA-Z0-9_]+)/g);
  return Array.from(new Set(Array.from(matches, match => match[1].toLowerCase())));
}

export const CommentsModal: React.FC<CommentsModalProps> = ({ post, isOpen, onClose, onCommentCountChange }) => {
  const { currentUser } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [thinkingBots, setThinkingBots] = useState<string[]>([]);
  const [reportTarget, setReportTarget] = useState<Comment | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const postAuthor = post.author ?? {
    id: post.author_id,
    username: post.author_id?.slice(0, 8) ?? 'unknown',
    display_name: 'Unknown Author',
    avatar_url: `https://picsum.photos/seed/${post.author_id}/200`,
    type: 'human' as const,
    is_live: false,
    is_online: false,
    activeStreamId: null,
  };

  const scrollToLatestComment = (behavior: ScrollBehavior = 'smooth') => {
    requestAnimationFrame(() => {
      threadEndRef.current?.scrollIntoView({ behavior, block: 'end' });
    });
  };

  useEffect(() => {
    if (!isOpen) return;

    setIsLoading(true);

    const fetchComments = async () => {
      const { data, error } = await supabase
        .from('comments')
        .select('*, author:users(id,display_name,avatar_url,username,type)')
        .eq('post_id', post.id)
        .order('created_at', { ascending: true });

      if (error) {
        handleDbError(error, 'LIST', 'comments');
        setIsLoading(false);
        return;
      }

      const fetchedComments = (data ?? []) as Comment[];
      setComments(fetchedComments);
      onCommentCountChange?.(fetchedComments.length);
      setIsLoading(false);
      scrollToLatestComment('auto');
    };

    fetchComments();

    const channel = supabase
      .channel(`comments-${post.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `post_id=eq.${post.id}` }, () => {
        fetchComments();
      })
      .subscribe();

    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 250);

    return () => {
      window.clearTimeout(focusTimer);
      supabase.removeChannel(channel);
    };
  }, [isOpen, post.id, onCommentCountChange]);

  useEffect(() => {
    if (isOpen && !isLoading) scrollToLatestComment();
  }, [comments.length, thinkingBots.length, isOpen, isLoading]);

  const handlePostComment = async () => {
    if (!newComment.trim() || !currentUser) return;

    setIsSubmitting(true);
    try {
      const commentContent = newComment.trim();
      const createdAt = new Date().toISOString();
      const { data: insertedComment, error: commentError } = await supabase.from('comments').insert({
        post_id: post.id,
        author_id: currentUser.id,
        content: commentContent,
        created_at: createdAt,
      }).select('id').maybeSingle();

      if (commentError) throw commentError;

      const optimisticComment: Comment = {
        id: insertedComment?.id ?? `optimistic-${createdAt}`,
        author_id: currentUser.id,
        content: commentContent,
        created_at: createdAt,
        author: currentUser,
      };

      setComments(prev => {
        if (insertedComment?.id && prev.some(comment => comment.id === insertedComment.id)) return prev;
        return [...prev, optimisticComment];
      });
      onCommentCountChange?.(prev => prev + 1);

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

      const commentUrl = `/profile/${postAuthor.username}`;
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

      if (postAuthor.id !== currentUser.id && !notifiedMentionIds.has(postAuthor.id) && postAuthor.type !== 'bot') {
        void sendPushEvent({
          recipientUserId: postAuthor.id,
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
      const isPostAuthorBot = postAuthor.type === 'bot';
      const botsToReply: User[] = [];
      if (isPostAuthorBot && !mentionedBots.some(p => p.username === postAuthor.username)) {
        botsToReply.push(postAuthor);
      }
      mentionedBots.forEach(p => {
        const botUser = getBotByUsername(p.username);
        if (botUser) botsToReply.push(botUser);
      });

      if (botsToReply.length > 0) {
        const history = comments.slice(-5).map(c => ({
          author: c.author?.display_name || 'Unknown',
          content: c.content
        }));
        const userContext = { username: currentUser.username, bio: currentUser.bio, reputation: currentUser.reputation_score };

        botsToReply.forEach((bot, index) => {
          setThinkingBots(prev => [...prev, bot.display_name]);
          setTimeout(async () => {
            try {
              const reply = await getBotReply(
                post.content, commentContent, bot.username, currentUser.ai_settings,
                history, userContext, postAuthor.display_name
              );
              if (reply) {
                await supabase.from('comments').insert({
                  post_id: post.id,
                  author_id: bot.id,
                  content: reply,
                  created_at: new Date().toISOString(),
                });
                await supabase.rpc('increment_counter', { p_table: 'posts', p_id: post.id, p_field: 'comments_count', p_amount: 1 });
                onCommentCountChange?.(prev => prev + 1);
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

  const handleComposerSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handlePostComment();
  };

  const visibleCommentCount = isLoading ? (post.comments_count ?? 0) : comments.length;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`comments-title-${post.id}`}
        >
          <motion.div
            initial={{ y: 32, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 32, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            onClick={(event) => event.stopPropagation()}
            className="w-full sm:max-w-xl bg-surface border border-white/10 sm:rounded-2xl rounded-t-2xl overflow-hidden shadow-2xl flex flex-col h-[86vh] max-h-[86vh] sm:h-[min(760px,82vh)] sm:max-h-[82vh]"
          >
            <div className="flex items-center justify-between gap-4 p-4 border-b border-white/10 bg-surface/90 backdrop-blur-md shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-accent" />
                  <h2 id={`comments-title-${post.id}`} className="text-lg font-bold text-white">Comments</h2>
                  <span className="rounded-full border border-accent/30 bg-accent/15 px-2 py-0.5 text-[10px] font-black text-accent tabular-nums">
                    {visibleCommentCount}
                  </span>
                </div>
                <p className="mt-1 truncate text-[11px] text-gray-500">
                  Thread for {postAuthor.display_name || postAuthor.username}
                </p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors" aria-label="Close comments">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-4 scroll-smooth">
              {isLoading ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center gap-3">
                  <Loader2 className="w-8 h-8 text-accent animate-spin" />
                  <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Accessing Neural Thread...</p>
                </div>
              ) : comments.length === 0 ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 p-8 text-center">
                  <MessageSquare className="mb-3 h-8 w-8 text-gray-600" />
                  <p className="text-sm font-semibold text-gray-400">No comments yet.</p>
                  <p className="mt-1 text-xs text-gray-600">Be the first to initiate a neural link.</p>
                </div>
              ) : (
                comments.map(comment => {
                  const commentAuthor = comment.author;
                  return (
                    <motion.div
                      key={comment.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex gap-3"
                    >
                      <img src={commentAuthor?.avatar_url || 'https://picsum.photos/seed/default/200'} alt="" className="w-8 h-8 shrink-0 rounded-full border border-white/10 object-cover" />
                      <div className="min-w-0 flex-1">
                        <div className="bg-black/40 border border-white/5 rounded-2xl rounded-tl-none p-3">
                          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-bold text-white text-sm">{commentAuthor?.display_name || 'Unknown'}</span>
                            <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                              {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                            </span>
                            {currentUser?.id !== comment.author_id && (
                              <button
                                type="button"
                                onClick={() => setReportTarget(comment)}
                                className="ml-auto inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-gray-500 transition hover:border-red-300/30 hover:text-red-200"
                                aria-label={`Report comment by ${commentAuthor?.display_name || 'unknown user'}`}
                              >
                                <ShieldAlert className="h-3 w-3" />
                                Report
                              </button>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-300">{comment.content}</p>
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}

              {thinkingBots.map((name, idx) => (
                <motion.div
                  key={`${name}-${idx}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex gap-3 items-center"
                >
                  <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center border border-accent/20">
                    <Bot className="w-4 h-4 text-accent animate-pulse" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-accent uppercase tracking-widest animate-pulse">
                      {name} is processing...
                    </span>
                  </div>
                </motion.div>
              ))}
              <div ref={threadEndRef} />
            </div>

            <form onSubmit={handleComposerSubmit} className="border-t border-white/10 bg-surface/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md shrink-0 sm:p-4">
              <div className="flex items-center gap-2">
                <img src={currentUser?.avatar_url || 'https://picsum.photos/seed/default-user/200'} alt="" className="w-8 h-8 rounded-full border border-white/10 object-cover hidden sm:block" />
                <div className="flex-1 relative">
                  <input
                    ref={inputRef}
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder={currentUser ? 'Transmit your thoughts...' : 'Sign in to comment'}
                    disabled={!currentUser || isSubmitting}
                    className="w-full bg-black/40 border border-white/10 rounded-full py-3 pl-4 pr-12 text-sm text-white placeholder:text-gray-600 focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting || !newComment.trim() || !currentUser}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 bg-accent rounded-full text-white shadow-[0_0_10px_rgba(255,0,0,0.3)] hover:shadow-[0_0_15px_rgba(255,0,0,0.5)] transition-all disabled:opacity-50 disabled:grayscale"
                    aria-label="Submit comment"
                  >
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </form>

            {reportTarget && (
              <ReportModal
                isOpen={Boolean(reportTarget)}
                onClose={() => setReportTarget(null)}
                targetType="comment"
                targetId={reportTarget.id}
                targetOwnerId={reportTarget.author_id}
                targetLabel={`Comment by @${reportTarget.author?.username || 'unknown'} on ${postAuthor.display_name}'s post: ${reportTarget.content.slice(0, 160)}`}
                targetPath={`/post/${post.id}`}
              />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
