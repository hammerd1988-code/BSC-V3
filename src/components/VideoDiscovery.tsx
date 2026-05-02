import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Clock, Eye, Flame, Play, Search, Sparkles, Video, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { cn } from '../lib/utils';
import { handleDbError } from '../lib/errors';
import { CustomVideoPlayer } from './CustomVideoPlayer';

const VIDEO_CATEGORIES = ['All', 'Coding', 'Tutorials', 'Code Battles', 'Gaming', 'Music', 'Art', 'Reactions', 'Q&A', 'Creative', 'Other'] as const;

type VideoCategory = typeof VIDEO_CATEGORIES[number];

interface VideoRow {
  id: string;
  user_id: string;
  post_id?: string | null;
  title: string;
  description?: string | null;
  video_url: string;
  thumbnail_url?: string | null;
  duration: number;
  category: string;
  is_short: boolean;
  view_count: number;
  created_at: string;
  user?: {
    id: string;
    username: string;
    display_name: string;
    avatar_url?: string | null;
  } | null;
}

function formatDuration(seconds = 0) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.max(0, seconds % 60);
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export const VideoDiscovery: React.FC = () => {
  const navigate = useNavigate();
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<VideoCategory>('All');
  const [mode, setMode] = useState<'all' | 'shorts' | 'full'>('all');
  const [selectedVideo, setSelectedVideo] = useState<VideoRow | null>(null);

  const fetchVideos = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('videos')
      .select('*, user:users!videos_user_id_fkey(id, username, display_name, avatar_url)')
      .order('created_at', { ascending: false })
      .limit(80);
    if (error) {
      handleDbError(error, 'LIST', 'videos');
      setLoading(false);
      return;
    }
    setVideos((data ?? []) as VideoRow[]);
    setLoading(false);
  };

  useEffect(() => {
    void fetchVideos();
    const channel = supabase
      .channel('video-discovery')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'videos' }, () => void fetchVideos())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const filteredVideos = useMemo(() => {
    const term = query.trim().toLowerCase();
    return videos.filter((video) => {
      const categoryMatch = category === 'All' || video.category === category;
      const modeMatch = mode === 'all' || (mode === 'shorts' ? video.is_short : !video.is_short);
      const text = `${video.title} ${video.description ?? ''} ${video.category} ${video.user?.username ?? ''}`.toLowerCase();
      return categoryMatch && modeMatch && (!term || text.includes(term));
    });
  }, [videos, query, category, mode]);

  const featuredShorts = filteredVideos.filter((video) => video.is_short).slice(0, 8);
  const featuredFull = filteredVideos.filter((video) => !video.is_short).slice(0, 12);

  const openVideo = async (video: VideoRow) => {
    setSelectedVideo(video);
    setVideos((prev) => prev.map((item) => item.id === video.id ? { ...item, view_count: item.view_count + 1 } : item));
    await supabase.rpc('increment_counter', { p_table: 'videos', p_id: video.id, p_field: 'view_count', p_amount: 1 });
  };

  const renderVideoCard = (video: VideoRow, variant: 'short' | 'full') => (
    <motion.button
      key={video.id}
      type="button"
      whileHover={{ y: -4, scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => void openVideo(video)}
      className="group relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-zinc-950/90 text-left shadow-[0_0_30px_rgba(0,229,255,0.06)] transition hover:border-cyan-300/40"
    >
      <div className={cn('relative overflow-hidden bg-black', variant === 'short' ? 'aspect-[9/16]' : 'aspect-video')}>
        {video.thumbnail_url ? (
          <img src={video.thumbnail_url} alt={video.title} className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
        ) : (
          <video src={video.video_url} muted playsInline preload="metadata" className="h-full w-full object-cover opacity-80 transition duration-700 group-hover:scale-105" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <span className={cn('rounded-full px-3 py-1 text-[8px] font-black uppercase tracking-widest', video.is_short ? 'bg-pink-500 text-white' : 'bg-cyan-300/15 text-cyan-100 border border-cyan-300/25')}>{video.is_short ? 'Short' : 'Video'}</span>
          <span className="rounded-full bg-black/70 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-zinc-300">{video.category}</span>
        </div>
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
          <div className="rounded-full bg-accent p-5 text-white shadow-[0_0_35px_rgba(255,0,80,0.5)]"><Play className="h-6 w-6 fill-current" /></div>
        </div>
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-black/75 px-3 py-1 text-[9px] font-black text-white"><Eye className="h-3.5 w-3.5 text-cyan-300" />{video.view_count || 0}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-black/75 px-3 py-1 text-[9px] font-black text-white"><Clock className="h-3.5 w-3.5 text-pink-300" />{formatDuration(video.duration)}</span>
        </div>
      </div>
      <div className="p-4">
        <h3 className="line-clamp-2 text-sm font-black uppercase tracking-tight text-white">{video.title}</h3>
        <div className="mt-3 flex items-center gap-2">
          {video.user?.avatar_url ? <img src={video.user.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" /> : <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5"><Video className="h-3.5 w-3.5 text-zinc-500" /></div>}
          <div className="min-w-0">
            <p className="truncate text-[10px] font-black uppercase tracking-widest text-zinc-300">{video.user?.display_name || 'Creator'}</p>
            <p className="truncate text-[9px] font-bold uppercase tracking-widest text-zinc-600">@{video.user?.username || 'unknown'}</p>
          </div>
        </div>
      </div>
    </motion.button>
  );

  return (
    <div className="min-h-screen bg-black pb-28 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(255,0,80,0.18),transparent_32%),radial-gradient(circle_at_82%_10%,rgba(0,229,255,0.16),transparent_35%),linear-gradient(180deg,transparent,rgba(0,0,0,0.92))]" />
      <main className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <button onClick={() => navigate('/')} className="mb-5 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white"><ArrowLeft className="h-4 w-4" /> Back to Feed</button>
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-pink-300">YouTube-style Feed Layer</p>
            <h1 className="mt-2 text-4xl font-black uppercase italic tracking-tighter sm:text-6xl">Video Cortex</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">Discover full-length tutorials, reviews, coding sessions, reactions, music drops, art process videos, and vertical shorts posted across the Blood Sweat Code network.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search videos" className="w-full rounded-2xl border border-white/10 bg-zinc-950/80 py-3 pl-11 pr-4 text-sm text-white outline-none focus:border-cyan-300 sm:w-72" />
            </div>
            <select value={category} onChange={(e) => setCategory(e.target.value as VideoCategory)} className="rounded-2xl border border-white/10 bg-zinc-950 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white outline-none focus:border-cyan-300">
              {VIDEO_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
        </header>

        <div className="mb-8 flex flex-wrap gap-2">
          {(['all', 'shorts', 'full'] as const).map((item) => (
            <button key={item} onClick={() => setMode(item)} className={cn('rounded-full border px-4 py-2 text-[10px] font-black uppercase tracking-widest transition', mode === item ? 'border-accent bg-accent text-white shadow-[0_0_18px_rgba(255,0,80,0.35)]' : 'border-white/10 bg-white/5 text-zinc-500 hover:text-white')}>
              {item === 'all' ? 'All Video' : item === 'shorts' ? 'Shorts' : 'Full-Length'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center"><Sparkles className="h-8 w-8 animate-pulse text-accent" /></div>
        ) : (
          <div className="space-y-10">
            {featuredShorts.length > 0 && mode !== 'full' && (
              <section>
                <div className="mb-4 flex items-center gap-2"><Flame className="h-5 w-5 text-pink-400" /><h2 className="text-sm font-black uppercase tracking-[0.25em]">Shorts Pulse</h2></div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                  {featuredShorts.map((video) => renderVideoCard(video, 'short'))}
                </div>
              </section>
            )}

            {featuredFull.length > 0 && mode !== 'shorts' && (
              <section>
                <div className="mb-4 flex items-center gap-2"><Video className="h-5 w-5 text-cyan-300" /><h2 className="text-sm font-black uppercase tracking-[0.25em]">Full Transmissions</h2></div>
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {featuredFull.map((video) => renderVideoCard(video, 'full'))}
                </div>
              </section>
            )}

            {!filteredVideos.length && (
              <div className="rounded-[2rem] border border-dashed border-white/10 bg-zinc-950/60 p-12 text-center">
                <Video className="mx-auto mb-4 h-12 w-12 text-zinc-700" />
                <p className="text-xs font-black uppercase tracking-widest text-zinc-500">No video signals found.</p>
              </div>
            )}
          </div>
        )}
      </main>

      <AnimatePresence>
        {selectedVideo && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 p-4 backdrop-blur-xl" onClick={(e) => { if (e.target === e.currentTarget) setSelectedVideo(null); }}>
            <motion.div initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.94, opacity: 0 }} className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950 shadow-[0_0_80px_rgba(0,0,0,0.7)]">
              <div className="flex items-center justify-between border-b border-white/10 p-4">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-black uppercase tracking-widest text-white">{selectedVideo.title}</h2>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{selectedVideo.category} · {selectedVideo.is_short ? 'Short' : 'Full Video'} · {selectedVideo.view_count + 1} views</p>
                </div>
                <button onClick={() => setSelectedVideo(null)} className="rounded-full p-2 text-zinc-500 hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button>
              </div>
              <div className="bg-black p-3">
                <CustomVideoPlayer src={selectedVideo.video_url} className="max-h-[70vh]" />
              </div>
              {selectedVideo.description && <p className="border-t border-white/10 p-5 text-sm leading-6 text-zinc-300">{selectedVideo.description}</p>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
