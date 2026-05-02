import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowRight, Loader2, Plus, Search, Shield, Sparkles, Users, X } from 'lucide-react';
import { supabase } from '../supabase';
import { cn } from '../lib/utils';
import { useAuth } from '../AuthContext';
import type { Faction, FactionMember, FactionPost } from '../types';

const EXAMPLE_FACTIONS = ['Rust Collective', 'AI Builders', 'Frontend Warriors', 'Open Source Legion'];

interface FactionCardData extends Faction {
  is_member?: boolean;
  role?: string;
  latest_posts?: FactionPost[];
}

const slugify = (value: string) => value
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 72);

const getFactionGradient = (index: number) => {
  const gradients = [
    'from-red-500/25 via-fuchsia-500/10 to-cyan-500/20',
    'from-cyan-500/25 via-blue-500/10 to-fuchsia-500/20',
    'from-yellow-500/20 via-red-500/10 to-purple-500/20',
    'from-emerald-500/20 via-cyan-500/10 to-red-500/20',
  ];
  return gradients[index % gradients.length];
};

export const Factions: React.FC = () => {
  const { currentUser } = useAuth();
  const [factions, setFactions] = useState<FactionCardData[]>([]);
  const [memberships, setMemberships] = useState<FactionMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', icon_url: '', banner_url: '' });

  const loadFactions = async () => {
    setLoading(true);
    const { data: factionRows, error } = await supabase
      .from('factions')
      .select('*')
      .order('member_count', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[Factions] Failed to load factions', error.message);
      setFactions([]);
      setLoading(false);
      return;
    }

    const loadedFactions = (factionRows ?? []) as Faction[];
    let loadedMemberships: FactionMember[] = [];
    if (currentUser) {
      const { data: memberRows } = await supabase
        .from('faction_members')
        .select('*')
        .eq('user_id', currentUser.id);
      loadedMemberships = (memberRows ?? []) as FactionMember[];
      setMemberships(loadedMemberships);
    }

    const factionIds = loadedFactions.map((faction) => faction.id);
    let posts: FactionPost[] = [];
    if (factionIds.length > 0) {
      const { data: postRows } = await supabase
        .from('faction_posts')
        .select('*')
        .in('faction_id', factionIds)
        .order('created_at', { ascending: false })
        .limit(50);
      posts = (postRows ?? []) as FactionPost[];
    }

    const membershipByFaction = new Map(loadedMemberships.map((member) => [member.faction_id, member]));
    setFactions(loadedFactions.map((faction) => ({
      ...faction,
      is_member: membershipByFaction.has(faction.id),
      role: membershipByFaction.get(faction.id)?.role,
      latest_posts: posts.filter((post) => post.faction_id === faction.id).slice(0, 2),
    })));
    setLoading(false);
  };

  useEffect(() => {
    void loadFactions();
  }, [currentUser?.id]);

  const filteredFactions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return factions;
    return factions.filter((faction) => (
      faction.name.toLowerCase().includes(normalized) ||
      faction.description.toLowerCase().includes(normalized) ||
      faction.slug.toLowerCase().includes(normalized)
    ));
  }, [factions, query]);

  const handleCreateFaction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentUser || !form.name.trim()) return;

    setCreating(true);
    const slug = slugify(form.name);
    const { error } = await supabase.from('factions').insert({
      name: form.name.trim(),
      slug,
      description: form.description.trim() || 'A new neural faction forming inside Blood, Sweat, or Code.',
      icon_url: form.icon_url.trim() || null,
      banner_url: form.banner_url.trim() || null,
      created_by: currentUser.id,
    });

    if (error) {
      console.warn('[Factions] Create failed', error.message);
    } else {
      setForm({ name: '', description: '', icon_url: '', banner_url: '' });
      setShowCreate(false);
      await loadFactions();
    }
    setCreating(false);
  };

  const handleJoinFaction = async (faction: FactionCardData) => {
    if (!currentUser) return;
    setJoiningId(faction.id);
    const existing = memberships.find((membership) => membership.faction_id === faction.id);

    if (existing) {
      await supabase.from('faction_members').delete().eq('id', existing.id);
    } else {
      await supabase.from('faction_members').insert({ faction_id: faction.id, user_id: currentUser.id, role: 'member' });
    }

    await loadFactions();
    setJoiningId(null);
  };

  return (
    <div className="min-h-screen bg-background pb-28 text-white">
      <main className="max-w-6xl mx-auto px-4 py-8">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-black/60 p-6 md:p-8 mb-8 shadow-[0_0_60px_rgba(255,0,80,0.08)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,0,80,0.2),transparent_30%),radial-gradient(circle_at_80%_10%,rgba(34,211,238,0.16),transparent_35%)]" />
          <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-5 h-5 text-accent" />
                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-accent">Faction Network</span>
              </div>
              <h1 className="text-3xl md:text-5xl font-black uppercase italic tracking-tighter mb-3">
                Find Your <span className="text-accent drop-shadow-[0_0_18px_rgba(255,0,0,0.7)]">Neon Tribe</span>
              </h1>
              <p className="max-w-2xl text-sm text-gray-400 leading-relaxed">
                Create or join interest-based communities for builders, language crews, open-source cells, and arena specialists. Factions surface on profiles as public badges and power focused mini-feeds.
              </p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3 text-xs font-black uppercase tracking-[0.2em] text-white shadow-[0_0_24px_rgba(255,0,0,0.35)] hover:shadow-[0_0_34px_rgba(255,0,0,0.55)] transition-all"
            >
              <Plus className="w-4 h-4" />
              Create Faction
            </button>
          </div>
        </section>

        <div className="flex flex-col md:flex-row gap-4 md:items-center md:justify-between mb-6">
          <div className="relative flex-1 max-w-xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Rust Collective, AI Builders, Frontend Warriors..."
              className="w-full rounded-2xl border border-white/10 bg-black/50 py-3 pl-11 pr-4 text-sm text-white placeholder:text-gray-600 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_FACTIONS.map((name) => (
              <button
                key={name}
                onClick={() => setQuery(name)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:border-accent/40 hover:text-accent transition-all"
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-24 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-accent" />
          </div>
        ) : filteredFactions.length === 0 ? (
          <div className="rounded-[2rem] border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
            <Sparkles className="w-12 h-12 mx-auto mb-4 text-gray-700" />
            <h2 className="text-xl font-black uppercase italic text-white mb-2">No faction signal found</h2>
            <p className="text-sm text-gray-500 mb-6">Start the first cell and give builders a place to gather.</p>
            <button onClick={() => setShowCreate(true)} className="rounded-xl bg-accent px-5 py-2 text-xs font-black uppercase tracking-widest text-white">
              Create the First Faction
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {filteredFactions.map((faction, index) => (
              <motion.article
                key={faction.id}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.035 }}
                className="group relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/55 shadow-[0_0_34px_rgba(255,0,80,0.06)] hover:border-accent/35 transition-all"
              >
                <div className={cn('h-28 bg-gradient-to-br', getFactionGradient(index))}>
                  {faction.banner_url && <img src={faction.banner_url} alt="" className="h-full w-full object-cover opacity-80" />}
                </div>
                <div className="p-5 -mt-10 relative z-10">
                  <div className="flex items-end justify-between gap-3 mb-4">
                    <div className="h-16 w-16 rounded-2xl border border-white/15 bg-black overflow-hidden flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.08)]">
                      {faction.icon_url ? (
                        <img src={faction.icon_url} alt={faction.name} className="h-full w-full object-cover" />
                      ) : (
                        <Shield className="w-8 h-8 text-accent" />
                      )}
                    </div>
                    <button
                      onClick={() => void handleJoinFaction(faction)}
                      disabled={joiningId === faction.id}
                      className={cn(
                        'rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all',
                        faction.is_member
                          ? 'border border-cyan-400/40 bg-cyan-400/10 text-cyan-200 hover:border-red-400/40 hover:text-red-300'
                          : 'bg-accent text-white shadow-[0_0_16px_rgba(255,0,0,0.3)] hover:shadow-[0_0_24px_rgba(255,0,0,0.5)]'
                      )}
                    >
                      {joiningId === faction.id ? 'Syncing' : faction.is_member ? 'Joined' : 'Join'}
                    </button>
                  </div>

                  <Link to={`/factions/${faction.slug}`} className="block">
                    <h2 className="text-xl font-black uppercase italic tracking-tight text-white group-hover:text-accent transition-colors">
                      {faction.name}
                    </h2>
                    <p className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-3">/{faction.slug}</p>
                    <p className="text-sm text-gray-400 leading-relaxed line-clamp-3 min-h-[4rem]">{faction.description}</p>
                  </Link>

                  <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
                    <div className="flex items-center gap-2 text-gray-400">
                      <Users className="w-4 h-4 text-cyan-300" />
                      <span className="text-xs font-black text-white">{faction.member_count}</span>
                      <span className="text-[10px] uppercase tracking-widest text-gray-600">members</span>
                    </div>
                    <Link to={`/factions/${faction.slug}`} className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-accent hover:text-white transition-colors">
                      Open <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>

                  {faction.latest_posts && faction.latest_posts.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {faction.latest_posts.map((post) => (
                        <div key={post.id} className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                          <p className="text-[11px] text-gray-400 line-clamp-2">{post.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </main>

      {showCreate && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-xl p-4">
          <form onSubmit={handleCreateFaction} className="w-full max-w-lg rounded-[2rem] border border-white/10 bg-[#080808] p-6 shadow-[0_0_60px_rgba(255,0,80,0.12)]">
            <div className="flex items-start justify-between mb-6">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.35em] text-accent mb-2">Found a Cell</p>
                <h2 className="text-2xl font-black uppercase italic text-white">Create Faction</h2>
              </div>
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-full border border-white/10 p-2 text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Faction name"
                maxLength={80}
                className="w-full rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white focus:border-accent focus:outline-none"
                required
              />
              <textarea
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Describe the mission, interests, and kind of builders who should join."
                maxLength={800}
                className="min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white focus:border-accent focus:outline-none"
              />
              <input
                value={form.icon_url}
                onChange={(event) => setForm((prev) => ({ ...prev, icon_url: event.target.value }))}
                placeholder="Icon URL (optional)"
                className="w-full rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white focus:border-accent focus:outline-none"
              />
              <input
                value={form.banner_url}
                onChange={(event) => setForm((prev) => ({ ...prev, banner_url: event.target.value }))}
                placeholder="Banner URL (optional)"
                className="w-full rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white focus:border-accent focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={creating || !form.name.trim()}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3 text-xs font-black uppercase tracking-[0.2em] text-white disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Launch Faction
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default Factions;
