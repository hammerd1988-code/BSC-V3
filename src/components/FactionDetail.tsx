import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, Crown, Loader2, Megaphone, MessageCircle, Plus, Send, Shield, ShieldAlert, Users, Zap } from 'lucide-react';
import { supabase } from '../supabase';
import { cn } from '../lib/utils';
import { useAuth } from '../AuthContext';
import type { Faction, FactionMember, FactionPost, User } from '../types';
import { getFactionGradient, getFactionLore } from '../lib/factionLore';
import { FactionSigil } from './FactionSigil';
import { ReportModal } from './ReportModal';

interface JoinedFactionMember extends FactionMember {
  user?: User;
}

interface JoinedFactionPost extends FactionPost {
  user?: User;
}

const getRoleTone = (role: string) => {
  if (role === 'founder') return 'text-yellow-300 border-yellow-300/30 bg-yellow-300/10';
  if (role === 'captain') return 'text-fuchsia-200 border-fuchsia-300/30 bg-fuchsia-300/10';
  if (role === 'admin') return 'text-cyan-300 border-cyan-300/30 bg-cyan-300/10';
  return 'text-gray-400 border-white/10 bg-white/[0.03]';
};

export const FactionDetail: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [faction, setFaction] = useState<Faction | null>(null);
  const [members, setMembers] = useState<JoinedFactionMember[]>([]);
  const [posts, setPosts] = useState<JoinedFactionPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [posting, setPosting] = useState(false);
  const [content, setContent] = useState('');
  const [reportFactionOpen, setReportFactionOpen] = useState(false);
  const [reportPost, setReportPost] = useState<JoinedFactionPost | null>(null);
  const [recruiting, setRecruiting] = useState(false);
  const [promotingMemberId, setPromotingMemberId] = useState('');

  const currentMembership = useMemo(
    () => members.find((member) => member.user_id === currentUser?.id),
    [members, currentUser?.id]
  );
  const isMember = Boolean(currentMembership);
  const canManageFaction = currentUser?.role === 'admin' || currentMembership?.role === 'founder' || currentMembership?.role === 'admin';
  const captain = members.find((member) => member.role === 'captain');
  const factionLore = faction ? getFactionLore(faction.slug) : null;

  const loadFaction = async () => {
    if (!slug) return;
    setLoading(true);

    const { data: factionRow, error: factionError } = await supabase
      .from('factions')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    if (factionError || !factionRow) {
      console.warn('[FactionDetail] Faction not found', factionError?.message);
      setFaction(null);
      setLoading(false);
      return;
    }

    const loadedFaction = factionRow as Faction;
    setFaction(loadedFaction);

    const [{ data: memberRows }, { data: postRows }] = await Promise.all([
      supabase
        .from('faction_members')
        .select('*, user:users(*)')
        .eq('faction_id', loadedFaction.id)
        .order('joined_at', { ascending: true }),
      supabase
        .from('faction_posts')
        .select('*, user:users(*)')
        .eq('faction_id', loadedFaction.id)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    setMembers((memberRows ?? []) as JoinedFactionMember[]);
    setPosts((postRows ?? []) as JoinedFactionPost[]);
    setLoading(false);
  };

  useEffect(() => {
    void loadFaction();
  }, [slug, currentUser?.id]);

  useEffect(() => {
    if (!faction) return;
    const channel = supabase
      .channel(`faction-detail-${faction.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'faction_posts', filter: `faction_id=eq.${faction.id}` }, () => void loadFaction())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'faction_members', filter: `faction_id=eq.${faction.id}` }, () => void loadFaction())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [faction?.id]);

  const handleJoinToggle = async () => {
    if (!currentUser || !faction) return;
    setJoining(true);

    if (currentMembership) {
      await supabase.from('faction_members').delete().eq('id', currentMembership.id);
    } else {
      await supabase.from('faction_members').insert({ faction_id: faction.id, user_id: currentUser.id, role: 'member' });
    }

    await loadFaction();
    setJoining(false);
  };

  const handlePost = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentUser || !faction || !content.trim() || !isMember) return;

    setPosting(true);
    const { error } = await supabase.from('faction_posts').insert({
      faction_id: faction.id,
      user_id: currentUser.id,
      content: content.trim(),
    });

    if (error) {
      console.warn('[FactionDetail] Failed to post', error.message);
    } else {
      setContent('');
      await loadFaction();
    }
    setPosting(false);
  };

  const handleRecruitSignal = async () => {
    if (!currentUser || !faction || !isMember || recruiting) return;
    setRecruiting(true);
    const rallyLine = factionLore
      ? `${faction.name} is recruiting. ${factionLore.motto} Bring your bots, your rivalries, and your best arena receipts.`
      : `${faction.name} is recruiting. Bring your bots, your rivalries, and your best arena receipts.`;
    const { error } = await supabase.from('faction_posts').insert({
      faction_id: faction.id,
      user_id: currentUser.id,
      content: `📣 RECRUITMENT SIGNAL\n\n${rallyLine}\n\nJoin the house, program your bot, and help us take the Colosseum.`,
    });
    if (error) console.warn('[FactionDetail] Failed to post recruitment signal', error.message);
    else await loadFaction();
    setRecruiting(false);
  };

  const promoteCaptain = async (member: JoinedFactionMember) => {
    if (!canManageFaction || !faction || member.role === 'founder' || promotingMemberId) return;
    setPromotingMemberId(member.id);
    const { error } = await supabase.rpc('promote_faction_captain', {
      p_faction_id: faction.id,
      p_member_id: member.id,
    });
    if (error) console.warn('[FactionDetail] Failed to promote captain', error.message);
    else await loadFaction();
    setPromotingMemberId('');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!faction) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <Shield className="w-14 h-14 text-gray-700 mb-4" />
        <h1 className="text-2xl font-black uppercase italic text-white mb-2">Faction Signal Lost</h1>
        <p className="text-sm text-gray-500 mb-6">The requested faction could not be found in the network.</p>
        <button onClick={() => navigate('/factions')} className="rounded-xl bg-accent px-5 py-2 text-xs font-black uppercase tracking-widest text-white">
          Back to Factions
        </button>
      </div>
    );
  }

  return (
    <div className="bsc-classic-stage min-h-screen bg-background pb-28 text-white">
      <div className="bsc-rift bsc-rift-a" />
      <div className="bsc-rift bsc-rift-b" />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <button onClick={() => navigate('/factions')} className="mb-5 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.25em] text-gray-500 hover:text-accent transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Faction Discovery
        </button>

        <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-black/60 shadow-[0_0_60px_rgba(255,0,80,0.08)] mb-6">
          <div className={cn('relative h-56 bg-gradient-to-br', getFactionGradient(faction.slug))}>
            <div className="forge-constellation" />
            {faction.banner_url && <img src={faction.banner_url} alt="" className="h-full w-full object-cover opacity-80" />}
          </div>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
          <div className="relative z-10 p-6 md:p-8 -mt-24">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
              <div className="flex items-end gap-4">
                <FactionSigil
                  name={faction.name}
                  symbol={factionLore?.symbol}
                  primary={factionLore?.primary}
                  secondary={factionLore?.secondary}
                  iconUrl={faction.icon_url}
                  className="h-24 w-24"
                />
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-gray-500">/{faction.slug}</p>
                  <h1 className="text-3xl md:text-5xl font-black uppercase italic tracking-tighter text-white drop-shadow-[0_0_24px_rgba(255,255,255,0.12)]">
                    {faction.name}
                  </h1>
                  {factionLore && (
                    <p className="mt-2 text-[10px] font-black uppercase tracking-[0.25em] text-fuchsia-200">
                      {factionLore.motto}
                    </p>
                  )}
                </div>
              </div>

              <button
                onClick={() => void handleJoinToggle()}
                disabled={joining}
                className={cn(
                  'inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-xs font-black uppercase tracking-[0.2em] transition-all',
                  isMember
                    ? 'border border-cyan-400/40 bg-cyan-400/10 text-cyan-200 hover:border-red-400/40 hover:text-red-300'
                    : 'bg-accent text-white shadow-[0_0_24px_rgba(255,0,0,0.35)] hover:shadow-[0_0_34px_rgba(255,0,0,0.55)]'
                )}
              >
                {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {isMember ? 'Joined' : 'Join Faction'}
              </button>
              <button
                onClick={() => setReportFactionOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-300/25 px-5 py-3 text-xs font-black uppercase tracking-[0.2em] text-red-200 transition-all hover:border-red-300/50 hover:bg-red-500/10"
                aria-label={`Report faction ${faction.name}`}
              >
                <ShieldAlert className="w-4 h-4" />
                Report
              </button>
            </div>

            <p className="mt-6 max-w-3xl text-sm text-gray-300 leading-relaxed">{faction.description}</p>
            {factionLore && (
              <div className="mt-6 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-black/35 p-4">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-cyan-200">Attitude</p>
                  <p className="mt-2 text-xs font-bold leading-5 text-zinc-300">{factionLore.attitude}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/35 p-4">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-fuchsia-200">Beliefs</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {factionLore.beliefs.map((belief) => <span key={belief} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[8px] font-black uppercase tracking-widest text-zinc-400">{belief}</span>)}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/35 p-4">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-yellow-200">Values</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {factionLore.values.map((value) => <span key={value} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[8px] font-black uppercase tracking-widest text-zinc-400">{value}</span>)}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-cyan-300" />
                  <span className="text-lg font-black text-white">{faction.member_count}</span>
                </div>
                <p className="text-[8px] font-black uppercase tracking-[0.25em] text-gray-500">members</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-accent" />
                  <span className="text-lg font-black text-white">{posts.length}</span>
                </div>
                <p className="text-[8px] font-black uppercase tracking-[0.25em] text-gray-500">feed signals</p>
              </div>
              {currentMembership && (
                <div className={cn('rounded-2xl border px-4 py-3', getRoleTone(currentMembership.role))}>
                  <div className="flex items-center gap-2">
                    <Crown className="w-4 h-4" />
                    <span className="text-lg font-black capitalize">{currentMembership.role}</span>
                  </div>
                  <p className="text-[8px] font-black uppercase tracking-[0.25em] opacity-70">your role</p>
                </div>
              )}
              <div className={cn('rounded-2xl border px-4 py-3', captain ? getRoleTone('captain') : 'border-white/10 bg-white/[0.03] text-gray-500')}>
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4" />
                  <span className="text-lg font-black">{captain?.user?.display_name ?? 'No Captain'}</span>
                </div>
                <p className="text-[8px] font-black uppercase tracking-[0.25em] opacity-70">faction captain</p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
          <section className="space-y-4">
            <div className="rounded-[1.75rem] border border-white/10 bg-black/50 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-4 h-4 text-accent" />
                <h2 className="text-[10px] font-black uppercase tracking-[0.32em] text-white">Faction Feed</h2>
              </div>

              {isMember ? (
                <div className="mb-5 space-y-3">
                <div className="rounded-2xl border border-fuchsia-300/15 bg-fuchsia-400/5 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.28em] text-fuchsia-200">Recruitment Signal</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-400">Post a faction rally call so humans and custom bots know how to join the house.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRecruitSignal()}
                      disabled={recruiting}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-fuchsia-300/30 bg-fuchsia-400/10 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-fuchsia-100 disabled:opacity-50"
                    >
                      {recruiting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
                      Recruit
                    </button>
                  </div>
                </div>
                <form onSubmit={handlePost}>
                  <textarea
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    placeholder="Transmit a build update, resource, battle report, or collaboration request..."
                    maxLength={2000}
                    className="min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-black/70 p-4 text-sm text-white placeholder:text-gray-600 focus:border-accent focus:outline-none"
                  />
                  <div className="mt-3 flex justify-end">
                    <button
                      type="submit"
                      disabled={posting || !content.trim()}
                      className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
                    >
                      {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Post to Faction
                    </button>
                  </div>
                </form>
                </div>
              ) : (
                <div className="mb-5 rounded-2xl border border-cyan-400/15 bg-cyan-400/5 p-4 text-sm text-cyan-100">
                  Join this faction to post in its mini-feed and coordinate with the crew.
                </div>
              )}

              <div className="space-y-3">
                {posts.length === 0 ? (
                  <div className="py-16 text-center text-gray-600">
                    <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-xs font-black uppercase tracking-widest">No faction posts yet</p>
                  </div>
                ) : posts.map((post, index) => (
                  <motion.article
                    key={post.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.025 }}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 hover:border-accent/30 transition-all"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <Link to={`/profile/${post.user?.username ?? ''}`} className="h-10 w-10 rounded-full overflow-hidden border border-white/10 bg-white/5 flex-shrink-0">
                        {post.user?.avatar_url ? <img src={post.user.avatar_url} alt="" className="h-full w-full object-cover" /> : null}
                      </Link>
                      <div className="min-w-0 flex-1">
                        <Link to={`/profile/${post.user?.username ?? ''}`} className="text-sm font-black text-white hover:text-accent transition-colors">
                          {post.user?.display_name ?? 'Unknown Builder'}
                        </Link>
                        <p className="text-[9px] font-mono uppercase tracking-widest text-gray-600">
                          @{post.user?.username ?? 'unknown'} · {new Date(post.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      {currentUser?.id !== post.user_id && (
                        <button
                          type="button"
                          onClick={() => setReportPost(post)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-gray-500 transition hover:border-red-300/30 hover:text-red-200"
                          aria-label={`Report faction post by ${post.user?.display_name ?? 'unknown user'}`}
                        >
                          <ShieldAlert className="h-3 w-3" />
                          Report
                        </button>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{post.content}</p>
                  </motion.article>
                ))}
              </div>
            </div>
          </section>

          <aside className="rounded-[1.75rem] border border-white/10 bg-black/50 p-5 h-fit">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-cyan-300" />
              <h2 className="text-[10px] font-black uppercase tracking-[0.32em] text-white">Member List</h2>
            </div>
            <div className="space-y-3">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="rounded-2xl border border-white/5 bg-white/[0.03] p-3 transition-all hover:border-accent/30"
                >
                  <div className="flex items-center justify-between gap-3">
                    <Link to={`/profile/${member.user?.username ?? ''}`} className="flex min-w-0 items-center gap-3">
                      <div className="h-10 w-10 rounded-full overflow-hidden border border-white/10 bg-white/5 flex-shrink-0">
                        {member.user?.avatar_url ? <img src={member.user.avatar_url} alt="" className="h-full w-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-white">{member.user?.display_name ?? 'Unknown Builder'}</p>
                        <p className="truncate text-[9px] font-mono text-gray-600">@{member.user?.username ?? 'unknown'}</p>
                      </div>
                    </Link>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={cn('rounded-full border px-2 py-1 text-[8px] font-black uppercase tracking-widest', getRoleTone(member.role))}>
                        {member.role}
                      </span>
                      {canManageFaction && member.role !== 'founder' && member.role !== 'captain' && (
                        <button
                          type="button"
                          onClick={() => void promoteCaptain(member)}
                          disabled={Boolean(promotingMemberId)}
                          className="rounded-full border border-fuchsia-300/25 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-fuchsia-200 transition hover:bg-fuchsia-300/10 disabled:opacity-50"
                        >
                          {promotingMemberId === member.id ? '...' : 'Captain'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </main>
      {faction && (
        <ReportModal
          isOpen={reportFactionOpen}
          onClose={() => setReportFactionOpen(false)}
          targetType="faction"
          targetId={faction.id}
          targetOwnerId={faction.created_by ?? null}
          targetLabel={`Faction ${faction.name}: ${faction.description.slice(0, 160)}`}
          targetPath={`/factions/${faction.slug}`}
        />
      )}
      {reportPost && (
        <ReportModal
          isOpen={Boolean(reportPost)}
          onClose={() => setReportPost(null)}
          targetType="faction_post"
          targetId={reportPost.id}
          targetOwnerId={reportPost.user_id}
          targetLabel={`Faction post by @${reportPost.user?.username ?? 'unknown'} in ${faction.name}: ${reportPost.content.slice(0, 160)}`}
          targetPath={`/factions/${faction.slug}`}
        />
      )}
    </div>
  );
};

export default FactionDetail;
