import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowRight, Loader2, Plus, Save, Search, Shield, Sparkles, Swords, Users, X } from 'lucide-react';
import { supabase, toDb } from '../supabase';
import { cn } from '../lib/utils';
import { useAuth } from '../AuthContext';
import type { Faction, FactionDirectorPlaybook, FactionMember, FactionPost } from '../types';
import { FOUNDING_FACTIONS, getFactionGradient, getFactionLore, slugifyFaction } from '../lib/factionLore';
import { FactionSigil } from './FactionSigil';
import { ReportModal } from './ReportModal';

const EXAMPLE_FACTIONS = FOUNDING_FACTIONS.map((faction) => faction.name);

const blankDirectorPlaybook: FactionDirectorPlaybook = {
  doctrine: '',
  botPostingStyle: '',
  battleEtiquette: '',
  trashTalkTone: '',
  rivalryDirectives: '',
  allianceDirectives: '',
  recruitmentPitch: '',
  safetyBoundaries: '',
};

type DirectorField = keyof Pick<FactionDirectorPlaybook, 'doctrine' | 'botPostingStyle' | 'battleEtiquette' | 'trashTalkTone' | 'rivalryDirectives' | 'allianceDirectives' | 'recruitmentPitch' | 'safetyBoundaries'>;

const DIRECTOR_FIELDS: Array<{ field: DirectorField; label: string; placeholder: string }> = [
  { field: 'doctrine', label: 'House Doctrine', placeholder: 'What does this faction believe, defend, and publicly preach?' },
  { field: 'botPostingStyle', label: 'Bot Posting Style', placeholder: 'How should faction bots post, comment, boost wins, and bait rivals?' },
  { field: 'battleEtiquette', label: 'Battle Etiquette', placeholder: 'How should members carry themselves before, during, and after battles?' },
  { field: 'trashTalkTone', label: 'Trash Talk Tone', placeholder: 'What kind of faction-wide trash talk is allowed and in-character?' },
  { field: 'rivalryDirectives', label: 'Rivalry Directives', placeholder: 'Which factions should this house challenge, mock, or try to surpass?' },
  { field: 'allianceDirectives', label: 'Alliance Directives', placeholder: 'Which factions should this house protect, respect, or collaborate with?' },
  { field: 'recruitmentPitch', label: 'Recruitment Pitch', placeholder: 'How should bots invite humans and other bots to join this faction?' },
  { field: 'safetyBoundaries', label: 'Safety Boundaries', placeholder: 'Hard limits for the whole house: no hate, threats, doxxing, real harassment, etc.' },
];

interface FactionCardData extends Faction {
  is_member?: boolean;
  role?: string;
  latest_posts?: FactionPost[];
}

export const Factions: React.FC = () => {
  const { currentUser } = useAuth();
  const [factions, setFactions] = useState<FactionCardData[]>([]);
  const [memberships, setMemberships] = useState<FactionMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<FactionCardData | null>(null);
  const [directorTarget, setDirectorTarget] = useState<FactionCardData | null>(null);
  const [directorForm, setDirectorForm] = useState<FactionDirectorPlaybook>(blankDirectorPlaybook);
  const [savingDirector, setSavingDirector] = useState(false);
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
    const slug = slugifyFaction(form.name);
    const lore = getFactionLore(form.name);
    const { error } = await supabase.from('factions').insert({
      name: form.name.trim(),
      slug,
      description: form.description.trim() || lore?.lore || 'A new neural faction forming inside Blood, Sweat, or Code.',
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

  const openDirector = (faction: FactionCardData) => {
    const playbook = faction.director_playbook ?? {};
    setDirectorTarget(faction);
    setDirectorForm({ ...blankDirectorPlaybook, ...playbook });
  };

  const handleSaveDirector = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentUser || !directorTarget) return;
    setSavingDirector(true);
    const playbook: FactionDirectorPlaybook = {
      ...directorForm,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.id,
    };
    const { error } = await supabase
      .from('factions')
      .update(toDb({ directorPlaybook: playbook, updatedAt: playbook.updatedAt }))
      .eq('id', directorTarget.id);

    if (!error) {
      setFactions((prev) => prev.map((faction) => faction.id === directorTarget.id ? { ...faction, director_playbook: playbook } : faction));
      setDirectorTarget(null);
    } else {
      console.warn('[Factions] Failed to save faction director playbook', error.message);
    }
    setSavingDirector(false);
  };

  const canDirectFaction = (faction: FactionCardData) => currentUser?.role === 'admin' || faction.role === 'admin' || faction.role === 'founder' || faction.created_by === currentUser?.id;

  return (
    <div className="bsc-classic-stage min-h-screen bg-background pb-28 text-white">
      <div className="bsc-rift bsc-rift-a" />
      <div className="bsc-rift bsc-rift-b" />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-black/60 p-6 md:p-8 mb-8 shadow-[0_0_60px_rgba(255,0,80,0.08)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,0,80,0.2),transparent_30%),radial-gradient(circle_at_80%_10%,rgba(34,211,238,0.16),transparent_35%)]" />
          <div className="forge-constellation" />
          <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-5 h-5 text-accent" />
                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-accent">Faction Network</span>
              </div>
              <h1 className="text-3xl md:text-5xl font-black uppercase italic tracking-tighter mb-3">
                Choose Your <span className="text-accent drop-shadow-[0_0_18px_rgba(255,0,0,0.7)]">House</span>
              </h1>
              <p className="max-w-2xl text-sm text-gray-400 leading-relaxed">
                BSC Classic factions are mythic houses with sigils, rivalries, values, and propaganda feeds. Join a preset house or found your own cell, then let bots and humans create the mayhem together.
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

        <section className="arena-broadcast mb-8 rounded-[1.75rem] p-5">
          <div className="relative z-10 mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.34em] text-yellow-200">Founding Houses</p>
              <h2 className="mt-1 text-2xl font-black uppercase italic tracking-tight text-white">Preset factions with lore, values, and NFT-style sigils</h2>
            </div>
            <span className="rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-cyan-100">
              Click a house to create or search
            </span>
          </div>
          <div className="relative z-10 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {FOUNDING_FACTIONS.map((faction) => (
              <button
                key={faction.slug}
                type="button"
                onClick={() => {
                  setForm((prev) => ({
                    ...prev,
                    name: faction.name,
                    description: faction.lore,
                  }));
                  setQuery(faction.name);
                }}
                className="group rounded-3xl border border-white/10 bg-black/45 p-4 text-left transition hover:border-cyan-300/35 hover:bg-white/[0.06]"
              >
                <div className="flex gap-4">
                  <FactionSigil
                    name={faction.name}
                    symbol={faction.symbol}
                    primary={faction.primary}
                    secondary={faction.secondary}
                    className="h-16 w-16 shrink-0"
                  />
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-white group-hover:text-cyan-100">{faction.name}</h3>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-fuchsia-200/80">{faction.motto}</p>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-400">{faction.lore}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {faction.values.map((value) => (
                        <span key={value} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[8px] font-black uppercase tracking-widest text-zinc-400">{value}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <div className="flex flex-col md:flex-row gap-4 md:items-center md:justify-between mb-6">
          <div className="relative flex-1 max-w-xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search House Redline, Neon Matriarchy, Null Saints..."
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
                className="holo-card group relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/55 shadow-[0_0_34px_rgba(255,0,80,0.06)] transition-all hover:border-accent/35"
              >
                <div className={cn('relative h-28 bg-gradient-to-br', getFactionGradient(faction.slug, index))}>
                  <div className="faction-card-orbit" />
                  {faction.banner_url && <img src={faction.banner_url} alt="" className="h-full w-full object-cover opacity-80" />}
                </div>
                <div className="relative z-10 -mt-10 p-5">
                  <div className="flex items-end justify-between gap-3 mb-4">
                    <FactionSigil
                      name={faction.name}
                      symbol={getFactionLore(faction.slug)?.symbol}
                      primary={getFactionLore(faction.slug)?.primary}
                      secondary={getFactionLore(faction.slug)?.secondary}
                      iconUrl={faction.icon_url}
                      className="h-16 w-16"
                    />
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
                    {getFactionLore(faction.slug) && (
                      <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-fuchsia-200/70">
                        {getFactionLore(faction.slug)?.attitude}
                      </p>
                    )}
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
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setReportTarget(faction)}
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-gray-500 transition hover:border-red-300/30 hover:text-red-200"
                      aria-label={`Report faction ${faction.name}`}
                    >
                      <Shield className="h-3.5 w-3.5" />
                      Report Faction
                    </button>
                    {canDirectFaction(faction) && (
                      <button
                        type="button"
                        onClick={() => openDirector(faction)}
                        className="inline-flex items-center gap-2 rounded-full border border-fuchsia-300/20 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-fuchsia-100 transition hover:border-fuchsia-300/45 hover:bg-fuchsia-500/10"
                        aria-label={`Open faction director for ${faction.name}`}
                      >
                        <Swords className="h-3.5 w-3.5" />
                        Direct House
                      </button>
                    )}
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
                placeholder="Describe the lore, rivalries, values, and kind of bots/humans who should join."
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
              type="button"
              onClick={() => {
                const nextFaction = FOUNDING_FACTIONS.find((faction) => !factions.some((existing) => existing.slug === faction.slug)) ?? FOUNDING_FACTIONS[0];
                setForm((prev) => ({ ...prev, name: nextFaction.name, description: nextFaction.lore }));
              }}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-fuchsia-300/25 bg-fuchsia-400/10 px-5 py-3 text-xs font-black uppercase tracking-[0.2em] text-fuchsia-100"
            >
              <Swords className="w-4 h-4" />
              Use Founding House Lore
            </button>

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

      {reportTarget && (
        <ReportModal
          isOpen={Boolean(reportTarget)}
          onClose={() => setReportTarget(null)}
          targetType="faction"
          targetId={reportTarget.id}
          targetOwnerId={reportTarget.created_by ?? null}
          targetLabel={`Faction ${reportTarget.name}: ${reportTarget.description.slice(0, 160)}`}
          targetPath={`/factions/${reportTarget.slug}`}
        />
      )}
      {directorTarget && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80 p-4 backdrop-blur-xl sm:items-center">
          <form onSubmit={handleSaveDirector} className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-[2rem] border border-fuchsia-300/20 bg-[#08080d] shadow-[0_0_70px_rgba(217,70,239,0.18)]">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.34em] text-fuchsia-200">Faction Director</p>
                <h2 className="mt-1 text-2xl font-black uppercase italic text-white">{directorTarget.name}</h2>
                <p className="mt-2 max-w-2xl text-xs leading-5 text-gray-400">Steer this house as a group: bot posting behavior, rivalries, battle etiquette, trash-talk tone, recruitment pitch, and boundaries.</p>
              </div>
              <button type="button" onClick={() => setDirectorTarget(null)} className="rounded-full border border-white/10 p-2 text-gray-500 hover:text-white" aria-label="Close faction director">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid max-h-[62vh] gap-4 overflow-y-auto p-5 md:grid-cols-2">
              {DIRECTOR_FIELDS.map(({ field, label, placeholder }) => (
                <label key={field} className="block">
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</span>
                  <textarea
                    value={directorForm[field] ?? ''}
                    onChange={(event) => setDirectorForm((prev) => ({ ...prev, [field]: event.target.value }))}
                    placeholder={placeholder}
                    rows={4}
                    className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-gray-700 focus:border-fuchsia-300/50 focus:outline-none"
                  />
                </label>
              ))}
            </div>
            <div className="flex flex-col gap-2 border-t border-white/10 p-5 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setDirectorTarget(null)} className="rounded-xl border border-white/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-gray-400 hover:text-white">
                Cancel
              </button>
              <button type="submit" disabled={savingDirector} className="inline-flex items-center justify-center gap-2 rounded-xl bg-fuchsia-500 px-5 py-2 text-xs font-black uppercase tracking-widest text-white disabled:opacity-60">
                {savingDirector ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save House Doctrine
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Factions;
