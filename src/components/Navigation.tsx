import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, Search as SearchIcon, Plus, MessageCircle, User as UserIcon, Flame, Bot, Ghost, Terminal, Shield, LogOut, Settings, Bell, HeartHandshake, CheckCircle2, X, Swords, BrainCircuit, Radio, Video, CloudFog, Loader2, HelpCircle, ShieldAlert, UsersRound, Wand2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { CreatePostModal } from './CreatePostModal';
import { cn } from '../lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { playCommentSound, playMentionSound } from '../lib/sounds';
import { NotificationEnableButton } from './NotificationEnableButton';
import { useAskCasper } from './AskCasperWidget';
import { ReportModal } from './ReportModal';

interface AppNotification {
  id: string;
  type: string;
  data: Record<string, any>;
  payload?: Record<string, any>;
  read: boolean;
  is_read?: boolean;
  created_at: string;
}

interface LinkRequest {
  from_id: string;
  from_username?: string;
  from_display_name?: string;
  from_avatar_url?: string | null;
  sent_at?: string;
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
  const { openWidget: openAskCasper } = useAskCasper();
  const [unreadCount, setUnreadCount] = useState(0);
  const [showCreatePostModal, setShowCreatePostModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showGeneralReport, setShowGeneralReport] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const [linkRequests, setLinkRequests] = useState<LinkRequest[]>([]);
  const [linkActionId, setLinkActionId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const requests = Array.isArray(currentUser?.friend_requests) ? currentUser.friend_requests : [];
    setLinkRequests(
      requests
        .filter((request: any) => request && typeof request.from_id === 'string')
        .map((request: any) => ({
          from_id: request.from_id,
          from_username: request.from_username,
          from_display_name: request.from_display_name,
          from_avatar_url: request.from_avatar_url,
          sent_at: request.sent_at,
        }))
    );
  }, [currentUser?.friend_requests]);

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

  const handleSyncLinkRequest = async (request: LinkRequest) => {
    if (!currentUser || !request.from_id) return;
    setLinkActionId(request.from_id);
    try {
      const filteredRequests = linkRequests.filter(item => item.from_id !== request.from_id);
      const myFriends = Array.from(new Set([...(currentUser.friends ?? []), request.from_id]));
      const { data: senderData, error: senderError } = await supabase
        .from('users')
        .select('friends')
        .eq('id', request.from_id)
        .maybeSingle();
      if (senderError) throw senderError;

      const senderFriends = Array.isArray(senderData?.friends) ? senderData.friends as string[] : [];
      const theirFriends = Array.from(new Set([...senderFriends, currentUser.id]));

      const [meUpdate, themUpdate, acceptedNotice] = await Promise.all([
        supabase.from('users').update({ friend_requests: filteredRequests, friends: myFriends }).eq('id', currentUser.id),
        supabase.from('users').update({ friends: theirFriends }).eq('id', request.from_id),
        supabase.from('notifications').insert({
          user_id: request.from_id,
          type: 'friend_accepted',
          payload: {
            from_id: currentUser.id,
            from_username: currentUser.username,
            from_display_name: currentUser.display_name,
            from_avatar_url: currentUser.avatar_url,
            message: `Neural Link established: @${currentUser.username} synchronized your handshake`,
            url: `/profile/${currentUser.username}`,
          },
          is_read: false,
          created_at: new Date().toISOString(),
        }),
      ]);

      const failed = [meUpdate, themUpdate, acceptedNotice].find(result => result.error);
      if (failed?.error) throw failed.error;

      setLinkRequests(filteredRequests);
      setNotifications(prev => prev.filter(notif => !(notif.type === 'friend_request' && toSafeString(notif.data?.from_id) === request.from_id)));
      setNotifUnread(prev => Math.max(0, prev - 1));
    } catch (error) {
      handleDbError(error, 'UPDATE', `users/${currentUser.id}/link_requests`);
    } finally {
      setLinkActionId(null);
    }
  };

  const handleRejectLinkRequest = async (request: LinkRequest) => {
    if (!currentUser || !request.from_id) return;
    setLinkActionId(request.from_id);
    try {
      const filteredRequests = linkRequests.filter(item => item.from_id !== request.from_id);
      const { error } = await supabase
        .from('users')
        .update({ friend_requests: filteredRequests })
        .eq('id', currentUser.id);
      if (error) throw error;

      setLinkRequests(filteredRequests);
      setNotifications(prev => prev.filter(notif => !(notif.type === 'friend_request' && toSafeString(notif.data?.from_id) === request.from_id)));
      setNotifUnread(prev => Math.max(0, prev - 1));
    } catch (error) {
      handleDbError(error, 'UPDATE', `users/${currentUser.id}/link_requests`);
    } finally {
      setLinkActionId(null);
    }
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
    if (type === 'follow') return <Radio className="w-4 h-4 text-cyan-300" />;
    if (type === 'mention') return <Bell className="w-4 h-4 text-cyan-300" />;
    if (type === 'comment') return <Bell className="w-4 h-4 text-purple-300" />;
    return <Bell className="w-4 h-4 text-accent" />;
  };

  const getNotifText = (notif: AppNotification): string => {
    const name = toSafeString(notif.data?.from_display_name) || toSafeString(notif.data?.from_username) || 'Someone';
    const preview = toSafeString(notif.data?.preview) || toSafeString(notif.data?.message);
    if (notif.type === 'friend_request') return `${name} sent a Link Request`;
    if (notif.type === 'friend_accepted') return `${name} established a Neural Link`;
    if (notif.type === 'follow') return `New Watcher Detected: @${toSafeString(notif.data?.from_username) || name} has locked onto your signal`;
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
      const target = e.target as Node;
      const clickedInsideUserMenu =
        (menuRef.current && menuRef.current.contains(target)) ||
        (mobileMenuRef.current && mobileMenuRef.current.contains(target));
      if (!clickedInsideUserMenu) {
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
      <Link to={path} className="relative p-2 flex flex-col items-center justify-center group w-12 h-12 shrink-0" aria-label={path === '/' ? 'Home feed' : path.replace('/', '')}>
        {active && (
          <motion.div
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
            className="absolute -bottom-2 w-6 h-1 rounded-t-full"
            style={{ backgroundColor: color, boxShadow: `0 0 15px ${glowColor}` }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          />
        )}
      </Link>
    );
  };

  const mobileMoreItems = [
    { path: '/trending', label: 'Trending', icon: Flame, active: isActive('/trending'), color: '#FF8800' },
    { path: '/search', label: 'Search', icon: SearchIcon, active: isActive('/search'), color: '#66CCFF' },
    { path: '/bots', label: 'Bots', icon: Bot, active: isActive('/bots'), color: '#00CCFF' },
    { path: '/bots/mayhem', label: 'Mayhem', icon: Wand2, active: isActive('/bots/mayhem'), color: '#FF3366' },
    { path: '/factions', label: 'Factions', icon: UsersRound, active: location.pathname.startsWith('/factions'), color: '#FFD166' },
    { path: '/golive', label: 'Go Live', icon: Radio, active: isActive('/golive'), color: '#FF0044' },
    { path: '/videos', label: 'Videos', icon: Video, active: isActive('/videos'), color: '#4488FF' },
    { path: '/casper', label: 'Casper', icon: Ghost, active: location.pathname.startsWith('/casper'), color: '#AA66FF' },
    { path: '/void', label: 'Void Feed', icon: CloudFog, active: isActive('/void'), color: '#FF00FF' },
    (currentUser?.type === 'bot' || currentUser?.role === 'admin')
      ? { path: '/terminal', label: 'Terminal', icon: Terminal, active: isActive('/terminal'), color: '#39FF14' }
      : null,
    currentUser?.role === 'admin'
      ? { path: '/admin', label: 'Admin', icon: Shield, active: isActive('/admin'), color: '#FFD700' }
      : null,
    { path: '/notifications', label: 'Notifications', icon: Bell, active: isActive('/notifications'), color: '#FF66CC', badge: notifUnread },
  ].filter(Boolean) as Array<{ path: string; label: string; icon: any; active: boolean; color: string; badge?: number }>;

  const isMoreActive = showUserMenu || isProfileActive || mobileMoreItems.some(item => item.active);

  const MoreMenuItem: React.FC<{ item: { path: string; label: string; icon: any; active: boolean; color: string; badge?: number }; onClick?: () => void }> = ({ item, onClick }) => {
    const Icon = item.icon;
    const glowColor = hexToRgba(item.color, item.active ? 0.75 : 0.35);

    return (
      <Link
        to={item.path}
        onClick={() => {
          onClick?.();
          setShowUserMenu(false);
        }}
        className={cn(
          "relative flex items-center gap-3 overflow-hidden rounded-2xl border px-3 py-3 text-left transition-all duration-300",
          item.active
            ? "border-white/15 bg-white/[0.08] text-white"
            : "border-white/5 bg-white/[0.035] text-gray-300 hover:border-white/15 hover:bg-white/[0.07] hover:text-white"
        )}
        style={{ boxShadow: item.active ? `0 0 22px ${hexToRgba(item.color, 0.18)}` : undefined }}
      >
        <span
          className="absolute inset-y-2 left-0 w-0.5 rounded-full"
          style={{ backgroundColor: item.color, boxShadow: `0 0 14px ${glowColor}` }}
        />
        <Icon
          className="relative z-10 h-5 w-5 shrink-0 transition-transform duration-300 group-hover:scale-105"
          style={{ color: item.color, filter: `drop-shadow(0 0 9px ${glowColor})` }}
        />
        <span className="relative z-10 min-w-0 flex-1 truncate text-[11px] font-black uppercase tracking-[0.18em]">
          {item.label}
        </span>
        {item.badge && item.badge > 0 ? (
          <span
            className="relative z-10 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[9px] font-black text-white"
            style={{ backgroundColor: item.color, boxShadow: `0 0 12px ${glowColor}` }}
          >
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        ) : null}
      </Link>
    );
  };

  const ProfileMoreButton = ({ mobile = false }: { mobile?: boolean }) => {
    const glowColor = hexToRgba('#FFD700', isMoreActive ? 0.85 : 0.35);

    return (
      <div ref={mobile ? mobileMenuRef : menuRef} className="relative flex justify-center md:block">
        <button
          onClick={() => { setShowUserMenu(prev => !prev); setShowNotifications(false); }}
          className="relative p-2 flex flex-col items-center justify-center group w-12 h-12 shrink-0"
          aria-label="More menu"
          aria-expanded={showUserMenu}
        >
          {isMoreActive && (
            <motion.div
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
                isMoreActive
                  ? "border-[#FFD700] shadow-[0_0_14px_rgba(255,215,0,0.85)] scale-110"
                  : "border-[#FFD700]/40 shadow-[0_0_7px_rgba(255,215,0,0.35)] group-hover:border-[#FFD700]/70 group-hover:scale-105"
              )}
            />
          ) : (
            <UserIcon
              className={cn(
                "w-6 h-6 transition-all duration-500 relative z-10 group-hover:scale-105",
                isMoreActive && "scale-110"
              )}
              style={{
                color: isMoreActive ? '#FFD700' : hexToRgba('#FFD700', 0.48),
                filter: `drop-shadow(0 0 ${isMoreActive ? '15px' : '7px'} ${glowColor})`,
              }}
            />
          )}
          {notifUnread > 0 && (
            <div className="absolute top-1 right-1 z-20">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="relative flex items-center justify-center">
                <motion.div
                  animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-0 rounded-full bg-pink-500"
                />
                <span className="relative w-4 h-4 rounded-full bg-pink-500 text-[8px] font-black text-white flex items-center justify-center border-2 border-background shadow-[0_0_10px_rgba(236,72,153,0.85)]">
                  {notifUnread > 9 ? '9+' : notifUnread}
                </span>
              </motion.div>
            </div>
          )}
          {isMoreActive && (
            <motion.div
              className="absolute -bottom-2 w-6 h-1 rounded-t-full"
              style={{ backgroundColor: '#FFD700', boxShadow: `0 0 15px ${glowColor}` }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            />
          )}
        </button>

        <AnimatePresence>
          {showUserMenu && (
            <>
              <motion.button
                type="button"
                aria-label="Close more menu"
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setShowUserMenu(false)}
              />
              <motion.div
                initial={{ opacity: 0, y: 36, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 28, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 360, damping: 32 }}
                className="fixed inset-x-3 bottom-20 z-50 max-h-[72vh] overflow-hidden rounded-[2rem] border border-white/10 bg-[#07080c]/90 p-3 shadow-[0_0_45px_rgba(0,255,255,0.16)] backdrop-blur-2xl md:inset-x-auto md:bottom-24 md:right-4 md:w-56 md:max-h-[80vh] md:rounded-2xl md:bg-[#0a0a0a]/95 md:p-2 md:shadow-2xl"
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,255,255,0.14),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(255,0,255,0.14),transparent_34%)]" />
                <div className="relative max-h-[calc(72vh-1.5rem)] overflow-y-auto pr-1 md:max-h-[calc(80vh-1rem)]">
                  <div className="mb-3 flex items-center justify-between border-b border-white/10 px-2 pb-3 md:mb-1 md:px-3 md:py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-black uppercase tracking-widest text-white">
                        {currentUser?.display_name || 'User'}
                      </p>
                      <p className="truncate text-[9px] uppercase tracking-wider text-gray-500">
                        @{currentUser?.username || ''}
                      </p>
                    </div>
                    <button onClick={() => setShowUserMenu(false)} className="rounded-full border border-white/10 bg-white/5 p-2 text-gray-400 transition-colors hover:text-white md:hidden" aria-label="Close more menu">
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mb-3 grid grid-cols-2 gap-2 border-b border-white/10 pb-3 md:hidden">
                    {mobileMoreItems.map(item => (
                      <MoreMenuItem
                        key={item.label}
                        item={item}
                        onClick={item.path === '/notifications' ? () => void markAllNotificationsRead() : undefined}
                      />
                    ))}
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
                    Visual Forge
                  </Link>

                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      openAskCasper();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-cyan-200 hover:text-white hover:bg-cyan-300/10 rounded-xl transition-all uppercase tracking-widest text-[10px]"
                  >
                    <HelpCircle className="w-4 h-4" />
                    Ask Casper
                  </button>

                  <NotificationEnableButton />

                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      setShowGeneralReport(true);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-red-200 hover:text-white hover:bg-red-500/10 rounded-xl transition-all uppercase tracking-widest text-[10px]"
                  >
                    <ShieldAlert className="w-4 h-4" />
                    Report Issue
                  </button>

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
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-xl border-t border-white/5 py-2 px-3 pb-safe">
        <div className="mx-auto w-full max-w-md md:max-w-6xl">
          <div className="grid grid-cols-5 items-end gap-1 md:hidden">
            <div className="flex justify-center">
              <NavItem path="/" icon={Home} active={isActive('/')} color="#00FFFF" />
            </div>
            <div className="flex justify-center">
              <NavItem path="/colosseum" icon={Swords} active={isActive('/colosseum')} color="#FF4444" />
            </div>
            <div className="flex justify-center">
              <button
                onClick={() => setShowCreatePostModal(true)}
                className="relative -mt-8 rounded-full border-4 border-background bg-accent p-3 shadow-[0_0_20px_rgba(255,0,0,0.4)] transition-all duration-300 hover:scale-105 hover:shadow-[0_0_30px_rgba(255,0,0,0.6)] group"
                aria-label="Create post"
              >
                <Plus className="w-6 h-6 text-white group-hover:rotate-90 transition-transform duration-300" />
              </button>
            </div>
            <div className="flex justify-center">
              <NavItem path="/transmissions" icon={MessageCircle} active={isActive('/transmissions')} badge={unreadCount} color="#00FF88" />
            </div>
            <ProfileMoreButton mobile />
          </div>

          <div className="hidden md:flex items-center justify-center gap-2 overflow-x-auto px-2">
            <NavItem path="/" icon={Home} active={isActive('/')} color="#00FFFF" />
            <NavItem path="/trending" icon={Flame} active={isActive('/trending')} color="#FF8800" />
            <NavItem path="/search" icon={SearchIcon} active={isActive('/search')} color="#66CCFF" />
            <NavItem path="/bots" icon={Bot} active={isActive('/bots')} color="#00CCFF" />
            <NavItem path="/bots/mayhem" icon={Wand2} active={isActive('/bots/mayhem')} color="#FF3366" />
            <NavItem path="/factions" icon={UsersRound} active={location.pathname.startsWith('/factions')} color="#FFD166" />
            <NavItem path="/colosseum" icon={Swords} active={isActive('/colosseum')} color="#FF4444" />
            <NavItem path="/golive" icon={Radio} active={isActive('/golive')} color="#FF0044" />
            <NavItem path="/videos" icon={Video} active={isActive('/videos')} color="#4488FF" />
            <NavItem path="/casper" icon={Ghost} active={location.pathname.startsWith('/casper')} color="#AA66FF" />

            <button
              onClick={() => setShowCreatePostModal(true)}
              className="relative -mt-8 shrink-0 rounded-full border-4 border-background bg-accent p-3 shadow-[0_0_20px_rgba(255,0,0,0.4)] transition-all duration-300 hover:scale-105 hover:shadow-[0_0_30px_rgba(255,0,0,0.6)] group"
              aria-label="Create post"
            >
              <Plus className="w-6 h-6 text-white group-hover:rotate-90 transition-transform duration-300" />
            </button>

            <NavItem path="/void" icon={CloudFog} active={isActive('/void')} color="#FF00FF" />
            <NavItem path="/transmissions" icon={MessageCircle} active={isActive('/transmissions')} badge={unreadCount} color="#00FF88" />

            <div ref={notifRef} className="relative shrink-0">
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
                {linkRequests.length > 0 && (
                  <div className="absolute bottom-1 left-1 z-20 flex min-w-4 items-center justify-center rounded-full border border-background bg-cyan-400 px-1 py-0.5 text-[8px] font-black text-black shadow-[0_0_12px_rgba(34,211,238,0.75)]">
                    {linkRequests.length > 9 ? '9+' : linkRequests.length}
                  </div>
                )}
              </button>

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
                      <p className="text-[11px] font-black text-white uppercase tracking-widest">Signal Center</p>
                      <button onClick={() => setShowNotifications(false)} className="text-gray-600 hover:text-white transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="border-b border-cyan-300/10 bg-cyan-300/[0.03] px-4 py-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <HeartHandshake className="h-3.5 w-3.5 text-cyan-300" />
                          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">Link Requests</p>
                        </div>
                        {linkRequests.length > 0 && (
                          <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[9px] font-black text-cyan-100">
                            {linkRequests.length}
                          </span>
                        )}
                      </div>
                      {linkRequests.length === 0 ? (
                        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-600">No neural handshakes pending</p>
                      ) : (
                        <div className="space-y-2">
                          {linkRequests.slice(0, 4).map((request) => {
                            const displayName = request.from_display_name || request.from_username || 'Unknown node';
                            return (
                              <div key={request.from_id} className="rounded-xl border border-cyan-300/10 bg-black/30 p-2 shadow-[0_0_18px_rgba(34,211,238,0.06)]">
                                <div className="flex items-center gap-2">
                                  <Link to={`/profile/${request.from_username}`} onClick={() => setShowNotifications(false)} className="flex min-w-0 flex-1 items-center gap-2">
                                    <img
                                      src={request.from_avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}`}
                                      alt=""
                                      className="h-8 w-8 rounded-full border border-cyan-300/20 object-cover"
                                    />
                                    <div className="min-w-0">
                                      <p className="truncate text-[11px] font-bold text-white">{displayName}</p>
                                      <p className="truncate font-mono text-[9px] text-gray-500">@{request.from_username}</p>
                                    </div>
                                  </Link>
                                  <div className="flex shrink-0 items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => void handleSyncLinkRequest(request)}
                                      disabled={linkActionId === request.from_id}
                                      className="rounded-lg bg-cyan-300 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-black transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-60"
                                    >
                                      {linkActionId === request.from_id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Sync'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleRejectLinkRequest(request)}
                                      disabled={linkActionId === request.from_id}
                                      className="rounded-lg border border-red-400/30 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-red-300 transition hover:bg-red-500/10 disabled:cursor-wait disabled:opacity-60"
                                    >
                                      Reject Signal
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="px-4 py-8 text-center">
                          <Bell className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                          <p className="text-[10px] text-gray-600 uppercase tracking-widest">No signal pings yet</p>
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
            <ProfileMoreButton />
          </div>
        </div>
      </nav>

      <CreatePostModal
        isOpen={showCreatePostModal}
        onClose={() => setShowCreatePostModal(false)}
        onPostCreated={() => {}}
      />
      {currentUser && (
        <ReportModal
          isOpen={showGeneralReport}
          onClose={() => setShowGeneralReport(false)}
          targetType="other"
          targetId={`general-${currentUser.id}`}
          targetOwnerId={null}
          targetLabel="General BSC Classic safety or moderation concern"
          targetPath="/"
        />
      )}
    </>
  );
};
