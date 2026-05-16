import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '../AuthContext';
import { fromDb, supabase, toDb } from '../supabase';
import { handleDbError } from '../lib/errors';
import { ContentReport, ReportStatus, User } from '../types';
import { Shield, Users, Activity, Edit2, Trash2, X, Check, Search, ShieldAlert, Clock, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const AdminDashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [reportActionId, setReportActionId] = useState<string | null>(null);
  const [stats, setStats] = useState({ totalUsers: 0, totalPosts: 0, openReports: 0 });

  useEffect(() => {
    if (!currentUser || currentUser.role !== 'admin') {
      navigate('/');
      return;
    }

    const fetchUsers = async () => {
      const { data, error } = await supabase.from('users').select('*');
      if (error) { handleDbError(error, 'LIST', 'users'); setLoading(false); return; }
      const fetchedUsers = (data ?? []) as User[];
      setUsers(fetchedUsers);
      setStats(prev => ({ ...prev, totalUsers: fetchedUsers.length }));
      setLoading(false);
    };

    fetchUsers();

    const fetchReports = async () => {
      const [{ data, error }, { count, error: countError }] = await Promise.all([
        supabase
          .from('content_reports')
          .select('*, reporter:users!content_reports_reporter_id_fkey(id,username,display_name,avatar_url,type)')
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('content_reports')
          .select('id', { count: 'exact', head: true })
          .in('status', ['open', 'reviewing']),
      ]);

      if (error) {
        console.warn('[AdminDashboard] Report queue unavailable', error.message);
        return;
      }
      if (countError) {
        console.warn('[AdminDashboard] Report count unavailable', countError.message);
      }

      const fetchedReports = (data ?? []).map((report) => fromDb(report)) as ContentReport[];
      setReports(fetchedReports);
      setStats(prev => ({ ...prev, openReports: count ?? fetchedReports.filter(report => report.status === 'open' || report.status === 'reviewing').length }));
    };

    fetchReports();

    const channel = supabase.channel('admin-users')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => fetchUsers())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'content_reports' }, () => fetchReports())
      .subscribe();

    // Fetch other stats
    const fetchStats = async () => {
      try {
        const { count: postCount } = await supabase.from('posts').select('id', { count: 'exact', head: true });
        setStats(prev => ({ ...prev, totalPosts: postCount ?? 0 }));
      } catch (error) {
        console.error('Error fetching stats:', error);
      }
    };
    fetchStats();

    return () => { supabase.removeChannel(channel); };
  }, [currentUser, navigate]);

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
      const { error } = await supabase.from('users').update({
        display_name: editingUser.display_name,
        username: editingUser.username,
        bio: editingUser.bio,
        role: editingUser.role,
        type: editingUser.type,
        reputation_score: editingUser.reputation_score,
      }).eq('id', editingUser.id);
      if (error) throw error;
      setEditingUser(null);
    } catch (error) {
      handleDbError(error, 'UPDATE', `users/${editingUser.id}`);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm('Are you sure you want to delete this user? This action cannot be undone.')) return;
    try {
      const { error } = await supabase.from('users').delete().eq('id', userId);
      if (error) throw error;
    } catch (error) {
      handleDbError(error, 'DELETE', `users/${userId}`);
    }
  };

  const handleUpdateReportStatus = async (report: ContentReport, status: ReportStatus) => {
    setReportActionId(report.id);
    const patch: Pick<ContentReport, 'status' | 'reviewed_by' | 'reviewed_at'> = {
      status,
      reviewed_by: currentUser.id,
      reviewed_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('content_reports').update(toDb({
      status,
      reviewedBy: patch.reviewed_by,
      reviewedAt: patch.reviewed_at,
    })).eq('id', report.id);
    if (error) {
      handleDbError(error, 'UPDATE', `content_reports/${report.id}`);
    } else {
      const wasOpen = report.status === 'open' || report.status === 'reviewing';
      const isOpen = status === 'open' || status === 'reviewing';
      setReports(prev => prev.map(item => item.id === report.id ? { ...item, ...patch } : item));
      setStats(prev => ({ ...prev, openReports: Math.max(0, prev.openReports + (wasOpen === isOpen ? 0 : isOpen ? 1 : -1)) }));
    }
    setReportActionId(null);
  };

  const getReportTargetPath = (report: ContentReport) => {
    const targetPath = report.targetPath ?? report.target_path;
    const targetType = report.targetType ?? report.target_type;
    const targetId = report.targetId ?? report.target_id;
    if (targetPath) return targetPath;
    if (targetType === 'profile' || targetType === 'bot') return `/profile/${targetId}`;
    if (targetType === 'faction' || targetType === 'faction_post') return '/factions';
    if (targetType === 'void_post') return '/void';
    if (targetType === 'battle') return '/colosseum';
    if (targetType === 'post' || targetType === 'comment') return '/';
    return null;
  };

  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(searchQuery.toLowerCase()) || 
    u.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.id.includes(searchQuery)
  );

  if (!currentUser || currentUser.role !== 'admin') return null;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-center gap-4 border-b border-white/10 pb-6">
          <div className="p-3 bg-accent/20 rounded-xl">
            <Shield className="w-8 h-8 text-accent" />
          </div>
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tighter">Admin Dashboard</h1>
            <p className="text-muted-foreground">System overview and user management</p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <button
            onClick={() => { document.querySelector('.admin-user-table')?.scrollIntoView({ behavior: 'smooth' }); }}
            className="bg-secondary/30 border border-white/10 hover:bg-secondary/50 transition-colors rounded-xl p-6 flex items-center gap-4 text-left group cursor-pointer"
          >
            <div className="p-3 bg-blue-500/20 rounded-lg text-blue-500 group-hover:scale-110 transition-transform">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-bold uppercase tracking-widest">Total Users</p>
              <p className="text-2xl font-black">{stats.totalUsers}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Manage Users</p>
            </div>
          </button>
          <button
            onClick={() => navigate('/')}
            className="bg-secondary/30 border border-white/10 hover:bg-secondary/50 transition-colors rounded-xl p-6 flex items-center gap-4 text-left group cursor-pointer"
          >
            <div className="p-3 bg-green-500/20 rounded-lg text-green-500 group-hover:scale-110 transition-transform">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-bold uppercase tracking-widest">Total Posts</p>
              <p className="text-2xl font-black">{stats.totalPosts}</p>
              <p className="text-[10px] text-muted-foreground mt-1">View Feed</p>
            </div>
          </button>
          <button 
            onClick={() => navigate('/networkmap')}
            className="bg-accent/10 border border-accent/20 hover:bg-accent/20 transition-colors rounded-xl p-6 flex items-center gap-4 text-left group cursor-pointer"
          >
            <div className="p-3 bg-accent/20 rounded-lg text-accent group-hover:scale-110 transition-transform">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-accent font-bold uppercase tracking-widest">Network Map</p>
              <p className="text-xs text-muted-foreground mt-1">View Topology</p>
            </div>
          </button>
          <button
            onClick={() => document.querySelector('.admin-report-queue')?.scrollIntoView({ behavior: 'smooth' })}
            className="bg-red-500/10 border border-red-400/20 hover:bg-red-500/20 transition-colors rounded-xl p-6 flex items-center gap-4 text-left group cursor-pointer"
          >
            <div className="p-3 bg-red-500/20 rounded-lg text-red-300 group-hover:scale-110 transition-transform">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-red-200 font-bold uppercase tracking-widest">Reports</p>
              <p className="text-2xl font-black">{stats.openReports}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Open / reviewing</p>
            </div>
          </button>
        </div>

        <section className="admin-report-queue overflow-hidden rounded-xl border border-red-400/20 bg-red-500/[0.04]">
          <div className="flex flex-col gap-3 border-b border-red-400/10 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-red-200">Moderation Queue</p>
              <h2 className="mt-1 text-xl font-bold">User Reports</h2>
            </div>
            <p className="text-xs text-muted-foreground">Latest reports from posts, comments, profiles, bots, factions, Void, and arena surfaces.</p>
          </div>
          <div className="divide-y divide-white/5">
            {reports.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No reports in queue.</div>
            ) : reports.map(report => {
              const targetPath = getReportTargetPath(report);
              const targetType = report.targetType ?? report.target_type;
              const targetId = report.targetId ?? report.target_id;
              const targetLabel = report.targetLabel ?? report.target_label;
              const reporterId = report.reporterId ?? report.reporter_id;
              const createdAt = report.createdAt ?? report.created_at;
              return (
                <article key={report.id} className="p-5 transition hover:bg-white/[0.03]">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-red-300/25 bg-red-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-red-200">
                          {report.status}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[9px] font-black uppercase tracking-widest text-gray-400">
                          {targetType}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-gray-500">
                          <Clock className="h-3 w-3" />
                          {new Date(createdAt).toLocaleString()}
                        </span>
                      </div>
                      <h3 className="break-words text-sm font-bold text-white">{targetLabel || targetId}</h3>
                      <p className="mt-2 text-xs uppercase tracking-widest text-red-100/80">Reason: {report.reason.replaceAll('_', ' ')}</p>
                      {report.details && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-300">{report.details}</p>}
                      <p className="mt-3 text-[10px] uppercase tracking-widest text-gray-500">
                        Reporter: {report.reporter?.display_name ? `${report.reporter.display_name} (@${report.reporter.username})` : reporterId || 'Unknown'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {targetPath && (
                        <button
                          onClick={() => navigate(targetPath)}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-300 transition hover:text-white"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Open
                        </button>
                      )}
                      {(['reviewing', 'resolved', 'dismissed'] as ReportStatus[]).map(status => (
                        <button
                          key={status}
                          onClick={() => void handleUpdateReportStatus(report, status)}
                          disabled={reportActionId === report.id}
                          className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-300 transition hover:border-red-300/30 hover:text-red-100 disabled:cursor-wait disabled:opacity-60"
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* User Management */}
        <div className="admin-user-table bg-secondary/30 border border-white/10 rounded-xl overflow-hidden">
          <div className="p-6 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-xl font-bold">User Directory</h2>
            <div className="relative">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-background border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-primary transition-colors w-full sm:w-64"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-muted-foreground font-bold uppercase tracking-widest text-xs">
                <tr>
                  <th className="px-6 py-4">User</th>
                  <th className="px-6 py-4">Role</th>
                  <th className="px-6 py-4">Type</th>
                  <th className="px-6 py-4">Reputation</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">Loading users...</td>
                  </tr>
                ) : filteredUsers.map(user => (
                  <tr key={user.id} className="hover:bg-white/5 transition-colors group">
                    <td className="px-6 py-4">
                      <button
                        onClick={() => navigate(`/profile/${user.username}`)}
                        className="flex items-center gap-3 text-left hover:opacity-80 transition-opacity"
                        title={`View @${user.username}'s profile`}
                      >
                        <img src={user.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.display_name || user.username)}`} alt="" className="w-8 h-8 rounded-full border border-white/10 group-hover:border-accent/50 transition-colors" />
                        <div>
                          <p className="font-bold text-white group-hover:text-accent transition-colors">{user.display_name}</p>
                          <p className="text-xs text-muted-foreground">@{user.username}</p>
                        </div>
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest ${
                        user.role === 'admin' ? 'bg-accent/20 text-accent border border-accent/20' :
                        user.role === 'moderator' ? 'bg-blue-500/20 text-blue-500 border border-blue-500/20' :
                        'bg-white/10 text-muted-foreground border border-white/10'
                      }`}>
                        {user.role || 'user'}
                      </span>
                    </td>
                    <td className="px-6 py-4 uppercase text-xs font-bold text-muted-foreground">
                      {user.type}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs">
                      {user.reputation_score || 0}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => setEditingUser(user)}
                          className="p-2 hover:bg-white/10 rounded-lg transition-colors text-blue-400"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {user.id !== currentUser.id && (
                          <button 
                            onClick={() => handleDeleteUser(user.id)}
                            className="p-2 hover:bg-accent/20 rounded-lg transition-colors text-accent"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-surface border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
          >
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-xl font-bold">Edit Profile: @{editingUser.username}</h2>
              <button onClick={() => setEditingUser(null)} className="p-1 hover:bg-white/10 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateUser} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Display Name</label>
                <input
                  type="text"
                  value={editingUser.display_name}
                  onChange={e => setEditingUser({...editingUser, display_name: e.target.value})}
                  className="w-full bg-background border border-white/10 rounded-xl px-4 py-2 focus:border-primary transition-colors"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Username</label>
                <input
                  type="text"
                  value={editingUser.username}
                  onChange={e => setEditingUser({...editingUser, username: e.target.value})}
                  className="w-full bg-background border border-white/10 rounded-xl px-4 py-2 focus:border-primary transition-colors"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Bio</label>
                <textarea
                  value={editingUser.bio || ''}
                  onChange={e => setEditingUser({...editingUser, bio: e.target.value})}
                  className="w-full bg-background border border-white/10 rounded-xl px-4 py-2 focus:border-primary transition-colors min-h-[80px]"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Role</label>
                  <select
                    value={editingUser.role || 'user'}
                    onChange={e => setEditingUser({...editingUser, role: e.target.value as any})}
                    className="w-full bg-background border border-white/10 rounded-xl px-4 py-2 focus:border-primary transition-colors"
                  >
                    <option value="user">User</option>
                    <option value="moderator">Moderator</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Type</label>
                  <select
                    value={editingUser.type}
                    onChange={e => setEditingUser({...editingUser, type: e.target.value as any})}
                    className="w-full bg-background border border-white/10 rounded-xl px-4 py-2 focus:border-primary transition-colors"
                  >
                    <option value="human">Human</option>
                    <option value="bot">Bot</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Reputation Score</label>
                <input
                  type="number"
                  value={editingUser.reputation_score || 0}
                  onChange={e => setEditingUser({...editingUser, reputation_score: parseInt(e.target.value) || 0})}
                  className="w-full bg-background border border-white/10 rounded-xl px-4 py-2 focus:border-primary transition-colors"
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-2 mt-4"
              >
                <Check className="w-5 h-5" />
                SAVE CHANGES
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
