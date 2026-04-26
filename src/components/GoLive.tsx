import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Camera, 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  X, 
  Send, 
  Users, 
  MessageCircle, 
  Radio, 
  Loader2,
  Heart,
  Zap,
  Shield,
  Bot,
  ArrowLeft,
  Eye,
  BarChart2,
  Gift,
  Coins,
  Share2,
  Copy,
  Facebook,
  Twitter,
  Youtube,
  Phone,
  CheckCircle2,
  MoreHorizontal
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { cn } from '../lib/utils';

export const GoLive: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const viewerStreamId = searchParams.get('streamId');
  const isViewer = !!viewerStreamId;

  const { currentUser } = useAuth();
  const [isLive, setIsLive] = useState(false);
  const [streamTitle, setStreamTitle] = useState('');
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [crowdSize, setCrowdSize] = useState(0);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [streamId, setStreamId] = useState<string | null>(viewerStreamId);
  const [isLoading, setIsLoading] = useState(false);
  const [streamData, setStreamData] = useState<any>(null);
  const [hasEnded, setHasEnded] = useState(false);
  
  // Interactive Features State
  const [recentEvents, setRecentEvents] = useState<any[]>([]);
  const [showPollModal, setShowPollModal] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOption1, setPollOption1] = useState('');
  const [pollOption2, setPollOption2] = useState('');
  const [votedPolls, setVotedPolls] = useState<Set<string>>(new Set());
  const [showDonateModal, setShowDonateModal] = useState(false);
  const [donationAmount, setDonationAmount] = useState('10');
  const [donationMessage, setDonationMessage] = useState('');
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const normalizeStreamData = (data: any) => {
    if (!data) return null;
    return {
      ...data,
      hostUsername: data.host_username,
      hostDisplayName: data.host_display_name,
      hostAvatar: data.host_avatar,
      activePoll: data.active_poll,
      isLive: data.is_live,
      crowdSize: data.crowd_size,
    };
  };

  const startMedia = async () => {
    if (isViewer) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 1280, height: 720 }, 
        audio: true 
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(e => console.error("Video play failed:", e));
      }
    } catch (error) {
      console.error('Media Error:', error);
      // Fallback to audio only if camera fails
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = audioStream;
        setIsCameraOn(false);
      } catch (audioError) {
        console.error('Audio also failed:', audioError);
        alert('Could not access camera or microphone. Please check permissions.');
      }
    }
  };

  const stopMedia = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  useEffect(() => {
    if (isViewer && viewerStreamId) {
      // Increment crowd size
      supabase.rpc('increment_counter', { p_table: 'streams', p_id: viewerStreamId, p_field: 'crowd_size', p_amount: 1 }).then();

      const fetchStream = async () => {
        const { data } = await supabase.from('streams').select('*').eq('id', viewerStreamId).maybeSingle();
        const normalized = normalizeStreamData(data);
        if (normalized) {
          setStreamData(normalized);
          setStreamTitle(normalized.title);
          setCrowdSize(normalized.crowdSize ?? 0);
          setIsLive(!!normalized.isLive);
          if (!normalized.isLive) setHasEnded(true);
        } else {
          setHasEnded(true);
        }
      };

      fetchStream();

      const streamChannel = supabase.channel(`stream-viewer-${viewerStreamId}`)
        .on('postgres_changes', { 
          event: 'UPDATE', 
          schema: 'public', 
          table: 'streams', 
          filter: `id=eq.${viewerStreamId}` 
        }, ({ new: data }) => {
          const normalized = normalizeStreamData(data);
          setStreamData(normalized);
          setStreamTitle(normalized?.title ?? '');
          setCrowdSize(normalized?.crowdSize ?? 0);
          setIsLive(!!normalized?.isLive);
          if (normalized && !normalized.isLive) setHasEnded(true);
        })
        .subscribe();

      return () => {
        supabase.rpc('increment_counter', { p_table: 'streams', p_id: viewerStreamId, p_field: 'crowd_size', p_amount: -1 }).then();
        supabase.removeChannel(streamChannel);
      };
    }

    startMedia();
    return () => stopMedia();
  }, [isViewer, viewerStreamId]);

  useEffect(() => {
    if (!streamId) return;

    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from('stream_chat')
        .select('*')
        .eq('stream_id', streamId)
        .order('created_at', { ascending: true })
        .limit(100);

      if (error) {
        handleDbError(error, 'LIST', `stream_chat/${streamId}`);
        return;
      }

      const normalized = (data ?? []).map((msg: any) => ({
        ...msg,
        content: msg.text,
        senderName: msg.sender_name,
        isDonation: (msg.text ?? '').startsWith('\u{1F48E}'),
      }));
      setMessages(normalized);
    };

    fetchMessages();

    const chatChannel = supabase.channel(`stream-chat-${streamId}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'stream_chat', 
        filter: `stream_id=eq.${streamId}` 
      }, () => {
        fetchMessages();
      })
      .subscribe();

    return () => { supabase.removeChannel(chatChannel); };
  }, [streamId]);

  // Handle host reconnection
  useEffect(() => {
    if (currentUser?.is_live && currentUser.active_stream_id && !isViewer && !isLive) {
      setStreamId(currentUser.active_stream_id);
      setIsLive(true);
      supabase.from('streams').select('*').eq('id', currentUser.active_stream_id).maybeSingle().then(({ data }) => {
        const normalized = normalizeStreamData(data);
        if (normalized) {
          setStreamTitle(normalized.title);
          setStreamData(normalized);
        }
      });
    }
  }, [currentUser, isViewer, isLive]);

  const toggleCamera = () => {
    if (streamRef.current) {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOn(videoTrack.enabled);
      }
    }
  };

  const toggleMic = () => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
      }
    }
  };

  const handleStartStream = async () => {
    if (!streamTitle.trim() || !currentUser) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase.from('streams').insert({
        host_id: currentUser.id,
        host_display_name: currentUser.display_name,
        host_username: currentUser.username,
        host_avatar: currentUser.avatar_url,
        title: streamTitle,
        is_live: true,
        crowd_size: 0,
        started_at: new Date().toISOString(),
      }).select().single();

      if (error) throw error;

      setStreamId(data.id);
      setIsLive(true);
      setStreamData(normalizeStreamData(data));
      await supabase.from('users').update({ is_live: true, active_stream_id: data.id }).eq('id', currentUser.id);
    } catch (error) {
      handleDbError(error, 'CREATE', 'streams');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEndStream = async () => {
    if (!streamId || !currentUser) return;
    try {
      await supabase.from('streams').update({ is_live: false, ended_at: new Date().toISOString() }).eq('id', streamId);
      await supabase.from('users').update({ is_live: false, active_stream_id: null }).eq('id', currentUser.id);

      setIsLive(false);
      setStreamId(null);
      setHasEnded(true);
      stopMedia();
    } catch (error) {
      handleDbError(error, 'UPDATE', `streams/${streamId}`);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !currentUser || !streamId) return;

    try {
      const { error } = await supabase.from('stream_chat').insert({
        stream_id: streamId,
        sender_id: currentUser.id,
        sender_name: currentUser.display_name,
        text: newMessage,
      });

      if (error) throw error;
      setNewMessage('');
    } catch (error) {
      handleDbError(error, 'CREATE', `stream_chat/${streamId}`);
    }
  };

  const handleDonate = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseInt(donationAmount, 10);
    if (!amount || amount <= 0 || !currentUser || !streamId || !streamData) return;
    if ((currentUser.cred_balance || 0) < amount) {
      alert('Insufficient CRED');
      return;
    }

    try {
      await Promise.all([
        supabase.rpc('increment_counter', { p_table: 'users', p_id: currentUser.id, p_field: 'cred_balance', p_amount: -amount }),
        supabase.rpc('increment_counter', { p_table: 'users', p_id: streamData.host_id, p_field: 'cred_balance', p_amount: amount }),
        supabase.from('transactions').insert([
          { user_id: currentUser.id, amount, type: 'spend', description: `Donated to ${streamData.host_username}'s stream`, created_at: new Date().toISOString() },
          { user_id: streamData.host_id, amount, type: 'earn', description: `Donation from ${currentUser.username}`, created_at: new Date().toISOString() },
        ]),
        supabase.from('stream_chat').insert({
          stream_id: streamId,
          sender_id: currentUser.id,
          sender_name: currentUser.display_name,
          text: `💎 ${amount} CRED: ${donationMessage || 'Sent a donation!'}`,
        })
      ]);

      setShowDonateModal(false);
      setDonationMessage('');
    } catch (error) {
      handleDbError(error, 'CREATE', 'donations');
    }
  };

  const handleCreatePoll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pollQuestion.trim() || !pollOption1.trim() || !pollOption2.trim() || !streamId) return;

    try {
      const activePoll = {
        id: Date.now().toString(),
        question: pollQuestion,
        options: {
          [pollOption1]: 0,
          [pollOption2]: 0,
        },
        totalVotes: 0,
      };

      const { error } = await supabase.from('streams').update({ active_poll: activePoll }).eq('id', streamId);
      if (error) throw error;

      setShowPollModal(false);
      setPollQuestion('');
      setPollOption1('');
      setPollOption2('');
    } catch (error) {
      handleDbError(error, 'UPDATE', `streams/${streamId}`);
    }
  };

  const handleVote = async (option: string) => {
    const poll = streamData?.active_poll;
    if (!streamId || !poll || votedPolls.has(poll.id)) return;

    try {
      setVotedPolls(prev => new Set(prev).add(poll.id));
      const updatedPoll = {
        ...poll,
        options: {
          ...poll.options,
          [option]: (poll.options?.[option] || 0) + 1,
        },
        totalVotes: (poll.totalVotes || 0) + 1,
      };

      const { error } = await supabase.from('streams').update({ active_poll: updatedPoll }).eq('id', streamId);
      if (error) throw error;
    } catch (error) {
      handleDbError(error, 'UPDATE', `streams/${streamId}`);
    }
  };

  const handleEndPoll = async () => {
    if (!streamId) return;
    try {
      const { error } = await supabase.from('streams').update({ active_poll: null }).eq('id', streamId);
      if (error) throw error;
    } catch (error) {
      handleDbError(error, 'UPDATE', `streams/${streamId}`);
    }
  };

  const getStreamUrl = () => {
    const id = streamId || viewerStreamId;
    return `${window.location.origin}/golive?streamId=${id}`;
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(getStreamUrl());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareOnTwitter = () => {
    const text = `Join my neural link stream on Blood Sweat Code! ${streamTitle}`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(getStreamUrl())}`, '_blank');
  };

  const shareOnFacebook = () => {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(getStreamUrl())}`, '_blank');
  };

  const shareOnWhatsApp = () => {
    const text = `Join my live stream on Blood Sweat Code: ${getStreamUrl()}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const shareViaSMS = () => {
    const text = `Join my live stream on Blood Sweat Code: ${getStreamUrl()}`;
    window.location.href = `sms:?body=${encodeURIComponent(text)}`;
  };

  const shareOnYoutube = () => {
    // YouTube doesn't have a direct share-to-post API for external sites, 
    // so we open YouTube's home or a placeholder for sharing
    window.open(`https://www.youtube.com/`, '_blank');
  };

  const handleWebShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: streamTitle || 'Blood Sweat Code Live Stream',
          text: `Join ${currentUser?.display_name}'s live stream on Blood Sweat Code!`,
          url: getStreamUrl(),
        });
      } catch (err) {
        console.error('Web Share failed:', err);
      }
    } else {
      setShowShareModal(true);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col md:flex-row overflow-hidden font-sans">
      {/* ── MAIN STREAM AREA ────────────────────────────────────────────── */}
      <div className="relative flex-1 bg-zinc-950 flex flex-col overflow-hidden">
        {/* Top Header (Mobile/Small Screens) */}
        <div className="p-4 flex items-center justify-between border-b border-white/5 md:hidden">
          <button onClick={() => navigate('/')} className="p-2 text-white">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
            <span className="text-xs font-black uppercase tracking-widest text-white">
              {isLive ? 'Live' : 'Preview'}
            </span>
          </div>
          <button onClick={() => setShowShareModal(true)} className="p-2 text-white">
            <Share2 className="w-5 h-5" />
          </button>
        </div>

        {/* Video Player Container */}
        <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
          {/* Video Feed */}
          <video 
            ref={videoRef} 
            autoPlay 
            muted={!isViewer} 
            playsInline 
            className={cn(
              "w-full h-full object-contain transition-opacity duration-700",
              (isCameraOn && (!isViewer || isLive)) ? "opacity-100" : "opacity-0"
            )}
          />

          {/* Viewer Placeholder (since no WebRTC peer yet) */}
          {isViewer && !hasEnded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/80 backdrop-blur-sm z-10">
              <div className="flex flex-col items-center gap-6 p-8 text-center max-w-md">
                <div className="relative">
                  <div className="absolute inset-0 bg-accent/20 blur-3xl rounded-full" />
                  {streamData?.host_avatar ? (
                    <img src={streamData.host_avatar} alt="" className="relative w-32 h-32 rounded-full border-4 border-accent object-cover shadow-2xl" />
                  ) : (
                    <div className="relative w-32 h-32 rounded-full bg-zinc-900 border-4 border-accent flex items-center justify-center">
                      <Bot className="w-16 h-16 text-accent" />
                    </div>
                  )}
                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-4 py-1 bg-accent rounded-full shadow-lg">
                    <span className="text-[10px] font-black text-white uppercase tracking-widest">Host</span>
                  </div>
                </div>
                
                <div>
                  <h2 className="text-2xl font-black text-white uppercase italic tracking-tighter mb-1">
                    {streamData?.hostDisplayName || streamData?.host_display_name || 'Neural Architect'}
                  </h2>
                  <p className="text-zinc-400 font-bold uppercase tracking-widest text-xs">
                    {streamTitle || 'Establishing Connection...'}
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 px-4 py-2 bg-accent/10 border border-accent/20 rounded-xl">
                    <Users className="w-4 h-4 text-accent" />
                    <span className="text-accent text-sm font-black tracking-tight">{crowdSize}</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl">
                    <Zap className="w-4 h-4 text-yellow-500" />
                    <span className="text-white text-sm font-black tracking-tight">Active</span>
                  </div>
                </div>

                <p className="text-zinc-500 text-xs leading-relaxed italic">
                  "The neural link is active. Signal is strong. Synchronizing data streams..."
                </p>
              </div>
            </div>
          )}

          {/* Camera Off Placeholder (Host) */}
          {!isCameraOn && !isViewer && !hasEnded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 z-10">
              <div className="w-24 h-24 rounded-full bg-zinc-800 flex items-center justify-center mb-4 border border-white/10 shadow-2xl">
                <VideoOff className="w-10 h-10 text-zinc-600" />
              </div>
              <p className="text-zinc-500 font-black uppercase tracking-widest text-xs italic">Camera Feed Offline</p>
            </div>
          )}

          {/* Stream Ended Overlay */}
          <AnimatePresence>
            {hasEnded && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 z-50 bg-black/95 backdrop-blur-2xl flex flex-col items-center justify-center p-6 text-center"
              >
                <div className="w-24 h-24 rounded-full bg-accent/20 flex items-center justify-center mb-8 border border-accent/50 shadow-[0_0_50px_rgba(255,0,0,0.3)]">
                  <Zap className="w-12 h-12 text-accent" />
                </div>
                <h2 className="text-4xl font-black text-white uppercase italic mb-4 tracking-tighter">Transmission Terminated</h2>
                <p className="text-zinc-500 max-w-sm mb-12 text-sm leading-relaxed font-medium">
                  The neural link has been successfully severed. All stream data has been archived to the global consciousness network.
                </p>
                <button 
                  onClick={() => navigate('/')}
                  className="px-16 py-5 bg-white text-black rounded-2xl font-black uppercase tracking-widest hover:bg-zinc-200 transition-all shadow-xl hover:scale-105 active:scale-95"
                >
                  Return to Network
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Interactive Overlays (Donations) */}
          <div className="absolute top-6 left-6 right-6 pointer-events-none flex flex-col gap-3 items-center z-40">
            <AnimatePresence>
              {recentEvents.map(event => (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: -40, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8, y: -20 }}
                  className="bg-accent/90 backdrop-blur-xl border border-white/20 p-5 rounded-2xl shadow-2xl flex items-center gap-5 pointer-events-auto max-w-md w-full"
                >
                  <div className="w-14 h-14 rounded-full bg-yellow-500/20 flex items-center justify-center border border-yellow-500/50 flex-shrink-0">
                    <Gift className="w-7 h-7 text-yellow-500" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-black text-white uppercase tracking-tight">
                      <span className="text-yellow-400">@{event.senderName}</span>
                    </p>
                    <p className="text-lg font-black text-white">
                      DONATED <span className="text-yellow-400">{event.amount} CRED</span>
                    </p>
                    {event.message && (
                      <p className="text-xs text-white/90 italic mt-1 font-medium">"{event.message}"</p>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* Active Poll Overlay */}
          <AnimatePresence>
            {streamData?.active_poll && (
              <motion.div
                initial={{ opacity: 0, x: -40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 }}
                className="absolute left-6 bottom-32 w-72 bg-black/80 backdrop-blur-xl border border-white/10 rounded-3xl p-6 pointer-events-auto z-40 shadow-2xl"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
                    <span className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Live Poll</span>
                  </div>
                  {!isViewer && (
                    <button onClick={handleEndPoll} className="text-[10px] font-black text-red-500 uppercase tracking-widest hover:text-red-400">End</button>
                  )}
                </div>
                <h3 className="text-sm font-black text-white mb-4 uppercase tracking-tight">{streamData.active_poll.question}</h3>
                <div className="space-y-3">
                  {Object.entries(streamData.active_poll.options).map(([option, votes]: [string, any]) => {
                    const total = streamData.active_poll.totalVotes || 1;
                    const percentage = Math.round((votes / total) * 100);
                    const hasVoted = votedPolls.has(streamData.active_poll.id);
                    
                    return (
                      <button
                        key={option}
                        disabled={hasVoted || isViewer === false}
                        onClick={() => handleVote(option)}
                        className="w-full relative overflow-hidden rounded-xl bg-white/5 border border-white/10 p-3 text-left transition-all hover:bg-white/10 disabled:cursor-default group"
                      >
                        <motion.div 
                          className="absolute inset-y-0 left-0 bg-accent/20"
                          initial={{ width: 0 }}
                          animate={{ width: `${percentage}%` }}
                          transition={{ duration: 1, ease: "easeOut" }}
                        />
                        <div className="relative flex items-center justify-between z-10">
                          <span className="text-xs font-black text-white uppercase tracking-tight">{option}</span>
                          <span className="text-[10px] font-black text-accent">{percentage}%</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{streamData.active_poll.totalVotes} Signals Received</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom Toolbar (Twitch-style) */}
        <div className="bg-zinc-900/50 backdrop-blur-xl border-t border-white/5 p-4 md:p-6 flex items-center justify-between z-50">
          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col">
              <h1 className="text-lg font-black text-white uppercase italic tracking-tighter leading-none mb-1">
                {streamTitle || 'Neural Transmission'}
              </h1>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Host:</span>
                <span className="text-[10px] font-black text-accent uppercase tracking-widest">
                  @{streamData?.host_username || currentUser?.username}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            {isLive && !isViewer ? (
              <>
                <button 
                  onClick={() => setShowPollModal(true)}
                  className="p-3 md:px-5 md:py-3 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-all flex items-center gap-2"
                  title="Create Poll"
                >
                  <BarChart2 className="w-5 h-5" />
                  <span className="hidden md:inline text-[10px] font-black uppercase tracking-widest">Poll</span>
                </button>
                <button 
                  onClick={toggleCamera}
                  className={cn(
                    "p-3 md:px-5 md:py-3 rounded-xl border transition-all flex items-center gap-2",
                    isCameraOn ? "bg-white/5 border-white/10 text-white hover:bg-white/10" : "bg-accent/20 border-accent/40 text-accent"
                  )}
                >
                  {isCameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                  <span className="hidden md:inline text-[10px] font-black uppercase tracking-widest">{isCameraOn ? 'Cam On' : 'Cam Off'}</span>
                </button>
                <button 
                  onClick={toggleMic}
                  className={cn(
                    "p-3 md:px-5 md:py-3 rounded-xl border transition-all flex items-center gap-2",
                    isMicOn ? "bg-white/5 border-white/10 text-white hover:bg-white/10" : "bg-accent/20 border-accent/40 text-accent"
                  )}
                >
                  {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                  <span className="hidden md:inline text-[10px] font-black uppercase tracking-widest">{isMicOn ? 'Mic On' : 'Mic Off'}</span>
                </button>
                <button 
                  onClick={() => setShowShareModal(true)}
                  className="p-3 md:px-5 md:py-3 rounded-xl bg-accent text-white font-black uppercase tracking-widest text-[10px] shadow-[0_0_20px_rgba(255,0,0,0.3)] hover:scale-105 transition-all flex items-center gap-2"
                >
                  <Share2 className="w-5 h-5" />
                  <span className="hidden md:inline">Share Stream</span>
                </button>
                <button 
                  onClick={handleEndStream}
                  className="p-3 md:px-5 md:py-3 bg-zinc-800 text-red-500 rounded-xl border border-red-500/30 hover:bg-red-500 hover:text-white transition-all"
                  title="End Stream"
                >
                  <X className="w-5 h-5" />
                </button>
              </>
            ) : isViewer ? (
              <>
                <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-white/5 rounded-xl border border-white/10 mr-4">
                  <img src={streamData?.host_avatar} alt="" className="w-8 h-8 rounded-full border border-accent" />
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-white uppercase tracking-tighter">@{streamData?.host_username}</span>
                    <span className="text-[8px] text-zinc-500 font-bold uppercase">Broadcasting</span>
                  </div>
                </div>
                <button 
                  onClick={() => setShowDonateModal(true)}
                  className="px-6 py-3 bg-yellow-500 text-black rounded-xl font-black uppercase tracking-widest hover:bg-yellow-400 transition-all flex items-center gap-2 shadow-lg"
                >
                  <Gift className="w-4 h-4" />
                  Donate
                </button>
                <button 
                  onClick={() => setShowShareModal(true)}
                  className="p-3 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-all"
                >
                  <Share2 className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => navigate('/')}
                  className="px-6 py-3 bg-zinc-800 text-white rounded-xl font-black uppercase tracking-widest hover:bg-zinc-700 transition-all border border-white/5"
                >
                  Leave
                </button>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="flex flex-col md:flex-row items-center gap-4 w-full max-w-2xl">
                  <input 
                    type="text" 
                    value={streamTitle}
                    onChange={(e) => setStreamTitle(e.target.value)}
                    placeholder="ENTER STREAM FREQUENCY TITLE..."
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-6 py-4 text-white font-bold uppercase tracking-widest text-xs focus:outline-none focus:border-accent transition-all"
                  />
                  <button 
                    onClick={handleStartStream}
                    disabled={!streamTitle.trim() || isLoading}
                    className="px-10 py-4 bg-accent text-white rounded-xl font-black uppercase tracking-[0.2em] text-xs shadow-[0_0_30px_rgba(255,0,0,0.3)] hover:scale-105 transition-all disabled:opacity-50 flex items-center gap-3"
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />}
                    Initialize Stream
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── CROWD SIDEBAR (Twitch-style) ────────────────────────────────── */}
      <div className="w-full md:w-80 lg:w-96 bg-zinc-950 border-l border-white/5 flex flex-col h-[40vh] md:h-full z-50">
        <div className="p-5 border-b border-white/5 flex items-center justify-between bg-zinc-900/30">
          <div className="flex items-center gap-3">
            <MessageCircle className="w-5 h-5 text-accent" />
            <h3 className="text-[10px] font-black text-white uppercase tracking-[0.3em]">Crowd Comms</h3>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-black rounded-full border border-white/5">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Live Sync</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide bg-gradient-to-b from-transparent to-black/20">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-20 text-center px-8">
              <Zap className="w-12 h-12 text-zinc-600 mb-4" />
              <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] leading-relaxed">
                Awaiting incoming signals from the neural network...
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                key={msg.id} 
                className={cn(
                  "flex flex-col gap-1.5 p-3 rounded-xl transition-all",
                  msg.isDonation ? "bg-yellow-500/10 border border-yellow-500/20" : "hover:bg-white/5"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn(
                    "text-[10px] font-black uppercase tracking-tighter",
                    msg.isDonation ? "text-yellow-500" : "text-accent"
                  )}>
                    @{msg.senderName}
                  </span>
                  <span className="text-[8px] text-zinc-600 font-bold">
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className={cn(
                  "text-xs leading-relaxed",
                  msg.isDonation ? "text-yellow-100 font-bold italic" : "text-zinc-300"
                )}>
                  {msg.content}
                </p>
              </motion.div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSendMessage} className="p-6 border-t border-white/5 bg-zinc-950">
          <div className="relative group">
            <input 
              type="text" 
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="TRANSMIT SIGNAL..."
              className="w-full bg-white/5 border border-white/10 rounded-2xl pl-5 pr-14 py-4 text-xs text-white placeholder:text-zinc-700 focus:outline-none focus:border-accent transition-all focus:bg-white/10"
            />
            <button 
              type="submit"
              disabled={!newMessage.trim()}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 text-accent hover:text-white transition-all disabled:opacity-20 group-focus-within:scale-110"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </form>
      </div>

      {/* ── MODALS ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {/* Share Modal */}
        {showShareModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-zinc-900 border border-white/10 rounded-[2rem] w-full max-w-md overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.5)]"
            >
              <div className="p-8 border-b border-white/5 flex items-center justify-between bg-zinc-800/30">
                <div className="flex items-center gap-3">
                  <Share2 className="w-6 h-6 text-accent" />
                  <h2 className="text-xl font-black text-white uppercase italic tracking-tighter">Spread the Signal</h2>
                </div>
                <button onClick={() => setShowShareModal(false)} className="p-2 hover:bg-white/10 rounded-full text-zinc-500 transition-all">
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="p-8 space-y-8">
                {/* Copy Link Section */}
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Stream Frequency URL</label>
                  <div className="flex gap-2">
                    <div className="flex-1 bg-black border border-white/10 rounded-xl px-4 py-3 text-zinc-400 font-mono text-xs overflow-hidden text-ellipsis whitespace-nowrap flex items-center">
                      {getStreamUrl()}
                    </div>
                    <button 
                      onClick={handleCopyLink}
                      className={cn(
                        "px-6 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all flex items-center gap-2",
                        copied ? "bg-green-500 text-white" : "bg-white text-black hover:bg-zinc-200"
                      )}
                    >
                      {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                {/* Social Grid */}
                <div className="grid grid-cols-3 gap-4">
                  <button onClick={shareOnTwitter} className="flex flex-col items-center gap-3 p-4 bg-white/5 border border-white/5 rounded-2xl hover:bg-white/10 transition-all group">
                    <Twitter className="w-6 h-6 text-[#1DA1F2] group-hover:scale-110 transition-transform" />
                    <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Twitter</span>
                  </button>
                  <button onClick={shareOnFacebook} className="flex flex-col items-center gap-3 p-4 bg-white/5 border border-white/5 rounded-2xl hover:bg-white/10 transition-all group">
                    <Facebook className="w-6 h-6 text-[#1877F2] group-hover:scale-110 transition-transform" />
                    <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Facebook</span>
                  </button>
                  <button onClick={shareOnWhatsApp} className="flex flex-col items-center gap-3 p-4 bg-white/5 border border-white/5 rounded-2xl hover:bg-white/10 transition-all group">
                    <MessageCircle className="w-6 h-6 text-[#25D366] group-hover:scale-110 transition-transform" />
                    <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">WhatsApp</span>
                  </button>
                  <button onClick={shareViaSMS} className="flex flex-col items-center gap-3 p-4 bg-white/5 border border-white/5 rounded-2xl hover:bg-white/10 transition-all group">
                    <Phone className="w-6 h-6 text-accent group-hover:scale-110 transition-transform" />
                    <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">SMS</span>
                  </button>
                  <button onClick={shareOnYoutube} className="flex flex-col items-center gap-3 p-4 bg-white/5 border border-white/5 rounded-2xl hover:bg-white/10 transition-all group">
                    <Youtube className="w-6 h-6 text-[#FF0000] group-hover:scale-110 transition-transform" />
                    <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">YouTube</span>
                  </button>
                  <button onClick={handleWebShare} className="flex flex-col items-center gap-3 p-4 bg-white/5 border border-white/5 rounded-2xl hover:bg-white/10 transition-all group">
                    <MoreHorizontal className="w-6 h-6 text-zinc-400 group-hover:scale-110 transition-transform" />
                    <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">More</span>
                  </button>
                </div>

                <p className="text-center text-zinc-600 text-[10px] font-medium leading-relaxed">
                  The more neural links we establish, the stronger the network becomes.
                </p>
              </div>
            </motion.div>
          </div>
        )}

        {/* Poll Modal */}
        {showPollModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-8 border-b border-white/10 flex items-center justify-between">
                <h2 className="text-xl font-black text-white uppercase italic tracking-tighter flex items-center gap-3">
                  <BarChart2 className="w-6 h-6 text-accent" />
                  Initiate Poll
                </h2>
                <button onClick={() => setShowPollModal(false)} className="p-2 hover:bg-white/10 rounded-full text-zinc-500 transition-all">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <form onSubmit={handleCreatePoll} className="p-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Query</label>
                  <input
                    type="text"
                    value={pollQuestion}
                    onChange={(e) => setPollQuestion(e.target.value)}
                    placeholder="WHAT IS THE NEXT OBJECTIVE?"
                    className="w-full bg-black border border-white/10 rounded-xl px-5 py-4 text-white text-xs font-bold uppercase tracking-widest focus:outline-none focus:border-accent transition-all"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Option Alpha</label>
                    <input
                      type="text"
                      value={pollOption1}
                      onChange={(e) => setPollOption1(e.target.value)}
                      placeholder="ALPHA"
                      className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:border-accent transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Option Beta</label>
                    <input
                      type="text"
                      value={pollOption2}
                      onChange={(e) => setPollOption2(e.target.value)}
                      placeholder="BETA"
                      className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:border-accent transition-all"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={!pollQuestion.trim() || !pollOption1.trim() || !pollOption2.trim()}
                  className="w-full py-5 bg-accent text-white rounded-xl font-black uppercase tracking-[0.3em] text-xs shadow-[0_0_30px_rgba(255,0,0,0.3)] hover:scale-105 transition-all disabled:opacity-50"
                >
                  Broadcast Poll
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {/* Donate Modal */}
        {showDonateModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-8 border-b border-white/10 flex items-center justify-between bg-yellow-500/5">
                <h2 className="text-xl font-black text-white uppercase italic tracking-tighter flex items-center gap-3">
                  <Gift className="w-6 h-6 text-yellow-500" />
                  Neural Support
                </h2>
                <button onClick={() => setShowDonateModal(false)} className="p-2 hover:bg-white/10 rounded-full text-zinc-500 transition-all">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <form onSubmit={handleDonate} className="p-8 space-y-6">
                <div className="grid grid-cols-3 gap-3">
                  {['10', '50', '100', '500', '1000', '5000'].map(amount => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setDonationAmount(amount)}
                      className={cn(
                        "py-3 rounded-xl border font-black text-xs transition-all",
                        donationAmount === amount 
                          ? "bg-yellow-500 border-yellow-500 text-black shadow-[0_0_20px_rgba(234,179,8,0.3)]" 
                          : "bg-white/5 border-white/10 text-white hover:bg-white/10"
                      )}
                    >
                      {amount}
                    </button>
                  ))}
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Custom Amount</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={donationAmount}
                      onChange={(e) => setDonationAmount(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded-xl pl-12 pr-4 py-4 text-white font-black text-lg focus:outline-none focus:border-yellow-500 transition-all"
                    />
                    <Coins className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-yellow-500" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Neural Message</label>
                  <textarea
                    value={donationMessage}
                    onChange={(e) => setDonationMessage(e.target.value)}
                    placeholder="OPTIONAL SIGNAL..."
                    className="w-full bg-black border border-white/10 rounded-xl px-5 py-4 text-white text-xs font-bold uppercase tracking-widest focus:outline-none focus:border-yellow-500 transition-all h-24 resize-none"
                  />
                </div>
                <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                  <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Your Balance</span>
                  <span className="text-sm font-black text-white">{currentUser?.cred_balance || 0} CRED</span>
                </div>
                <button
                  type="submit"
                  disabled={!donationAmount || parseInt(donationAmount) <= 0 || (currentUser?.cred_balance || 0) < parseInt(donationAmount)}
                  className="w-full py-5 bg-yellow-500 text-black rounded-xl font-black uppercase tracking-[0.3em] text-xs shadow-[0_0_30px_rgba(234,179,8,0.3)] hover:scale-105 transition-all disabled:opacity-50"
                >
                  Confirm Support
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
