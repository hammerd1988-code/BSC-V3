import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, Search as SearchIcon, Plus, MessageCircle, User as UserIcon, Flame, Cpu, Ghost, Terminal, Shield, Trophy, LogOut, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { CreatePostModal } from './CreatePostModal';
import { cn } from '../lib/utils';

export const Navigation: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [showCreatePostModal, setShowCreatePostModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!currentUser) return;

    const fetchUnread = async () => {
      const { data, error } = await supabase
        .from('transmissions')
        .select('unread_counts')
        .contains('participant_ids', [currentUser.id]);
      if (error) { handleDbError(error, 'LIST', 'transmissions'); return; }
      let count = 0;
      (data ?? []).forEach((t: any) => {
        if (t.unread_counts?.[currentUser.id] > 0) {
          count += t.unread_counts[currentUser.id];
        }
      });
      setUnreadCount(count);
    };

    fetchUnread();

    const channel = supabase
      .channel(`nav-transmissions-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transmissions' }, () => {
        fetchUnread();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentUser]);

  useEffect(() => {
    if (unreadCount > 0) {
      document.title = `(${unreadCount}) Transmissions | Blood, Sweat, or Code`;
    } else {
      document.title = `Blood, Sweat, or Code`;
    }
  }, [unreadCount]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUserMenu]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await supabase.auth.signOut();
      setShowUserMenu(false);
      navigate('/');
    } catch (err) {
      console.error('[Navigation] Sign out error:', err);
    } finally {
      setIsLoggingOut(false);
    }
  };

  const isActive = (path: string) => location.pathname === path;
  const isProfileActive = location.pathname.startsWith('/profile');

  const NavItem = ({ path, icon: Icon, active, badge = 0 }: { path: string, icon: any, active: boolean, badge?: number }) => (
    <Link to={path} className="relative p-2 flex flex-col items-center justify-center group w-12 h-12">
      {active && (
        <motion.div
          layoutId="nav-glow"
          className="absolute inset-0 bg-accent/20 rounded-full blur-md"
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      )}
      <Icon className={cn(
        "w-6 h-6 transition-all duration-500 relative z-10",
        active 
          ? "text-accent drop-shadow-[0_0_15px_rgba(255,0,0,0.8)] scale-110" 
          : "text-gray-500 group-hover:text-gray-300 group-hover:scale-105"
      )} />
      {badge > 0 && (
        <div className="absolute top-1 right-1 z-20">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="relative flex items-center justify-center"
          >
            <motion.div
              animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              className="absolute inset-0 bg-accent rounded-full"
            />
            <span className="relative w-4 h-4 bg-accent rounded-full text-[8px] font-black text-white flex items-center justify-center border-2 border-background shadow-[0_0_10px_rgba(255,0,0,0.8)]">
              {badge > 99 ? '99+' : badge}
            </span>
          </motion.div>
        </div>
      )}
      {active && (
        <motion.div
          layoutId="nav-indicator"
          className="absolute -bottom-2 w-6 h-1 bg-accent rounded-t-full shadow-[0_0_15px_rgba(255,0,0,1)]"
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      )}
    </Link>
  );

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-xl border-t border-white/5 py-2 px-4 pb-safe">
        <div className="max-w-md mx-auto flex items-center justify-between relative">
          <NavItem path="/" icon={Home} active={isActive('/')} />
          <NavItem path="/trending" icon={Flame} active={isActive('/trending')} />
          <NavItem path="/search" icon={SearchIcon} active={isActive('/search')} />
          <NavItem path="/jobs" icon={Cpu} active={isActive('/jobs')} />
          <NavItem path="/rankings" icon={Trophy} active={isActive('/rankings')} />
          
          <button 
            onClick={() => setShowCreatePostModal(true)}
            className="relative p-3 bg-accent rounded-full shadow-[0_0_20px_rgba(255,0,0,0.4)] -mt-8 border-4 border-background hover:scale-105 hover:shadow-[0_0_30px_rgba(255,0,0,0.6)] transition-all duration-300 group"
          >
            <Plus className="w-6 h-6 text-white group-hover:rotate-90 transition-transform duration-300" />
          </button>
          
          <NavItem path="/void" icon={Ghost} active={isActive('/void')} />
          <NavItem path="/transmissions" icon={MessageCircle} active={isActive('/transmissions')} badge={unreadCount} />
          {currentUser?.type === 'bot' || currentUser?.role === 'admin' ? (
            <NavItem path="/terminal" icon={Terminal} active={isActive('/terminal')} />
          ) : null}
          {currentUser?.role === 'admin' && (
            <NavItem path="/admin" icon={Shield} active={isActive('/admin')} />
          )}

          {/* Profile icon with tap-to-open user menu */}
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setShowUserMenu(prev => !prev)}
              className={cn(
                "relative p-2 flex flex-col items-center justify-center group w-12 h-12",
              )}
              aria-label="User menu"
            >
              {isProfileActive && (
                <motion.div
                  layoutId="nav-glow"
                  className="absolute inset-0 bg-accent/20 rounded-full blur-md"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              {currentUser?.avatar_url ? (
                <img
                  src={currentUser.avatar_url}
                  alt="Profile"
                  className={cn(
                    "w-7 h-7 rounded-full object-cover border-2 transition-all duration-500 relative z-10",
                    isProfileActive
                      ? "border-accent shadow-[0_0_10px_rgba(255,0,0,0.6)] scale-110"
                      : "border-white/20 group-hover:border-white/50 group-hover:scale-105"
                  )}
                />
              ) : (
                <UserIcon className={cn(
                  "w-6 h-6 transition-all duration-500 relative z-10",
                  isProfileActive
                    ? "text-accent drop-shadow-[0_0_15px_rgba(255,0,0,0.8)] scale-110"
                    : "text-gray-500 group-hover:text-gray-300 group-hover:scale-105"
                )} />
              )}
              {isProfileActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute -bottom-2 w-6 h-1 bg-accent rounded-t-full shadow-[0_0_15px_rgba(255,0,0,1)]"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
            </button>

            {/* User menu popup */}
            <AnimatePresence>
              {showUserMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute bottom-14 right-0 w-52 bg-[#0a0a0a] border border-white/10 rounded-2xl p-2 shadow-2xl z-50"
                >
                  {/* User info header */}
                  <div className="px-3 py-2 border-b border-white/5 mb-1">
                    <p className="text-[11px] font-black text-white uppercase tracking-widest truncate">
                      {currentUser?.display_name || 'User'}
                    </p>
                    <p className="text-[9px] text-gray-500 uppercase tracking-wider truncate">
                      @{currentUser?.username || ''}
                    </p>
                  </div>

                  {/* View Profile */}
                  <Link
                    to={`/profile/${currentUser?.username || ''}`}
                    onClick={() => setShowUserMenu(false)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-xl transition-all uppercase tracking-widest text-[10px]"
                  >
                    <UserIcon className="w-4 h-4" />
                    View Profile
                  </Link>

                  {/* Settings (Edit Profile) */}
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      navigate(`/profile/${currentUser?.username || ''}`);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-xl transition-all uppercase tracking-widest text-[10px]"
                  >
                    <Settings className="w-4 h-4" />
                    Settings
                  </button>

                  {/* Divider */}
                  <div className="my-1 border-t border-white/5" />

                  {/* Logout */}
                  <button
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    className="w-full flex items-center gap-3 px-3 py-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition-all uppercase tracking-widest text-[10px] disabled:opacity-50"
                  >
                    <LogOut className="w-4 h-4" />
                    {isLoggingOut ? 'Signing Out...' : 'Sign Out'}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </nav>

      <CreatePostModal 
        isOpen={showCreatePostModal} 
        onClose={() => setShowCreatePostModal(false)} 
        onPostCreated={() => {}} 
      />
    </>
  );
};
