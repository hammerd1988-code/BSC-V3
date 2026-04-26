import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Send, Loader2, Image as ImageIcon, CheckCircle, AlertCircle, Bold, Italic, Link as LinkIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { socket } from '../lib/socket';
import { v4 as uuidv4 } from 'uuid';

// Lazy-load TipTap to avoid SSR/init issues
let useEditor: any = null;
let EditorContent: any = null;
let StarterKit: any = null;
let LinkExt: any = null;
let ImageExt: any = null;
let Placeholder: any = null;

try {
  const tiptapReact = require('@tiptap/react');
  const tiptapStarterKit = require('@tiptap/starter-kit');
  const tiptapLink = require('@tiptap/extension-link');
  const tiptapImage = require('@tiptap/extension-image');
  const tiptapPlaceholder = require('@tiptap/extension-placeholder');
  useEditor = tiptapReact.useEditor;
  EditorContent = tiptapReact.EditorContent;
  StarterKit = tiptapStarterKit.default;
  LinkExt = tiptapLink.default;
  ImageExt = tiptapImage.default;
  Placeholder = tiptapPlaceholder.default;
} catch (e) {
  console.warn('[CreatePostModal] TipTap not available, using fallback textarea');
}

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPostCreated: (post: any) => void;
}

export const CreatePostModal: React.FC<CreatePostModalProps> = ({ isOpen, onClose, onPostCreated }) => {
  const { currentUser } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Fallback plain text content (used when TipTap isn't ready or fails)
  const [fallbackContent, setFallbackContent] = useState('');
  const [useFallback, setUseFallback] = useState(false);

  // TipTap editor — only used when TipTap is available
  const editor = useEditor && !useFallback ? useEditor({
    extensions: [
      StarterKit,
      Placeholder?.configure({
        placeholder: 'Broadcast your signal to the network...',
        emptyEditorClass: 'is-editor-empty',
      }),
      ImageExt?.configure({
        HTMLAttributes: { class: 'rounded-xl max-h-96 object-cover my-4 w-full' },
      }),
      LinkExt?.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-accent underline' },
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-[150px] text-white',
      },
    },
  }) : null;

  // Fall back to plain textarea if TipTap editor fails to init after 500ms
  useEffect(() => {
    if (!useEditor) {
      setUseFallback(true);
      return;
    }
    const timer = setTimeout(() => {
      if (!editor) setUseFallback(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [editor]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setError(null);
      setSuccess(false);
      setFallbackContent('');
      if (editor) editor.commands.setContent('');
    }
  }, [isOpen]);

  const getContent = (): { html: string; text: string } => {
    if (useFallback || !editor) {
      const text = fallbackContent.trim();
      // Convert plain text to simple HTML paragraphs
      const html = text.split('\n').filter(Boolean).map(line => `<p>${line}</p>`).join('') || `<p>${text}</p>`;
      return { html, text };
    }
    return {
      html: editor.getHTML(),
      text: editor.getText().trim(),
    };
  };

  const isEmpty = (): boolean => {
    if (useFallback || !editor) return !fallbackContent.trim();
    const text = editor.getText().trim();
    const html = editor.getHTML();
    return !text && !html.includes('<img');
  };

  const setLink = () => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `post_images/${currentUser.id}/${uuidv4()}.${fileExt}`;
      const { error: upErr } = await supabase.storage.from('media').upload(filePath, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(filePath);
      if (editor) {
        editor.chain().focus().setImage({ src: publicUrl }).run();
      } else {
        // Append image URL to fallback content
        setFallbackContent(prev => prev + `\n[Image: ${publicUrl}]`);
      }
    } catch (err: any) {
      setError(`Image upload failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSubmitting(false);
      if (e.target) e.target.value = '';
    }
  };

  const handlePost = async () => {
    console.log('[CreatePost] handlePost called', { currentUser: !!currentUser, editor: !!editor, useFallback });

    if (!currentUser) {
      setError('No active session. Please sign in again.');
      return;
    }

    const { html: htmlContent, text: textContent } = getContent();

    if (!textContent && !htmlContent.includes('<img')) {
      setError('Write something before posting.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Only include columns that exist in the posts table:
      // id (auto), author_id, content, media_url, media_type, type, likes, boosts,
      // comments_count, is_boosted, last_comment_at, expires_at, is_echo, feed_type,
      // created_at, updated_at, view_count, poll_data
      const newPost = {
        author_id: currentUser.id,
        content: htmlContent,
        likes: 0,
        boosts: 0,
        comments_count: 0,
        is_boosted: false,
        type: 'text' as const,
        view_count: 0,
      };

      console.log('[CreatePost] Inserting post with author_id:', currentUser.id);

      const { data: inserted, error: insertErr } = await supabase
        .from('posts')
        .insert(newPost)
        .select()
        .maybeSingle();

      if (insertErr) {
        console.error('[CreatePost] Insert error:', insertErr);
        throw insertErr;
      }

      console.log('[CreatePost] Insert result:', inserted);

      // inserted may be null if RLS blocks the SELECT after insert (insert still succeeded)
      const postResult = inserted ?? {
        ...newPost,
        id: uuidv4(),
        created_at: new Date().toISOString(),
      };

      onPostCreated(postResult);
      socket.emit('post:create', postResult);

      setSuccess(true);
      setFallbackContent('');
      if (editor) editor.commands.setContent('');

      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 800);

    } catch (err: any) {
      console.error('[CreatePost] Submission error:', err);
      const msg = err?.message || String(err);
      if (msg.includes('row-level security') || msg.includes('permission') || msg.includes('violates')) {
        setError('Permission denied. Your session may have expired — try signing out and back in.');
      } else if (msg.includes('foreign key') || msg.includes('author_id')) {
        setError('Account setup incomplete. Please sign out and sign in again.');
      } else if (msg.includes('network') || msg.includes('fetch')) {
        setError('Network error. Check your connection and try again.');
      } else if (msg.includes('invalid input value for enum')) {
        setError('Post type error. Please try again.');
      } else {
        setError(`Failed to post: ${msg}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setError(null);
      setSuccess(false);
      setFallbackContent('');
      if (editor) editor.commands.setContent('');
      onClose();
    }
  };

  if (!isOpen) return null;

  const canSubmit = !isSubmitting && !isEmpty() && !success;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
        onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 40 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 40 }}
          className="w-full sm:max-w-lg bg-zinc-950 border border-white/10 rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-white/5">
            <div className="flex items-center gap-3">
              {currentUser?.avatar_url ? (
                <img src={currentUser.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border border-white/10" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-zinc-800 border border-white/10" />
              )}
              <div>
                <h2 className="text-sm font-black text-white uppercase tracking-tight">New Signal</h2>
                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                  @{currentUser?.username || 'anonymous'}
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              disabled={isSubmitting}
              className="p-2 hover:bg-white/10 rounded-full transition-colors disabled:opacity-50 text-zinc-500 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-4">
            {/* Rich text toolbar — only show when TipTap is active */}
            {editor && !useFallback && (
              <div className="flex items-center gap-1 mb-3 p-1.5 bg-white/5 rounded-xl border border-white/5">
                <button
                  type="button"
                  onClick={() => editor.chain().focus().toggleBold().run()}
                  className={cn(
                    "p-2 rounded-lg hover:bg-white/10 transition-colors",
                    editor.isActive('bold') ? "bg-white/20 text-white" : "text-zinc-500"
                  )}
                >
                  <Bold className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                  className={cn(
                    "p-2 rounded-lg hover:bg-white/10 transition-colors",
                    editor.isActive('italic') ? "bg-white/20 text-white" : "text-zinc-500"
                  )}
                >
                  <Italic className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-4 bg-white/10 mx-1" />
                <button
                  type="button"
                  onClick={setLink}
                  className={cn(
                    "p-2 rounded-lg hover:bg-white/10 transition-colors",
                    editor.isActive('link') ? "bg-white/20 text-accent" : "text-zinc-500"
                  )}
                >
                  <LinkIcon className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-4 bg-white/10 mx-1" />
                <label className="p-2 rounded-lg hover:bg-white/10 transition-colors text-zinc-500 cursor-pointer">
                  <ImageIcon className="w-3.5 h-3.5" />
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={isSubmitting} />
                </label>
              </div>
            )}

            {/* Editor / Fallback textarea */}
            {!useFallback && editor ? (
              <div
                className="bg-black/30 border border-white/5 rounded-2xl p-4 min-h-[140px] cursor-text focus-within:border-accent/30 transition-colors"
                onClick={() => editor.commands.focus()}
              >
                <EditorContent editor={editor} />
              </div>
            ) : (
              <textarea
                value={fallbackContent}
                onChange={(e) => setFallbackContent(e.target.value)}
                placeholder="Broadcast your signal to the network..."
                className="w-full bg-black/30 border border-white/5 rounded-2xl p-4 min-h-[140px] text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-accent/30 transition-colors resize-none"
                autoFocus
              />
            )}

            {/* Error message */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 flex items-start gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl"
              >
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-400 font-medium flex-1">{error}</p>
                <button onClick={() => setError(null)} className="text-red-400/50 hover:text-red-400 transition-colors flex-shrink-0">
                  <X className="w-3 h-3" />
                </button>
              </motion.div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-5 border-t border-white/5 flex items-center justify-between bg-black/20">
            {/* Image upload for fallback mode */}
            {useFallback && (
              <label className="p-2 rounded-xl hover:bg-white/10 transition-colors text-zinc-500 cursor-pointer border border-white/5">
                <ImageIcon className="w-4 h-4" />
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={isSubmitting} />
              </label>
            )}
            {!useFallback && <div />}

            <button
              type="button"
              onClick={handlePost}
              disabled={!canSubmit}
              className={cn(
                "px-8 py-3 rounded-2xl font-black text-sm uppercase tracking-widest transition-all flex items-center gap-2",
                success
                  ? "bg-green-500 text-white shadow-[0_0_20px_rgba(34,197,94,0.4)] scale-105"
                  : canSubmit
                  ? "bg-accent text-white shadow-[0_0_20px_rgba(255,0,0,0.3)] hover:shadow-[0_0_30px_rgba(255,0,0,0.5)] hover:scale-105 active:scale-95"
                  : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
              )}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Transmitting...
                </>
              ) : success ? (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Sent!
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Post
                </>
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
