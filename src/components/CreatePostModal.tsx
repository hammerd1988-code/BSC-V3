import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { X, Bold, Italic, Link as LinkIcon, Send, Loader2, Image as ImageIcon, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { socket } from '../lib/socket';
import { v4 as uuidv4 } from 'uuid';

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

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Broadcast your neural transmission...',
        emptyEditorClass: 'is-editor-empty',
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'rounded-xl max-h-96 object-cover my-4 w-full',
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-accent underline',
        },
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-[150px] text-white',
      },
    },
  });

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
    if (!file || !editor || !currentUser) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `post_images/${currentUser.id}/${uuidv4()}.${fileExt}`;
      const { error: upErr } = await supabase.storage.from('media').upload(filePath, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(filePath);
      editor.chain().focus().setImage({ src: publicUrl }).run();
    } catch (err: any) {
      setError(`Image upload failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSubmitting(false);
      if (e.target) e.target.value = '';
    }
  };

  const handlePost = async () => {
    if (!editor) return;

    // Get the raw text content to check if truly empty
    const textContent = editor.getText().trim();
    const htmlContent = editor.getHTML();
    const hasImages = htmlContent.includes('<img');

    if (!textContent && !hasImages) {
      setError('Cannot post empty content. Write something first.');
      return;
    }

    if (!currentUser) {
      setError('No active session. Please sign in again.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const newPost = {
        author_id: currentUser.id,
        content: htmlContent,
        likes: 0,
        boosts: 0,
        comments_count: 0,
        shares_count: 0,
        is_boosted: false,
        type: 'text',
        neural_tags: [],
      };

      // Use maybeSingle() instead of single() to avoid PGRST116 error
      // when RLS blocks the SELECT after a successful INSERT
      const { data: inserted, error: insertErr } = await supabase
        .from('posts')
        .insert(newPost)
        .select()
        .maybeSingle();

      if (insertErr) {
        console.error('[CreatePost] Insert error:', insertErr);
        throw insertErr;
      }

      // inserted may be null if RLS blocks the SELECT after insert,
      // but the insert itself succeeded. Use a fallback post object.
      const postResult = inserted ?? {
        ...newPost,
        id: uuidv4(),
        created_at: new Date().toISOString(),
      };

      console.log('[CreatePost] Post created successfully:', postResult.id);

      onPostCreated(postResult);
      socket.emit('post:create', postResult);

      // Show success state briefly, then close
      setSuccess(true);
      editor.commands.setContent('');

      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 800);

    } catch (err: any) {
      console.error('[CreatePost] Submission error:', err);
      const msg = err?.message || String(err);
      // Provide user-friendly error messages for common failures
      if (msg.includes('row-level security') || msg.includes('permission') || msg.includes('violates')) {
        setError('Permission denied. Your session may have expired — try signing out and back in.');
      } else if (msg.includes('foreign key') || msg.includes('author_id')) {
        setError('Account not fully set up. Please sign out and sign in again to complete setup.');
      } else if (msg.includes('network') || msg.includes('fetch')) {
        setError('Network error. Check your connection and try again.');
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
      onClose();
    }
  };

  if (!isOpen) return null;

  const isEmpty = !editor || (editor.isEmpty && !editor.getHTML().includes('<img'));

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="w-full max-w-lg bg-background border border-white/10 rounded-2xl overflow-hidden shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h2 className="text-lg font-bold text-white">New Transmission</h2>
            <button
              onClick={handleClose}
              disabled={isSubmitting}
              className="p-2 hover:bg-white/10 rounded-full transition-colors disabled:opacity-50"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4">
            {/* Toolbar */}
            {editor && (
              <div className="flex items-center gap-2 mb-4 p-2 bg-white/5 rounded-lg border border-white/10">
                <button
                  type="button"
                  onClick={() => editor.chain().focus().toggleBold().run()}
                  className={cn(
                    "p-2 rounded hover:bg-white/10 transition-colors",
                    editor.isActive('bold') ? "bg-white/20 text-white" : "text-gray-400"
                  )}
                  title="Bold"
                >
                  <Bold className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                  className={cn(
                    "p-2 rounded hover:bg-white/10 transition-colors",
                    editor.isActive('italic') ? "bg-white/20 text-white" : "text-gray-400"
                  )}
                  title="Italic"
                >
                  <Italic className="w-4 h-4" />
                </button>
                <div className="w-px h-4 bg-white/20 mx-1" />
                <button
                  type="button"
                  onClick={setLink}
                  className={cn(
                    "p-2 rounded hover:bg-white/10 transition-colors",
                    editor.isActive('link') ? "bg-white/20 text-accent" : "text-gray-400"
                  )}
                  title="Add link"
                >
                  <LinkIcon className="w-4 h-4" />
                </button>
                <div className="w-px h-4 bg-white/20 mx-1" />
                <label
                  className="p-2 rounded hover:bg-white/10 transition-colors text-gray-400 cursor-pointer"
                  title="Upload image"
                >
                  <ImageIcon className="w-4 h-4" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageUpload}
                    disabled={isSubmitting}
                  />
                </label>
              </div>
            )}

            {/* Editor area */}
            <div
              className="bg-black/40 border border-white/10 rounded-xl p-4 min-h-[150px] cursor-text focus-within:border-accent/40 transition-colors"
              onClick={() => editor?.commands.focus()}
            >
              <EditorContent editor={editor} />
            </div>

            {/* Error message */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-xl"
              >
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-red-400 font-medium flex-1">{error}</p>
                <button onClick={() => setError(null)} className="text-red-400/50 hover:text-red-400 transition-colors flex-shrink-0">
                  <X className="w-3 h-3" />
                </button>
              </motion.div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-white/10 flex items-center justify-between">
            <p className="text-[10px] text-gray-600 uppercase tracking-widest">
              {currentUser?.display_name || 'Anonymous'}
            </p>
            <button
              type="button"
              onClick={handlePost}
              disabled={isSubmitting || isEmpty || success}
              className={cn(
                "px-6 py-2 rounded-full font-bold text-white transition-all flex items-center gap-2 disabled:cursor-not-allowed",
                success
                  ? "bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.4)]"
                  : "bg-accent shadow-[0_0_15px_rgba(255,0,0,0.3)] hover:shadow-[0_0_25px_rgba(255,0,0,0.5)] disabled:opacity-50 disabled:bg-gray-700"
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
