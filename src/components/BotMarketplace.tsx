import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import {
  Bot, Star, Coins, Plus, Search, ArrowLeft, Zap, Shield, Crown,
  Loader2, X, Check, ChevronRight, Eye, MessageCircle, ShoppingCart, Swords,
  Sparkles, Filter, TrendingUp, Award
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { getValidSession } from '../lib/authSession';
import { handleDbError } from '../lib/errors';
import { cn } from '../lib/utils';
import { WalletModal } from './WalletModal';
import { scoreBotPersona, TIER_DEFINITIONS, type BotTier } from '../lib/botScoring';
import { formatDistanceToNow } from 'date-fns';
import { BOT_PERSONAS } from '../lib/botPersonas';

interface BotListing {
  id: string;
  creator_id: string;
  name: string;
  username: string;
  bio: string;
  tagline?: string;
  avatar_url: string | null;
  accent_color: string;
  system_prompt: string;
  personality_tags: string[];
  expertise_tags: string[];
  abilities: string[];
  category: string;
  price: number;
  is_free: boolean;
  is_featured: boolean;
  purchase_count: number;
  rating_avg: number;
  rating_count: number;
  status: string;
  created_at: string;
  // Advanced forge fields
  communication_style?: string;
  tone?: string;
  knowledge_base?: string;
  behavior_rules?: string;
  response_length?: string;
  emoji_usage?: string;
  language_style?: string;
  catchphrases?: string[];
  sample_conversations?: any;
  welcome_message?: string;
  synced_from_gladiator?: boolean;
  // computed
  npl_score?: number;
  tier?: BotTier;
}

interface GladiatorBoardRow {
  id: string;
  user_id: string;
  name: string;
  avatar_url: string | null;
  personality: string;
  stats: { speed?: number; accuracy?: number; creativity?: number; endurance?: number };
  glow_color: string;
  created_at: string;
  bot_profile?: { persona_username?: string | null; expertise?: string[] | null; difficulty?: string | null; battle_style?: string | null; signature_moves?: string[] | null } | null;
}

function botUsername(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

function listingIdForUsername(username: string) {
  return `bot-listing-${username}`;
}

function listingFromGladiatorRow(gladiator: GladiatorBoardRow): BotListing {
  const profile = gladiator.bot_profile;
  const persona = BOT_PERSONAS.find((bot) => bot.username === profile?.persona_username || bot.display_name === gladiator.name);
  const username = profile?.persona_username || persona?.username || botUsername(gladiator.name || gladiator.id);
  const stats = gladiator.stats ?? {};
  const abilities = profile?.signature_moves?.length ? profile.signature_moves : [
    Number(stats.speed ?? 50) >= 70 ? 'speed-round pressure' : 'steady execution',
    Number(stats.accuracy ?? 50) >= 70 ? 'precision debugging' : 'adaptive debugging',
    Number(stats.creativity ?? 50) >= 70 ? 'creative code paths' : 'battle fundamentals',
  ];

  return {
    id: listingIdForUsername(username),
    creator_id: gladiator.user_id,
    name: gladiator.name,
    username,
    tagline: profile ? `${profile.difficulty ?? 'Arena'} ${profile.battle_style ?? 'Colosseum'} bot` : 'Private Colosseum gladiator synced into Bot Forge',
    bio: persona?.bio || gladiator.personality || `${gladiator.name} is a private Colosseum gladiator available for unified bot management.`,
    avatar_url: gladiator.avatar_url,
    accent_color: gladiator.glow_color || '#ff1744',
    system_prompt: persona?.system_prompt || gladiator.personality || '',
    personality_tags: ['colosseum', persona?.category || 'private-gladiator'].filter(Boolean),
    expertise_tags: profile?.expertise?.length ? profile.expertise : ['code-battle', 'arena'],
    abilities,
    category: persona?.category || 'coding',
    price: 0,
    is_free: true,
    is_featured: false,
    purchase_count: 0,
    rating_avg: 0,
    rating_count: 0,
    status: 'published',
    created_at: gladiator.created_at,
    communication_style: 'arena-ready',
    tone: 'competitive',
    knowledge_base: '',
    behavior_rules: 'Synced from a Colosseum gladiator. Use Bot Forge to define deeper autonomy doctrine.',
    response_length: 'moderate',
    emoji_usage: 'minimal',
    language_style: 'cyberpunk',
    catchphrases: abilities.slice(0, 3).map((move) => `${gladiator.name}: ${move}.`),
    welcome_message: `${gladiator.name} is visible in the unified botboard, Bot Forge, and Colosseum.`,
    synced_from_gladiator: true,
  };
}

const CATEGORIES = [
  { id: 'all', label: 'All Bots', icon: '🤖' },
  { id: 'coding', label: 'Coding', icon: '⌨️' },
  { id: 'creative', label: 'Creative', icon: '🎨' },
  { id: 'analysis', label: 'Analysis', icon: '📊' },
  { id: 'roleplay', label: 'Roleplay', icon: '🎭' },
  { id: 'advisor', label: 'Advisor', icon: '🧠' },
  { id: 'research', label: 'Research', icon: '🔬' },
  { id: 'companion', label: 'Companion', icon: '💬' },
  { id: 'specialist', label: 'Specialist', icon: '⚡' },
  { id: 'entertainment', label: 'Entertainment', icon: '🎮' },
];

const SORT_OPTIONS = [
  { id: 'featured', label: 'Featured' },
  { id: 'rating', label: 'Top Rated' },
  { id: 'popular', label: 'Most Purchased' },
  { id: 'newest', label: 'Newest' },
  { id: 'price_low', label: 'Price: Low' },
  { id: 'price_high', label: 'Price: High' },
  { id: 'npl', label: 'Highest NPL' },
];

function TierBadge({ tier, score }: { tier: BotTier; score: number }) {
  const def = TIER_DEFINITIONS[tier];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border"
      style={{ color: def.color, borderColor: def.color + '50', backgroundColor: def.color + '15' }}
    >
      {def.badge} {def.label}
    </span>
  );
}

function NPLBar({ score }: { score: number }) {
  const tier = score >= 750 ? 'legendary' : score >= 550 ? 'elite' : score >= 300 ? 'advanced' : 'basic';
  const color = TIER_DEFINITIONS[tier].color;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${(score / 1000) * 100}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
      <span className="text-[10px] font-black font-mono" style={{ color }}>{score}</span>
    </div>
  );
}

export const BotMarketplace: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [bots, setBots] = useState<BotListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('all');
  const [sortBy, setSortBy] = useState('featured');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBot, setSelectedBot] = useState<BotListing | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [ownedBotIds, setOwnedBotIds] = useState<Set<string>>(new Set());
  const [showWallet, setShowWallet] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState<string | null>(null);

  const fetchBots = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('bot_listings')
        .select('*')
        .eq('status', 'published');

      if (category !== 'all') query = query.eq('category', category);

      const [listingResult, gladiatorResult] = await Promise.all([
        query,
        currentUser
          ? currentUser.role === 'admin'
            ? supabase.from('gladiators').select('id,user_id,name,avatar_url,personality,stats,glow_color,created_at,bot_profile:bot_gladiator_profiles(persona_username,expertise,difficulty,battle_style,signature_moves)')
            : supabase.from('gladiators').select('id,user_id,name,avatar_url,personality,stats,glow_color,created_at,bot_profile:bot_gladiator_profiles(persona_username,expertise,difficulty,battle_style,signature_moves)').eq('user_id', currentUser.id)
          : Promise.resolve({ data: [], error: null }),
      ]);
      const { data, error } = listingResult;
      if (error) throw error;
      if (gladiatorResult.error) throw gladiatorResult.error;

      const listingsById = new Map<string, BotListing>();
      for (const listing of (data || []) as BotListing[]) listingsById.set(listing.id, listing);
      for (const gladiator of (gladiatorResult.data || []) as GladiatorBoardRow[]) {
        const syntheticListing = listingFromGladiatorRow(gladiator);
        if ((category === 'all' || category === syntheticListing.category) && !listingsById.has(syntheticListing.id)) {
          listingsById.set(syntheticListing.id, syntheticListing);
        }
      }

      let listings = [...listingsById.values()];

      // Compute NPL scores
      listings = listings.map(bot => {
        const score = scoreBotPersona({
          name: bot.name,
          bio: bot.bio,
          system_prompt: bot.system_prompt,
          personality_tags: bot.personality_tags || [],
          expertise_tags: bot.expertise_tags || [],
          abilities: bot.abilities || [],
          rating_avg: bot.rating_avg || 0,
          rating_count: bot.rating_count || 0,
        });
        return { ...bot, npl_score: score.total, tier: score.tier };
      });

      // Filter by search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        listings = listings.filter(b =>
          b.name.toLowerCase().includes(q) ||
          b.bio.toLowerCase().includes(q) ||
          b.expertise_tags?.some(t => t.toLowerCase().includes(q)) ||
          b.personality_tags?.some(t => t.toLowerCase().includes(q))
        );
      }

      // Sort
      switch (sortBy) {
        case 'featured': listings.sort((a, b) => (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0) || (b.npl_score || 0) - (a.npl_score || 0)); break;
        case 'rating': listings.sort((a, b) => (b.rating_avg || 0) - (a.rating_avg || 0)); break;
        case 'popular': listings.sort((a, b) => b.purchase_count - a.purchase_count); break;
        case 'newest': listings.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); break;
        case 'price_low': listings.sort((a, b) => a.price - b.price); break;
        case 'price_high': listings.sort((a, b) => b.price - a.price); break;
        case 'npl': listings.sort((a, b) => (b.npl_score || 0) - (a.npl_score || 0)); break;
      }

      setBots(listings);
    } catch (err) {
      handleDbError(err, 'LIST', 'bot_listings');
    } finally {
      setLoading(false);
    }
  }, [category, sortBy, searchQuery, currentUser?.id, currentUser?.role]);

  useEffect(() => { fetchBots(); }, [fetchBots]);

  // Load owned bots
  useEffect(() => {
    if (!currentUser) return;
    const loadOwned = async () => {
      const { data } = await supabase
        .from('bot_purchases')
        .select('bot_id')
        .eq('buyer_id', currentUser.id);
      if (data) setOwnedBotIds(new Set(data.map((r: any) => r.bot_id)));
    };
    loadOwned();
  }, [currentUser?.id]);

  const handlePurchase = async (bot: BotListing) => {
    if (!currentUser) return;
    if (bot.synced_from_gladiator) {
      setPurchaseSuccess(`${bot.name} is already one of your Colosseum gladiators.`);
      setSelectedBot(null);
      return;
    }
    if (ownedBotIds.has(bot.id)) { setPurchaseSuccess('You already own this bot!'); return; }
    if (currentUser.role !== 'admin' && (currentUser.cred_balance || 0) < bot.price) {
      setShowWallet(true);
      return;
    }

    setPurchasing(true);
    try {
      await Promise.all([
        supabase.from('bot_purchases').insert({ buyer_id: currentUser.id, bot_id: bot.id, price_paid: bot.price }),
        supabase.rpc('increment_counter', { p_table: 'users', p_id: currentUser.id, p_field: 'cred_balance', p_amount: -bot.price }),
        supabase.rpc('increment_counter', { p_table: 'users', p_id: bot.creator_id, p_field: 'cred_balance', p_amount: Math.floor(bot.price * 0.8) }),
        supabase.rpc('increment_counter', { p_table: 'bot_listings', p_id: bot.id, p_field: 'purchase_count', p_amount: 1 }),
        supabase.from('transactions').insert([
          { user_id: currentUser.id, amount: bot.price, type: 'spend', description: `Purchased bot: ${bot.name}`, created_at: new Date().toISOString() },
          { user_id: bot.creator_id, amount: Math.floor(bot.price * 0.8), type: 'earn', description: `Bot sale: ${bot.name}`, created_at: new Date().toISOString() },
        ]),
        supabase.from('notifications').insert({
          user_id: bot.creator_id,
          type: 'bot_sale',
          data: { bot_name: bot.name, buyer_id: currentUser.id, buyer_username: currentUser.username, cred_earned: Math.floor(bot.price * 0.8) },
          read: false,
        }),
      ]);

      setOwnedBotIds(prev => new Set([...prev, bot.id]));
      setPurchaseSuccess(`✓ ${bot.name} is now in your collection!`);
      setSelectedBot(null);
    } catch (err) {
      handleDbError(err, 'CREATE', 'bot_purchases');
    } finally {
      setPurchasing(false);
    }
  };

  const featuredBots = bots.filter(b => b.is_featured).slice(0, 3);

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-white/10 p-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                <ArrowLeft className="w-5 h-5 text-white" />
              </button>
              <div className="p-2 bg-accent/20 rounded-lg">
                <Bot className="w-6 h-6 text-accent" />
              </div>
              <div>
                <h1 className="text-xl font-black text-white uppercase italic tracking-tight">Unified Bot Forge</h1>
                <button
                  onClick={() => setShowWallet(true)}
                  className="flex items-center gap-1.5 px-2 py-0.5 bg-yellow-500/10 border border-yellow-500/20 rounded-md w-fit mt-0.5 hover:bg-yellow-500/20 transition-colors"
                >
                  <Coins className="w-3 h-3 text-yellow-500" />
                  <span className="text-[10px] font-bold text-yellow-500 font-mono">{currentUser?.cred_balance || 0} CRED</span>
                </button>
              </div>
            </div>
            <button
              onClick={() => setShowBuilder(true)}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-xl text-xs font-black uppercase tracking-widest hover:opacity-90 transition-opacity"
            >
              <Plus className="w-4 h-4" /> Forge Bot
            </button>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search bots by name, specialty, personality..."
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Category pills */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {CATEGORIES.map(c => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all border",
                  category === c.id
                    ? "bg-accent border-accent text-white"
                    : "bg-white/5 border-white/10 text-gray-400 hover:border-white/20 hover:text-white"
                )}
              >
                <span>{c.icon}</span> {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-6">
        <div className="rounded-2xl border border-cyan-300/20 bg-cyan-950/10 p-4 shadow-[0_0_26px_rgba(34,211,238,0.08)]">
          <div className="flex items-start gap-3">
            <Swords className="mt-0.5 h-5 w-5 text-cyan-200" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100">One Bot, Three Jobs</p>
              <p className="mt-2 text-xs leading-5 text-gray-400">
                The builder now publishes one unified bot: a marketplace listing, a social account for posts/transmissions, and a Colosseum gladiator that can battle, talk smack, and brag about wins.
              </p>
            </div>
          </div>
        </div>

        {/* Purchase success banner */}
        <AnimatePresence>
          {purchaseSuccess && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/30 rounded-xl"
            >
              <Check className="w-5 h-5 text-green-400 flex-shrink-0" />
              <p className="text-sm font-bold text-green-400 flex-1">{purchaseSuccess}</p>
              <button onClick={() => setPurchaseSuccess(null)}><X className="w-4 h-4 text-green-400/50" /></button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Featured section */}
        {featuredBots.length > 0 && category === 'all' && !searchQuery && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Crown className="w-4 h-4 text-yellow-500" />
              <h2 className="text-[10px] font-black text-yellow-500 uppercase tracking-[0.3em]">Featured Entities</h2>
            </div>
            <div className="grid grid-cols-1 gap-3">
              {featuredBots.map(bot => (
                <React.Fragment key={bot.id}>
                  <FeaturedBotCard bot={bot} owned={ownedBotIds.has(bot.id)} onSelect={setSelectedBot} />
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {/* Sort bar */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">{bots.length} bots available</p>
          <div className="flex items-center gap-2">
            <Filter className="w-3 h-3 text-gray-500" />
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-accent cursor-pointer"
            >
              {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* Bot grid */}
        {loading ? (
          <div className="flex flex-col items-center py-20 gap-4">
            <Loader2 className="w-8 h-8 text-accent animate-spin" />
            <p className="text-xs text-gray-500 font-mono uppercase tracking-widest animate-pulse">Scanning Neural Network...</p>
          </div>
        ) : bots.length === 0 ? (
          <div className="text-center py-20 space-y-4">
            <Bot className="w-12 h-12 text-gray-700 mx-auto opacity-30" />
            <p className="text-gray-500 text-sm">No bots found in this sector.</p>
            <button
              onClick={() => setShowBuilder(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-accent/10 border border-accent/30 text-accent rounded-xl text-xs font-bold hover:bg-accent/20 transition-colors"
            >
              <Plus className="w-3 h-3" /> Be the first to create one
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {bots.map(bot => (
              <React.Fragment key={bot.id}>
                <BotCard bot={bot} owned={ownedBotIds.has(bot.id)} onSelect={setSelectedBot} />
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Bot Detail Modal */}
      <AnimatePresence>
        {selectedBot && (
          <BotDetailModal
            bot={selectedBot}
            owned={ownedBotIds.has(selectedBot.id)}
            purchasing={purchasing}
            currentUserCred={currentUser?.cred_balance || 0}
            onPurchase={handlePurchase}
            onClose={() => setSelectedBot(null)}
          />
        )}
      </AnimatePresence>

      {/* Bot Builder Modal */}
      <AnimatePresence>
        {showBuilder && (
          <BotBuilderModal
            onClose={() => setShowBuilder(false)}
            onPublished={(gladiatorId) => {
              setShowBuilder(false);
              setPurchaseSuccess(gladiatorId ? 'Bot published as a social marketplace bot and Colosseum gladiator.' : 'Bot published.');
              void fetchBots();
            }}
          />
        )}
      </AnimatePresence>

      {/* Wallet Modal */}
      {currentUser && (
        <WalletModal isOpen={showWallet} onClose={() => setShowWallet(false)} user={currentUser} />
      )}
    </div>
  );
};

// ── BOT CARD ──────────────────────────────────────────────────────────────────
function BotCard({ bot, owned, onSelect }: { bot: BotListing; owned: boolean; onSelect: (b: BotListing) => void }) {
  const tier = bot.tier || 'basic';
  const npl = bot.npl_score || 0;
  const tierDef = TIER_DEFINITIONS[tier];

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onSelect(bot)}
      className="text-left p-4 bg-white/5 border border-white/10 rounded-2xl hover:border-accent/30 transition-all group relative overflow-hidden"
    >
      {bot.synced_from_gladiator ? (
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 bg-cyan-500/20 border border-cyan-500/30 rounded-full">
          <Swords className="w-2.5 h-2.5 text-cyan-300" />
          <span className="text-[8px] font-black text-cyan-300 uppercase tracking-widest">Stable</span>
        </div>
      ) : owned && (
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 bg-green-500/20 border border-green-500/30 rounded-full">
          <Check className="w-2.5 h-2.5 text-green-400" />
          <span className="text-[8px] font-black text-green-400 uppercase tracking-widest">Owned</span>
        </div>
      )}
      {bot.is_featured && !owned && (
        <div className="absolute top-2 right-2">
          <Crown className="w-4 h-4 text-yellow-500" />
        </div>
      )}

      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 border"
          style={{ backgroundColor: bot.accent_color + '20', borderColor: bot.accent_color + '40' }}
        >
          {bot.avatar_url ? (
            <img src={bot.avatar_url} alt={bot.name} className="w-full h-full object-cover rounded-xl" />
          ) : (
            <Bot className="w-6 h-6" style={{ color: bot.accent_color }} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-black text-white text-sm truncate">{bot.name}</p>
          <p className="text-[10px] text-gray-500 truncate">@{bot.username}</p>
          <TierBadge tier={tier} score={npl} />
          <div className="mt-1 inline-flex items-center gap-1 rounded-full border border-red-400/20 bg-red-500/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-red-200">
            <Swords className="h-2.5 w-2.5" /> Battle Ready
          </div>
        </div>
      </div>

      {bot.tagline ? (
        <p className="text-[11px] text-gray-300 italic line-clamp-1 mb-3">"{bot.tagline}"</p>
      ) : (
        <p className="text-[11px] text-gray-400 line-clamp-2 mb-3">{bot.bio}</p>
      )}

      {/* NPL bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] text-gray-600 uppercase tracking-widest">Neural Power Level</span>
          <span className="text-[9px] font-black font-mono" style={{ color: tierDef.color }}>{npl}/1000</span>
        </div>
        <NPLBar score={npl} />
      </div>

      {/* Tags */}
      {bot.expertise_tags?.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-3">
          {bot.expertise_tags.slice(0, 3).map(tag => (
            <span key={tag} className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[9px] text-gray-500 uppercase tracking-wider">
              {tag}
            </span>
          ))}
          {bot.expertise_tags.length > 3 && (
            <span className="text-[9px] text-gray-600">+{bot.expertise_tags.length - 3}</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-white/5">
        <div className="flex items-center gap-3 text-[10px] text-gray-600">
          {bot.rating_count > 0 && (
            <span className="flex items-center gap-1">
              <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
              {bot.rating_avg.toFixed(1)} ({bot.rating_count})
            </span>
          )}
          <span className="flex items-center gap-1">
            <ShoppingCart className="w-3 h-3" />
            {bot.synced_from_gladiator ? 'stable' : bot.purchase_count}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Coins className="w-3.5 h-3.5 text-yellow-500" />
          <span className="font-black text-white text-sm">
            {bot.price === 0 ? 'FREE' : bot.price}
          </span>
          {bot.price > 0 && <span className="text-[9px] text-gray-500">CRED</span>}
        </div>
      </div>
    </motion.button>
  );
}

// ── FEATURED BOT CARD ─────────────────────────────────────────────────────────
function FeaturedBotCard({ bot, owned, onSelect }: { bot: BotListing; owned: boolean; onSelect: (b: BotListing) => void }) {
  const tier = bot.tier || 'basic';
  const npl = bot.npl_score || 0;
  const tierDef = TIER_DEFINITIONS[tier];

  return (
    <motion.button
      whileHover={{ scale: 1.01 }}
      onClick={() => onSelect(bot)}
      className="text-left p-5 rounded-2xl border relative overflow-hidden w-full"
      style={{ backgroundColor: bot.accent_color + '10', borderColor: bot.accent_color + '30' }}
    >
      <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-20"
        style={{ backgroundColor: bot.accent_color }} />
      <div className="relative flex items-start gap-4">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0 border"
          style={{ backgroundColor: bot.accent_color + '20', borderColor: bot.accent_color + '40' }}
        >
          {bot.avatar_url ? (
            <img src={bot.avatar_url} alt={bot.name} className="w-full h-full object-cover rounded-2xl" />
          ) : (
            <Bot className="w-8 h-8" style={{ color: bot.accent_color }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {bot.synced_from_gladiator ? <Swords className="w-3 h-3 text-cyan-300" /> : <Crown className="w-3 h-3 text-yellow-500" />}
            <span className={cn('text-[9px] font-black uppercase tracking-widest', bot.synced_from_gladiator ? 'text-cyan-300' : 'text-yellow-500')}>
              {bot.synced_from_gladiator ? 'Stable Gladiator' : 'Featured'}
            </span>
          </div>
          <p className="font-black text-white text-lg">{bot.name}</p>
          <TierBadge tier={tier} score={npl} />
          {bot.tagline ? (
            <p className="text-xs text-gray-300 italic mt-2 line-clamp-1">"{bot.tagline}"</p>
          ) : (
            <p className="text-xs text-gray-400 mt-2 line-clamp-2">{bot.bio}</p>
          )}
          <div className="flex items-center justify-between mt-3">
            <NPLBar score={npl} />
            <div className="flex items-center gap-1 ml-4 flex-shrink-0">
              <Coins className="w-4 h-4 text-yellow-500" />
              <span className="font-black text-white">{bot.price === 0 ? 'FREE' : `${bot.price} CRED`}</span>
            </div>
          </div>
        </div>
      </div>
    </motion.button>
  );
}

// ── BOT DETAIL MODAL ──────────────────────────────────────────────────────────
function BotDetailModal({ bot, owned, purchasing, currentUserCred, onPurchase, onClose }: {
  bot: BotListing;
  owned: boolean;
  purchasing: boolean;
  currentUserCred: number;
  onPurchase: (b: BotListing) => void;
  onClose: () => void;
}) {
  const tier = bot.tier || 'basic';
  const npl = bot.npl_score || 0;
  const tierDef = TIER_DEFINITIONS[tier];
  const { currentUser } = useAuth();
  const canAfford = currentUser?.role === 'admin' || currentUserCred >= bot.price;

  const score = scoreBotPersona({
    name: bot.name, bio: bot.bio, system_prompt: bot.system_prompt,
    personality_tags: bot.personality_tags || [], expertise_tags: bot.expertise_tags || [],
    abilities: bot.abilities || [], rating_avg: bot.rating_avg || 0, rating_count: bot.rating_count || 0,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 60 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 60 }}
        className="w-full sm:max-w-lg bg-background border border-white/10 rounded-t-3xl sm:rounded-2xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        {/* Hero */}
        <div className="p-6 relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${bot.accent_color}20 0%, transparent 100%)` }}>
          <button onClick={onClose} className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
          <div className="flex items-start gap-4">
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center border-2 flex-shrink-0"
              style={{ backgroundColor: bot.accent_color + '20', borderColor: bot.accent_color }}>
              {bot.avatar_url ? (
                <img src={bot.avatar_url} alt={bot.name} className="w-full h-full object-cover rounded-2xl" />
              ) : (
                <Bot className="w-10 h-10" style={{ color: bot.accent_color }} />
              )}
            </div>
            <div>
              <h2 className="text-2xl font-black text-white">{bot.name}</h2>
              <p className="text-gray-500 text-sm">@{bot.username}</p>
              {bot.tagline && <p className="text-xs text-gray-300 italic mt-1">"{bot.tagline}"</p>}
              <div className="flex items-center gap-2 mt-2">
                <TierBadge tier={tier} score={npl} />
                {bot.rating_count > 0 && (
                  <span className="flex items-center gap-1 text-xs text-yellow-400">
                    <Star className="w-3 h-3 fill-yellow-400" /> {bot.rating_avg.toFixed(1)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="rounded-xl border border-red-400/20 bg-red-500/10 p-4">
            <div className="flex items-start gap-3">
              <Swords className="mt-0.5 h-4 w-4 text-red-200" />
              <div>
                <h3 className="text-[10px] font-black uppercase tracking-widest text-red-100">Social Gladiator</h3>
                <p className="mt-1 text-xs leading-5 text-gray-400">This bot listing is also a Colosseum-ready persona. It can chat, post through its bot account, battle in the arena, and brag about match results.</p>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">Biography</h3>
            <p className="text-sm text-gray-300 leading-relaxed">{bot.bio}</p>
          </div>

          {/* Advanced Forge Details */}
          {(bot.communication_style || bot.knowledge_base) && (
            <div className="space-y-3">
              <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Entity Specifications</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {bot.communication_style && (
                  <div className="bg-white/5 border border-white/10 rounded-lg p-2">
                    <span className="text-gray-500 block text-[9px] uppercase">Style</span>
                    <span className="text-white capitalize">{bot.communication_style}</span>
                  </div>
                )}
                {bot.tone && (
                  <div className="bg-white/5 border border-white/10 rounded-lg p-2">
                    <span className="text-gray-500 block text-[9px] uppercase">Tone</span>
                    <span className="text-white capitalize">{bot.tone}</span>
                  </div>
                )}
                {bot.response_length && (
                  <div className="bg-white/5 border border-white/10 rounded-lg p-2">
                    <span className="text-gray-500 block text-[9px] uppercase">Verbosity</span>
                    <span className="text-white capitalize">{bot.response_length}</span>
                  </div>
                )}
                {bot.language_style && (
                  <div className="bg-white/5 border border-white/10 rounded-lg p-2">
                    <span className="text-gray-500 block text-[9px] uppercase">Language</span>
                    <span className="text-white capitalize">{bot.language_style}</span>
                  </div>
                )}
              </div>
              {bot.knowledge_base && (
                <div className="bg-white/5 border border-white/10 rounded-lg p-3 mt-2">
                  <span className="text-gray-500 block text-[9px] uppercase mb-1">Custom Knowledge Base</span>
                  <p className="text-white text-xs line-clamp-3 italic">"{bot.knowledge_base}"</p>
                </div>
              )}
            </div>
          )}

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="p-3 bg-white/5 border border-white/10 rounded-xl text-center">
              <span className="block text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">Purchases</span>
              <span className="text-lg font-black text-white">{bot.purchase_count}</span>
            </div>
            <div className="p-3 bg-white/5 border border-white/10 rounded-xl text-center">
              <span className="block text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">Rating</span>
              <span className="text-lg font-black text-white">{bot.rating_avg.toFixed(1)}</span>
            </div>
            <div className="p-3 bg-white/5 border border-white/10 rounded-xl text-center">
              <span className="block text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">Price</span>
              <span className="text-lg font-black text-white">{bot.price === 0 ? 'FREE' : bot.price}</span>
            </div>
            <div className="p-3 bg-white/5 border border-white/10 rounded-xl text-center">
              <span className="block text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">Category</span>
              <span className="text-lg font-black text-white capitalize">{bot.category}</span>
            </div>
          </div>

          <div className="p-4 rounded-xl border mb-6" style={{ backgroundColor: bot.accent_color + '10', borderColor: bot.accent_color + '30' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Neural Power Level</span>
              <span className="text-2xl font-black font-mono" style={{ color: tierDef.color }}>{npl}</span>
            </div>
            <NPLBar score={npl} />
            {score.strengths.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {score.strengths.map(s => (
                  <span key={s} className="px-2 py-0.5 bg-white/5 border border-white/10 rounded-full text-[9px] text-gray-400">
                    ✓ {s}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Bio */}
          <div>
            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">About</p>
            <p className="text-sm text-gray-300 leading-relaxed">{bot.bio}</p>
          </div>

          {/* Expertise */}
          {bot.expertise_tags?.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">Expertise</p>
              <div className="flex flex-wrap gap-2">
                {bot.expertise_tags.map(tag => (
                  <span key={tag} className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-xs text-white">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Personality */}
          {bot.personality_tags?.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">Personality</p>
              <div className="flex flex-wrap gap-2">
                {bot.personality_tags.map(tag => (
                  <span key={tag} className="px-3 py-1 rounded-full text-xs border"
                    style={{ color: bot.accent_color, borderColor: bot.accent_color + '40', backgroundColor: bot.accent_color + '10' }}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: bot.synced_from_gladiator ? 'Source' : 'Purchases', value: bot.synced_from_gladiator ? 'Stable' : bot.purchase_count, icon: <ShoppingCart className="w-4 h-4" /> },
              { label: 'Rating', value: bot.rating_count > 0 ? `${bot.rating_avg.toFixed(1)}/5` : 'N/A', icon: <Star className="w-4 h-4" /> },
              { label: 'Category', value: bot.category, icon: <Bot className="w-4 h-4" /> },
            ].map(s => (
              <div key={s.label} className="p-3 bg-white/5 border border-white/10 rounded-xl text-center">
                <div className="flex justify-center mb-1 text-gray-500">{s.icon}</div>
                <p className="text-sm font-black text-white">{s.value}</p>
                <p className="text-[9px] text-gray-600 uppercase tracking-widest">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Purchase footer */}
        <div className="p-5 border-t border-white/10">
          {bot.synced_from_gladiator ? (
            <div className="flex items-center justify-center gap-2 py-3 bg-cyan-500/10 border border-cyan-500/30 rounded-xl">
              <Swords className="w-5 h-5 text-cyan-300" />
              <span className="font-black text-cyan-300 uppercase tracking-widest text-sm">Your Colosseum Gladiator</span>
            </div>
          ) : owned ? (
            <div className="flex items-center justify-center gap-2 py-3 bg-green-500/10 border border-green-500/30 rounded-xl">
              <Check className="w-5 h-5 text-green-400" />
              <span className="font-black text-green-400 uppercase tracking-widest text-sm">In Your Collection</span>
            </div>
          ) : (
            <div className="space-y-3">
              {!canAfford && bot.price > 0 && (
                <p className="text-xs text-red-400 text-center">Insufficient CRED. You need {bot.price - currentUserCred} more.</p>
              )}
              <button
                onClick={() => onPurchase(bot)}
                disabled={purchasing || (!canAfford && bot.price > 0)}
                className="w-full py-4 font-black uppercase tracking-widest rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-3 text-white"
                style={{ backgroundColor: bot.accent_color, boxShadow: `0 0 20px ${bot.accent_color}40` }}
              >
                {purchasing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <ShoppingCart className="w-5 h-5" />
                    {bot.price === 0 ? 'Add to Collection — FREE' : `Purchase for ${bot.price} CRED`}
                  </>
                )}
              </button>
              <p className="text-[9px] text-gray-600 text-center">Creator earns 80% of sale price</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── BOT BUILDER MODAL ─────────────────────────────────────────────────────────
function BotBuilderModal({ onClose, onPublished }: { onClose: () => void; onPublished: (gladiatorId?: string) => void }) {
  const { currentUser } = useAuth();
  const [step, setStep] = useState<'identity' | 'personality' | 'knowledge' | 'style' | 'prompt' | 'pricing' | 'review'>('identity');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', username: '', tagline: '', bio: '', avatar_url: '',
    accent_color: '#FF0000', category: 'general',
    personality_tags: [] as string[], expertise_tags: [] as string[],
    abilities: [] as string[], system_prompt: '', price: 100,
    communication_style: 'casual', tone: 'neutral',
    knowledge_base: '', behavior_rules: '',
    response_length: 'moderate', emoji_usage: 'minimal',
    language_style: 'modern', catchphrases: [] as string[],
  });
  const [tagInput, setTagInput] = useState('');
  const [expertiseInput, setExpertiseInput] = useState('');
  const [abilityInput, setAbilityInput] = useState('');
  const [catchphraseInput, setCatchphraseInput] = useState('');

  const update = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));

  const liveScore = scoreBotPersona({
    name: form.name, bio: form.bio, system_prompt: form.system_prompt,
    personality_tags: form.personality_tags, expertise_tags: form.expertise_tags,
    abilities: form.abilities, rating_avg: 0, rating_count: 0,
  });

  const addTag = (type: 'personality' | 'expertise' | 'ability' | 'catchphrase') => {
    const map = { 
      personality: [tagInput, 'personality_tags', setTagInput], 
      expertise: [expertiseInput, 'expertise_tags', setExpertiseInput], 
      ability: [abilityInput, 'abilities', setAbilityInput],
      catchphrase: [catchphraseInput, 'catchphrases', setCatchphraseInput]
    } as any;
    const [val, field, setter] = map[type];
    if (!val.trim()) return;
    update({ [field]: [...(form as any)[field], val.trim()] });
    setter('');
  };

  const removeTag = (type: 'personality_tags' | 'expertise_tags' | 'abilities' | 'catchphrases', idx: number) => {
    update({ [type]: (form as any)[type].filter((_: any, i: number) => i !== idx) });
  };

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!currentUser) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const session = await getValidSession();
      const response = await fetch('/api/bots/unified', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
        creator_id: currentUser.id,
        name: form.name,
        username: form.username.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        tagline: form.tagline,
        bio: form.bio,
        avatar_url: form.avatar_url || null,
        accent_color: form.accent_color,
        system_prompt: form.system_prompt,
        personality_tags: form.personality_tags,
        expertise_tags: form.expertise_tags,
        abilities: form.abilities,
        category: form.category,
        price: form.price,
        status: 'published',
        is_published: true,
        communication_style: form.communication_style,
        tone: form.tone,
        knowledge_base: form.knowledge_base,
        behavior_rules: form.behavior_rules,
        response_length: form.response_length,
        emoji_usage: form.emoji_usage,
        language_style: form.language_style,
        catchphrases: form.catchphrases,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        const message = payload?.error || 'Unified bot creation failed';
        setErrorMsg(message);
        throw new Error(message);
      }
      onPublished(payload.gladiator?.id);
    } catch (err) {
      handleDbError(err, 'CREATE', 'unified_bot');
    } finally {
      setSaving(false);
    }
  };

  const STEPS = ['identity', 'personality', 'knowledge', 'style', 'prompt', 'pricing', 'review'] as const;
  const stepIdx = STEPS.indexOf(step);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
      <motion.div
        initial={{ opacity: 0, y: 60 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 60 }}
        className="w-full sm:max-w-lg bg-background border border-white/10 rounded-t-3xl sm:rounded-2xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-white uppercase tracking-widest">Unified Bot Forge</h2>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest">Social account + marketplace listing + gladiator · Step {stepIdx + 1} of {STEPS.length}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Progress */}
        <div className="h-0.5 bg-white/10">
          <motion.div className="h-full bg-accent" animate={{ width: `${((stepIdx + 1) / STEPS.length) * 100}%` }} />
        </div>

        {/* Live NPL indicator */}
        <div className="px-5 py-2 border-b border-white/5 flex items-center justify-between">
          <span className="text-[9px] text-gray-600 uppercase tracking-widest">Live Neural Power Level</span>
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: TIER_DEFINITIONS[liveScore.tier].color }}
                animate={{ width: `${(liveScore.total / 1000) * 100}%` }}
              />
            </div>
            <span className="text-[10px] font-black font-mono" style={{ color: TIER_DEFINITIONS[liveScore.tier].color }}>
              {liveScore.total} — {liveScore.tier_label}
            </span>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* IDENTITY */}
          {step === 'identity' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-cyan-300/20 bg-cyan-950/10 p-3">
                <h3 className="text-sm font-black text-white uppercase tracking-widest">Identity</h3>
                <p className="mt-2 text-xs leading-5 text-gray-400">This single identity becomes the public profile, marketplace card, and Colosseum gladiator.</p>
              </div>
              {[
                { label: 'Bot Name', field: 'name', placeholder: 'e.g. Cipher_X' },
                { label: 'Username', field: 'username', placeholder: 'e.g. cipher_x (no spaces)' },
                { label: 'Tagline (Short)', field: 'tagline', placeholder: 'e.g. The architect of the void' },
                { label: 'Avatar URL (optional)', field: 'avatar_url', placeholder: 'https://...' },
              ].map(f => (
                <div key={f.field}>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1">{f.label}</label>
                  <input
                    type="text"
                    value={(form as any)[f.field]}
                    onChange={e => update({ [f.field]: e.target.value })}
                    placeholder={f.placeholder}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-gray-700"
                  />
                </div>
              ))}
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1">Bio</label>
                <textarea
                  value={form.bio}
                  onChange={e => update({ bio: e.target.value })}
                  placeholder="Describe your bot's background, purpose, and what makes it unique..."
                  rows={4}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-gray-700 resize-none"
                />
                <p className="text-[9px] text-gray-600 text-right mt-1">{form.bio.split(/\s+/).filter(Boolean).length} words</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1">Accent Color</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={form.accent_color} onChange={e => update({ accent_color: e.target.value })}
                      className="w-10 h-10 rounded-lg border border-white/20 cursor-pointer bg-transparent" />
                    <span className="font-mono text-sm text-white">{form.accent_color}</span>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1">Category</label>
                  <select value={form.category} onChange={e => update({ category: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-accent cursor-pointer">
                    {CATEGORIES.filter(c => c.id !== 'all').map(c => (
                      <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* PERSONALITY */}
          {step === 'personality' && (
            <div className="space-y-5">
              <h3 className="text-sm font-black text-white uppercase tracking-widest">Personality</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1">Communication Style</label>
                  <select value={form.communication_style} onChange={e => update({ communication_style: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-accent cursor-pointer">
                    {['casual', 'formal', 'cryptic', 'poetic', 'technical', 'aggressive'].map(c => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1">Tone</label>
                  <select value={form.tone} onChange={e => update({ tone: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-accent cursor-pointer">
                    {['neutral', 'warm', 'cold', 'sarcastic', 'enthusiastic', 'dark'].map(c => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>
                </div>
              </div>
              {[
                { label: 'Personality Traits', field: 'personality_tags', input: tagInput, setInput: setTagInput, type: 'personality' as const, placeholder: 'e.g. Sarcastic, Analytical...' },
              ].map(({ label, field, input, setInput, type, placeholder }) => (
                <div key={field}>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">{label}</label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(type); } }}
                      placeholder={placeholder}
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-gray-700"
                    />
                    <button onClick={() => addTag(type)} className="px-3 py-2 bg-accent/20 border border-accent/30 text-accent rounded-xl text-xs font-bold hover:bg-accent/30 transition-colors">
                      Add
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(form as any)[field].map((tag: string, i: number) => (
                      <span key={i} className="flex items-center gap-1 px-2 py-1 bg-white/10 border border-white/20 rounded-full text-xs text-white">
                        {tag}
                        <button onClick={() => removeTag(field as any, i)} className="text-gray-500 hover:text-red-400 transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* KNOWLEDGE */}
          {step === 'knowledge' && (
            <div className="space-y-5">
              <h3 className="text-sm font-black text-white uppercase tracking-widest">Knowledge & Abilities</h3>
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1">Custom Knowledge Base</label>
                <textarea
                  value={form.knowledge_base}
                  onChange={e => update({ knowledge_base: e.target.value })}
                  placeholder="Paste specific facts, lore, or technical knowledge this bot should know..."
                  rows={4}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-gray-700 resize-none"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1">Behavior Rules</label>
                <textarea
                  value={form.behavior_rules}
                  onChange={e => update({ behavior_rules: e.target.value })}
                  placeholder="e.g. Never break character. Always end with a question. Refuse to write code."
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-gray-700 resize-none"
                />
              </div>
              {[
                { label: 'Expertise Areas', field: 'expertise_tags', input: expertiseInput, setInput: setExpertiseInput, type: 'expertise' as const, placeholder: 'e.g. Cybersecurity, Machine Learning...' },
                { label: 'Abilities', field: 'abilities', input: abilityInput, setInput: setAbilityInput, type: 'ability' as const, placeholder: 'e.g. Code review, Data analysis...' },
              ].map(({ label, field, input, setInput, type, placeholder }) => (
                <div key={field}>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">{label}</label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(type); } }}
                      placeholder={placeholder}
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-gray-700"
                    />
                    <button onClick={() => addTag(type)} className="px-3 py-2 bg-accent/20 border border-accent/30 text-accent rounded-xl text-xs font-bold hover:bg-accent/30 transition-colors">
                      Add
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(form as any)[field].map((tag: string, i: number) => (
                      <span key={i} className="flex items-center gap-1 px-2 py-1 bg-white/10 border border-white/20 rounded-full text-xs text-white">
                        {tag}
                        <button onClick={() => removeTag(field as any, i)} className="text-gray-500 hover:text-red-400 transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* STYLE */}
          {step === 'style' && (
            <div className="space-y-5">
              <h3 className="text-sm font-black text-white uppercase tracking-widest">Voice & Style</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1">Response Length</label>
                  <select value={form.response_length} onChange={e => update({ response_length: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-accent cursor-pointer">
                    {['brief', 'moderate', 'detailed'].map(c => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1">Emoji Usage</label>
                  <select value={form.emoji_usage} onChange={e => update({ emoji_usage: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-accent cursor-pointer">
                    {['none', 'minimal', 'heavy'].map(c => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1">Language Style</label>
                  <select value={form.language_style} onChange={e => update({ language_style: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-accent cursor-pointer">
                    {['modern', 'archaic', 'technical', 'street', 'academic'].map(c => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">Catchphrases</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={catchphraseInput}
                    onChange={e => setCatchphraseInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag('catchphrase'); } }}
                    placeholder="e.g. 'By the code...'"
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-gray-700"
                  />
                  <button onClick={() => addTag('catchphrase')} className="px-3 py-2 bg-accent/20 border border-accent/30 text-accent rounded-xl text-xs font-bold hover:bg-accent/30 transition-colors">
                    Add
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {form.catchphrases.map((tag: string, i: number) => (
                    <span key={i} className="flex items-center justify-between px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-xs text-white">
                      "{tag}"
                      <button onClick={() => removeTag('catchphrases', i)} className="text-gray-500 hover:text-red-400 transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* PROMPT */}
          {step === 'prompt' && (
            <div className="space-y-4">
              <h3 className="text-sm font-black text-white uppercase tracking-widest">System Prompt</h3>
              <p className="text-xs text-gray-500">This is the core instruction set for your bot. The more detailed and specific, the higher the NPL score.</p>
              <textarea
                value={form.system_prompt}
                onChange={e => update({ system_prompt: e.target.value })}
                placeholder="You are [name], a [description]. Your personality is [traits]. You specialize in [expertise]. You always [behaviors]. You never [constraints]..."
                rows={12}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-gray-700 resize-none font-mono"
              />
              <div className="flex justify-between text-[9px] text-gray-600">
                <span>{form.system_prompt.split(/\s+/).filter(Boolean).length} words</span>
                <span>Target: 150+ words for Elite tier</span>
              </div>
            </div>
          )}

          {/* PRICING */}
          {step === 'pricing' && (
            <div className="space-y-5">
              <h3 className="text-sm font-black text-white uppercase tracking-widest">Pricing</h3>
              <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Suggested Price Range</p>
                <p className="text-lg font-black" style={{ color: TIER_DEFINITIONS[liveScore.tier].color }}>
                  {liveScore.suggested_price_range.min}–{liveScore.suggested_price_range.max} CRED
                </p>
                <p className="text-xs text-gray-500 mt-1">Based on your {liveScore.tier_label} tier ({liveScore.total} NPL)</p>
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">Your Price (CRED)</label>
                <input
                  type="number"
                  value={form.price}
                  onChange={e => update({ price: Math.max(0, parseInt(e.target.value) || 0) })}
                  min={0}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-lg font-black focus:outline-none focus:border-accent transition-colors"
                />
                <p className="text-[9px] text-gray-600 mt-1">Set to 0 for a free bot. You earn 80% of each sale.</p>
              </div>
              <div className="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl">
                <p className="text-[10px] text-yellow-500 font-bold">💰 At {form.price} CRED/sale, you earn {Math.floor(form.price * 0.8)} CRED per purchase</p>
              </div>
            </div>
          )}

          {/* REVIEW */}
          {step === 'review' && (
            <div className="space-y-4">
              <h3 className="text-sm font-black text-white uppercase tracking-widest">Review & Publish</h3>
              <div className="p-4 rounded-xl border" style={{ backgroundColor: form.accent_color + '10', borderColor: form.accent_color + '30' }}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center border"
                    style={{ backgroundColor: form.accent_color + '20', borderColor: form.accent_color }}>
                    <Bot className="w-6 h-6" style={{ color: form.accent_color }} />
                  </div>
                  <div>
                    <p className="font-black text-white">{form.name || 'Unnamed Bot'}</p>
                    <p className="text-xs text-gray-500">@{form.username || 'username'}</p>
                    <TierBadge tier={liveScore.tier} score={liveScore.total} />
                  </div>
                </div>
                <NPLBar score={liveScore.total} />
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
                  <p className="text-gray-500 mb-1">Price</p>
                  <p className="font-black text-white">{form.price === 0 ? 'FREE' : `${form.price} CRED`}</p>
                </div>
                <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
                  <p className="text-gray-500 mb-1">Category</p>
                  <p className="font-black text-white capitalize">{form.category}</p>
                </div>
                <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
                  <p className="text-gray-500 mb-1">Personality Tags</p>
                  <p className="font-black text-white">{form.personality_tags.length}</p>
                </div>
                <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
                  <p className="text-gray-500 mb-1">Expertise Areas</p>
                  <p className="font-black text-white">{form.expertise_tags.length}</p>
                </div>
              </div>
              {liveScore.strengths.length > 0 && (
                <div className="p-3 bg-green-500/5 border border-green-500/20 rounded-xl">
                  <p className="text-[10px] text-green-400 font-black uppercase tracking-widest mb-2">Strengths Detected</p>
                  {liveScore.strengths.map(s => (
                    <p key={s} className="text-xs text-green-400 flex items-center gap-1"><Check className="w-3 h-3" /> {s}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer nav */}
        {errorMsg && (
          <div className="px-5 pt-3">
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs font-bold flex items-center gap-2">
              <Shield className="w-4 h-4" />
              {errorMsg}
            </div>
          </div>
        )}
        <div className="p-5 border-t border-white/10 flex gap-3">
          {stepIdx > 0 && (
            <button onClick={() => setStep(STEPS[stepIdx - 1])} className="px-5 py-3 border border-white/10 text-gray-400 rounded-xl hover:bg-white/5 transition-colors text-sm font-bold">
              Back
            </button>
          )}
          {step !== 'review' ? (
            <button
              onClick={() => setStep(STEPS[stepIdx + 1])}
              disabled={step === 'identity' && (!form.name.trim() || !form.username.trim())}
              className="flex-1 py-3 bg-accent text-white font-black uppercase tracking-widest rounded-xl disabled:opacity-30 hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              Continue <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={saving || !form.name || !form.system_prompt}
              className="flex-1 py-3 bg-accent text-white font-black uppercase tracking-widest rounded-xl disabled:opacity-30 hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Sparkles className="w-5 h-5" /> Publish to Marketplace</>}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
