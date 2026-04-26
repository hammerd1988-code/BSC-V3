import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Palette, Music, Layout, Type, Check, Loader2, Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { cn } from '../lib/utils';
import { awardAchievement } from '../lib/achievements';

export interface ProfileTheme {
  accent_color: string;
  bg_color: string;
  bg_gradient: string;
  text_color: string;
  card_bg: string;
  card_border: string;
  font_family: string;
  layout: 'default' | 'centered' | 'sidebar' | 'magazine';
  particle_effect: 'none' | 'matrix' | 'stars' | 'glitch' | 'rain';
}

export interface ProfileSection {
  id: string;
  title: string;
  content: string;
  icon: string;
  visible: boolean;
}

interface ProfileThemeEditorProps {
  userId: string;
  currentTheme: ProfileTheme | null;
  currentSections: ProfileSection[] | null;
  currentMusicUrl: string | null;
  currentMusicTitle: string | null;
  currentMusicArtist: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const DEFAULT_THEME: ProfileTheme = {
  accent_color: '#FF0000',
  bg_color: '#0A0A0A',
  bg_gradient: 'linear-gradient(135deg, #0A0A0A 0%, #1A0A0A 100%)',
  text_color: '#FFFFFF',
  card_bg: 'rgba(255,255,255,0.05)',
  card_border: 'rgba(255,255,255,0.1)',
  font_family: 'system-ui',
  layout: 'default',
  particle_effect: 'none',
};

const FONT_OPTIONS = [
  { value: 'system-ui', label: 'System Default' },
  { value: "'Space Grotesk', sans-serif", label: 'Space Grotesk' },
  { value: "'Courier New', monospace", label: 'Courier (Mono)' },
  { value: "'Georgia', serif", label: 'Georgia (Serif)' },
  { value: "'Impact', sans-serif", label: 'Impact (Bold)' },
  { value: "'Trebuchet MS', sans-serif", label: 'Trebuchet' },
  { value: "'Comic Sans MS', cursive", label: 'Comic Sans (Classic)' },
];

const LAYOUT_OPTIONS = [
  { value: 'default', label: 'Default', desc: 'Standard top-down layout' },
  { value: 'centered', label: 'Centered', desc: 'Everything centered, minimal' },
  { value: 'sidebar', label: 'Sidebar', desc: 'Profile info on the left' },
  { value: 'magazine', label: 'Magazine', desc: 'Grid-based editorial style' },
];

const PARTICLE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'matrix', label: 'Matrix Rain' },
  { value: 'stars', label: 'Stars' },
  { value: 'glitch', label: 'Glitch Flicker' },
  { value: 'rain', label: 'Neon Rain' },
];

const GRADIENT_PRESETS = [
  { label: 'Blood Dark', value: 'linear-gradient(135deg, #0A0A0A 0%, #1A0A0A 100%)' },
  { label: 'Deep Space', value: 'linear-gradient(135deg, #0A0A1A 0%, #0A0A0A 100%)' },
  { label: 'Void Purple', value: 'linear-gradient(135deg, #0D0A1A 0%, #0A0A0A 100%)' },
  { label: 'Neon Sunset', value: 'linear-gradient(135deg, #1A0A0A 0%, #0A0A1A 100%)' },
  { label: 'Forest Night', value: 'linear-gradient(135deg, #0A1A0A 0%, #0A0A0A 100%)' },
  { label: 'Ocean Depth', value: 'linear-gradient(135deg, #0A1A1A 0%, #0A0A0A 100%)' },
  { label: 'Pure Black', value: '#000000' },
  { label: 'Charcoal', value: '#111111' },
];

type Tab = 'colors' | 'layout' | 'music' | 'sections';

export const ProfileThemeEditor: React.FC<ProfileThemeEditorProps> = ({
  userId,
  currentTheme,
  currentSections,
  currentMusicUrl,
  currentMusicTitle,
  currentMusicArtist,
  onClose,
  onSaved,
}) => {
  const [tab, setTab] = useState<Tab>('colors');
  const [theme, setTheme] = useState<ProfileTheme>(currentTheme || DEFAULT_THEME);
  const [sections, setSections] = useState<ProfileSection[]>(currentSections || []);
  const [musicUrl, setMusicUrl] = useState(currentMusicUrl || '');
  const [musicTitle, setMusicTitle] = useState(currentMusicTitle || '');
  const [musicArtist, setMusicArtist] = useState(currentMusicArtist || '');
  const [saving, setSaving] = useState(false);

  const updateTheme = (patch: Partial<ProfileTheme>) => setTheme(t => ({ ...t, ...patch }));

  const addSection = () => {
    setSections(prev => [...prev, {
      id: Date.now().toString(),
      title: 'New Section',
      content: '',
      icon: '📌',
      visible: true,
    }]);
  };

  const updateSection = (id: string, patch: Partial<ProfileSection>) => {
    setSections(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  const removeSection = (id: string) => {
    setSections(prev => prev.filter(s => s.id !== id));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await supabase.from('users').update({
        profile_theme: theme,
        profile_sections: sections,
        profile_music_url: musicUrl.trim() || null,
        profile_music_title: musicTitle.trim() || null,
        profile_music_artist: musicArtist.trim() || null,
        custom_accent: theme.accent_color,
      }).eq('id', userId);

      await awardAchievement(userId, 'profile_customized');
      onSaved();
      onClose();
    } catch (err) {
      handleDbError(err, 'UPDATE', `users/${userId}`);
    } finally {
      setSaving(false);
    }
  };

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'colors', label: 'Colors & Style', icon: <Palette className="w-4 h-4" /> },
    { id: 'layout', label: 'Layout', icon: <Layout className="w-4 h-4" /> },
    { id: 'music', label: 'Profile Music', icon: <Music className="w-4 h-4" /> },
    { id: 'sections', label: 'Sections', icon: <Type className="w-4 h-4" /> },
  ];

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="w-full max-w-2xl bg-[#0A0A0A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-white uppercase tracking-widest">Profile Customizer</h2>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">Your profile, your rules</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10 px-2 pt-2 gap-1 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-t-lg text-xs font-bold uppercase tracking-widest transition-all whitespace-nowrap",
                tab === t.id
                  ? "bg-white/10 text-white border-b-2 border-accent"
                  : "text-gray-500 hover:text-gray-300"
              )}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 p-5">
          <AnimatePresence mode="wait">
            {/* ── COLORS & STYLE ─────────────────────────────────────────── */}
            {tab === 'colors' && (
              <motion.div key="colors" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                {/* Accent color */}
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-3">Accent Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={theme.accent_color}
                      onChange={e => updateTheme({ accent_color: e.target.value })}
                      className="w-12 h-12 rounded-xl border border-white/20 cursor-pointer bg-transparent"
                    />
                    <div className="flex gap-2 flex-wrap">
                      {['#FF0000','#FF6B00','#9B59B6','#00BCD4','#E91E63','#00FF41','#FFD700','#FFFFFF'].map(c => (
                        <button key={c} onClick={() => updateTheme({ accent_color: c })}
                          className={cn("w-8 h-8 rounded-full border-2 transition-all hover:scale-110", theme.accent_color === c ? "border-white scale-110" : "border-transparent")}
                          style={{ backgroundColor: c }} />
                      ))}
                    </div>
                    <span className="font-mono text-sm text-white ml-2">{theme.accent_color}</span>
                  </div>
                </div>

                {/* Background */}
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-3">Background</label>
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    {GRADIENT_PRESETS.map(p => (
                      <button
                        key={p.value}
                        onClick={() => updateTheme({ bg_gradient: p.value, bg_color: p.value.startsWith('#') ? p.value : '#0A0A0A' })}
                        className={cn("h-12 rounded-lg border-2 transition-all hover:scale-105 relative overflow-hidden", theme.bg_gradient === p.value ? "border-accent" : "border-white/10")}
                        style={{ background: p.value }}
                        title={p.label}
                      >
                        {theme.bg_gradient === p.value && <Check className="w-3 h-3 text-white absolute top-1 right-1" />}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={theme.bg_color}
                      onChange={e => updateTheme({ bg_color: e.target.value, bg_gradient: e.target.value })}
                      className="w-10 h-10 rounded-lg border border-white/20 cursor-pointer bg-transparent"
                    />
                    <span className="text-xs text-gray-400">Custom solid color</span>
                  </div>
                </div>

                {/* Text color */}
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-3">Text Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={theme.text_color}
                      onChange={e => updateTheme({ text_color: e.target.value })}
                      className="w-10 h-10 rounded-lg border border-white/20 cursor-pointer bg-transparent"
                    />
                    <div className="flex gap-2">
                      {['#FFFFFF','#F0F0F0','#CCCCCC','#AAAAAA'].map(c => (
                        <button key={c} onClick={() => updateTheme({ text_color: c })}
                          className={cn("w-8 h-8 rounded-full border-2 transition-all", theme.text_color === c ? "border-accent" : "border-white/10")}
                          style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Card style */}
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-3">Card Background</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={theme.card_bg.startsWith('rgba') ? '#1A1A1A' : theme.card_bg}
                      onChange={e => updateTheme({ card_bg: e.target.value + '20', card_border: e.target.value + '40' })}
                      className="w-10 h-10 rounded-lg border border-white/20 cursor-pointer bg-transparent"
                    />
                    <span className="text-xs text-gray-400">Card tint color</span>
                  </div>
                </div>

                {/* Font */}
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-3">Font Family</label>
                  <div className="grid grid-cols-2 gap-2">
                    {FONT_OPTIONS.map(f => (
                      <button
                        key={f.value}
                        onClick={() => updateTheme({ font_family: f.value })}
                        className={cn(
                          "p-3 rounded-xl border text-left transition-all",
                          theme.font_family === f.value ? "border-accent bg-accent/10" : "border-white/10 bg-white/5 hover:border-white/20"
                        )}
                        style={{ fontFamily: f.value }}
                      >
                        <span className="text-sm text-white">{f.label}</span>
                        <p className="text-[10px] text-gray-500 mt-0.5" style={{ fontFamily: f.value }}>The quick brown fox</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Particle effect */}
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-3">Background Effect</label>
                  <div className="flex gap-2 flex-wrap">
                    {PARTICLE_OPTIONS.map(p => (
                      <button
                        key={p.value}
                        onClick={() => updateTheme({ particle_effect: p.value as ProfileTheme['particle_effect'] })}
                        className={cn(
                          "px-4 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-all",
                          theme.particle_effect === p.value ? "border-accent bg-accent/10 text-accent" : "border-white/10 text-gray-400 hover:border-white/20"
                        )}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── LAYOUT ─────────────────────────────────────────────────── */}
            {tab === 'layout' && (
              <motion.div key="layout" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                <p className="text-xs text-gray-500">Choose how your profile page is arranged.</p>
                <div className="grid grid-cols-2 gap-3">
                  {LAYOUT_OPTIONS.map(l => (
                    <button
                      key={l.value}
                      onClick={() => updateTheme({ layout: l.value as ProfileTheme['layout'] })}
                      className={cn(
                        "p-4 rounded-xl border text-left transition-all",
                        theme.layout === l.value ? "border-accent bg-accent/10" : "border-white/10 bg-white/5 hover:border-white/20"
                      )}
                    >
                      <p className="text-sm font-black text-white uppercase tracking-wider">{l.label}</p>
                      <p className="text-[10px] text-gray-500 mt-1">{l.desc}</p>
                      {theme.layout === l.value && <Check className="w-3 h-3 text-accent mt-2" />}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── MUSIC ──────────────────────────────────────────────────── */}
            {tab === 'music' && (
              <motion.div key="music" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
                <div className="p-4 bg-accent/5 border border-accent/20 rounded-xl">
                  <p className="text-xs text-accent font-bold mb-1">🎵 MySpace-Style Profile Music</p>
                  <p className="text-[10px] text-gray-400 leading-relaxed">
                    Paste a YouTube, SoundCloud, or direct audio URL. It will auto-play (muted by default, user can unmute) when someone visits your profile.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">Music URL</label>
                    <input
                      type="url"
                      value={musicUrl}
                      onChange={e => setMusicUrl(e.target.value)}
                      placeholder="https://youtube.com/watch?v=... or https://soundcloud.com/..."
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-gray-700"
                    />
                    <p className="text-[9px] text-gray-600 mt-1">Supported: YouTube, SoundCloud, direct .mp3/.ogg/.wav URLs</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">Song Title</label>
                    <input
                      type="text"
                      value={musicTitle}
                      onChange={e => setMusicTitle(e.target.value)}
                      placeholder="e.g. Blade Runner Blues"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-gray-700"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">Artist</label>
                    <input
                      type="text"
                      value={musicArtist}
                      onChange={e => setMusicArtist(e.target.value)}
                      placeholder="e.g. Vangelis"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-gray-700"
                    />
                  </div>
                  {musicUrl && (
                    <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
                      <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Preview</p>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-accent/20 rounded-lg flex items-center justify-center">
                          <Music className="w-5 h-5 text-accent" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white">{musicTitle || 'Unknown Track'}</p>
                          <p className="text-[10px] text-gray-500">{musicArtist || 'Unknown Artist'}</p>
                        </div>
                      </div>
                    </div>
                  )}
                  {musicUrl && (
                    <button
                      onClick={() => { setMusicUrl(''); setMusicTitle(''); setMusicArtist(''); }}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> Remove profile music
                    </button>
                  )}
                </div>
              </motion.div>
            )}

            {/* ── SECTIONS ───────────────────────────────────────────────── */}
            {tab === 'sections' && (
              <motion.div key="sections" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">Add custom sections to your profile page.</p>
                  <button
                    onClick={addSection}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 border border-accent/30 text-accent rounded-lg text-xs font-bold hover:bg-accent/20 transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Add Section
                  </button>
                </div>

                {sections.length === 0 && (
                  <div className="py-12 text-center border border-white/5 rounded-xl">
                    <Type className="w-8 h-8 text-gray-700 mx-auto mb-3" />
                    <p className="text-xs text-gray-600 uppercase tracking-widest">No custom sections yet</p>
                  </div>
                )}

                <div className="space-y-3">
                  {sections.map((section, idx) => (
                    <div key={section.id} className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-500 uppercase tracking-widest">Section {idx + 1}</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updateSection(section.id, { visible: !section.visible })}
                            className="p-1 text-gray-500 hover:text-white transition-colors"
                            title={section.visible ? 'Hide' : 'Show'}
                          >
                            {section.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => removeSection(section.id)}
                            className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={section.icon}
                          onChange={e => updateSection(section.id, { icon: e.target.value })}
                          placeholder="🔥"
                          className="w-12 bg-black/30 border border-white/10 rounded-lg px-2 py-2 text-center text-lg focus:outline-none focus:border-accent"
                        />
                        <input
                          type="text"
                          value={section.title}
                          onChange={e => updateSection(section.id, { title: e.target.value })}
                          placeholder="Section Title"
                          className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent placeholder:text-gray-700"
                        />
                      </div>
                      <textarea
                        value={section.content}
                        onChange={e => updateSection(section.id, { content: e.target.value })}
                        placeholder="Write anything here — links, text, your manifesto..."
                        rows={3}
                        className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent placeholder:text-gray-700 resize-none"
                      />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-white/10 flex items-center justify-between gap-3">
          <button onClick={onClose} className="px-6 py-2.5 border border-white/10 text-gray-400 rounded-xl hover:bg-white/5 transition-colors text-sm font-bold">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 bg-accent text-white font-black uppercase tracking-widest rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4" /> Save Profile Theme</>}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
