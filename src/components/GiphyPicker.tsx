import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import { Search, Loader2, TrendingUp, X } from 'lucide-react';

interface GiphyGif {
  id: string;
  title: string;
  images: {
    fixed_height: { url: string; width: string; height: string };
    fixed_height_still: { url: string };
    original: { url: string };
    preview_gif: { url: string };
  };
}

interface GiphyPickerProps {
  onSelect: (gif: { url: string; title: string; width: number; height: number }) => void;
  apiKey?: string;
}

const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';

export const GiphyPicker: React.FC<GiphyPickerProps> = ({ onSelect, apiKey }) => {
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GiphyGif[]>([]);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [mode, setMode] = useState<'trending' | 'search'>('trending');
  const scrollRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const key = apiKey || import.meta.env.VITE_GIPHY_API_KEY;

  const fetchGifs = useCallback(async (searchQuery: string, newOffset: number, append = false) => {
    if (!key) return;
    setLoading(true);
    try {
      const endpoint = searchQuery.trim()
        ? `${GIPHY_BASE}/search?api_key=${key}&q=${encodeURIComponent(searchQuery)}&limit=20&offset=${newOffset}&rating=pg-13&lang=en`
        : `${GIPHY_BASE}/trending?api_key=${key}&limit=20&offset=${newOffset}&rating=pg-13`;

      const res = await fetch(endpoint);
      if (!res.ok) throw new Error('Giphy API error');
      const json = await res.json();
      const results: GiphyGif[] = json.data || [];

      setGifs(prev => append ? [...prev, ...results] : results);
      setHasMore(results.length >= 20);
      setOffset(newOffset + results.length);
      setMode(searchQuery.trim() ? 'search' : 'trending');
    } catch (err) {
      console.warn('[GiphyPicker] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    if (!key) return;
    void fetchGifs('', 0);
  }, [key, fetchGifs]);

  useEffect(() => {
    if (!key) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchGifs(query, 0);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, key, fetchGifs]);

  const handleScroll = () => {
    if (!scrollRef.current || loading || !hasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      void fetchGifs(query, offset, true);
    }
  };

  if (!key) {
    return (
      <div className="p-6 text-center">
        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Giphy Integration</p>
        <p className="text-[9px] text-zinc-600">Add <code className="bg-white/10 px-1 py-0.5 rounded">VITE_GIPHY_API_KEY</code> to enable live GIF search</p>
        <p className="text-[8px] text-zinc-700 mt-2">Get a free key at developers.giphy.com</p>
      </div>
    );
  }

  return (
    <div>
      <div className="px-4 pt-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cyan-400/60" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
            placeholder="SEARCH GIPHY..."
            className="w-full rounded-xl border border-white/10 bg-black/50 py-2.5 pl-9 pr-8 text-[10px] font-black uppercase tracking-[0.2em] text-white outline-none placeholder:text-gray-600 focus:border-cyan-500/50"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <TrendingUp className="h-3 w-3 text-cyan-400/50" />
          <span className="text-[8px] font-black uppercase tracking-[0.3em] text-cyan-400/50">
            {mode === 'trending' ? 'Trending on Giphy' : `Results for "${query}"`}
          </span>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="grid grid-cols-2 gap-1.5 p-3 max-h-64 overflow-y-auto custom-scrollbar md:grid-cols-3"
      >
        {gifs.map(gif => (
          <motion.button
            key={gif.id}
            type="button"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onSelect({
              url: gif.images.fixed_height.url,
              title: gif.title || 'GIF',
              width: parseInt(gif.images.fixed_height.width) || 200,
              height: parseInt(gif.images.fixed_height.height) || 200,
            })}
            className="group overflow-hidden rounded-xl border border-white/5 bg-black/30 transition hover:border-cyan-500/30"
          >
            <img
              src={gif.images.fixed_height.url}
              alt={gif.title}
              loading="lazy"
              className="w-full h-auto object-cover opacity-85 group-hover:opacity-100 transition"
            />
          </motion.button>
        ))}
        {loading && (
          <div className="col-span-full flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
          </div>
        )}
        {!loading && gifs.length === 0 && (
          <div className="col-span-full py-6 text-center text-[9px] font-black uppercase tracking-widest text-zinc-600">
            {query ? 'No GIFs found' : 'Loading trending...'}
          </div>
        )}
      </div>
      <div className="px-4 pb-2 flex justify-center">
        <img src="https://giphy.com/static/img/poweredby_giphy.png" alt="Powered by GIPHY" className="h-4 opacity-40" />
      </div>
    </div>
  );
};
