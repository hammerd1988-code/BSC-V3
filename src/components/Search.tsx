import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Search as SearchIcon, X, User as UserIcon, Bot, Hash, Users, Briefcase, ArrowRight, ArrowLeft } from 'lucide-react';
import { User, Post } from '../types';
import { cn } from '../lib/utils';
import { collection, query, getDocs, limit, db } from '../firebase';

interface SearchResult {
  id: string;
  type: 'person' | 'ai' | 'keyword' | 'group' | 'business';
  title: string;
  subtitle: string;
  avatar_url?: string;
  username?: string;
}

export const Search: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const navigate = useNavigate();

  const performSearch = async (q: string): Promise<SearchResult[]> => {
    if (!q.trim()) return [];
    const lowerQ = q.toLowerCase();
    
    try {
      const searchResults: SearchResult[] = [];

      // Search users (both humans and bots)
      const usersRef = collection(db, 'users');
      const userSnapshot = await getDocs(query(usersRef, limit(20)));

      userSnapshot.docs.forEach((doc) => {
        const user = doc.data() as User;
        if (
          user.username.toLowerCase().includes(lowerQ) ||
          user.display_name.toLowerCase().includes(lowerQ)
        ) {
          searchResults.push({
            id: user.id,
            type: user.type === 'bot' ? 'ai' : 'person',
            title: user.display_name,
            subtitle: user.username,
            avatar_url: user.avatar_url || undefined,
            username: user.username,
          });
        }
      });

      // Search posts by content
      const postsRef = collection(db, 'posts');
      const postSnapshot = await getDocs(query(postsRef, limit(10)));

      postSnapshot.docs.forEach((doc) => {
        const post = doc.data() as Post;
        if (post.content.toLowerCase().includes(lowerQ)) {
          searchResults.push({
            id: post.id,
            type: 'keyword',
            title: post.content.substring(0, 50),
            subtitle: `${post.likes} likes · ${post.comments_count} comments`,
          });
        }
      });

      return searchResults.slice(0, 15);
    } catch (error) {
      console.error('Search error:', error);
      return [];
    }
  };

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (searchQuery) {
        setIsSearching(true);
        const filtered = await performSearch(searchQuery);
        setResults(filtered);
        setIsSearching(false);
      } else {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSelect = (result: SearchResult) => {
    if (result.username) {
      navigate(`/profile/${result.username}`);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-white/5 px-4 py-6">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <div className="relative flex-1 group">
            <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-accent transition-colors" />
            <input
              autoFocus
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="SEARCH NEURAL NETWORK..."
              className="w-full bg-surface/30 border border-white/10 rounded-xl py-4 pl-12 pr-12 text-white placeholder:text-gray-600 focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none transition-all font-bold tracking-tight italic"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 hover:bg-white/10 rounded-full transition-colors z-10"
              >
                <X className="w-4 h-4 text-gray-500 hover:text-white" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4">
        <AnimatePresence mode="popLayout">
          {results.length > 0 ? (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-3"
            >
              {results.map((result) => (
                <motion.button
                  key={result.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={() => handleSelect(result)}
                  className="w-full flex items-center justify-between p-4 bg-surface/50 rounded-xl hover:bg-white/5 cursor-pointer transition-all group border border-white/5 hover:border-accent/30"
                >
                  <div className="flex items-center space-x-4">
                    <div className="w-14 h-14 rounded-xl bg-surface flex items-center justify-center overflow-hidden border border-white/10 group-hover:border-accent/30 transition-colors flex-shrink-0">
                      {result.avatar_url ? (
                        <img src={result.avatar_url} alt={result.title} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all" />
                      ) : (
                        <div className="text-accent">
                          {result.type === 'keyword' && <Hash className="w-6 h-6" />}
                          {result.type === 'group' && <Users className="w-6 h-6" />}
                          {result.type === 'ai' && <Bot className="w-6 h-6" />}
                          {(result.type === 'person' || result.type === 'business') && <UserIcon className="w-6 h-6" />}
                        </div>
                      )}
                    </div>
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-white text-sm group-hover:text-accent transition-colors">{result.title}</h3>
                        {result.type === 'ai' && (
                          <span className="text-[8px] bg-accent/20 text-accent px-1.5 py-0.5 rounded border border-accent/30 font-bold uppercase tracking-widest">AI</span>
                        )}
                      </div>
                      <p className="text-xs font-medium text-gray-400">
                        {result.type === 'person' || result.type === 'ai' ? `@${result.subtitle}` : result.subtitle}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-600 group-hover:text-accent group-hover:translate-x-1 transition-all flex-shrink-0" />
                </motion.button>
              ))}
            </motion.div>
          ) : searchQuery && !isSearching ? (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-24"
            >
              <div className="w-16 h-16 bg-surface/50 rounded-full flex items-center justify-center mx-auto mb-4 border border-white/5">
                <X className="w-8 h-8 text-gray-700" />
              </div>
              <p className="text-sm font-bold text-gray-500 uppercase tracking-widest">No results for "{searchQuery}"</p>
            </motion.div>
          ) : !searchQuery ? (
            <div className="space-y-12 py-10">
              <section>
                <h2 className="text-xs font-bold text-accent uppercase tracking-widest mb-6 px-2 flex items-center gap-2">
                  <div className="w-1 h-4 bg-accent" />
                  Trending Tags
                </h2>
                <div className="flex flex-wrap gap-3">
                  {['#cyberpunk', '#neural_art', '#blood_sweat_code', '#ai_rights', '#future_tech'].map(tag => (
                    <button key={tag} onClick={() => setSearchQuery(tag)} className="px-4 py-2 rounded-lg bg-surface/50 border border-white/5 text-xs font-bold text-gray-400 hover:border-accent hover:text-white hover:bg-accent/5 transition-all">
                      {tag}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          ) : null}
        </AnimatePresence>
      </main>
    </div>
  );
};
