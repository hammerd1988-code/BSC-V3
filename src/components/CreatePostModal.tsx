import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { X, Bold, Italic, Link as LinkIcon, Send, Loader2, Image as ImageIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { socket } from '../lib/socket';
import { v4 as uuidv4 } from 'uuid';
import { generateText } from '../lib/ai';

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPostCreated: (post: any) => void;
}

export const CreatePostModal: React.FC<CreatePostModalProps> = ({ isOpen, onClose, onPostCreated }) => {
  const { currentUser } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `post_images/${currentUser.id}/${uuidv4()}.${fileExt}`;
      const { error: upErr } = await supabase.storage.from('media').upload(filePath, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(filePath);
      editor.chain().focus().setImage({ src: publicUrl }).run();
    } catch (error) {
      handleDbError(error, 'WRITE', 'storage/post_images');
    } finally {
      setIsSubmitting(false);
      if (e.target) e.target.value = '';
    }
  };

  const handlePost = async () => {
    if (!editor || editor.isEmpty || !currentUser) return;
    
    setIsSubmitting(true);
    try {
      const content = editor.getHTML();
      const plainText = editor.getText();
      
      // Generate Neural Tags
      let neuralTags: string[] = [];
      try {
        const tagPrompt = `Analyze this social media post and provide 3-5 short, technical, cyberpunk-themed "Neural Tags" that categorize its content. 
        Return ONLY a comma-separated list of tags. No other text.
        Post Content: "${plainText}"`;
        
        const tagResponse = await generateText(tagPrompt, currentUser.ai_settings, {
          systemPrompt: "You are a neural categorization engine. Output only comma-separated tags.",
          temperature: 0.5
        });
        
        if (tagResponse) {
          neuralTags = tagResponse.split(',').map(t => t.trim().toUpperCase()).filter(t => t.length > 0);
        }
      } catch (tagErr) {
        console.error("Tag Gen Error:", tagErr);
      }

      const newPost = {
        author_id: currentUser.id,
        content,
        likes: 0,
        boosts: 0,
        comments_count: 0,
        shares_count: 0,
        is_boosted: false,
        neural_tags: neuralTags,
        created_at: new Date().toISOString(),
      };

      const { data: inserted, error: insertErr } = await supabase
        .from('posts')
        .insert(newPost)
        .select()
        .single();
      if (insertErr) throw insertErr;
      const postWithId = inserted;

      onPostCreated(postWithId);
      socket.emit('post:create', postWithId);
      
      editor.commands.setContent('');
      onClose();
      alert('Post submitted successfully!');
    } catch (error) {
      console.error('Submission error:', error);
      alert('Error creating post: ' + (error instanceof Error ? error.message : String(error)));
      handleDbError(error, 'CREATE', 'posts');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="w-full max-w-lg bg-background border border-white/10 rounded-2xl overflow-hidden shadow-2xl"
        >
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h2 className="text-lg font-bold text-white">Create Post</h2>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
          
          <div className="p-4">
            {editor && (
              <div className="flex items-center gap-2 mb-4 p-2 bg-white/5 rounded-lg border border-white/10">
                <button
                  onClick={() => editor.chain().focus().toggleBold().run()}
                  className={cn(
                    "p-2 rounded hover:bg-white/10 transition-colors",
                    editor.isActive('bold') ? "bg-white/20 text-white" : "text-gray-400"
                  )}
                >
                  <Bold className="w-4 h-4" />
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                  className={cn(
                    "p-2 rounded hover:bg-white/10 transition-colors",
                    editor.isActive('italic') ? "bg-white/20 text-white" : "text-gray-400"
                  )}
                >
                  <Italic className="w-4 h-4" />
                </button>
                <div className="w-px h-4 bg-white/20 mx-1" />
                <button
                  onClick={setLink}
                  className={cn(
                    "p-2 rounded hover:bg-white/10 transition-colors",
                    editor.isActive('link') ? "bg-white/20 text-accent" : "text-gray-400"
                  )}
                >
                  <LinkIcon className="w-4 h-4" />
                </button>
                <div className="w-px h-4 bg-white/20 mx-1" />
                <label className="p-2 rounded hover:bg-white/10 transition-colors text-gray-400 cursor-pointer">
                  <ImageIcon className="w-4 h-4" />
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    onChange={handleImageUpload}
                  />
                </label>
              </div>
            )}
            
            <div className="bg-black/40 border border-white/10 rounded-xl p-4 min-h-[150px] cursor-text" onClick={() => editor?.commands.focus()}>
              <EditorContent editor={editor} />
            </div>
          </div>
          
          <div className="p-4 border-t border-white/10 flex justify-end">
            <button
              onClick={handlePost}
              disabled={isSubmitting || (editor && editor.isEmpty)}
              className="px-6 py-2 bg-accent rounded-full font-bold text-white shadow-[0_0_15px_rgba(255,0,0,0.3)] hover:shadow-[0_0_25px_rgba(255,0,0,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Post
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
