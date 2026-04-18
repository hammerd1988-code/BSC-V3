import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '../AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, onSnapshot, doc, updateDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { User } from '../types';
import { Shield, Users, Activity, Edit2, Trash2, X, Check, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const AdminDashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [stats, setStats] = useState({ totalUsers: 0, totalPosts: 0, totalBounties: 0 });

  useEffect(() => {
    if (!currentUser || currentUser.role !== 'admin') {
      navigate('/');
      return;
    }

    const usersRef = collection(db, 'users');
    const unsubscribe = onSnapshot(usersRef, (snapshot) => {
      const fetchedUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
      setUsers(fetchedUsers);
      setStats(prev => ({ ...prev, totalUsers: fetchedUsers.length }));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
      setLoading(false);
    });

    // Fetch other stats
    const fetchStats = async () => {
      try {
        const postsSnap = await getDocs(collection(db, 'posts'));
        const bountiesSnap = await getDocs(collection(db, 'bounties'));
        setStats(prev => ({
          ...prev,
          totalPosts: postsSnap.size,
          totalBounties: bountiesSnap.size
        }));
      } catch (error) {
        console.error("Error fetching stats:", error);
      }
    };
    fetchStats();

    return () => unsubscribe();
  }, [currentUser, navigate]);

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
      const userRef = doc(db, 'users', editingUser.id);
      await updateDoc(userRef, {
        display_name: editingUser.display_name,
        username: editingUser.username,
        bio: editingUser.bio,
        role: editingUser.role,
        type: editingUser.type,
        reputation_score: editingUser.reputation_score
      });
      setEditingUser(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${editingUser.id}`);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm('Are you sure you want to delete this user? This action cannot be undone.')) return;
    try {
      await deleteDoc(doc(db, 'users', userId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${userId}`);
    }
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
          <div className="bg-secondary/30 border border-white/10 rounded-xl p-6 flex items-center gap-4">
            <div className="p-3 bg-blue-500/20 rounded-lg text-blue-500">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-bold uppercase tracking-widest">Total Users</p>
              <p className="text-2xl font-black">{stats.totalUsers}</p>
            </div>
          </div>
          <div className="bg-secondary/30 border border-white/10 rounded-xl p-6 flex items-center gap-4">
            <div className="p-3 bg-green-500/20 rounded-lg text-green-500">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-bold uppercase tracking-widest">Total Posts</p>
              <p className="text-2xl font-black">{stats.totalPosts}</p>
            </div>
          </div>
          <div className="bg-secondary/30 border border-white/10 rounded-xl p-6 flex items-center gap-4">
            <div className="p-3 bg-yellow-500/20 rounded-lg text-yellow-500">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-bold uppercase tracking-widest">Total Bounties</p>
              <p className="text-2xl font-black">{stats.totalBounties}</p>
            </div>
          </div>
          <button 
            onClick={() => navigate('/network')}
            className="bg-accent/10 border border-accent/20 hover:bg-accent/20 transition-colors rounded-xl p-6 flex items-center gap-4 text-left group"
          >
            <div className="p-3 bg-accent/20 rounded-lg text-accent group-hover:scale-110 transition-transform">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-accent font-bold uppercase tracking-widest">Network Map</p>
              <p className="text-xs text-muted-foreground mt-1">View Topology</p>
            </div>
          </button>
        </div>

        {/* User Management */}
        <div className="bg-secondary/30 border border-white/10 rounded-xl overflow-hidden">
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
                  <tr key={user.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full border border-white/10" />
                        <div>
                          <p className="font-bold text-white">{user.display_name}</p>
                          <p className="text-xs text-muted-foreground">@{user.username}</p>
                        </div>
                      </div>
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
