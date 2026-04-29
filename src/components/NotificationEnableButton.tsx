import { useState } from 'react';
import { Bell, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { isPushSupported, subscribeCurrentUserToPush } from '../lib/notifications';
import { cn } from '../lib/utils';

export function NotificationEnableButton({ onDone }: { onDone?: () => void }) {
  const { currentUser } = useAuth();
  const [status, setStatus] = useState<'idle' | 'loading' | 'enabled' | 'unsupported' | 'error'>(() => {
    if (!isPushSupported()) return 'unsupported';
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') return 'enabled';
    return 'idle';
  });
  const [message, setMessage] = useState('');

  const enableNotifications = async () => {
    if (!currentUser) return;
    setStatus('loading');
    setMessage('');

    const result = await subscribeCurrentUserToPush(currentUser.id);
    if (result.success) {
      setStatus('enabled');
      setMessage('Neural alerts armed on this device.');
      onDone?.();
      return;
    }

    setStatus(result.reason?.includes('does not support') ? 'unsupported' : 'error');
    setMessage(result.reason || 'Unable to enable alerts on this device.');
  };

  const disabled = status === 'loading' || status === 'enabled' || status === 'unsupported' || !currentUser;
  const Icon = status === 'loading' ? Loader2 : status === 'enabled' ? CheckCircle2 : status === 'unsupported' || status === 'error' ? ShieldAlert : Bell;

  return (
    <div className="px-3 py-2 border-t border-white/5 border-b mb-1">
      <button
        type="button"
        onClick={() => void enableNotifications()}
        disabled={disabled}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all uppercase tracking-widest text-[10px]',
          status === 'enabled'
            ? 'text-green-300 bg-green-500/10'
            : status === 'unsupported' || status === 'error'
              ? 'text-yellow-300 bg-yellow-500/10'
              : 'text-accent hover:text-white hover:bg-accent/10',
          disabled && status !== 'idle' && 'cursor-default',
        )}
        aria-live="polite"
      >
        <Icon className={cn('w-4 h-4', status === 'loading' && 'animate-spin')} />
        {status === 'enabled' ? 'Alerts Enabled' : status === 'unsupported' ? 'Alerts Unsupported' : status === 'loading' ? 'Arming Alerts' : 'Enable Alerts'}
      </button>
      {message && <p className="mt-1 px-1 text-[9px] leading-snug text-gray-500">{message}</p>}
      {status === 'unsupported' && !message && (
        <p className="mt-1 px-1 text-[9px] leading-snug text-gray-500">
          Install BSC to your home screen on iOS Safari 16.4+ or use a Push-capable browser.
        </p>
      )}
    </div>
  );
}
