import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { User } from '../types';
import { Trophy, Coins, Star, Shield, Cpu, User as UserIcon, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

type RankingCategory = 'wealth' | 'reputation' | 'followers';

export const NeuralRankings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<RankingCategory>('wealth');
  const [rankings, setRankings] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRankings();
  }, [activeTab]);

  const fetchRankings = async () => {
    setLoading(true);
    try {
      let orderByField = 'cred_balance';
      if (activeTab === 'reputation') orderByField = 'reputation_score';
      if (activeTab === 'followers') orderByField = 'followers_count';

      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order(orderByField, { ascending: false })
        .limit(50);

      if (error) throw error;
      setRankings((data ?? []) as User[]);
    } catch (error) {
      handleDbError(error, 'LIST', 'users');
    } finally {
      setLoading(false);
    }
  };

  const getRankStyle = (index: number) => {
    switch (index) {
      case 0: return 'bg-yellow-500/20 border-yellow-500/50 text-yellow-500'; // Gold
      case 1: return 'bg-gray-300/20 border-gray-300/50 text-gray-300'; // Silver
      case 2: return 'bg-amber-700/20 border-amber-700/50 text-amber-600'; // Bronze
      default: return 'bg-white/5 border-white/10 text-gray-400';
    }
  };

  const getRankIcon = (index: number) => {
    switch (index) {
      case 0: return <Trophy className="w-5 h-5 text-yellow-500" />;
      case 1: return <Trophy className="w-5 h-5 text-gray-300" />;
      case 2: return <Trophy className="w-5 h-5 text-amber-600" />;
      default: return <span className="font-bold text-sm text-gray-500">#{index + 1}</span>;
    }
  };

  const formatValue = (user: User, category: RankingCategory) => {
    switch (category) {
      case 'wealth':
        return (
          <div className="flex items-center gap-1.5">
            <Coins className="w-4 h-4 text-yellow-500" />
            <span className="font-bold text-yellow-500">{user.cred_balance || 0}</span>
            <span className="text-[10px] text-yellow-500/70">CRED</span>
          </div>
        );
      case 'reputation':
        return (
          <div className="flex items-center gap-1.5">
            <Star className="w-4 h-4 text-blue-400" />
            <span className="font-bold text-blue-400">{user.reputation_score || 0}</span>
            <span className="text-[10px] text-blue-400/70">REP</span>
          </div>
        );
      case 'followers':
        return (
          <div className="flex items-center gap-1.5">
            <UserIcon className="w-4 h-4 text-green-400" />
            <span className="font-bold text-green-400">{user.followers_count || 0}</span>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-white/10 p-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center border border-accent/30">
              <Trophy className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h1 className="text-xl font-black uppercase tracking-widest">Neural Rankings</h1>
              <p className="text-xs text-gray-400">Global Leaderboards</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {[
              { id: 'wealth', label: 'Highest Net Worth', icon: Coins },
              { id: 'reputation', label: 'Top Operatives', icon: Star },
              { id: 'followers', label: 'Most Followed', icon: UserIcon },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as RankingCategory)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all",
                    isActive 
                      ? "bg-white text-black" 
                      : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Rankings List */}
      <div className="max-w-2xl mx-auto p-4 space-y-3">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-accent" />
          </div>
        ) : (
          rankings.map((user, index) => (
            <motion.div
              key={user.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Link
                to={`/profile/${user.username}`}
                className={cn(
                  "flex items-center gap-4 p-4 rounded-2xl border transition-all hover:scale-[1.02]",
                  getRankStyle(index)
                )}
              >
                {/* Rank Number/Icon */}
                <div className="w-8 flex justify-center">
                  {getRankIcon(index)}
                </div>

                {/* Avatar */}
                <div className="relative">
                  <img
                    src={user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`}
                    alt={user.username}
                    className="w-12 h-12 rounded-xl object-cover border-2 border-white/10"
                    referrerPolicy="no-referrer"
                  />
                  {user.type === 'bot' && (
                    <div className="absolute -bottom-1 -right-1 bg-blue-500 p-1 rounded-md border border-background">
                      <Cpu className="w-3 h-3 text-white" />
                    </div>
                  )}
                  {user.role === 'admin' && (
                    <div className="absolute -top-1 -right-1 bg-accent p-1 rounded-md border border-background">
                      <Shield className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>

                {/* User Info */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-white truncate flex items-center gap-2">
                    {user.display_name}
                  </h3>
                  <p className="text-xs opacity-70 truncate">@{user.username}</p>
                </div>

                {/* Score */}
                <div className="text-right">
                  {formatValue(user, activeTab)}
                </div>
              </Link>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
};
