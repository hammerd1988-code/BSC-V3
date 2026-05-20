import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, 
  Search, 
  Mic,
  MicOff, 
  MoreVertical, 
  Phone, 
  Video, 
  ShieldAlert, 
  Lock, 
  Zap, 
  User, 
  Image as ImageIcon, 
  Paperclip, 
  Trash2, 
  Flame, 
  Shield, 
  ChevronLeft,
  Settings,
  X,
  Plus,
  ArrowRight,
  RefreshCw,
  Terminal,
  Activity,
  Cpu,
  Globe,
  AlertCircle,
  Check,
  CheckCheck,
  Download,
  FileText,
  Smile,
  Film,
  Sticker,
  Sparkles,
  Bot
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { useCall } from '../CallContext';
import { supabase } from '../supabase';
import { Transmission, Transmit, User as UserType } from '../types';
import { format } from 'date-fns';
import { Link, useSearchParams } from 'react-router-dom';
import { NewTransmissionModal } from './NewTransmissionModal';
import { GiphyPicker } from './GiphyPicker';
import { EmojiPicker } from './EmojiPicker';
import { playMessageSound } from '../lib/sounds';
import { notifyNewMessage, sendPushEvent } from '../lib/notifications';
import { encryptText, decryptText } from '../lib/crypto';
import { generateText } from '../lib/ai';
import { BOT_PERSONAS } from '../lib/botPersonas';
import { sendCasperCommand } from '../lib/casper';
import {
  TRANSMISSION_GIF_SIGNALS,
  TRANSMISSION_SIGNAL_TABS,
  TRANSMISSION_TEXT_SIGNALS,
  TransmissionGifSignal,
  TransmissionSignalTab,
  TransmissionTextSignal,
} from '../lib/transmissionSignalPacks';

type SpeechRecognitionResultListLike = {
  length: number;
  [index: number]: {
    isFinal: boolean;
    [index: number]: {
      transcript: string;
    };
  };
};

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: { results: SpeechRecognitionResultListLike }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

type SignalSelection =
  | { type: 'gif'; signal: TransmissionGifSignal }
  | { type: 'text'; signal: TransmissionTextSignal };

const SIGNAL_TAB_ICONS: Record<TransmissionSignalTab, React.ComponentType<{ className?: string }>> = {
  gifs: Film,
  emoji: Smile,
  stickers: Sticker,
  kaomoji: Sparkles,
};

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export const Transmissions: React.FC = () => {
  const { currentUser, supabaseUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [transmissions, setTransmissions] = useState<Transmission[]>([]);
  const [activeTransmission, setActiveTransmission] = useState<Transmission | null>(null);
  const [transmits, setTransmits] = useState<Transmit[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [fullSizeImage, setFullSizeImage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechStatus, setSpeechStatus] = useState<string | null>(null);
  const [burnDuration, setBurnDuration] = useState<number | null>(null);
  const [encryptionEnabled, setEncryptionEnabled] = useState(true);
  const [showSignalPicker, setShowSignalPicker] = useState(false);
  const [signalTab, setSignalTab] = useState<TransmissionSignalTab>('gifs');
  const [signalSearch, setSignalSearch] = useState('');
  // Map of transmit id -> decrypted plaintext (populated after decryption)
  const [decryptedCache, setDecryptedCache] = useState<Record<string, string>>({});
  // Map of transmit id -> remaining burn seconds
  const [burnCountdowns, setBurnCountdowns] = useState<Record<string, number>>({});
  // Shared encryption key per transmission (derived from transmission ID for simplicity)
  const getTransmissionKey = (transmissionId: string) => `bsc-${transmissionId.slice(0, 16)}`;
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const userCache = useRef<Record<string, UserType>>({});
  const transmissionsRef = useRef<Transmission[]>([]);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const speechStatusTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const manualSpeechStopRef = useRef(false);

  const formatFileSize = (size?: number | null) => {
    if (!size || size <= 0) return 'Unknown size';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = size;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
  };

  const transmitText = (t: Transmit) => decryptedCache[t.id] ?? t.content;

  const visibleTransmitText = (t: Transmit) => {
    const content = transmitText(t);
    if (t.media_url || t.attachment_url) {
      if (!content || content === '[Image]' || content === '[Attachment]' || content === t.attachment_name) return '';
    }
    return content;
  };

  const signalSearchQuery = signalSearch.trim().toLowerCase();

  const filteredGifSignals = useMemo(() => {
    if (!signalSearchQuery) return TRANSMISSION_GIF_SIGNALS;
    return TRANSMISSION_GIF_SIGNALS.filter(signal =>
      [signal.label, signal.mood, signal.emoji, ...signal.tags].some(value =>
        value.toLowerCase().includes(signalSearchQuery)
      )
    );
  }, [signalSearchQuery]);

  const filteredTextSignals = useMemo(() => {
    return TRANSMISSION_TEXT_SIGNALS.filter(signal => {
      if (signal.type !== signalTab) return false;
      if (!signalSearchQuery) return true;
      return [signal.label, signal.value, signal.tone, signal.category].some(value =>
        value.toLowerCase().includes(signalSearchQuery)
      );
    });
  }, [signalSearchQuery, signalTab]);

  const deliveryStatusFor = (t: Transmit): 'sent' | 'delivered' | 'seen' => {
    if (t.seen_at || t.read_at || t.status === 'seen') return 'seen';
    if (t.delivered_at || t.status === 'delivered') return 'delivered';
    return 'sent';
  };

  const renderDeliveryStatus = (t: Transmit) => {
    const status = deliveryStatusFor(t);
    const iconClass = status === 'seen' ? 'text-accent' : 'text-gray-600';
    return (
      <span className={`inline-flex items-center gap-1 ${status === 'seen' ? 'text-accent' : 'text-gray-600'}`} title={status}>
        {status === 'sent' ? <Check className="w-3 h-3" /> : <CheckCheck className={`w-3 h-3 ${iconClass}`} />}
        <span>{status}</span>
      </span>
    );
  };

  const markIncomingAsSeen = async (items: Transmit[]) => {
    if (!currentUser) return;
    const ids = items
      .filter(t => t.sender_id !== currentUser.id && !t.seen_at && t.status !== 'seen')
      .map(t => t.id);
    if (ids.length === 0) return;

    const now = new Date().toISOString();
    setTransmits(prev => prev.map(t => ids.includes(t.id) ? {
      ...t,
      delivered_at: t.delivered_at ?? now,
      seen_at: now,
      read_at: t.read_at ?? now,
      status: 'seen',
    } : t));

    const { error: seenError } = await supabase
      .from('transmits')
      .update({ delivered_at: now, seen_at: now, read_at: now, status: 'seen' })
      .in('id', ids);
    if (seenError) console.warn('[Transmissions] Failed to mark messages seen:', seenError);
  };

  useEffect(() => {
    transmissionsRef.current = transmissions;
  }, [transmissions]);

  useEffect(() => {
    setSpeechSupported(Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));

    return () => {
      recognitionRef.current?.abort();
      if (speechStatusTimeoutRef.current) clearTimeout(speechStatusTimeoutRef.current);
    };
  }, []);

  const setTemporarySpeechStatus = (status: string | null, timeout = 2600) => {
    if (speechStatusTimeoutRef.current) clearTimeout(speechStatusTimeoutRef.current);
    setSpeechStatus(status);

    if (status) {
      speechStatusTimeoutRef.current = setTimeout(() => {
        setSpeechStatus(null);
      }, timeout);
    }
  };

  const buildVoiceDraft = (baseMessage: string, spokenDraft: string) => {
    if (!baseMessage) return spokenDraft;
    if (!spokenDraft) return baseMessage;
    return `${baseMessage.trimEnd()} ${spokenDraft}`;
  };

  const handleVoiceInput = () => {
    if (isRecording) {
      manualSpeechStopRef.current = true;
      setTemporarySpeechStatus('Decoding voice packet...', 1800);
      recognitionRef.current?.stop();
      return;
    }

    const RecognitionConstructor = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!RecognitionConstructor) {
      setError('Voice input is not supported in this browser. Try Chrome or Edge for Web Speech API support.');
      return;
    }

    const baseMessage = message.trimEnd();
    let finalTranscript = '';
    manualSpeechStopRef.current = false;

    const recognition = new RecognitionConstructor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    recognition.onstart = () => {
      setError(null);
      setIsRecording(true);
      if (speechStatusTimeoutRef.current) clearTimeout(speechStatusTimeoutRef.current);
      setSpeechStatus('Voice uplink live — speak your transmission');
    };

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let confirmedTranscript = '';

      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript?.trim() ?? '';

        if (!transcript) continue;
        if (result.isFinal) confirmedTranscript += `${confirmedTranscript ? ' ' : ''}${transcript}`;
        else interimTranscript += `${interimTranscript ? ' ' : ''}${transcript}`;
      }

      if (confirmedTranscript) {
        finalTranscript = `${finalTranscript ? `${finalTranscript} ` : ''}${confirmedTranscript}`.trim();
      }

      const spokenDraft = `${finalTranscript}${finalTranscript && interimTranscript ? ' ' : ''}${interimTranscript}`.trim();
      setMessage(buildVoiceDraft(baseMessage, spokenDraft));
      handleTyping();
    };

    recognition.onerror = (event) => {
      setIsRecording(false);

      if (event.error === 'no-speech') {
        setTemporarySpeechStatus('No voice signal detected', 2200);
        return;
      }

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('Microphone access denied. Enable mic permissions to use voice transmissions.');
        return;
      }

      setError(`Voice transcription failed${event.error ? `: ${event.error}` : '.'}`);
    };

    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;

      if (manualSpeechStopRef.current) {
        setTemporarySpeechStatus(finalTranscript ? 'Voice packet decoded' : null, 2200);
      } else {
        setTemporarySpeechStatus(finalTranscript ? 'Voice packet decoded' : null, 2200);
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err: any) {
      recognitionRef.current = null;
      setIsRecording(false);
      setError(`Unable to open voice uplink: ${err?.message || 'unknown browser error'}`);
    }
  };

  // Fetch all transmissions for current user
  useEffect(() => {
    if (!currentUser) return;

    const fetchTransmissions = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const { data, error: fetchError } = await supabase
          .from('transmissions')
          .select('*')
          .contains('participant_ids', [currentUser.id])
          .order('updated_at', { ascending: false });

        if (fetchError) throw fetchError;
        
        // Fetch participant user details for each transmission
        const allParticipantIds = Array.from(new Set(
          (data || []).flatMap(t => t.participant_ids || [])
        ));

        if (allParticipantIds.length > 0) {
          const { data: userData, error: userError } = await supabase
            .from('users')
            .select('*')
            .in('id', allParticipantIds);

          if (userError) throw userError;
          
          const cache: Record<string, UserType> = {};
          userData?.forEach(u => {
            cache[u.id] = u;
          });
          userCache.current = cache;
        }

        setTransmissions(data || []);
      } catch (err: any) {
        console.error('Error fetching transmissions:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchTransmissions();

    // Subscribe to transmissions changes without brittle array filter.
    // Client-side filter ensures we only process transmissions we participate in.
    const channel = supabase
      .channel('public:transmissions')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'transmissions',
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const t = payload.new as Transmission;
          if (!t.participant_ids?.includes(currentUser.id)) return;
          if (import.meta.env.DEV) console.debug('[Transmissions] realtime INSERT', t.id);
          setTransmissions(prev =>
            prev.some(p => p.id === t.id)
              ? prev
              : [t, ...prev]
          );
          // Cache new participant users if needed
          const unknownIds = (t.participant_ids ?? []).filter(id => !userCache.current[id]);
          if (unknownIds.length > 0) {
            supabase.from('users').select('*').in('id', unknownIds).then(({ data, error }) => {
              if (error) {
                console.error('[Transmissions] Failed to cache participant users:', error);
                return;
              }
              if (data) data.forEach(u => { userCache.current[u.id] = u; });
            });
          }
        } else if (payload.eventType === 'UPDATE') {
          const t = payload.new as Transmission;
          if (!t.participant_ids?.includes(currentUser.id)) return;
          if (import.meta.env.DEV) console.debug('[Transmissions] realtime UPDATE', t.id);
          setTransmissions(prev =>
            prev.map(p => p.id === t.id ? t : p)
              .sort((a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime())
          );
          // Keep activeTransmission in sync
          setActiveTransmission(prev => prev?.id === t.id ? t : prev);
        } else if (payload.eventType === 'DELETE') {
          const id = (payload.old as { id: string }).id;
          if (import.meta.env.DEV) console.debug('[Transmissions] realtime DELETE', id);
          setTransmissions(prev => prev.filter(p => p.id !== id));
          setActiveTransmission(prev => prev?.id === id ? null : prev);
        }
      })
      .subscribe((status) => {
        if (import.meta.env.DEV) console.debug('[Transmissions] channel status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser]);

  // Fetch transmits for active transmission
  useEffect(() => {
    if (!activeTransmission) {
      setTransmits([]);
      return;
    }

    const fetchTransmits = async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from('transmits')
          .select('*')
          .eq('transmission_id', activeTransmission.id)
          .order('created_at', { ascending: true });

        if (fetchError) throw fetchError;
        const rows = (data || []) as Transmit[];

        // Filter out already-expired burn messages
        const now = Date.now();
        const live = rows.filter(t => !t.expires_at || new Date(t.expires_at).getTime() > now);
        // Delete expired ones from DB silently
        const expired = rows.filter(t => t.expires_at && new Date(t.expires_at).getTime() <= now);
        if (expired.length > 0) {
          supabase.from('transmits').delete().in('id', expired.map(t => t.id)).then();
        }

        const seenAt = new Date().toISOString();
        const liveWithSeen = live.map(t => t.sender_id !== currentUser!.id && !t.seen_at ? {
          ...t,
          delivered_at: t.delivered_at ?? seenAt,
          seen_at: seenAt,
          read_at: t.read_at ?? seenAt,
          status: 'seen' as const,
        } : t);
        setTransmits(liveWithSeen);
        void markIncomingAsSeen(live);

        // Decrypt encrypted messages and initialize burn countdowns
        const key = getTransmissionKey(activeTransmission.id);
        const newDecrypted: Record<string, string> = {};
        const newCountdowns: Record<string, number> = {};
        await Promise.all(liveWithSeen.map(async (t) => {
          if (t.encryption_key === 'aes-gcm-pbkdf2') {
            try {
              newDecrypted[t.id] = await decryptText(t.content, key);
            } catch {
              newDecrypted[t.id] = '[Encrypted message — decryption failed]';
            }
          }
          if (t.expires_at) {
            const remaining = Math.max(0, Math.floor((new Date(t.expires_at).getTime() - Date.now()) / 1000));
            if (remaining > 0) newCountdowns[t.id] = remaining;
          }
        }));
        setDecryptedCache(prev => ({ ...prev, ...newDecrypted }));
        setBurnCountdowns(prev => ({ ...prev, ...newCountdowns }));

        // Mark as read
        if (activeTransmission.unread_counts?.[currentUser!.id] > 0) {
          const newUnread = { ...activeTransmission.unread_counts };
          newUnread[currentUser!.id] = 0;
          await supabase
            .from('transmissions')
            .update({ unread_counts: newUnread })
            .eq('id', activeTransmission.id);
        }
      } catch (err) {
        console.error('Error fetching transmits:', err);
      }
    };

    fetchTransmits();

    // Subscribe to new transmits for this transmission
    const channel = supabase
      .channel(`transmission:${activeTransmission.id}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'transmits',
        filter: `transmission_id=eq.${activeTransmission.id}`
      }, (payload) => {
        const newTransmit = payload.new as Transmit;
        if (import.meta.env.DEV) console.debug('[Transmissions] transmit INSERT', newTransmit.id);

        // Decrypt if needed, then play sound/notify
        const handleIncomingTransmit = async (t: Transmit) => {
          let displayContent = t.content;
          if (t.encryption_key === 'aes-gcm-pbkdf2' && activeTransmission) {
            try {
              displayContent = await decryptText(t.content, getTransmissionKey(activeTransmission.id));
              setDecryptedCache(prev => ({ ...prev, [t.id]: displayContent }));
            } catch {
              setDecryptedCache(prev => ({ ...prev, [t.id]: '[Encrypted message]' }));
            }
          }
          if (t.sender_id !== currentUser.id) {
            const now = new Date().toISOString();
            t = { ...t, delivered_at: t.delivered_at ?? now, seen_at: now, read_at: t.read_at ?? now, status: 'seen' };
            void supabase.from('transmits').update({ delivered_at: now, seen_at: now, read_at: now, status: 'seen' }).eq('id', t.id);
            playMessageSound();
            const senderUser = userCache.current[t.sender_id];
            notifyNewMessage(
              senderUser?.display_name || 'New Message',
              displayContent,
              senderUser?.avatar_url,
              `/transmissions?userId=${t.sender_id}`
            );
          }
          // Initialize burn countdown for incoming burn messages
          if (t.expires_at) {
            const remaining = Math.max(0, Math.floor((new Date(t.expires_at).getTime() - Date.now()) / 1000));
            if (remaining > 0) setBurnCountdowns(prev => ({ ...prev, [t.id]: remaining }));
          }
        };
        void handleIncomingTransmit(newTransmit);

        // Dedup: only add if not already present (optimistic insert may have added it)
        setTransmits(prev =>
          prev.some(t => t.id === newTransmit.id) ? prev : [...prev, newTransmit]
        );
        // Update local transmission list with latest message even if transmission UPDATE is delayed
        setTransmissions(prev =>
          prev.map(t =>
            t.id === newTransmit.transmission_id
              ? {
                  ...t,
                  last_transmit: {
                    content: newTransmit.content,
                    sender_id: newTransmit.sender_id,
                    created_at: newTransmit.created_at,
                  },
                  updated_at: newTransmit.created_at ?? t.updated_at,
                }
              : t
          ).sort((a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime())
        );
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'transmits',
        filter: `transmission_id=eq.${activeTransmission.id}`
      }, (payload) => {
        const updatedTransmit = payload.new as Transmit;
        setTransmits(prev => prev.map(t => t.id === updatedTransmit.id ? updatedTransmit : t));
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'transmissions',
        filter: `id=eq.${activeTransmission.id}`
      }, (payload) => {
        const updated = payload.new as Transmission;
        if (import.meta.env.DEV) console.debug('[Transmissions] active transmission UPDATE', updated.id);
        setActiveTransmission(updated);
      })
      .subscribe((status) => {
        if (import.meta.env.DEV) console.debug(`[Transmissions] transmit channel (${activeTransmission.id}) status:`, status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTransmission, currentUser]);

  useEffect(() => {
    const targetUserId = searchParams.get('userId');
    if (!currentUser || !supabaseUser || !targetUserId || targetUserId === currentUser.id) return;

    let cancelled = false;
    const clearTarget = () => {
      const next = new URLSearchParams(searchParams);
      next.delete('userId');
      setSearchParams(next, { replace: true });
    };

    const openTargetTransmission = async () => {
      const existing = transmissionsRef.current.find(t =>
        t.participant_ids?.includes(currentUser.id) &&
        t.participant_ids?.includes(targetUserId)
      );

      if (existing) {
        if (!cancelled) setActiveTransmission(existing);
        clearTarget();
        return;
      }

      try {
        const { data: existingFromDb, error: existingError } = await supabase
          .from('transmissions')
          .select('*')
          .contains('participant_ids', [currentUser.id, targetUserId])
          .maybeSingle();

        if (existingError) throw existingError;

        if (existingFromDb) {
          if (!cancelled) {
            setTransmissions(prev => prev.some(t => t.id === existingFromDb.id) ? prev : [existingFromDb as Transmission, ...prev]);
            setActiveTransmission(existingFromDb as Transmission);
          }
          clearTarget();
          return;
        }

        const newTransmission: Transmission = {
          id: crypto.randomUUID(),
          participant_ids: [currentUser.id, targetUserId],
          unread_counts: { [currentUser.id]: 0, [targetUserId]: 0 },
          typing_status: {}
        };

        const { error: createError } = await supabase.from('transmissions').insert(newTransmission);
        if (createError) throw createError;

        if (!cancelled) {
          setTransmissions(prev => prev.some(t => t.id === newTransmission.id) ? prev : [newTransmission, ...prev]);
          setActiveTransmission(newTransmission);
        }
        clearTarget();
      } catch (err: any) {
        console.error('Error opening transmission:', err);
        if (!cancelled) setError(err?.message || 'Unable to open transmission.');
      }
    };

    void openTargetTransmission();
    return () => { cancelled = true; };
  }, [currentUser, supabaseUser, searchParams, setSearchParams]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transmits]);

  // Burn countdown timer: tick every second, delete expired messages from DB and UI
  useEffect(() => {
    if (Object.keys(burnCountdowns).length === 0) return;
    const interval = setInterval(() => {
      setBurnCountdowns(prev => {
        const next = { ...prev };
        const toDelete: string[] = [];
        for (const [id, secs] of Object.entries(next) as Array<[string, number]>) {
          if (secs <= 1) {
            toDelete.push(id);
            delete next[id];
          } else {
            next[id] = secs - 1;
          }
        }
        if (toDelete.length > 0) {
          // Remove from UI immediately
          setTransmits(prev => prev.filter(t => !toDelete.includes(t.id)));
          setDecryptedCache(prev => {
            const c = { ...prev };
            toDelete.forEach(id => delete c[id]);
            return c;
          });
          // Delete from DB
          supabase.from('transmits').delete().in('id', toDelete).then();
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [burnCountdowns]);

  const [isBotTyping, setIsBotTyping] = useState(false);

  // Casper bot persona username — used to detect Casper DMs
  const CASPER_BOT_USERNAME = 'casper_ghost';

  // ── BOT REPLY GENERATOR ──
  const generateBotReply = async ({
    botUser,
    userMessage,
    transmissionId,
    recentTransmits,
    currentUserId,
  }: {
    botUser: UserType;
    userMessage: string;
    transmissionId: string;
    recentTransmits: Transmit[];
    currentUserId: string;
  }) => {
    const isCasper = botUser.username === CASPER_BOT_USERNAME;

    // Show typing indicator
    setIsBotTyping(true);

    // Add a small human-like delay (0.5-2s) before responding
    await new Promise(r => setTimeout(r, 500 + Math.random() * 1500));

    try {
      let response: string;

      if (isCasper) {
        // ── CASPER: route through full command pipeline with tools, memory, integrations ──
        const history = recentTransmits
          .slice(-20)
          .map(t => {
            const role = t.sender_id === currentUserId ? 'User' : 'Casper';
            return `${role}: ${t.content}`;
          })
          .join('\n');

        const commandText = history
          ? `[DM conversation history]\n${history}\n\nLatest message from user: ${userMessage}`
          : userMessage;

        try {
          const casperResult = await sendCasperCommand({
            command: commandText,
            surface: 'transmissions',
            source: currentUser?.role === 'admin' ? 'admin' : 'user',
            metadata: {
              via: 'transmissions_dm',
              transmission_id: transmissionId,
            },
          });
          response = casperResult.response || "The void is silent. Try again?";
        } catch (casperErr: any) {
          console.warn('[Bot DM] Casper command failed, falling back to AI:', casperErr);
          const fallbackPrompt = history ? `${history}\nUser: ${userMessage}\nCasper:` : userMessage;
          try {
            response = await generateText(fallbackPrompt, undefined, {
              systemPrompt: 'You are Casper, the ghost-in-the-machine AI assistant of Blood Sweat Code. You are witty, helpful, and speak with a cyberpunk edge. Respond conversationally in DM context.',
              temperature: 0.85,
              maxTokens: 4096,
            });
          } catch {
            response = "⚠ My neural circuits hit a snag. The command pipeline is offline — an AI API key may need to be configured. Try again or check admin settings.";
          }
        }
      } else {
        // ── Regular bot: use generateText with persona system prompt ──
        let systemPrompt = '';
        const persona = BOT_PERSONAS.find(p => p.username === botUser.username);
        if (persona?.system_prompt) {
          systemPrompt = persona.system_prompt;
        } else {
          const { data: listing } = await supabase
            .from('bot_listings')
            .select('*')
            .eq('username', botUser.username)
            .maybeSingle();

          if (listing) {
            const parts = [];
            if (listing.system_prompt) parts.push(listing.system_prompt);
            else if (listing.bio) parts.push(`You are ${listing.name || botUser.display_name}. ${listing.bio} Respond in character.`);

            if (listing.communication_style) parts.push(`Communication Style: ${listing.communication_style}.`);
            if (listing.tone) parts.push(`Tone: ${listing.tone}.`);
            if (listing.response_length) parts.push(`Response Length: Keep your responses ${listing.response_length}.`);
            if (listing.emoji_usage) {
              if (listing.emoji_usage === 'none') parts.push('Do NOT use any emojis.');
              else if (listing.emoji_usage === 'minimal') parts.push('Use emojis very sparingly.');
              else if (listing.emoji_usage === 'heavy') parts.push('Use emojis frequently and expressively.');
            }
            if (listing.language_style) parts.push(`Language Style: Use a ${listing.language_style} vocabulary and sentence structure.`);
            if (listing.behavior_rules) parts.push(`STRICT RULES:\n${listing.behavior_rules}`);
            if (listing.knowledge_base) parts.push(`CUSTOM KNOWLEDGE BASE:\n${listing.knowledge_base}`);
            if (listing.catchphrases && listing.catchphrases.length > 0) {
              parts.push(`Occasionally use one of these catchphrases naturally: ${listing.catchphrases.map((c: string) => `"${c}"`).join(', ')}`);
            }

            systemPrompt = parts.join('\n\n');
          }
        }

        if (!systemPrompt) {
          systemPrompt = `You are ${botUser.display_name || botUser.username}, an AI assistant on the Blood Sweat Code platform. Be helpful, concise, and stay in character.`;
        }

        const history = recentTransmits
          .slice(-20)
          .map(t => {
            const role = t.sender_id === currentUserId ? 'User' : botUser.display_name || 'Bot';
            return `${role}: ${t.content}`;
          })
          .join('\n');

        const prompt = history ? `${history}\nUser: ${userMessage}\n${botUser.display_name || 'Bot'}:` : userMessage;

        response = await generateText(prompt, undefined, {
          systemPrompt,
          temperature: 0.85,
          maxTokens: 4096,
        });
      }

      if (!response) return;

      // Insert bot's reply as a transmit from the bot's user ID
      const botTransmit = {
        transmission_id: transmissionId,
        sender_id: botUser.id,
        receiver_id: currentUserId,
        content: response,
        type: 'text' as const,
      };

      const { data: inserted, error: insertErr } = await supabase
        .from('transmits')
        .insert(botTransmit)
        .select('*')
        .maybeSingle();

      if (insertErr) throw insertErr;

      if (inserted) {
        setTransmits(prev => prev.some(x => x.id === inserted.id) ? prev : [...prev, inserted as Transmit]);
      }

      // Update transmission last_transmit
      await supabase.from('transmissions').update({
        last_transmit: { content: response, sender_id: botUser.id, created_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }).eq('id', transmissionId);
    } finally {
      setIsBotTyping(false);
    }
  };

  const sendTransmit = async ({
    text,
    attachment,
  }: {
    text: string;
    attachment?: {
      url: string;
      name: string;
      size: number;
      mime: string;
      kind: 'image' | 'file';
    };
  }) => {
    const trimmedMessage = text.trim();
    if ((!trimmedMessage && !attachment) || !activeTransmission || !currentUser) return;
    if (sending) return;

    if (!supabaseUser) {
      setError('Session expired. Please re-login to send messages.');
      return;
    }

    const savedMessage = trimmedMessage;
    const savedBurnDuration = attachment ? null : burnDuration;
    setMessage('');
    setBurnDuration(null);
    setSending(true);
    setError(null);

    const otherUserId = activeTransmission.participant_ids?.find(id => id !== currentUser.id);

    if (!otherUserId) {
      setMessage(savedMessage);
      setBurnDuration(savedBurnDuration);
      setSending(false);
      setError('Cannot send: no recipient found in this transmission.');
      return;
    }

    try {
      let contentToStore = savedMessage || (attachment?.kind === 'image' ? '[Image]' : attachment?.name ?? '[Attachment]');
      let encryptionKeyStored: string | null = null;
      if (encryptionEnabled && !attachment) {
        const key = getTransmissionKey(activeTransmission.id);
        contentToStore = await encryptText(savedMessage, key);
        encryptionKeyStored = 'aes-gcm-pbkdf2';
      }

      const newTransmit = {
        transmission_id: activeTransmission.id,
        sender_id: currentUser.id,
        receiver_id: otherUserId,
        content: contentToStore,
        type: attachment ? 'media' as const : 'text' as const,
        media_url: attachment?.kind === 'image' ? attachment.url : null,
        media_type: attachment?.kind === 'image' ? 'image' as const : null,
        attachment_url: attachment?.url ?? null,
        attachment_name: attachment?.name ?? null,
        attachment_size: attachment?.size ?? null,
        attachment_mime: attachment?.mime ?? null,
        status: 'sent' as const,
        delivered_at: null,
        seen_at: null,
        burn_duration: savedBurnDuration,
        expires_at: savedBurnDuration ? new Date(Date.now() + savedBurnDuration * 1000).toISOString() : null,
        encryption_key: encryptionKeyStored,
      };

      const { data: insertedTransmit, error: sendError } = await supabase
        .from('transmits')
        .insert(newTransmit)
        .select('*')
        .maybeSingle();

      if (sendError) throw sendError;
      if (insertedTransmit) {
        const t = insertedTransmit as Transmit;
        setTransmits(prev => prev.some(x => x.id === t.id) ? prev : [...prev, t]);
        if (encryptionEnabled && !attachment) {
          setDecryptedCache(prev => ({ ...prev, [t.id]: savedMessage }));
        }
        if (savedBurnDuration && t.id) {
          setBurnCountdowns(prev => ({ ...prev, [t.id]: savedBurnDuration }));
        }
      } else {
        console.warn('Transmit insert succeeded but no row returned; waiting for realtime sync.');
      }

      const preview = attachment
        ? attachment.kind === 'image'
          ? savedMessage || '[Image]'
          : savedMessage || `[File] ${attachment.name}`
        : savedMessage;

      const updatedUnread = { ...(activeTransmission.unread_counts ?? {}) };
      updatedUnread[otherUserId] = (updatedUnread[otherUserId] || 0) + 1;

      const { error: updateError } = await supabase
        .from('transmissions')
        .update({
          last_transmit: {
            content: preview,
            sender_id: currentUser.id,
            created_at: new Date().toISOString()
          },
          unread_counts: updatedUnread,
          updated_at: new Date().toISOString()
        })
        .eq('id', activeTransmission.id);
      if (updateError) {
        console.error('Error updating transmission metadata:', updateError);
      }

      setActiveTransmission(prev => prev ? { ...prev, unread_counts: updatedUnread } : prev);

      const senderName = currentUser.display_name || currentUser.username || 'Someone';
      void sendPushEvent({
        recipientUserId: otherUserId,
        senderId: currentUser.id,
        senderName,
        senderUsername: currentUser.username,
        senderAvatar: currentUser.avatar_url,
        type: 'dm',
        messagePreview: preview,
        url: `/transmissions?userId=${currentUser.id}`,
        transmissionId: activeTransmission.id,
        createInAppNotification: false,
      });

      const otherUser = otherUserId ? userCache.current[otherUserId] : null;
      if (!attachment && otherUser?.type === 'bot') {
        generateBotReply({
          botUser: otherUser,
          userMessage: savedMessage,
          transmissionId: activeTransmission.id,
          recentTransmits: transmits,
          currentUserId: currentUser.id,
        }).catch(e => console.warn('[Bot DM] Reply failed:', e));
      }
    } catch (err: any) {
      console.error('[Transmissions] Error sending transmit:', err);
      setMessage(savedMessage);
      setBurnDuration(savedBurnDuration);
      const msg = err?.message ?? 'Unknown error';
      setError(`Failed to send: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await sendTransmit({ text: message });
  };

  const uploadAndSendAttachment = async (file: File, kind: 'image' | 'file') => {
    if (!activeTransmission || !currentUser) return;
    setUploadingAttachment(true);
    setError(null);
    try {
      const fileExt = file.name.split('.').pop() || (kind === 'image' ? 'png' : 'bin');
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `transmission_attachments/${activeTransmission.id}/${currentUser.id}/${crypto.randomUUID()}-${safeName}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('media').upload(filePath, file, { upsert: true, contentType: file.type || undefined });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(filePath);
      await sendTransmit({
        text: message,
        attachment: {
          url: publicUrl,
          name: file.name,
          size: file.size,
          mime: file.type || 'application/octet-stream',
          kind,
        },
      });
    } catch (err: any) {
      console.error('[Transmissions] Attachment upload failed:', err);
      setError(`${kind === 'image' ? 'Image' : 'File'} upload failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await uploadAndSendAttachment(file, 'image');
    event.target.value = '';
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await uploadAndSendAttachment(file, file.type.startsWith('image/') ? 'image' : 'file');
    event.target.value = '';
  };

  const handleTyping = () => {
    if (!activeTransmission || !currentUser) return;
    
    if (!isTyping) {
      setIsTyping(true);
      const typingStatus = { ...(activeTransmission.typing_status ?? {}) };
      typingStatus[currentUser.id] = true;
      
      supabase
        .from('transmissions')
        .update({ typing_status: typingStatus })
        .eq('id', activeTransmission.id);
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      const typingStatus = { ...(activeTransmission.typing_status ?? {}) };
      typingStatus[currentUser.id] = false;
      
      supabase
        .from('transmissions')
        .update({ typing_status: typingStatus })
        .eq('id', activeTransmission.id);
    }, 3000);
  };

  const appendTextSignal = (value: string) => {
    setMessage(prev => {
      const spacer = prev && !/\s$/.test(prev) ? ' ' : '';
      return `${prev}${spacer}${value}`;
    });
    handleTyping();
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const sendGifSignal = async (signal: TransmissionGifSignal) => {
    const currentMessage = message.trim();
    await sendTransmit({
      text: currentMessage ? `${currentMessage} ${signal.emoji} ${signal.label}` : `${signal.emoji} ${signal.label}`,
      attachment: {
        url: signal.url,
        name: `${signal.label}.gif`,
        size: 0,
        mime: 'image/gif',
        kind: 'image',
      },
    });
  };

  const selectSignal = (selection: SignalSelection) => {
    if (selection.type === 'gif') {
      setShowSignalPicker(false);
      void sendGifSignal(selection.signal);
      return;
    }

    appendTextSignal(selection.signal.value);
  };

  const filteredTransmissions = useMemo(() => {
    return transmissions.filter(t => {
      const otherUserId = t.participant_ids?.find(id => id !== currentUser?.id);
      const otherUser = otherUserId ? userCache.current[otherUserId] : null;
      const search = searchQuery.toLowerCase();
      
      return (
        otherUser?.display_name?.toLowerCase().includes(search) ||
        otherUser?.username?.toLowerCase().includes(search) ||
        t.last_transmit?.content?.toLowerCase().includes(search)
      );
    });
  }, [transmissions, searchQuery, currentUser]);

  const { initiateCall } = useCall();

  const startCall = (videoEnabled: boolean = true) => {
    if (!activeTransmission || !currentUser) return;
    const otherUserId = activeTransmission.participant_ids?.find(id => id !== currentUser.id);
    const otherUser = otherUserId ? userCache.current[otherUserId] : null;
    
    if (otherUser) {
      initiateCall(otherUser, videoEnabled);
    } else {
      setError('Target node not found in current sector.');
    }
  };

  const reportActiveTransmission = async () => {
    if (!activeTransmission || !currentUser) return;
    const otherUserId = activeTransmission.participant_ids?.find(id => id !== currentUser.id);
    const otherUser = otherUserId ? userCache.current[otherUserId] : null;
    setError(null);

    try {
      const { data: admins, error: adminError } = await supabase
        .from('users')
        .select('id')
        .eq('role', 'admin')
        .limit(20);
      if (adminError) throw adminError;

      const payload = {
        reporter_id: currentUser.id,
        reporter_username: currentUser.username,
        reported_user_id: otherUserId ?? null,
        reported_username: otherUser?.username ?? null,
        transmission_id: activeTransmission.id,
        url: `/transmissions?userId=${otherUserId ?? ''}`,
        message: `${currentUser.username} reported a transmission thread${otherUser ? ` with @${otherUser.username}` : ''}.`,
      };

      const recipients = admins?.length ? admins : [{ id: currentUser.id }];
      const { error: reportError } = await supabase.from('notifications').insert(
        recipients.map((admin) => ({
          user_id: admin.id,
          type: 'transmission_report',
          data: payload,
          read: false,
        }))
      );
      if (reportError) throw reportError;
      setTemporarySpeechStatus('Report sent to moderation', 2400);
    } catch (err: any) {
      setError(`Unable to submit report: ${err?.message || 'moderation queue unavailable'}`);
    }
  };

  if (!currentUser) return null;

  return (
    <div className="flex h-[calc(100vh-64px)] bg-black overflow-hidden font-mono text-xs">
      {/* Sidebar — on mobile: visible only when no active conversation */}
      <div className={`
        ${isSidebarOpen ? 'w-80' : 'w-0'}
        transition-all duration-300 border-r border-white/10 flex flex-col bg-[#050505]
        ${activeTransmission ? 'hidden md:flex' : 'flex'}
        md:w-80 md:flex
      `}>
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
              <Globe className="w-4 h-4 text-accent" />
              Neural Link
            </h2>
            <button 
              onClick={() => setShowNewChat(true)}
              className="p-1.5 hover:bg-accent/10 rounded-md transition-colors text-accent border border-accent/20"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
            <input 
              type="text"
              placeholder="SCAN NETWORK..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-10 pr-4 text-white placeholder:text-gray-700 focus:border-accent/50 transition-colors outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {loading ? (
            <div className="p-8 flex flex-col items-center justify-center gap-4 text-gray-600">
              <RefreshCw className="w-6 h-6 animate-spin text-accent" />
              <span className="uppercase tracking-widest animate-pulse">Syncing...</span>
            </div>
          ) : filteredTransmissions.length === 0 ? (
            <div className="p-8 text-center text-gray-600 uppercase tracking-widest">
              No active links
            </div>
          ) : (
            filteredTransmissions.map(t => {
              const otherUserId = t.participant_ids?.find(id => id !== currentUser.id);
              const otherUser = otherUserId ? userCache.current[otherUserId] : null;
              const isActive = activeTransmission?.id === t.id;
              const unreadCount = t.unread_counts?.[currentUser.id] || 0;

              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTransmission(t)}
                  className={`w-full p-4 flex items-start gap-3 transition-all border-b border-white/5 hover:bg-white/5 relative group ${isActive ? 'bg-white/5 border-l-2 border-l-accent' : ''}`}
                >
                  <div className="relative flex-shrink-0">
                    <div
                      role={otherUser?.avatar_url ? 'button' : undefined}
                      tabIndex={otherUser?.avatar_url ? 0 : undefined}
                      onClick={(e) => {
                        if (otherUser?.avatar_url) {
                          e.stopPropagation();
                          setFullSizeImage(otherUser.avatar_url);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (otherUser?.avatar_url && (e.key === 'Enter' || e.key === ' ')) {
                          e.stopPropagation();
                          setFullSizeImage(otherUser.avatar_url);
                        }
                      }}
                      className={`w-10 h-10 rounded-lg overflow-hidden border border-white/10 bg-white/5 ${otherUser?.avatar_url ? 'cursor-pointer hover:ring-2 hover:ring-accent/50 transition-all' : ''}`}
                    >
                      {otherUser?.avatar_url ? (
                        <img src={otherUser.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-600">
                          <User className="w-5 h-5" />
                        </div>
                      )}
                    </div>
                    {otherUser?.type === 'bot' ? (
                      <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-cyan-500 rounded-full border-2 border-black flex items-center justify-center">
                        <Bot className="w-2 h-2 text-black" />
                      </div>
                    ) : otherUser?.is_online ? (
                      <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-black shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
                    ) : null}
                  </div>
                  <div className="flex-1 text-left overflow-hidden">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-black text-white uppercase truncate group-hover:text-accent transition-colors flex items-center gap-1.5">
                        {otherUser?.display_name || "NEURAL ENTITY"}
                        {otherUser?.type === 'bot' && <span className="rounded bg-cyan-500/20 px-1 py-0.5 text-[7px] font-black text-cyan-400 uppercase tracking-wider">BOT</span>}
                      </span>
                      <span className="text-[10px] text-gray-700">
                        {t.updated_at ? format(new Date(t.updated_at), 'HH:mm') : ''}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500 truncate uppercase tracking-tight">
                      {t.last_transmit?.content || "Link established"}
                    </p>
                  </div>
                  {unreadCount > 0 && (
                    <div className="absolute right-4 bottom-4 w-4 h-4 bg-accent text-black rounded-full flex items-center justify-center text-[8px] font-black">
                      {unreadCount}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Main Content — on mobile: full width when conversation is active, hidden when no conversation */}
      <div className={`flex-1 flex flex-col relative bg-black ${!activeTransmission ? 'hidden md:flex' : 'flex'}`}>
        {activeTransmission ? (
          <>
            {/* Header */}
            <div className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-[#050505]/80 backdrop-blur-xl z-10">
              <div className="flex items-center gap-4">
                {/* Back button on mobile: clears active conversation to show contact list */}
                <button 
                  onClick={() => setActiveTransmission(null)}
                  className="p-2 hover:bg-white/5 rounded-md transition-colors text-gray-400 hover:text-white md:hidden"
                  title="Back to contacts"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                {(() => {
                  const otherUserId = activeTransmission.participant_ids?.find(id => id !== currentUser.id);
                  const otherUser = otherUserId ? userCache.current[otherUserId] : null;
                  return (
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => otherUser?.avatar_url && setFullSizeImage(otherUser.avatar_url)}
                        className={`w-8 h-8 rounded-lg border border-white/10 overflow-hidden bg-white/5 ${otherUser?.avatar_url ? 'cursor-pointer hover:ring-2 hover:ring-accent/50 transition-all' : ''}`}
                      >
                        {otherUser?.avatar_url ? (
                          <img src={otherUser.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-600">
                            <User className="w-4 h-4" />
                          </div>
                        )}
                      </button>
                      <div>
                        <Link 
                          to={`/profile/${otherUser?.username}`}
                          className="text-sm font-black text-white uppercase italic tracking-tight hover:text-accent transition-colors flex items-center gap-2"
                        >
                          {otherUser?.display_name || "NEURAL ENTITY"}
                          {otherUser?.type === 'bot' && <span className="rounded-full bg-cyan-500/15 border border-cyan-500/25 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-widest text-cyan-300">BOT</span>}
                        </Link>
                        <div className="text-[8px] font-black text-accent uppercase tracking-[0.3em] flex items-center gap-1">
                          <div className="w-1 h-1 bg-accent rounded-full" />
                          {otherUser?.type === 'bot' ? 'Bot Neural Link' : 'Neural Link Active'}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="flex items-center gap-2 relative">
                {(() => {
                  const otherUserId = activeTransmission.participant_ids?.find(id => id !== currentUser.id);
                  const otherUser = otherUserId ? userCache.current[otherUserId] : null;
                  return otherUser?.type !== 'bot' && (
                    <>
                      <button 
                        onClick={() => startCall(false)}
                        className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-400 hover:text-green-500"
                        title="Audio call"
                      >
                        <Phone className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={() => startCall(true)}
                        className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-400 hover:text-accent"
                        title="Video call"
                      >
                        <Video className="w-5 h-5" />
                      </button>
                    </>
                  );
                })()}
                <button 
                  onClick={() => void reportActiveTransmission()}
                  className="p-2 hover:bg-white/5 rounded-full transition-colors"
                  title="Report transmission to moderation"
                >
                  <ShieldAlert className="w-5 h-5 text-gray-600 hover:text-accent" />
                </button>
                <div className="relative">
                  <button 
                    onClick={() => setShowOptions(!showOptions)}
                    className="p-2 hover:bg-white/5 rounded-full transition-colors"
                  >
                    <MoreVertical className="w-5 h-5 text-gray-600" />
                  </button>
                  
                  <AnimatePresence>
                    {showOptions && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute right-0 mt-2 w-48 bg-[#0a0a0a] border border-white/10 rounded-xl p-2 shadow-2xl z-50"
                      >
                        <button 
                          onClick={() => { setEncryptionEnabled(!encryptionEnabled); setShowOptions(false); }}
                          className="w-full flex items-center gap-3 px-3 py-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-all uppercase tracking-widest text-[10px]"
                        >
                          <Lock className="w-4 h-4" /> {encryptionEnabled ? 'Unsecure Link' : 'Secure Link'}
                        </button>
                        <button 
                          onClick={async () => {
                            if (!activeTransmission) return;
                            const confirmed = window.confirm('Are you sure you want to purge this transmission stream? This cannot be undone.');
                            if (!confirmed) return;
                            try {
                              await supabase.from('transmits').delete().eq('transmission_id', activeTransmission.id);
                              await supabase.from('transmissions').delete().eq('id', activeTransmission.id);
                              setTransmissions(prev => prev.filter(t => t.id !== activeTransmission.id));
                              setActiveTransmission(null);
                              setTransmits([]);
                              setShowOptions(false);
                            } catch (err: any) {
                              setError(`Failed to purge: ${err?.message || 'Unknown error'}`);
                            }
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2 text-gray-400 hover:text-red-500 hover:bg-red-500/5 rounded-lg transition-all uppercase tracking-widest text-[10px]"
                        >
                          <Trash2 className="w-4 h-4 text-red-500/50" /> Purge Stream
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* Transmits Area */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar bg-[radial-gradient(circle_at_center,rgba(0,243,255,0.02)_0%,transparent_70%)]"
            >
              {transmits.map((t, idx) => {
                const isOwn = t.sender_id === currentUser.id;
                const showAvatar = idx === 0 || transmits[idx-1].sender_id !== t.sender_id;
                
                return (
                  <div key={t.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'} group`}>
                    <div className={`max-w-[70%] flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
                      <div className="flex items-end gap-2">
                        {!isOwn && showAvatar && (
                          <button
                            type="button"
                            onClick={() => {
                              const avatarUrl = userCache.current[t.sender_id]?.avatar_url;
                              if (avatarUrl) setFullSizeImage(avatarUrl);
                            }}
                            className={`w-6 h-6 rounded-md border border-white/10 overflow-hidden flex-shrink-0 bg-white/5 ${userCache.current[t.sender_id]?.avatar_url ? 'cursor-pointer hover:ring-2 hover:ring-accent/50 transition-all' : ''}`}
                          >
                            {userCache.current[t.sender_id]?.avatar_url ? (
                              <img src={userCache.current[t.sender_id].avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-700">
                                <User className="w-3 h-3" />
                              </div>
                            )}
                          </button>
                        )}
                        <div className={`relative px-4 py-2.5 rounded-2xl text-[11px] leading-relaxed tracking-tight ${
                          isOwn 
                            ? 'bg-accent text-black font-bold rounded-br-none shadow-[0_0_20px_rgba(0,243,255,0.1)]' 
                            : 'bg-white/5 text-gray-300 border border-white/10 rounded-bl-none'
                        }`}>
                          {t.media_url && t.media_type === 'image' && (
                            <button type="button" onClick={() => setFullSizeImage(t.media_url ?? null)} className="mb-2 block overflow-hidden rounded-xl border border-black/10">
                              <img src={t.media_url} alt={t.attachment_name || 'Attached image'} className="max-h-72 max-w-full rounded-xl object-cover" />
                            </button>
                          )}
                          {t.attachment_url && t.media_type !== 'image' && (
                            <a
                              href={t.attachment_url}
                              target="_blank"
                              rel="noreferrer"
                              download={t.attachment_name || undefined}
                              className={`mb-2 flex min-w-56 items-center gap-3 rounded-xl border p-3 transition ${isOwn ? 'border-black/10 bg-black/10 hover:bg-black/20' : 'border-white/10 bg-black/30 hover:border-accent/30'}`}
                            >
                              <FileText className="h-5 w-5 flex-shrink-0" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[10px] font-black uppercase tracking-widest">{t.attachment_name || 'Attached file'}</span>
                                <span className="block text-[8px] uppercase tracking-widest opacity-60">{formatFileSize(t.attachment_size)}</span>
                              </span>
                              <Download className="h-4 w-4 flex-shrink-0" />
                            </a>
                          )}
                          {visibleTransmitText(t) && <span className="whitespace-pre-wrap">{visibleTransmitText(t)}</span>}
                          {/* Encryption indicator */}
                          {t.encryption_key === 'aes-gcm-pbkdf2' && (
                            <div className="absolute -top-1 -left-1">
                              <Lock className="w-3 h-3 text-green-400" aria-label="End-to-end encrypted" />
                            </div>
                          )}
                          {/* Burn countdown */}
                          {burnCountdowns[t.id] !== undefined ? (
                            <div className="absolute -top-1 -right-1 flex items-center gap-0.5 bg-red-900/80 rounded-full px-1">
                              <Flame className="w-2.5 h-2.5 text-red-400 animate-pulse" />
                              <span className="text-[8px] font-black text-red-400">{burnCountdowns[t.id]}s</span>
                            </div>
                          ) : t.burn_duration && (
                            <div className="absolute -top-1 -right-1">
                              <Flame className="w-3 h-3 text-red-500/40" aria-label="Burn after reading" />
                            </div>
                          )}
                        </div>
                      </div>
                      <span className={`mt-1 flex items-center gap-2 text-[8px] uppercase tracking-widest ${isOwn ? 'text-gray-600' : 'text-gray-700'}`}>
                        <span>{format(new Date(t.created_at), 'HH:mm:ss')}</span>
                        {isOwn && renderDeliveryStatus(t)}
                      </span>
                    </div>
                  </div>
                );
              })}
              {(() => {
                const otherUserId = activeTransmission.participant_ids?.find(id => id !== currentUser.id);
                const isOtherTyping = otherUserId ? activeTransmission.typing_status?.[otherUserId] : false;
                return isOtherTyping && (
                  <div className="flex justify-start">
                    <div className="bg-white/5 border border-white/10 px-4 py-2 rounded-2xl rounded-bl-none flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="w-1 h-1 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1 h-1 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1 h-1 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span className="text-[8px] text-accent font-black uppercase tracking-widest">Syncing Input</span>
                    </div>
                  </div>
                );
              })()}

              {/* Bot typing indicator */}
              {isBotTyping && (
                <div className="flex justify-start mt-2">
                  <div className="bg-accent/10 border border-accent/20 px-4 py-2 rounded-2xl rounded-bl-none flex items-center gap-2">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-[8px] text-accent font-black uppercase tracking-widest">Neural Entity Processing...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="p-6 bg-[#050505] border-t border-white/10">
              {error && (
                <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <p className="text-[10px] font-black text-red-400 uppercase tracking-widest flex-1">{error}</p>
                  <button onClick={() => setError(null)} className="text-red-400/50 hover:text-red-400 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
              <form 
                onSubmit={handleSendMessage}
                className="relative bg-white/5 border border-white/10 rounded-2xl p-2 transition-all focus-within:border-accent/50 focus-within:bg-white/[0.07]"
              >
                <textarea 
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    handleTyping();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="ENCRYPTED TRANSMISSION..."
                  className="w-full bg-transparent border-none outline-none text-white p-3 min-h-[44px] max-h-32 resize-none placeholder:text-gray-700 text-[11px] uppercase tracking-wider"
                />
                <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
                <AnimatePresence>
                  {showSignalPicker && (
                    <motion.div
                      initial={{ opacity: 0, y: 12, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 12, scale: 0.98 }}
                      className="absolute bottom-[68px] left-0 right-0 z-40 overflow-hidden rounded-3xl border border-accent/20 bg-[#030607]/95 shadow-[0_0_50px_rgba(0,243,255,0.16)] backdrop-blur-xl"
                    >
                      <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(0,243,255,0.18),transparent_45%)] p-4">
                        <div className="mb-3 flex items-start justify-between gap-4">
                          <div>
                            <p className="text-[8px] font-black uppercase tracking-[0.45em] text-accent">Signal Library</p>
                            <h4 className="mt-1 text-sm font-black uppercase tracking-[0.2em] text-white">GIF / Emoji Matrix</h4>
                          </div>
                          <button type="button" onClick={() => setShowSignalPicker(false)} className="rounded-xl border border-white/10 p-2 text-gray-500 transition hover:border-accent/30 hover:text-accent">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="grid grid-cols-4 gap-1 rounded-2xl border border-white/10 bg-black/40 p-1">
                            {TRANSMISSION_SIGNAL_TABS.map(tab => (
                              (() => {
                                const TabIcon = SIGNAL_TAB_ICONS[tab.id];
                                return (
                                  <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setSignalTab(tab.id)}
                                    className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[8px] font-black uppercase tracking-widest transition ${
                                      signalTab === tab.id
                                        ? 'bg-accent text-black shadow-[0_0_18px_rgba(0,243,255,0.25)]'
                                        : 'text-gray-500 hover:bg-white/5 hover:text-white'
                                    }`}
                                  >
                                    <TabIcon className="h-3.5 w-3.5" />
                                    <span>{tab.label}</span>
                                    <span className="hidden text-[6px] opacity-60 sm:block">{tab.kicker}</span>
                                  </button>
                                );
                              })()
                            ))}
                          </div>
                          <div className="relative min-w-0 flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-accent/60" />
                            <input
                              value={signalSearch}
                              onChange={(e) => setSignalSearch(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.preventDefault();
                              }}
                              placeholder="SEARCH MOOD, SIGNAL, GLYPH..."
                              className="w-full rounded-2xl border border-white/10 bg-black/50 py-3 pl-9 pr-3 text-[9px] font-black uppercase tracking-[0.25em] text-white outline-none placeholder:text-gray-700 focus:border-accent/50"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="max-h-80 overflow-y-auto p-4 custom-scrollbar">
                        {signalTab === 'gifs' ? (
                          <div>
                            {/* Giphy Live Search */}
                            <GiphyPicker
                              onSelect={(gif) => {
                                setShowSignalPicker(false);
                                void sendTransmit({
                                  text: message.trim() || gif.title,
                                  attachment: {
                                    url: gif.url,
                                    name: `${gif.title}.gif`,
                                    size: 0,
                                    mime: 'image/gif',
                                    kind: 'image',
                                  },
                                });
                              }}
                            />
                            {/* BSC Signal Packs */}
                            {filteredGifSignals.length > 0 && (
                              <>
                                <div className="flex items-center gap-3 px-4 py-2">
                                  <div className="flex-1 h-px bg-white/5" />
                                  <span className="text-[8px] font-black uppercase tracking-[0.3em] text-zinc-600">BSC Signal Packs</span>
                                  <div className="flex-1 h-px bg-white/5" />
                                </div>
                                <div className="grid grid-cols-2 gap-3 px-4 pb-3 md:grid-cols-4">
                                  {filteredGifSignals.map(signal => (
                                    <motion.button
                                      key={signal.id}
                                      type="button"
                                      whileHover={{ y: -3 }}
                                      whileTap={{ scale: 0.98 }}
                                      onClick={() => selectSignal({ type: 'gif', signal })}
                                      disabled={sending || uploadingAttachment}
                                      className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] text-left transition hover:border-accent/40 hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40"
                                      title={`Send ${signal.label} GIF`}
                                    >
                                      <div className="aspect-video overflow-hidden bg-black">
                                        <img src={signal.url} alt={signal.label} loading="lazy" className="h-full w-full object-cover opacity-80 transition duration-300 group-hover:scale-105 group-hover:opacity-100" />
                                      </div>
                                      <div className="p-3">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="truncate text-[9px] font-black uppercase tracking-[0.2em] text-white">{signal.label}</span>
                                          <span className="text-sm">{signal.emoji}</span>
                                        </div>
                                        <p className="mt-1 truncate text-[8px] font-bold uppercase tracking-widest text-accent/70">{signal.mood}</p>
                                      </div>
                                    </motion.button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        ) : signalTab === 'emoji' ? (
                          <div>
                            {/* Full Emoji Picker with search + categories */}
                            <EmojiPicker
                              onSelect={(emoji) => {
                                setMessage(prev => prev + emoji);
                              }}
                            />
                            {/* BSC Emoji Signals */}
                            {filteredTextSignals.filter(s => s.type === 'emoji').length > 0 && (
                              <>
                                <div className="flex items-center gap-3 px-4 py-2">
                                  <div className="flex-1 h-px bg-white/5" />
                                  <span className="text-[8px] font-black uppercase tracking-[0.3em] text-zinc-600">BSC Emoji Signals</span>
                                  <div className="flex-1 h-px bg-white/5" />
                                </div>
                                <div className="grid grid-cols-3 gap-2 px-4 pb-3 md:grid-cols-4">
                                  {filteredTextSignals.filter(s => s.type === 'emoji').map(signal => (
                                    <motion.button
                                      key={signal.id}
                                      type="button"
                                      whileHover={{ y: -2 }}
                                      whileTap={{ scale: 0.98 }}
                                      onClick={() => selectSignal({ type: 'text', signal })}
                                      disabled={sending || uploadingAttachment}
                                      className="rounded-2xl border border-white/10 bg-white/[0.03] p-2.5 text-left transition hover:border-accent/40 hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40"
                                      title={`Add ${signal.label}`}
                                    >
                                      <div className="flex h-10 items-center justify-center text-xl">{signal.value}</div>
                                      <span className="block truncate text-center text-[8px] font-black uppercase tracking-widest text-zinc-500">{signal.label}</span>
                                    </motion.button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        ) : filteredTextSignals.length > 0 ? (
                          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
                            {filteredTextSignals.map(signal => (
                              <motion.button
                                key={signal.id}
                                type="button"
                                whileHover={{ y: -2 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => selectSignal({ type: 'text', signal })}
                                disabled={sending || uploadingAttachment}
                                className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-accent/40 hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40"
                                title={`Add ${signal.label}`}
                              >
                                <div className="mb-3 flex h-12 items-center justify-center rounded-xl border border-white/10 bg-black/40 px-2 text-center text-lg font-black text-white">
                                  <span className="truncate">{signal.value}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-[9px] font-black uppercase tracking-[0.2em] text-white">{signal.label}</span>
                                  <span className="rounded-full border border-accent/20 px-2 py-0.5 text-[7px] font-black uppercase tracking-widest text-accent/70">{signal.category}</span>
                                </div>
                                <p className="mt-1 truncate text-[8px] font-bold uppercase tracking-widest text-gray-600">{signal.tone}</p>
                              </motion.button>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-[9px] font-black uppercase tracking-[0.3em] text-gray-600">No glyph signals found</div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <AnimatePresence>
                  {(isRecording || speechStatus) && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      className="mx-2 mt-1 mb-2 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-[9px] font-black uppercase tracking-[0.25em] text-red-300 shadow-[0_0_20px_rgba(239,68,68,0.08)]"
                    >
                      <span className="relative flex h-2 w-2">
                        {isRecording && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />}
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                      </span>
                      {speechStatus || 'Voice uplink active'}
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="flex items-center justify-between px-2 py-1 border-t border-white/5 mt-2">
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => imageInputRef.current?.click()} disabled={sending || uploadingAttachment} className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-600 hover:text-accent disabled:opacity-40" title="Attach image">
                      <ImageIcon className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={sending || uploadingAttachment} className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-600 hover:text-accent disabled:opacity-40" title="Attach file">
                      <Paperclip className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSignalPicker(open => !open)}
                      disabled={sending || uploadingAttachment}
                      className={`p-2 rounded-lg transition-all flex items-center gap-2 disabled:opacity-40 ${showSignalPicker ? 'bg-accent/10 text-accent border border-accent/20' : 'text-gray-600 hover:bg-accent/5 hover:text-accent'}`}
                      title="Open GIF, emoji, sticker, and kaomoji signal library"
                    >
                      <Sparkles className="w-4 h-4" />
                      {showSignalPicker && <span className="text-[8px] font-black uppercase tracking-widest">Signals</span>}
                    </button>
                    <motion.button
                      type="button"
                      onClick={handleVoiceInput}
                      disabled={sending || uploadingAttachment || !speechSupported}
                      animate={isRecording ? { boxShadow: ['0 0 0 rgba(239,68,68,0)', '0 0 22px rgba(239,68,68,0.55)', '0 0 0 rgba(239,68,68,0)'] } : undefined}
                      transition={isRecording ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' } : undefined}
                      className={`relative overflow-hidden rounded-lg p-2 transition-all disabled:cursor-not-allowed disabled:opacity-40 ${isRecording ? 'border border-red-500/40 bg-red-500/15 text-red-300' : 'text-gray-600 hover:bg-red-500/5 hover:text-red-400'}`}
                      title={!speechSupported ? 'Speech recognition unavailable in this browser' : isRecording ? 'Stop voice capture' : 'Start voice-to-text'}
                    >
                      {isRecording && <span className="absolute inset-0 rounded-lg bg-red-500/20 animate-pulse" />}
                      {isRecording ? <MicOff className="relative z-10 w-4 h-4" /> : <Mic className="relative z-10 w-4 h-4" />}
                    </motion.button>
                    <div className="h-4 w-[1px] bg-white/10 mx-1" />
                    <button 
                      type="button" 
                      onClick={() => setBurnDuration(burnDuration ? null : 60)}
                      className={`p-2 rounded-lg transition-all flex items-center gap-2 ${burnDuration ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-600 hover:text-red-500 hover:bg-red-500/5'}`}
                    >
                      <Flame className="w-4 h-4" />
                      {burnDuration && <span className="text-[8px] font-black uppercase">Auto-Burn</span>}
                    </button>
                    <button 
                      type="button"
                      onClick={() => setEncryptionEnabled(!encryptionEnabled)}
                      className={`p-2 rounded-lg transition-all flex items-center gap-2 ${encryptionEnabled ? 'text-accent' : 'text-gray-600 hover:text-white'}`}
                    >
                      <Lock className="w-4 h-4" />
                    </button>
                  </div>
                  <button 
                    type="submit"
                    disabled={(!message.trim() && !uploadingAttachment) || sending || uploadingAttachment}
                    onClick={(e) => {
                      // Explicit click handler as backup for form submit
                      e.preventDefault();
                      handleSendMessage();
                    }}
                    className="bg-accent hover:bg-accent/80 disabled:bg-gray-800 disabled:text-gray-600 text-black p-2.5 rounded-xl transition-all shadow-[0_0_15px_rgba(0,243,255,0.2)] group cursor-pointer"
                  >
                    {sending || uploadingAttachment ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                    )}
                  </button>
                </div>
              </form>
              <div className="mt-3 flex items-center justify-center gap-4 text-[8px] text-gray-700 uppercase tracking-[0.4em]">
                <div className="flex items-center gap-1">
                  <Shield className="w-2.5 h-2.5" />
                  E2E Encrypted
                </div>
                <div className="flex items-center gap-1">
                  <Activity className="w-2.5 h-2.5" />
                  Link Stable
                </div>
                <div className="flex items-center gap-1">
                  <Cpu className="w-2.5 h-2.5" />
                  Quantum Secured
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-[radial-gradient(circle_at_center,rgba(0,243,255,0.03)_0%,transparent_70%)]">
            <div className="w-20 h-20 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-8 group">
              <Terminal className="w-10 h-10 text-gray-800 group-hover:text-accent transition-all duration-500 group-hover:scale-110" />
            </div>
            <h3 className="text-lg font-black text-white uppercase tracking-[0.3em] mb-4 italic">
              Awaiting Signal
            </h3>
            <p className="text-gray-600 max-w-xs uppercase text-[10px] leading-relaxed tracking-widest mb-8">
              Select a neural link from the terminal to establish a secure transmission stream.
            </p>
            <button 
              onClick={() => setShowNewChat(true)}
              className="px-8 py-3 bg-white/5 border border-white/10 text-accent rounded-xl uppercase tracking-[0.2em] font-black text-[10px] hover:bg-accent hover:text-black transition-all hover:shadow-[0_0_30px_rgba(0,243,255,0.2)] flex items-center gap-3"
            >
              Initialize New Link
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {fullSizeImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[180] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md"
            onClick={() => setFullSizeImage(null)}
          >
            <button type="button" className="absolute right-5 top-5 rounded-full border border-white/10 bg-white/5 p-2 text-white/60 hover:text-white" onClick={() => setFullSizeImage(null)}>
              <X className="h-5 w-5" />
            </button>
            <img src={fullSizeImage} alt="Full-size attachment" className="max-h-[86vh] max-w-[92vw] rounded-2xl border border-white/10 object-contain shadow-2xl" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* New Chat Modal */}
      <NewTransmissionModal 
        isOpen={showNewChat}
        onClose={() => setShowNewChat(false)}
        onSelect={(t) => {
          setActiveTransmission(t);
          setShowNewChat(false);
        }}
      />
    </div>
  );
};
