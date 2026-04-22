import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, 
  Search, 
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
  Globe
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { useCall } from '../CallContext';
import { supabase } from '../supabase';
import { Transmission, Transmit, User as UserType } from '../types';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { NewTransmissionModal } from './NewTransmissionModal';

const appendTransmitUnique = (prev: Transmit[], next: Transmit): Transmit[] =>
  prev.some((t) => t.id === next.id) ? prev : [...prev, next];

export const Transmissions: React.FC = () => {
  const { currentUser } = useAuth();
  const [transmissions, setTransmissions] = useState<Transmission[]>([]);
  const [activeTransmission, setActiveTransmission] = useState<Transmission | null>(null);
  const [transmits, setTransmits] = useState<Transmit[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [burnDuration, setBurnDuration] = useState<number | null>(null);
  const [encryptionEnabled, setEncryptionEnabled] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const userCache = useRef<Record<string, UserType>>({});
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

    // Subscribe to new transmissions
    const channel = supabase
      .channel('public:transmissions')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'transmissions',
        filter: `participant_ids=cs.{${currentUser.id}}`
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setTransmissions(prev => [payload.new as Transmission, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setTransmissions(prev => prev.map(t => t.id === payload.new.id ? payload.new as Transmission : t));
        } else if (payload.eventType === 'DELETE') {
          setTransmissions(prev => prev.filter(t => t.id !== payload.old.id));
        }
      })
      .subscribe();

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
        setTransmits(data || []);
        
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

    // Subscribe to new transmits
    const channel = supabase
      .channel(`transmission:${activeTransmission.id}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'transmits',
        filter: `transmission_id=eq.${activeTransmission.id}`
      }, (payload) => {
        const next = payload.new as Transmit;
        setTransmits((prev) => appendTransmitUnique(prev, next));
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'transmissions',
        filter: `id=eq.${activeTransmission.id}`
      }, (payload) => {
        setActiveTransmission(payload.new as Transmission);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTransmission, currentUser]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transmits]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!message.trim() || !activeTransmission || !currentUser || sending) return;

    setError(null);
    setSending(true);
    const otherUserId = activeTransmission.participant_ids?.find(id => id !== currentUser.id);
    const messageText = message.trim();

    try {
      const newTransmit = {
        transmission_id: activeTransmission.id,
        sender_id: currentUser.id,
        content: messageText,
        type: 'text',
        burn_duration: burnDuration,
        expires_at: burnDuration ? new Date(Date.now() + burnDuration * 1000).toISOString() : null,
      };

      const { data: insertedTransmit, error: sendError } = await supabase
        .from('transmits')
        .insert(newTransmit)
        .select('*')
        .single();

      if (sendError) throw sendError;
      if (insertedTransmit) {
        setTransmits((prev) => appendTransmitUnique(prev, insertedTransmit as Transmit));
      }

      // Update transmission metadata
      const updatedUnread = { ...activeTransmission.unread_counts };
      if (otherUserId) {
        updatedUnread[otherUserId] = (updatedUnread[otherUserId] || 0) + 1;
      }

      await supabase
        .from('transmissions')
        .update({
          last_transmit: {
            content: messageText,
            sender_id: currentUser.id,
            created_at: new Date().toISOString()
          },
          unread_counts: updatedUnread,
          updated_at: new Date().toISOString()
        })
        .eq('id', activeTransmission.id);

      setMessage('');
      setBurnDuration(null);
    } catch (err: unknown) {
      console.error('Error sending transmit:', err);
      setError(err instanceof Error ? err.message : 'Failed to send transmission.');
    } finally {
      setSending(false);
    }
  };

  const handleTyping = () => {
    if (!activeTransmission || !currentUser) return;
    
    if (!isTyping) {
      setIsTyping(true);
      const typingStatus = { ...activeTransmission.typing_status };
      typingStatus[currentUser.id] = true;
      
      supabase
        .from('transmissions')
        .update({ typing_status: typingStatus })
        .eq('id', activeTransmission.id);
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      const typingStatus = { ...activeTransmission.typing_status };
      typingStatus[currentUser.id] = false;
      
      supabase
        .from('transmissions')
        .update({ typing_status: typingStatus })
        .eq('id', activeTransmission.id);
    }, 3000);
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

  const startCall = () => {
    if (!activeTransmission || !currentUser) return;
    const otherUserId = activeTransmission.participant_ids?.find(id => id !== currentUser.id);
    const otherUser = otherUserId ? userCache.current[otherUserId] : null;
    
    if (otherUser) {
      initiateCall(otherUser);
    } else {
      alert("NEURAL LINK ERROR: Target node not found in current sector.");
    }
  };

  if (!currentUser) return null;

  return (
    <div className="flex h-[calc(100vh-64px)] bg-black overflow-hidden font-mono text-xs">
      {/* Sidebar */}
      <div className={`${isSidebarOpen ? 'w-80' : 'w-0'} transition-all duration-300 border-r border-white/10 flex flex-col bg-[#050505]`}>
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
                    <div className="w-10 h-10 rounded-lg overflow-hidden border border-white/10 bg-white/5">
                      {otherUser?.avatar_url ? (
                        <img src={otherUser.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-600">
                          <User className="w-5 h-5" />
                        </div>
                      )}
                    </div>
                    {otherUser?.is_online && (
                      <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-black shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
                    )}
                  </div>
                  <div className="flex-1 text-left overflow-hidden">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-black text-white uppercase truncate group-hover:text-accent transition-colors">
                        {otherUser?.display_name || "NEURAL ENTITY"}
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

      {/* Main Content */}
      <div className="flex-1 flex flex-col relative bg-black">
        {activeTransmission ? (
          <>
            {/* Header */}
            <div className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-[#050505]/80 backdrop-blur-xl z-10">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                  className="p-2 hover:bg-white/5 rounded-md transition-colors text-gray-600 lg:hidden"
                >
                  <ChevronLeft className={`w-5 h-5 transition-transform ${isSidebarOpen ? '' : 'rotate-180'}`} />
                </button>
                {(() => {
                  const otherUserId = activeTransmission.participant_ids?.find(id => id !== currentUser.id);
                  const otherUser = otherUserId ? userCache.current[otherUserId] : null;
                  return (
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg border border-white/10 overflow-hidden bg-white/5">
                        {otherUser?.avatar_url ? (
                          <img src={otherUser.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-600">
                            <User className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                      <div>
                        <Link 
                          to={`/profile/${otherUser?.username}`}
                          className="text-sm font-black text-white uppercase italic tracking-tight hover:text-accent transition-colors"
                        >
                          {otherUser?.display_name || "NEURAL ENTITY"}
                        </Link>
                        <div className="text-[8px] font-black text-accent uppercase tracking-[0.3em] flex items-center gap-1">
                          <div className="w-1 h-1 bg-accent rounded-full" />
                          Neural Link Active
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
                        onClick={startCall}
                        className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-400 hover:text-green-500"
                      >
                        <Phone className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={startCall}
                        className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-400 hover:text-accent"
                      >
                        <Video className="w-5 h-5" />
                      </button>
                    </>
                  );
                })()}
                <button className="p-2 hover:bg-white/5 rounded-full transition-colors">
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
                        <button className="w-full flex items-center gap-3 px-3 py-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-all uppercase tracking-widest text-[10px]">
                          <Lock className="w-4 h-4" /> Secure Link
                        </button>
                        <button className="w-full flex items-center gap-3 px-3 py-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-all uppercase tracking-widest text-[10px]">
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
                          <div className="w-6 h-6 rounded-md border border-white/10 overflow-hidden flex-shrink-0 bg-white/5">
                            {userCache.current[t.sender_id]?.avatar_url ? (
                              <img src={userCache.current[t.sender_id].avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-700">
                                <User className="w-3 h-3" />
                              </div>
                            )}
                          </div>
                        )}
                        <div className={`relative px-4 py-2.5 rounded-2xl text-[11px] leading-relaxed tracking-tight ${
                          isOwn 
                            ? 'bg-accent text-black font-bold rounded-br-none shadow-[0_0_20px_rgba(0,243,255,0.1)]' 
                            : 'bg-white/5 text-gray-300 border border-white/10 rounded-bl-none'
                        }`}>
                          {t.content}
                          {t.burn_duration && (
                            <div className="absolute -top-1 -right-1">
                              <Flame className="w-3 h-3 text-red-500 animate-pulse" />
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="text-[8px] text-gray-700 mt-1 uppercase tracking-widest">
                        {format(new Date(t.created_at), 'HH:mm:ss')}
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
            </div>

            {/* Input Area */}
            <div className="p-6 bg-[#050505] border-t border-white/10">
              <form 
                onSubmit={handleSendMessage}
                className="relative bg-white/5 border border-white/10 rounded-2xl p-2 transition-all focus-within:border-accent/50 focus-within:bg-white/[0.07]"
              >
                <textarea 
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
                <div className="flex items-center justify-between px-2 py-1 border-t border-white/5 mt-2">
                  <div className="flex items-center gap-1">
                    <button type="button" className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-600 hover:text-accent">
                      <ImageIcon className="w-4 h-4" />
                    </button>
                    <button type="button" className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-600 hover:text-accent">
                      <Paperclip className="w-4 h-4" />
                    </button>
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
                    disabled={!message.trim() || sending}
                    className="bg-accent hover:bg-accent/80 disabled:bg-gray-800 disabled:text-gray-600 text-black p-2.5 rounded-xl transition-all shadow-[0_0_15px_rgba(0,243,255,0.2)] group"
                  >
                    {sending ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                    )}
                  </button>
                </div>
              </form>
              {error && (
                <div className="mt-2 text-[9px] text-red-400 uppercase tracking-wider text-center">
                  {error}
                </div>
              )}
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
