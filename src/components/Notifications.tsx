import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, CheckCircle2, HeartHandshake, Loader2, MessageSquare, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { cn } from '../lib/utils';

type NotificationData = Record<string, any>;

interface AppNotification {
  id: string;
  user_id?: string;
  type: string;
  data: NotificationData;
  payload?: NotificationData;
  read: boolean;
  is_read?: boolean;
  created_at: string;
}

const isRecord = (value: unknown): value is NotificationData =>
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
    id: toSafeString(source.id),
    type: toSafeString(source.type, 'notification'),
    data,
    read: Boolean(source.read ?? source.is_read ?? false),
    created_at: toSafeString(source.created_at, new Date().toISOString()),
  } as AppNotification;
}

function getNotificationIcon(type: string) {
  if (type === 'friend_request') return <HeartHandshake className="w-5 h-5 text-pink-400" />;
  if (type === 'friend_accepted') return <CheckCircle2 className="w-5 h-5 text-green-400" />;
  if (type === 'comment') return <MessageSquare className="w-5 h-5 text-purple-300" />;
  return <Bell className="w-5 h-5 text-accent" />;
}

function getNotificationText(notif: AppNotification): string {
  const name = toSafeString(notif.data?.from_display_name) || toSafeString(notif.data?.senderName) || toSafeString(notif.data?.from_username) || 'Someone';
  const preview = toSafeString(notif.data?.preview) || toSafeString(notif.data?.message) || toSafeString(notif.data?.messagePreview);

  if (notif.type === 'friend_request') return `${name} sent you a friend request`;
  if (notif.type === 'friend_accepted') return `${name} accepted your friend request`;
  if (notif.type === 'mention') return `${name} mentioned you${preview ? `: ${preview}` : ''}`;
  if (notif.type === 'comment') return `${name} commented${preview ? `: ${preview}` : ''}`;
  if (notif.type === 'tip') return `${name} tipped you${preview ? `: ${preview}` : ''}`;
  return preview || toSafeString(notif.data?.message, 'New notification') || 'New notification';
}

export const Notifications: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

  const fetchNotifications = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setNotifications((data ?? []).map(normalizeNotification));
    } catch (error) {
      console.error('[Notifications] Failed to load notifications:', error);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    void fetchNotifications();

    const channel = supabase
      .channel(`notifications-page-${currentUser.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${currentUser.id}`,
      }, () => {
        void fetchNotifications();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentUser, fetchNotifications]);

  const markNotificationRead = async (notif: AppNotification) => {
    if (notif.read || !notif.id) return;

    const { error: isReadError } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notif.id);

    if (isReadError) {
      await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notif.id);
    }

    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true, is_read: true } : n));
  };

  const markAllRead = async () => {
    if (!currentUser || unreadCount === 0) return;
    setMarkingAll(true);
    try {
      const { error: isReadError } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', currentUser.id)
        .eq('is_read', false);

      if (isReadError) {
        await supabase
          .from('notifications')
          .update({ read: true })
          .eq('user_id', currentUser.id)
          .eq('read', false);
      }

      setNotifications(prev => prev.map(n => ({ ...n, read: true, is_read: true })));
    } catch (error) {
      console.error('[Notifications] Failed to mark all read:', error);
    } finally {
      setMarkingAll(false);
    }
  };

  const handleNotificationClick = async (notif: AppNotification) => {
    await markNotificationRead(notif);

    const url = toSafeString(notif.data?.url);
    const fromUsername = toSafeString(notif.data?.from_username) || toSafeString(notif.data?.senderUsername);

    if (url) {
      navigate(url);
    } else if (fromUsername) {
      navigate(`/profile/${fromUsername}`);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-28 text-foreground">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-background/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="shrink-0 rounded-full p-2 text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
              aria-label="Go back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-black uppercase italic tracking-tight text-white">Notifications</h1>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gray-500">
                {unreadCount > 0 ? `${unreadCount} unread signal${unreadCount === 1 ? '' : 's'}` : 'All signals synchronized'}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => void fetchNotifications()}
              className="rounded-full border border-white/10 p-2 text-gray-400 transition-colors hover:border-white/20 hover:text-white"
              aria-label="Refresh notifications"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              onClick={() => void markAllRead()}
              disabled={markingAll || unreadCount === 0}
              className="rounded-full border border-accent/30 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {markingAll ? 'Syncing' : 'Mark read'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-5">
        {loading ? (
          <div className="flex min-h-[45vh] flex-col items-center justify-center gap-3 text-gray-500">
            <Loader2 className="h-7 w-7 animate-spin text-accent" />
            <p className="text-xs font-black uppercase tracking-[0.25em]">Loading signals</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-surface/70 p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Bell className="h-7 w-7" />
            </div>
            <h2 className="text-sm font-black uppercase tracking-widest text-white">No notifications yet</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              Comments, mentions, friend activity, and other BSC signals will appear here when they arrive.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map((notif) => (
              <button
                key={notif.id}
                onClick={() => void handleNotificationClick(notif)}
                className={cn(
                  'flex w-full min-w-0 items-start gap-3 rounded-2xl border p-4 text-left transition-all',
                  notif.read
                    ? 'border-white/5 bg-surface/45 hover:border-white/10 hover:bg-surface/70'
                    : 'border-accent/30 bg-accent/10 shadow-[0_0_22px_rgba(255,0,0,0.08)] hover:bg-accent/15'
                )}
              >
                <div className="mt-0.5 shrink-0 rounded-xl border border-white/10 bg-black/30 p-2">
                  {getNotificationIcon(notif.type)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="min-w-0 break-words text-sm font-semibold leading-relaxed text-white">
                      {getNotificationText(notif)}
                    </p>
                    {!notif.read && (
                      <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-white">
                        New
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">
                    {formatDistanceToNow(new Date(notif.created_at))} ago
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};
