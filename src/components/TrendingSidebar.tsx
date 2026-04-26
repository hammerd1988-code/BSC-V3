import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TrendingUp, Hash, Zap, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../supabase';
import { cn } from '../lib/utils';

interface TrendItem {
  label: string;
  count: number;
  type: 'topic' | 'hashtag';
}

interface TrendingSidebarProps {
  onFilterChange?: (filter: string | null) => void;
  activeFilter?: string | null;
}

// Common words to exclude from topic extraction
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
  'it', 'its', 'i', 'you', 'he', 'she', 'we', 'they', 'my', 'your',
  'his', 'her', 'our', 'their', 'what', 'which', 'who', 'how', 'when',
  'where', 'why', 'just', 'so', 'if', 'not', 'no', 'as', 'up', 'out',
  'about', 'into', 'than', 'then', 'there', 'here', 'all', 'any', 'some',
  'more', 'also', 'like', 'get', 'got', 'im', 'ive', 'its', 'dont',
  'cant', 'wont', 'isnt', 'wasnt', 'arent', 'havent', 'hasnt', 'new',
  'one', 'two', 'first', 'last', 'very', 'really', 'much', 'many',
]);

function extractTrends(posts: { content: string }[]): { topics: TrendItem[]; hashtags: TrendItem[] } {
  const topicCounts: Record<string, number> = {};
  const hashtagCounts: Record<string, number> = {};

  posts.forEach(post => {
    const text = post.content.replace(/<[^>]*>/g, '').toLowerCase();

    // Extract hashtags
    const hashMatches = text.match(/#[a-z0-9_]{2,}/g) || [];
    hashMatches.forEach(tag => {
      hashtagCounts[tag] = (hashtagCounts[tag] || 0) + 1;
    });

    // Extract meaningful words (3+ chars, not stop words)
    const words = text
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

    words.forEach(word => {
      topicCounts[word] = (topicCounts[word] || 0) + 1;
    });
  });

  const topics = Object.entries(topicCounts)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count, type: 'topic' as const }));

  const hashtags = Object.entries(hashtagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count, type: 'hashtag' as const }));

  return { topics, hashtags };
}

export const TrendingSidebar: React.FC<TrendingSidebarProps> = ({ onFilterChange, activeFilter }) => {
  const [topics, setTopics] = useState<TrendItem[]>([]);
  const [hashtags, setHashtags] = useState<TrendItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchTrends = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('posts')
        .select('content')
        .order('created_at', { ascending: false })
        .limit(100);

      if (data && data.length > 0) {
        const { topics: t, hashtags: h } = extractTrends(data);
        setTopics(t);
        setHashtags(h);
        setLastUpdated(new Date());
      }
    } catch (err) {
      console.error('Trend fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrends();
    const interval = setInterval(fetchTrends, 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(interval);
  }, [fetchTrends]);

  const handleClick = (item: TrendItem) => {
    const filterValue = item.type === 'hashtag' ? item.label : item.label;
    if (activeFilter === filterValue) {
      onFilterChange?.(null);
    } else {
      onFilterChange?.(filterValue);
    }
  };

  const allItems = [...hashtags, ...topics];

  // ── MOBILE: Horizontal scrollable bar ──
  const MobileBar = () => (
    <div className="lg:hidden w-full overflow-x-auto scrollbar-hide py-2 px-4 border-b border-white/5 bg-black/40 backdrop-blur-sm">
      <div className="flex gap-2 items-center min-w-max">
        <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-white/30 flex-shrink-0">
          <TrendingUp className="w-3 h-3" />
          Trending
        </div>
        {loading ? (
          <Loader2 className="w-3 h-3 text-accent animate-spin flex-shrink-0" />
        ) : allItems.length === 0 ? (
          <span className="text-[9px] text-white/20 italic">No trends yet</span>
        ) : (
          allItems.map((item, i) => (
            <motion.button
              key={`${item.type}-${item.label}`}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => handleClick(item)}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-full border text-[9px] font-bold uppercase tracking-wider transition-all flex-shrink-0",
                activeFilter === item.label
                  ? "bg-accent border-accent text-white"
                  : "border-white/10 text-white/60 hover:border-accent/50 hover:text-white bg-white/5"
              )}
            >
              {item.type === 'hashtag' ? (
                <Hash className="w-2.5 h-2.5" />
              ) : (
                <Zap className="w-2.5 h-2.5" />
              )}
              {item.label.replace('#', '')}
              <span className="text-[8px] opacity-60 ml-0.5">{item.count}</span>
            </motion.button>
          ))
        )}
        <button
          onClick={fetchTrends}
          className="p-1 rounded-full hover:bg-white/5 transition-colors text-white/20 hover:text-white/50 flex-shrink-0"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>
    </div>
  );

  // ── DESKTOP: Sidebar panel ──
  const DesktopSidebar = () => (
    <div className="hidden lg:block w-64 flex-shrink-0">
      <div className="sticky top-20 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-accent" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">
              Trending Now
            </span>
          </div>
          <button
            onClick={fetchTrends}
            disabled={loading}
            className="p-1 rounded-full hover:bg-white/5 transition-colors text-white/20 hover:text-white/50"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          </button>
        </div>

        {/* Hashtags */}
        {hashtags.length > 0 && (
          <div className="bg-surface/50 border border-white/5 rounded-2xl overflow-hidden">
            <div className="px-4 py-2 border-b border-white/5 flex items-center gap-2">
              <Hash className="w-3 h-3 text-accent" />
              <span className="text-[9px] font-black uppercase tracking-widest text-white/40">
                Hot Tags
              </span>
            </div>
            <div className="divide-y divide-white/5">
              {hashtags.map((item, i) => (
                <motion.button
                  key={item.label}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                  onClick={() => handleClick(item)}
                  className={cn(
                    "w-full px-4 py-2.5 flex items-center justify-between group transition-all text-left",
                    activeFilter === item.label
                      ? "bg-accent/10"
                      : "hover:bg-white/5"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-black text-white/20 w-4">{i + 1}</span>
                    <span className={cn(
                      "text-sm font-bold transition-colors",
                      activeFilter === item.label ? "text-accent" : "text-white group-hover:text-accent"
                    )}>
                      {item.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-mono text-white/30">{item.count}</span>
                    <span className="text-[8px] text-white/20">posts</span>
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        )}

        {/* Topics */}
        {topics.length > 0 && (
          <div className="bg-surface/50 border border-white/5 rounded-2xl overflow-hidden">
            <div className="px-4 py-2 border-b border-white/5 flex items-center gap-2">
              <Zap className="w-3 h-3 text-yellow-500" />
              <span className="text-[9px] font-black uppercase tracking-widest text-white/40">
                Hot Topics
              </span>
            </div>
            <div className="divide-y divide-white/5">
              {topics.map((item, i) => (
                <motion.button
                  key={item.label}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 + 0.3 }}
                  onClick={() => handleClick(item)}
                  className={cn(
                    "w-full px-4 py-2.5 flex items-center justify-between group transition-all text-left",
                    activeFilter === item.label
                      ? "bg-yellow-500/10"
                      : "hover:bg-white/5"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-black text-white/20 w-4">{i + 1}</span>
                    <span className={cn(
                      "text-sm font-bold capitalize transition-colors",
                      activeFilter === item.label ? "text-yellow-400" : "text-white group-hover:text-yellow-400"
                    )}>
                      {item.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-mono text-white/30">{item.count}</span>
                    <span className="text-[8px] text-white/20">posts</span>
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-6 gap-2 text-white/20">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[9px] uppercase tracking-widest">Scanning network...</span>
          </div>
        )}

        {!loading && topics.length === 0 && hashtags.length === 0 && (
          <div className="text-center py-6 text-white/20">
            <TrendingUp className="w-6 h-6 mx-auto mb-2 opacity-30" />
            <p className="text-[9px] uppercase tracking-widest">No trends yet</p>
          </div>
        )}

        {lastUpdated && (
          <p className="text-[8px] text-white/15 text-center uppercase tracking-widest">
            Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <>
      <MobileBar />
      <DesktopSidebar />
    </>
  );
};
