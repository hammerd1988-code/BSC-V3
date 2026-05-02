import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Send, Loader2, Image as ImageIcon, CheckCircle, AlertCircle, Bold, Italic, Link as LinkIcon, Video, Clapperboard } from 'lucide-react';
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
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoTitle, setVideoTitle] = useState('');
  const [videoThumbnailUrl, setVideoThumbnailUrl] = useState('');
  const [videoCategory, setVideoCategory] = useState('Coding');
  const [isShort, setIsShort] = useState(false);

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
      clearVideo();
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
    if (videoFile) return false;
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

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    const previewUrl = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoPreviewUrl(previewUrl);
    setVideoTitle(file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '));
    setError(null);

    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      const duration = Number.isFinite(probe.duration) ? Math.round(probe.duration) : 0;
      setVideoDuration(duration);
      setIsShort(duration > 0 && duration <= 60);
      URL.revokeObjectURL(probe.src);
    };
    probe.src = URL.createObjectURL(file);
    if (e.target) e.target.value = '';
  };

  const clearVideo = () => {
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoFile(null);
    setVideoPreviewUrl(null);
    setVideoDuration(0);
    setVideoTitle('');
    setVideoThumbnailUrl('');
    setIsShort(false);
  };

  const handlePost = async () => {
    console.log('[CreatePost] handlePost called', { currentUser: !!currentUser, editor: !!editor, useFallback });

    if (!currentUser) {
      setError('No active session. Please sign in again.');
      return;
    }

    const { html: htmlContent, text: textContent } = getContent();

    if (!textContent && !htmlContent.includes('<img') && !videoFile) {
      setError('Write something or attach a video before posting.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      let uploadedVideoUrl: string | null = null;
      if (videoFile) {
        const fileExt = videoFile.name.split('.').pop() || 'mp4';
        const filePath = `post_videos/${currentUser.id}/${uuidv4()}.${fileExt}`;
        const { error: videoUploadError } = await supabase.storage.from('media').upload(filePath, videoFile, {
          upsert: true,
          contentType: videoFile.type || 'video/mp4',
        });
        if (videoUploadError) throw videoUploadError;
        const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(filePath);
        uploadedVideoUrl = publicUrl;
      }

      // Only include columns that exist in the posts table:
      // id (auto), author_id, content, media_url, media_type, type, likes, boosts,
      // comments_count, is_boosted, last_comment_at, expires_at, is_echo, feed_type,
      // created_at, updated_at, view_count, poll_data
      const newPost = {
        author_id: currentUser.id,
        content: htmlContent || `<p>${videoTitle || 'New video transmission'}</p>`,
        media_url: uploadedVideoUrl,
        media_type: uploadedVideoUrl ? 'video' as const : null,
        likes: 0,
        boosts: 0,
        comments_count: 0,
        is_boosted: false,
        type: uploadedVideoUrl ? (isShort ? 'short' : 'video') : 'text' as const,
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

      if (uploadedVideoUrl) {
        const { error: videoInsertError } = await supabase.from('videos').insert({
          user_id: currentUser.id,
          post_id: postResult.id,
          title: videoTitle.trim() || textContent.slice(0, 80) || 'Untitled video',
          description: textContent || null,
          video_url: uploadedVideoUrl,
          thumbnail_url: videoThumbnailUrl.trim() || null,
          duration: videoDuration,
          category: videoCategory,
          is_short: isShort,
          view_count: 0,
        });
        if (videoInsertError) throw videoInsertError;
      }

      onPostCreated(postResult);
      socket.emit('post:create', postResult);

      setSuccess(true);
      setFallbackContent('');
      clearVideo();
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
      clearVideo();
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
                <label className="p-2 rounded-lg hover:bg-white/10 transition-colors text-zinc-500 cursor-pointer" title="Add image">
                  <ImageIcon className="w-3.5 h-3.5" />
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={isSubmitting} />
                </label>
                <label className="p-2 rounded-lg hover:bg-white/10 transition-colors text-cyan-400 cursor-pointer" title="Add video or short">
                  <Video className="w-3.5 h-3.5" />
                  <input type="file" accept="video/*" className="hidden" onChange={handleVideoSelect} disabled={isSubmitting} />
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

            {/* Video / Shorts composer */}
            {videoFile && videoPreviewUrl && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 overflow-hidden rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.04]"
              >
                <div className="relative aspect-video bg-black">
                  <video src={videoPreviewUrl} controls className="h-full w-full object-contain" />
                  <button
                    type="button"
                    onClick={clearVideo}
                    className="absolute right-3 top-3 rounded-full bg-black/70 p-2 text-white hover:bg-red-500"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <div className="absolute left-3 top-3 rounded-full bg-black/70 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-cyan-100">
                    {isShort ? 'Short' : 'Full Video'} · {videoDuration ? `${Math.round(videoDuration)}s` : 'metadata'}
                  </div>
                </div>
                <div className="space-y-3 p-4">
                  <input
                    value={videoTitle}
                    onChange={(e) => setVideoTitle(e.target.value)}
                    placeholder="Video title"
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs font-bold text-white outline-none focus:border-cyan-300"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={videoCategory}
                      onChange={(e) => setVideoCategory(e.target.value)}
                      className="rounded-xl border border-white/10 bg-black/80 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white outline-none focus:border-cyan-300"
                    >
                      {['Coding','Tutorials','Code Battles','Gaming','Music','Art','Reactions','Q&A','Creative','Other'].map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setIsShort((value) => !value)}
                      className={cn(
                        'inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition',
                        isShort ? 'border-pink-400/40 bg-pink-500/15 text-pink-100' : 'border-white/10 bg-white/5 text-zinc-400'
                      )}
                    >
                      <Clapperboard className="h-3.5 w-3.5" />
                      {isShort ? 'Shorts Mode' : 'Full Video'}
                    </button>
                  </div>
                  <input
                    value={videoThumbnailUrl}
                    onChange={(e) => setVideoThumbnailUrl(e.target.value)}
                    placeholder="Thumbnail URL (optional)"
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-cyan-300"
                  />
                </div>
              </motion.div>
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
              <div className="flex items-center gap-2">
                <label className="p-2 rounded-xl hover:bg-white/10 transition-colors text-zinc-500 cursor-pointer border border-white/5" title="Add image">
                  <ImageIcon className="w-4 h-4" />
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={isSubmitting} />
                </label>
                <label className="p-2 rounded-xl hover:bg-white/10 transition-colors text-cyan-400 cursor-pointer border border-cyan-300/20" title="Add video or short">
                  <Video className="w-4 h-4" />
                  <input type="file" accept="video/*" className="hidden" onChange={handleVideoSelect} disabled={isSubmitting} />
                </label>
              </div>
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
