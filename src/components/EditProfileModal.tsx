import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, Upload, Camera, Cpu, Globe, Key, Palette, HeartHandshake, Megaphone, ExternalLink } from 'lucide-react';
import { User, AiProvider } from '../types';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { v4 as uuidv4 } from 'uuid';
import { cn } from '../lib/utils';
import { AvatarBuilderModal } from './AvatarBuilderModal';
import { Wand2 } from 'lucide-react';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({ isOpen, onClose, user }) => {
  const { currentUser } = useAuth();
  const [displayName, setDisplayName] = useState(user.display_name);
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState(user.bio || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url);
  const [coverUrl, setCoverUrl] = useState(user.cover_url || '');
  const [customAccent, setCustomAccent] = useState(user.custom_accent || '#FF0000');
  const [sponsoredEntity, setSponsoredEntity] = useState(user.sponsored_entity || {
    name: '',
    type: 'business',
    link: '',
    description: ''
  });
  const [showAvatarBuilder, setShowAvatarBuilder] = useState(false);
  
  const [aiProvider, setAiProvider] = useState<AiProvider>(user.ai_settings?.provider || 'gemini');
  const [aiEndpoint, setAiEndpoint] = useState(user.ai_settings?.endpoint || '');
  const [aiModel, setAiModel] = useState(user.ai_settings?.model || '');
  const [aiApiKey, setAiApiKey] = useState(user.ai_settings?.apiKey || '');
  
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDisplayName(user.display_name);
    setUsername(user.username);
    setBio(user.bio || '');
    setAvatarUrl(user.avatar_url);
    setCoverUrl(user.cover_url || '');
    setCustomAccent(user.custom_accent || '#FF0000');
    setSponsoredEntity(user.sponsored_entity || {
      name: '',
      type: 'business',
      link: '',
      description: ''
    });
    setAiProvider(user.ai_settings?.provider || 'gemini');
    setAiEndpoint(user.ai_settings?.endpoint || '');
    setAiModel(user.ai_settings?.model || '');
    setAiApiKey(user.ai_settings?.apiKey || '');
    setError(null);
  }, [isOpen, user]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'cover') => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    setIsSaving(true);
    setError(null);
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `profile_images/${currentUser.id}/${type}_${uuidv4()}.${fileExt}`;
      const { error: upErr } = await supabase.storage.from('media').upload(filePath, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(filePath);
      if (type === 'avatar') setAvatarUrl(publicUrl);
      else setCoverUrl(publicUrl);
    } catch (err) {
      console.error(err);
      setError(`Failed to upload ${type} image.`);
    } finally {
      setIsSaving(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleSave = async () => {
    if (!currentUser || currentUser.id !== user.id) return;
    
    setIsSaving(true);
    setError(null);

    try {
      // Check if username is taken
      if (username !== user.username) {
        const { data: taken } = await supabase
          .from('users')
          .select('id')
          .eq('username', username)
          .maybeSingle();
        if (taken) {
          setError('Username is already taken.');
          setIsSaving(false);
          return;
        }
      }

      let finalAvatarUrl = avatarUrl;
      if (avatarUrl.startsWith('data:')) {
        const filePath = `profile_images/${currentUser.id}/avatar_${uuidv4()}.png`;
        const blob = await fetch(avatarUrl).then(r => r.blob());
        const { error: upErr } = await supabase.storage.from('media').upload(filePath, blob, { upsert: true, contentType: 'image/png' });
        if (upErr) throw upErr;
        finalAvatarUrl = supabase.storage.from('media').getPublicUrl(filePath).data.publicUrl;
      }

      const { error: updateErr } = await supabase.from('users').update({
        display_name: displayName,
        username,
        bio,
        avatar_url: finalAvatarUrl,
        cover_url: coverUrl,
        custom_accent: customAccent,
        sponsored_entity: sponsoredEntity.name ? sponsoredEntity : null,
        ai_settings: { provider: aiProvider, endpoint: aiEndpoint, model: aiModel, apiKey: aiApiKey },
      }).eq('id', currentUser.id);
      if (updateErr) throw updateErr;

      onClose();
    } catch (err) {
      handleDbError(err, 'UPDATE', `users/${currentUser.id}`);
      setError('Failed to update profile.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="w-full max-w-md glass-card rounded-2xl overflow-hidden neon-border flex flex-col max-h-[90vh]"
        >
          <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/50">
            <h2 className="text-lg font-black text-white uppercase tracking-widest italic">Edit Profile</h2>
            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1 space-y-6">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-500 text-xs font-bold uppercase tracking-widest text-center">
                {error}
              </div>
            )}

            {/* Cover Image */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cover Image</label>
              <div 
                className="relative h-32 w-full bg-surface rounded-xl overflow-hidden border border-white/10 group cursor-pointer"
                onClick={() => coverInputRef.current?.click()}
              >
                {coverUrl ? (
                  <img src={coverUrl} alt="Cover" className="w-full h-full object-cover group-hover:opacity-50 transition-opacity" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-white/5 group-hover:bg-white/10 transition-colors">
                    <Upload className="w-6 h-6 text-gray-500" />
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                  <Camera className="w-8 h-8 text-white" />
                </div>
                <input 
                  type="file" 
                  ref={coverInputRef} 
                  className="hidden" 
                  accept="image/*"
                  onChange={(e) => handleImageUpload(e, 'cover')}
                />
              </div>
            </div>

            {/* Avatar Image */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Avatar</label>
              <div className="flex items-center gap-4">
                <div 
                  className="relative w-20 h-20 rounded-full overflow-hidden border-2 border-white/10 group cursor-pointer bg-surface"
                  onClick={() => avatarInputRef.current?.click()}
                >
                  <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover group-hover:opacity-50 transition-opacity" />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                    <Camera className="w-6 h-6 text-white" />
                  </div>
                </div>
                <input 
                  type="file" 
                  ref={avatarInputRef} 
                  className="hidden" 
                  accept="image/*"
                  onChange={(e) => handleImageUpload(e, 'avatar')}
                />
                <div className="flex-1 space-y-2">
                  <p className="text-xs text-gray-500">Tap the image to upload a new avatar.</p>
                  <button
                    onClick={() => setShowAvatarBuilder(true)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 text-accent border border-accent/20 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-accent/20 transition-colors"
                  >
                    <Wand2 className="w-3 h-3" />
                    AI Avatar Builder
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-accent outline-none transition-colors"
                  placeholder="Your Name"
                  maxLength={50}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-accent outline-none transition-colors"
                  placeholder="username"
                  maxLength={30}
                />
                <p className="text-[10px] text-gray-500 mt-1">Only lowercase letters, numbers, and underscores.</p>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Bio</label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-accent outline-none transition-colors resize-none h-24"
                  placeholder="Tell the network about yourself..."
                  maxLength={160}
                />
                <div className="text-right mt-1">
                  <span className="text-[10px] text-gray-500">{bio.length}/160</span>
                </div>
              </div>

              {/* Custom Accent Color */}
              <div className="pt-4 border-t border-white/5 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Palette className="w-4 h-4 text-accent" />
                  <h3 className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Neural Accent Color</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    '#FF0000', '#8B0000', '#E91E63', '#FF5722', 
                    '#9C27B0', '#673AB7', '#B71C1C', '#4A148C',
                    '#00BCD4', '#4CAF50', '#FFEB3B', '#FFFFFF'
                  ].map(color => (
                    <button
                      key={color}
                      onClick={() => setCustomAccent(color)}
                      className={cn(
                        "w-8 h-8 rounded-lg border transition-all",
                        customAccent === color 
                          ? "border-white scale-110 shadow-[0_0_10px_rgba(255,255,255,0.3)]" 
                          : "border-white/10 hover:border-white/30"
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              {/* Sponsored Entity Section */}
              <div className="pt-4 border-t border-white/5 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <HeartHandshake className="w-4 h-4 text-accent" />
                  <h3 className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Sponsorship Config</h3>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Entity Name</label>
                    <input
                      type="text"
                      value={sponsoredEntity.name}
                      onChange={(e) => setSponsoredEntity({ ...sponsoredEntity, name: e.target.value })}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-accent outline-none transition-colors"
                      placeholder="e.g., Neural Net Charity"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Entity Type</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['business', 'charity', 'individual'] as const).map((type) => (
                        <button
                          key={type}
                          onClick={() => setSponsoredEntity({ ...sponsoredEntity, type })}
                          className={cn(
                            "py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-all",
                            sponsoredEntity.type === type 
                              ? "bg-accent border-accent text-white" 
                              : "bg-black/40 border-white/10 text-gray-500 hover:border-white/20"
                          )}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Link</label>
                    <input
                      type="url"
                      value={sponsoredEntity.link}
                      onChange={(e) => setSponsoredEntity({ ...sponsoredEntity, link: e.target.value })}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-accent outline-none transition-colors"
                      placeholder="https://..."
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Description</label>
                    <textarea
                      value={sponsoredEntity.description}
                      onChange={(e) => setSponsoredEntity({ ...sponsoredEntity, description: e.target.value })}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-accent outline-none transition-colors resize-none h-20"
                      placeholder="Why are you sponsoring them?"
                    />
                  </div>
                </div>
              </div>

              {/* AI Settings Section */}
              <div className="pt-4 border-t border-white/5 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Cpu className="w-4 h-4 text-accent" />
                  <h3 className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Neural Processor Config</h3>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">AI Provider</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['gemini', 'ollama', 'lmstudio'] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setAiProvider(p)}
                        className={cn(
                          "py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-all",
                          aiProvider === p 
                            ? "bg-accent border-accent text-white shadow-[0_0_10px_rgba(255,0,0,0.3)]" 
                            : "bg-black/40 border-white/10 text-gray-500 hover:border-white/20"
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                {aiProvider !== 'gemini' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="space-y-4 overflow-hidden"
                  >
                    <div>
                      <label className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                        <Globe className="w-3 h-3" />
                        API Endpoint
                      </label>
                      <input
                        type="text"
                        value={aiEndpoint}
                        onChange={(e) => setAiEndpoint(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-accent outline-none transition-colors"
                        placeholder={aiProvider === 'ollama' ? "http://localhost:11434/v1/chat/completions" : "http://localhost:1234/v1/chat/completions"}
                      />
                    </div>

                    <div>
                      <label className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                        <Cpu className="w-3 h-3" />
                        Model Name
                      </label>
                      <input
                        type="text"
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-accent outline-none transition-colors"
                        placeholder={aiProvider === 'ollama' ? "llama3" : "model-identifier"}
                      />
                    </div>

                    <div>
                      <label className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                        <Key className="w-3 h-3" />
                        API Key (Optional)
                      </label>
                      <input
                        type="password"
                        value={aiApiKey}
                        onChange={(e) => setAiApiKey(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-accent outline-none transition-colors"
                        placeholder="Leave blank if not required"
                      />
                    </div>
                  </motion.div>
                )}
                
                {aiProvider === 'gemini' && (
                  <p className="text-[10px] text-gray-500 italic">
                    Using platform-default Gemini Neural Engine. No configuration required.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-white/5 bg-black/50 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !displayName.trim() || !username.trim()}
              className="px-6 py-2 bg-accent text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-accent/80 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </motion.div>
      </div>

      <AvatarBuilderModal
        isOpen={showAvatarBuilder}
        onClose={() => setShowAvatarBuilder(false)}
        onApply={(base64Image) => {
          setAvatarUrl(base64Image);
          setShowAvatarBuilder(false);
        }}
      />
    </AnimatePresence>
  );
};
