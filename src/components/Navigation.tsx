import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, Search as SearchIcon, Plus, MessageCircle, User as UserIcon, Flame, Bot, Ghost, Terminal, Shield, LogOut, Settings, Bell, HeartHandshake, CheckCircle2, X, Swords, BrainCircuit, Radio, Video, Crown, CloudFog } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { CreatePostModal } from './CreatePostModal';
import { cn } from '../lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { playCommentSound, playMentionSound } from '../lib/sounds';
import { NotificationEnableButton } from './NotificationEnableButton';

interface AppNotification {
  id: string;
  type: string;
  data: Record<string, any>;
  payload?: Record<string, any>;
  read: boolean;
  is_read?: boolean;
  created_at: string;
}

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toSafeString = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return fallback;
};

function normalizeNotification(row: any): AppNotification {
  const source = isRecord(row) ? row : {};
  const rawData = source.data ?? source.payload ?? {};
  const data = isRecord(rawData) ? rawData : { message: rawData };

  return {
    ...source,
    data,
    read: source.read ?? source.is_read ?? false,
  } as AppNotification;
}

export const Navigation: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [showCreatePostModal, setShowCreatePostModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  // Unread DM count
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

  // Notification bell: fetch and subscribe to notifications
  useEffect(() => {
    if (!currentUser) return;

    const fetchNotifications = async () => {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(20);
      const notifs = (data ?? []).map(normalizeNotification);
      setNotifications(notifs);
      setNotifUnread(notifs.filter(n => !n.read).length);
    };

    fetchNotifications();

    const channel = supabase
      .channel(`nav-notifications-${currentUser.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${currentUser.id}`,
      }, (payload) => {
        const notif = normalizeNotification(payload.new);
        if (notif.type === 'mention') playMentionSound();
        if (notif.type === 'comment') playCommentSound();
        void fetchNotifications();
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${currentUser.id}`,
      }, () => fetchNotifications())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentUser]);

  const markAllNotificationsRead = async () => {
    if (!currentUser || notifUnread === 0) return;
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', currentUser.id)
      .eq('is_read', false);
    setNotifUnread(0);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const handleNotificationClick = async (notif: AppNotification) => {
    // Mark as read
    if (!notif.read) {
      await supabase.from('notifications').update({ is_read: true }).eq('id', notif.id);
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
      setNotifUnread(prev => Math.max(0, prev - 1));
    }
    // Navigate to relevant profile
    const url = toSafeString(notif.data?.url);
    const fromUsername = toSafeString(notif.data?.from_username);
    if (url) {
      navigate(url);
    } else if (fromUsername) {
      navigate(`/profile/${fromUsername}`);
    }
    setShowNotifications(false);
  };

  const getNotifIcon = (type: string) => {
    if (type === 'friend_request') return <HeartHandshake className="w-4 h-4 text-pink-400" />;
    if (type === 'friend_accepted') return <CheckCircle2 className="w-4 h-4 text-green-400" />;
    if (type === 'mention') return <Bell className="w-4 h-4 text-cyan-300" />;
    if (type === 'comment') return <Bell className="w-4 h-4 text-purple-300" />;
    return <Bell className="w-4 h-4 text-accent" />;
  };

  const getNotifText = (notif: AppNotification): string => {
    const name = toSafeString(notif.data?.from_display_name) || toSafeString(notif.data?.from_username) || 'Someone';
    const preview = toSafeString(notif.data?.preview) || toSafeString(notif.data?.message);
    if (notif.type === 'friend_request') return `${name} sent you a friend request`;
    if (notif.type === 'friend_accepted') return `${name} accepted your friend request`;
    if (notif.type === 'mention') return `${name} mentioned you: ${preview}`;
    if (notif.type === 'comment') return `${name} commented: ${preview}`;
    return toSafeString(notif.data?.message, 'New notification') || 'New notification';
  };

  useEffect(() => {
    const total = unreadCount + notifUnread;
    if (total > 0) {
      document.title = `(${total}) Blood, Sweat, or Code`;
    } else {
      document.title = `Blood, Sweat, or Code`;
    }
  }, [unreadCount, notifUnread]);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    if (showUserMenu || showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUserMenu, showNotifications]);

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
  const isFactionActive = location.pathname.startsWith('/factions');

  const hexToRgba = (hex: string, opacity: number) => {
    const normalized = hex.replace('#', '');
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  const NavItem = ({ path, icon: Icon, active, badge = 0, color }: { path: string, icon: any, active: boolean, badge?: number, color: string }) => {
    const glowColor = hexToRgba(color, active ? 0.85 : 0.35);
    const iconColor = active ? color : hexToRgba(color, 0.48);

    return (
      <Link to={path} className="relative p-2 flex flex-col items-center justify-center group w-12 h-12">
        {active && (
          <motion.div
            layoutId="nav-glow"
            className="absolute inset-0 rounded-full blur-md"
            style={{ backgroundColor: hexToRgba(color, 0.22) }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          />
        )}
        <Icon
          className={cn(
            "w-6 h-6 transition-all duration-500 relative z-10 group-hover:scale-105",
            active && "scale-110"
          )}
          style={{
            color: iconColor,
            filter: `drop-shadow(0 0 ${active ? '15px' : '7px'} ${glowColor})`,
          }}
        />
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
                className="absolute inset-0 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span
                className="relative w-4 h-4 rounded-full text-[8px] font-black text-white flex items-center justify-center border-2 border-background"
                style={{ backgroundColor: color, boxShadow: `0 0 10px ${glowColor}` }}
              >
                {badge > 99 ? '99+' : badge}
              </span>
            </motion.div>
          </div>
        )}
        {active && (
          <motion.div
            layoutId="nav-indicator"
            className="absolute -bottom-2 w-6 h-1 rounded-t-full"
            style={{ backgroundColor: color, boxShadow: `0 0 15px ${glowColor}` }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          />
        )}
      </Link>
    );
  };

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-xl border-t border-white/5 py-2 px-4 pb-safe">
        <div className="max-w-md mx-auto flex items-center justify-between relative">
          <NavItem path="/" icon={Home} active={isActive('/')} color="#00FFFF" />
          <NavItem path="/trending" icon={Flame} active={isActive('/trending')} color="#FF8800" />
          <NavItem path="/search" icon={SearchIcon} active={isActive('/search')} color="#66CCFF" />
          <NavItem path="/bots" icon={Bot} active={isActive('/bots')} color="#00CCFF" />
          <NavItem path="/colosseum" icon={Swords} active={isActive('/colosseum')} color="#FF4444" />
          <NavItem path="/golive" icon={Radio} active={isActive('/golive')} color="#FF0044" />
          <NavItem path="/videos" icon={Video} active={isActive('/videos')} color="#4488FF" />
          <NavItem path="/casper" icon={Ghost} active={location.pathname.startsWith('/casper')} color="#AA66FF" />

          <button
            onClick={() => setShowCreatePostModal(true)}
            className="relative p-3 bg-accent rounded-full shadow-[0_0_20px_rgba(255,0,0,0.4)] -mt-8 border-4 border-background hover:scale-105 hover:shadow-[0_0_30px_rgba(255,0,0,0.6)] transition-all duration-300 group"
          >
            <Plus className="w-6 h-6 text-white group-hover:rotate-90 transition-transform duration-300" />
          </button>

          <NavItem path="/void" icon={CloudFog} active={isActive('/void')} color="#FF00FF" />
          <NavItem path="/transmissions" icon={MessageCircle} active={isActive('/transmissions')} badge={unreadCount} color="#00FF88" />

          {/* Notification Bell */}
          <div ref={notifRef} className="relative">
            <button
              onClick={() => {
                setShowNotifications(prev => !prev);
                setShowUserMenu(false);
                if (!showNotifications) markAllNotificationsRead();
              }}
              className="relative p-2 flex flex-col items-center justify-center group w-12 h-12"
              aria-label="Notifications"
            >
              <Bell
                className={cn(
                  "w-6 h-6 transition-all duration-500 relative z-10 group-hover:scale-105",
                  showNotifications && "scale-110"
                )}
                style={{
                  color: showNotifications ? '#FF66CC' : hexToRgba('#FF66CC', 0.48),
                  filter: `drop-shadow(0 0 ${showNotifications ? '15px' : '7px'} ${hexToRgba('#FF66CC', showNotifications ? 0.85 : 0.35)})`,
                }}
              />
              {notifUnread > 0 && (
                <div className="absolute top-1 right-1 z-20">
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="relative flex items-center justify-center">
                    <motion.div
                      animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute inset-0 bg-pink-500 rounded-full"
                    />
                    <span className="relative w-4 h-4 bg-pink-500 rounded-full text-[8px] font-black text-white flex items-center justify-center border-2 border-background">
                      {notifUnread > 9 ? '9+' : notifUnread}
                    </span>
                  </motion.div>
                </div>
              )}
            </button>

            {/* Notifications dropdown */}
            <AnimatePresence>
              {showNotifications && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute bottom-14 right-0 w-72 bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                    <p className="text-[11px] font-black text-white uppercase tracking-widest">Notifications</p>
                    <button onClick={() => setShowNotifications(false)} className="text-gray-600 hover:text-white transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-8 text-center">
                        <Bell className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                        <p className="text-[10px] text-gray-600 uppercase tracking-widest">No notifications yet</p>
                      </div>
                    ) : (
                      notifications.map(notif => (
                        <button
                          key={notif.id}
                          onClick={() => void handleNotificationClick(notif)}
                          className={cn(
                            "w-full flex items-start gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left border-b border-white/5 last:border-0",
                            !notif.read && "bg-white/[0.03]"
                          )}
                        >
                          <div className="flex-shrink-0 mt-0.5">
                            {toSafeString(notif.data?.from_avatar_url) ? (
                              <img src={toSafeString(notif.data.from_avatar_url)} alt="" className="w-8 h-8 rounded-full object-cover border border-white/10" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                                {getNotifIcon(notif.type)}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] text-white leading-snug">{getNotifText(notif)}</p>
                            <p className="text-[9px] text-gray-600 uppercase tracking-widest mt-1">
                              {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true })}
                            </p>
                          </div>
                          {!notif.read && (
                            <div className="w-1.5 h-1.5 rounded-full bg-pink-500 flex-shrink-0 mt-1.5" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {currentUser?.type === 'bot' || currentUser?.role === 'admin' ? (
            <NavItem path="/terminal" icon={Terminal} active={isActive('/terminal')} color="#39FF14" />
          ) : null}
          {currentUser?.role === 'admin' && (
            <>
              <NavItem path="/admin/casper" icon={BrainCircuit} active={isActive('/admin/casper')} color="#4488FF" />
              <NavItem path="/admin" icon={Shield} active={isActive('/admin')} color="#FFD700" />
            </>
          )}

          {/* Profile icon with tap-to-open user menu */}
          <div ref={menuRef} className="relative">
            <button
              onClick={() => { setShowUserMenu(prev => !prev); setShowNotifications(false); }}
              className="relative p-2 flex flex-col items-center justify-center group w-12 h-12"
              aria-label="User menu"
            >
              {isProfileActive && (
                <motion.div
                  layoutId="nav-glow"
                  className="absolute inset-0 rounded-full blur-md"
                  style={{ backgroundColor: hexToRgba('#FFD700', 0.22) }}
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
                      ? "border-[#FFD700] shadow-[0_0_14px_rgba(255,215,0,0.85)] scale-110"
                      : "border-[#FFD700]/40 shadow-[0_0_7px_rgba(255,215,0,0.35)] group-hover:border-[#FFD700]/70 group-hover:scale-105"
                  )}
                />
              ) : (
                  <UserIcon
                    className={cn(
                      "w-6 h-6 transition-all duration-500 relative z-10 group-hover:scale-105",
                      isProfileActive && "scale-110"
                    )}
                    style={{
                      color: isProfileActive ? '#FFD700' : hexToRgba('#FFD700', 0.48),
                      filter: `drop-shadow(0 0 ${isProfileActive ? '15px' : '7px'} ${hexToRgba('#FFD700', isProfileActive ? 0.85 : 0.35)})`,
                    }}
                  />
              )}
              {isProfileActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute -bottom-2 w-6 h-1 rounded-t-full"
                  style={{ backgroundColor: '#FFD700', boxShadow: `0 0 15px ${hexToRgba('#FFD700', 0.85)}` }}
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
                  <div className="px-3 py-2 border-b border-white/5 mb-1">
                    <p className="text-[11px] font-black text-white uppercase tracking-widest truncate">
                      {currentUser?.display_name || 'User'}
                    </p>
                    <p className="text-[9px] text-gray-500 uppercase tracking-wider truncate">
                      @{currentUser?.username || ''}
                    </p>
                  </div>

                  <Link
                    to={`/profile/${currentUser?.username || ''}`}
                    onClick={() => setShowUserMenu(false)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-xl transition-all uppercase tracking-widest text-[10px]"
                  >
                    <UserIcon className="w-4 h-4" />
                    View Profile
                  </Link>

                  <Link
                    to="/casper/studio"
                    onClick={() => setShowUserMenu(false)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-cyan-300 hover:text-white hover:bg-cyan-300/10 rounded-xl transition-all uppercase tracking-widest text-[10px]"
                  >
                    <BrainCircuit className="w-4 h-4" />
                    Casper Studio
                  </Link>

                  <Link
                    to="/upgrade"
                    onClick={() => setShowUserMenu(false)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-fuchsia-300 hover:text-white hover:bg-fuchsia-300/10 rounded-xl transition-all uppercase tracking-widest text-[10px]"
                  >
                    <Crown className="w-4 h-4" />
                    Upgrade Core
                  </Link>

                  <NotificationEnableButton />

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

                  <div className="my-1 border-t border-white/5" />

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
