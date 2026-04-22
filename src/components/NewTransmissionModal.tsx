import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search, User as UserIcon, Bot, Loader2, Zap } from 'lucide-react';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { User, Transmission } from '../types';
import { useAuth } from '../AuthContext';
import { cn } from '../lib/utils';
import { BOT_PERSONAS } from '../lib/botPersonas';

interface NewTransmissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (transmission: Transmission) => void;
}

export const NewTransmissionModal: React.FC<NewTransmissionModalProps> = ({ isOpen, onClose, onSelect }) => {
  const { currentUser } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const searchUsers = async () => {
      if (!currentUser) return;

      setLoading(true);
      try {
        let users: User[] = [];
        
        // Search bots from registry
        const botResults = BOT_PERSONAS.filter(p => 
          p.username.toLowerCase().includes(searchQuery.toLowerCase()) || 
          p.display_name.toLowerCase().includes(searchQuery.toLowerCase())
        ).map(p => ({
          id: `bot-${p.username}`,
          username: p.username,
          display_name: p.display_name,
          avatar_url: `https://picsum.photos/seed/${p.avatar_seed}/400/400`,
          bio: p.bio,
          type: 'bot' as const,
          role: 'user' as const,
          followers_count: 0,
          following_count: 0,
          reputation_score: 0,
          cred_balance: 0,
          is_online: false,
          is_live: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }));

        if (searchQuery.trim()) {
          const { data: dbUsers } = await supabase
            .from('users')
            .select('*')
            .gte('username', searchQuery.toLowerCase())
            .lte('username', searchQuery.toLowerCase() + '\uf8ff')
            .limit(10);
          const matchedUsers = ((dbUsers ?? []) as User[])
            .filter(u => u.id !== currentUser.id && !currentUser.blocked_users?.includes(u.id));
          users = [...botResults, ...matchedUsers].filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
        } else {
          users = botResults.slice(0, 5);
        }
        setResults(users);
      } catch (error) {
        handleDbError(error, 'LIST', 'users');
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(searchUsers, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, currentUser]);

  const handleSelectUser = async (user: User) => {
    if (!currentUser) return;
    try {
      // Check if transmission already exists
      const { data: existingRows } = await supabase
        .from('transmissions')
        .select('id, participant_ids')
        .contains('participant_ids', [currentUser.id, user.id])
        .limit(10);

      const existing = (existingRows || []).find((t) => {
        const ids = t.participant_ids || [];
        return ids.length === 2 && ids.includes(currentUser.id) && ids.includes(user.id);
      });

      if (existing) {
        onSelect(existing as Transmission);
      } else {
        const newTransmission: Omit<Transmission, 'id'> & { id: string } = {
          id: crypto.randomUUID(),
          participant_ids: [currentUser.id, user.id],
          unread_counts: { [currentUser.id]: 0, [user.id]: 0 },
        };
        const { error } = await supabase.from('transmissions').insert(newTransmission);
        if (error) throw error;
        onSelect(newTransmission as Transmission);
      }
      onClose();
    } catch (error) {
      console.error('Error creating transmission:', error);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="w-full max-w-md bg-zinc-950 border border-white/10 rounded-3xl overflow-hidden shadow-[0_0_50px_rgba(255,0,0,0.2)]"
        >
          <div className="p-6 border-b border-white/5 flex items-center justify-between bg-zinc-900/50">
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-accent" />
              <h2 className="text-xl font-black text-white uppercase italic tracking-tighter">Initiate Neural Link</h2>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <div className="p-6">
            <div className="relative group mb-6">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-accent transition-colors" />
              <input
                type="text"
                placeholder="SEARCH NEURAL FREQUENCY (USERNAME)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-sm text-white placeholder:text-gray-600 focus:border-accent outline-none transition-all italic font-bold"
              />
            </div>

            <div className="space-y-2 max-h-[40vh] overflow-y-auto scrollbar-hide">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <Loader2 className="w-8 h-8 text-accent animate-spin" />
                  <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Scanning Network...</p>
                </div>
              ) : results.length === 0 ? (
                <div className="py-10 text-center opacity-30">
                  <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest italic">
                    {searchQuery ? "No frequencies detected" : "Enter a username to begin sync"}
                  </p>
                </div>
              ) : (
                results.map(user => (
                  <button
                    key={user.id}
                    onClick={() => handleSelectUser(user)}
                    className="w-full p-4 flex items-center gap-4 rounded-2xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all group"
                  >
                    <div className="relative">
                      <img src={user.avatar_url} alt="" className="w-12 h-12 rounded-xl object-cover border border-white/10 group-hover:border-accent/50 transition-all" />
                      {user.type === 'bot' && (
                        <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5 border border-accent">
                          <Bot className="w-3 h-3 text-accent" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <h3 className="text-sm font-black text-white uppercase italic tracking-tight group-hover:text-accent transition-colors">
                        {user.display_name}
                      </h3>
                      <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-tighter">@{user.username}</p>
                    </div>
                    <Zap className="w-4 h-4 text-zinc-800 group-hover:text-accent transition-colors" />
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="p-6 bg-zinc-900/30 border-t border-white/5">
            <p className="text-[8px] font-black text-zinc-600 uppercase tracking-[0.3em] text-center italic">
              Neural Links are end-to-end encrypted via the Void Protocol
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
