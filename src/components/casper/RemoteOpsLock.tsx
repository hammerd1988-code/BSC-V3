import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Delete, Lock, ShieldCheck } from 'lucide-react';
import { haptic } from '../../lib/mobile';
import { cn } from '../../lib/utils';

const PIN_LENGTH = 4;
const storageKey = (userId: string) => `casper.remoteops.lock.${userId}`;

interface StoredPin {
  salt: string;
  hash: string;
}

function randomSalt(): string {
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function readStored(userId: string): StoredPin | null {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPin>;
    if (typeof parsed.salt === 'string' && typeof parsed.hash === 'string') {
      return { salt: parsed.salt, hash: parsed.hash };
    }
  } catch {
    /* ignore malformed entries */
  }
  return null;
}

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

/**
 * App-lock gate for Remote Ops on the native mobile shell. Because Remote Ops
 * can run shell directives on linked machines, a PIN provides a fast local
 * barrier if the phone is unlocked but left unattended. First launch sets the
 * PIN; subsequent launches require it. The PIN is only stored as a salted
 * SHA-256 hash in localStorage and never leaves the device.
 */
export const RemoteOpsLock: React.FC<{ userId: string; children: React.ReactNode }> = ({ userId, children }) => {
  const [stored, setStored] = useState<StoredPin | null>(() => readStored(userId));
  const [unlocked, setUnlocked] = useState(false);
  const [entry, setEntry] = useState('');
  const [confirmEntry, setConfirmEntry] = useState('');
  const [stage, setStage] = useState<'enter' | 'confirm'>('enter');
  const [shake, setShake] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isSetup = stored === null;
  const active = stage === 'confirm' ? confirmEntry : entry;

  useEffect(() => {
    setStored(readStored(userId));
    setUnlocked(false);
    setEntry('');
    setConfirmEntry('');
    setStage('enter');
  }, [userId]);

  const fail = useCallback((msg: string) => {
    haptic('error');
    setErrorMsg(msg);
    setShake(true);
    setTimeout(() => setShake(false), 400);
  }, []);

  const completeSetup = useCallback(async (pin: string) => {
    const salt = randomSalt();
    const hash = await hashPin(pin, salt);
    const record = { salt, hash };
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(record));
    } catch {
      /* storage may be unavailable; gate still unlocks for this session */
    }
    setStored(record);
    haptic('success');
    setUnlocked(true);
  }, [userId]);

  const attemptUnlock = useCallback(async (pin: string) => {
    if (!stored) return;
    const hash = await hashPin(pin, stored.salt);
    if (hash === stored.hash) {
      haptic('success');
      setUnlocked(true);
    } else {
      setEntry('');
      fail('Incorrect PIN. Try again.');
    }
  }, [stored, fail]);

  // Advance the flow whenever a full-length PIN is entered.
  useEffect(() => {
    if (active.length !== PIN_LENGTH) return;
    if (isSetup) {
      if (stage === 'enter') {
        setTimeout(() => { setStage('confirm'); }, 120);
      } else {
        if (confirmEntry === entry) {
          void completeSetup(confirmEntry);
        } else {
          setEntry('');
          setConfirmEntry('');
          setStage('enter');
          fail('PINs did not match. Start over.');
        }
      }
    } else {
      void attemptUnlock(entry);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const press = (key: string) => {
    setErrorMsg(null);
    if (key === 'del') {
      haptic('light');
      if (stage === 'confirm') setConfirmEntry((p) => p.slice(0, -1));
      else setEntry((p) => p.slice(0, -1));
      return;
    }
    if (!key) return;
    haptic('light');
    if (stage === 'confirm') {
      setConfirmEntry((p) => (p.length < PIN_LENGTH ? p + key : p));
    } else {
      setEntry((p) => (p.length < PIN_LENGTH ? p + key : p));
    }
  };

  const title = useMemo(() => {
    if (!isSetup) return 'Enter your PIN';
    return stage === 'enter' ? 'Set a Remote Ops PIN' : 'Confirm your PIN';
  }, [isSetup, stage]);

  if (unlocked) return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col items-center justify-between bg-[#050508] px-6 pt-safe pb-safe text-white">
      <div className="flex flex-1 flex-col items-center justify-center">
        <span className="grid h-14 w-14 place-items-center rounded-3xl border border-cyan-400/30 bg-cyan-500/10">
          {isSetup ? <ShieldCheck className="h-7 w-7 text-cyan-300" /> : <Lock className="h-7 w-7 text-cyan-300" />}
        </span>
        <h1 className="mt-4 text-base font-black tracking-tight">{title}</h1>
        <p className="mt-1 max-w-xs text-center text-xs text-zinc-500">
          {isSetup
            ? 'Protect remote machine control with a 4-digit PIN stored only on this device.'
            : 'Remote Ops can run commands on your machines — confirm it\u2019s you.'}
        </p>

        <div className={cn('mt-7 flex gap-3', shake && 'animate-[shake_0.4s]')}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-3.5 w-3.5 rounded-full border transition',
                i < active.length ? 'border-cyan-400 bg-cyan-400' : 'border-white/25 bg-transparent',
              )}
            />
          ))}
        </div>
        <p className="mt-3 h-4 text-[11px] text-red-400">{errorMsg}</p>
      </div>

      <div className="grid w-full max-w-xs grid-cols-3 gap-3 pb-6">
        {KEYPAD.map((key, i) => (
          <button
            key={i}
            type="button"
            disabled={!key}
            onClick={() => press(key)}
            className={cn(
              'grid h-16 w-full place-items-center rounded-2xl text-xl font-bold transition active:scale-90',
              !key
                ? 'pointer-events-none opacity-0'
                : key === 'del'
                  ? 'text-zinc-400'
                  : 'border border-white/10 bg-white/[0.04] text-white hover:border-cyan-400/30',
            )}
          >
            {key === 'del' ? <Delete className="h-6 w-6" /> : key}
          </button>
        ))}
      </div>
    </div>
  );
};
