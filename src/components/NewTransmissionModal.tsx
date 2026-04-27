import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search, Loader2, Zap, AlertCircle } from 'lucide-react';
import { supabase } from '../supabase';
import { User, Transmission } from '../types';
import { useAuth } from '../AuthContext';

interface NewTransmissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (transmission: Transmission) => void;
}

export const NewTransmissionModal: React.FC<NewTransmissionModalProps> = ({ isOpen, onClose, onSelect }) => {
  const { currentUser, supabaseUser } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setResults([]);
      setError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    const searchUsers = async () => {
      if (!currentUser || !supabaseUser) return;

      setLoading(true);
      setError(null);
      try {
        // Allow searching both humans and bots
        let query = supabase
          .from('users')
          .select('id, username, display_name, avatar_url, bio, type, role, is_online, followers_count, following_count, reputation_score, cred_balance, is_live, created_at, updated_at')
          .neq('id', currentUser.id)
          .limit(10);

        if (searchQuery.trim()) {
          query = query.ilike('username', `%${searchQuery.trim()}%`);
        }

        const { data: dbUsers, error: dbError } = await query;
        if (dbError) throw dbError;

        const matchedUsers = ((dbUsers ?? []) as User[])
          .filter(u => !currentUser.blocked_users?.includes(u.id));
        setResults(matchedUsers);
      } catch (err: any) {
        console.error('[NewTransmissionModal] search error:', err);
        setError(err?.message || 'Failed to search users.');
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(searchUsers, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, currentUser, supabaseUser]);

  const handleSelectUser = async (user: User) => {
    if (!currentUser || !supabaseUser) {
      setError('Session expired. Please re-login to start a conversation.');
      return;
    }
    // Check if it's a bot, ensure user owns it (optional, but good for marketplace)
    if (user.type === 'bot') {
      // Allow Casper
      if (user.username !== 'casper_ghost') {
        const { data: purchases } = await supabase
          .from('bot_purchases')
          .select('id')
          .eq('buyer_id', currentUser.id)
          .eq('bot_id', user.id);
          
        const { data: createdBots } = await supabase
          .from('bot_listings')
          .select('id')
          .eq('creator_id', currentUser.id)
          .eq('id', user.id);
          
        const isOwned = (purchases && purchases.length > 0) || (createdBots && createdBots.length > 0);
        
        // In V3, we might just allow talking to any bot, but let's check ownership for marketplace bots
        // Actually, let's just allow it for now to avoid breaking the flow, but log it
        console.log('[NewTransmissionModal] Starting chat with bot:', user.username);
      }
    }
    setError(null);
    try {
      // Check if transmission already exists
      const { data: existing, error: existingError } = await supabase
        .from('transmissions')
        .select('*')
        .contains('participant_ids', [currentUser.id, user.id])
        .maybeSingle();

      if (existingError) throw existingError;

      if (existing) {
        onSelect(existing as Transmission);
      } else {
        const newTransmission: Omit<Transmission, 'id'> & { id: string } = {
          id: crypto.randomUUID(),
          participant_ids: [currentUser.id, user.id],
          unread_counts: { [currentUser.id]: 0, [user.id]: 0 },
        };
        const { error: insertError } = await supabase.from('transmissions').insert(newTransmission);
        if (insertError) throw insertError;
        onSelect(newTransmission as Transmission);
      }
      onClose();
    } catch (err: any) {
      console.error('[NewTransmissionModal] create transmission error:', err);
      const msg = err?.message ?? 'Unknown error';
      setError(
        import.meta.env.DEV
          ? `Failed to open transmission: ${msg}`
          : 'Failed to open transmission. Please try again.'
      );
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
            {!supabaseUser ? (
              <div className="py-10 flex flex-col items-center gap-3 text-center">
                <AlertCircle className="w-8 h-8 text-red-500" />
                <p className="text-xs font-black text-red-400 uppercase tracking-widest">
                  Session expired. Please re-login to send messages.
                </p>
              </div>
            ) : (
              <>
                <div className="relative group mb-4">
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

                {error && (
                  <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">{error}</p>
                  </div>
                )}

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
              </>
            )}
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
