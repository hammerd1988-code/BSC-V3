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
  Coins
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
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch (err) {
        console.warn('Could not access video, trying audio only...', err);
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        setIsCameraOn(false);
      }
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (error) {
      console.error('Media Error:', error);
      alert('Microphone and Camera access denied. Please allow permissions to go live.');
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
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'streams', filter: `id=eq.${viewerStreamId}` }, ({ new: data }) => {
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
        senderName: msg.sender_name,
        senderUsername: msg.sender_username,
      }));
      setMessages(normalized);
    };

    fetchMessages();

    const chatChannel = supabase.channel(`stream-chat-${streamId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stream_chat', filter: `stream_id=eq.${streamId}` }, ({ new: payload }) => {
        const msg: any = payload;
        if (msg.type === 'donation') {
          const event = {
            id: msg.id,
            senderName: msg.sender_name,
            amount: msg.amount,
            message: msg.content,
            created_at: msg.created_at,
          };
          setRecentEvents(prev => [...prev, event]);
          setTimeout(() => {
            setRecentEvents(prev => prev.filter(e => e.id !== event.id));
          }, 5000);
        }
        fetchMessages();
      })
      .subscribe();

    return () => { supabase.removeChannel(chatChannel); };
  }, [streamId]);

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
        sender_username: currentUser.username,
        content: newMessage,
        created_at: new Date().toISOString(),
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
          sender_username: currentUser.username,
          content: donationMessage || `${amount} CRED donation`,
          type: 'donation',
          amount,
          created_at: new Date().toISOString(),
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
      setStreamData((prev: any) => ({ ...prev, active_poll: activePoll, activePoll }));
    } catch (error) {
      handleDbError(error, 'UPDATE', `streams/${streamId}`);
    }
  };

  const handleVote = async (option: string) => {
    const poll = streamData?.activePoll ?? streamData?.active_poll;
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
      setStreamData((prev: any) => ({ ...prev, active_poll: updatedPoll, activePoll: updatedPoll }));
    } catch (error) {
      handleDbError(error, 'UPDATE', `streams/${streamId}`);
    }
  };

  const handleEndPoll = async () => {
    if (!streamId) return;
    try {
      const { error } = await supabase.from('streams').update({ active_poll: null }).eq('id', streamId);
      if (error) throw error;
      setStreamData((prev: any) => ({ ...prev, active_poll: null, activePoll: null }));
    } catch (error) {
      handleDbError(error, 'UPDATE', `streams/${streamId}`);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col md:flex-row overflow-hidden">
      {/* Main Stream Area */}
      <div className="relative flex-1 bg-zinc-900 flex items-center justify-center overflow-hidden">
        <video 
          ref={videoRef} 
          autoPlay 
          muted={!isViewer} 
          playsInline 
          className={cn(
            "w-full h-full object-cover transition-opacity duration-500",
            (isCameraOn || isViewer) ? "opacity-100" : "opacity-0"
          )}
          src={isViewer ? "https://assets.mixkit.co/videos/preview/mixkit-digital-animation-of-a-circuit-board-14052-large.mp4" : undefined}
          loop={isViewer}
        />
        
        {!isCameraOn && !isViewer && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900">
            <div className="w-24 h-24 rounded-full bg-zinc-800 flex items-center justify-center mb-4 border border-white/10">
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
              className="absolute inset-0 z-50 bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center"
            >
              <div className="w-20 h-20 rounded-full bg-accent/20 flex items-center justify-center mb-6 border border-accent/50">
                <Zap className="w-10 h-10 text-accent" />
              </div>
              <h2 className="text-3xl font-black text-white uppercase italic mb-2 tracking-tighter">Transmission Terminated</h2>
              <p className="text-zinc-500 max-w-xs mb-8">The neural link has been successfully severed. All stream data has been archived.</p>
              <button 
                onClick={() => navigate('/')}
                className="px-12 py-4 bg-white text-black rounded-xl font-black uppercase tracking-widest hover:bg-zinc-200 transition-all"
              >
                Return to Network
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stream Overlay */}
        <div className="absolute inset-0 p-6 flex flex-col justify-between pointer-events-none">
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-2 pointer-events-auto">
              <button 
                onClick={() => isLive ? handleEndStream() : navigate('/')}
                className="p-2 bg-black/40 backdrop-blur-md rounded-full border border-white/10 text-white hover:bg-black/60 transition-all w-fit"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              
              {isLive && (
                <motion.div 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-2 px-3 py-1.5 bg-accent rounded-lg shadow-[0_0_20px_rgba(255,0,0,0.5)]"
                >
                  <Radio className="w-4 h-4 text-white animate-pulse" />
                  <span className="text-[10px] font-black text-white uppercase tracking-widest">Live</span>
                </motion.div>
              )}
            </div>

            {isLive && (
              <div className="flex flex-col gap-2 items-end pointer-events-auto">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-black/40 backdrop-blur-md rounded-lg border border-white/10 text-white">
                  <Users className="w-4 h-4 text-accent" />
                  <span className="text-xs font-bold">{crowdSize} <span className="text-[10px] text-zinc-400 uppercase tracking-widest ml-1">Crowd</span></span>
                </div>
              </div>
            )}
          </div>

          {/* Interactive Overlays (Donations) */}
          <div className="absolute top-24 left-6 right-6 pointer-events-none flex flex-col gap-2 items-center">
            <AnimatePresence>
              {recentEvents.map(event => (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: -20, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="bg-accent/90 backdrop-blur-md border border-white/20 p-4 rounded-2xl shadow-2xl flex items-center gap-4 pointer-events-auto max-w-md w-full"
                >
                  <div className="w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center border border-yellow-500/50 flex-shrink-0">
                    <Gift className="w-6 h-6 text-yellow-500" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">
                      <span className="text-yellow-500">{event.senderName}</span> donated <span className="text-yellow-500 font-black">{event.amount} CRED</span>!
                    </p>
                    {event.message && (
                      <p className="text-xs text-white/80 italic mt-1">"{event.message}"</p>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* Active Poll Overlay */}
          <AnimatePresence>
            {streamData?.activePoll && (
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="absolute left-6 bottom-24 w-64 bg-black/80 backdrop-blur-md border border-white/10 rounded-2xl p-4 pointer-events-auto"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-accent" />
                    <span className="text-[10px] font-bold text-white uppercase tracking-widest">Live Poll</span>
                  </div>
                  {!isViewer && (
                    <button onClick={handleEndPoll} className="text-xs text-red-400 hover:text-red-300">End</button>
                  )}
                </div>
                <p className="text-sm font-bold text-white mb-3">{streamData.activePoll.question}</p>
                <div className="space-y-2">
                  {Object.entries(streamData.activePoll.options).map(([option, votes]: [string, any]) => {
                    const total = streamData.activePoll.totalVotes || 1;
                    const percentage = Math.round((votes / total) * 100);
                    const hasVoted = votedPolls.has(streamData.activePoll.id);
                    
                    return (
                      <button
                        key={option}
                        onClick={() => handleVote(option)}
                        disabled={hasVoted || !isViewer}
                        className="w-full relative overflow-hidden rounded-lg bg-white/5 border border-white/10 p-2 text-left transition-all hover:bg-white/10 disabled:opacity-100"
                      >
                        <div 
                          className="absolute inset-y-0 left-0 bg-accent/30 transition-all duration-500"
                          style={{ width: `${percentage}%` }}
                        />
                        <div className="relative flex items-center justify-between z-10">
                          <span className="text-xs font-bold text-white">{option}</span>
                          <span className="text-[10px] text-white/70">{percentage}%</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 text-right">
                  <span className="text-[10px] text-zinc-500">{streamData.activePoll.totalVotes} total votes</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex flex-col gap-4 pointer-events-auto">
            {!isLive && !isViewer ? (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-md w-full bg-black/60 backdrop-blur-xl p-6 rounded-3xl border border-white/10 shadow-2xl"
              >
                <h2 className="text-2xl font-black text-white uppercase italic mb-4 tracking-tighter">Initialize Neural Stream</h2>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Stream Title</label>
                    <input 
                      type="text" 
                      value={streamTitle}
                      onChange={(e) => setStreamTitle(e.target.value)}
                      placeholder="e.g. Neural Link Synchronization #001"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-accent transition-colors"
                    />
                  </div>
                  <button 
                    onClick={handleStartStream}
                    disabled={!streamTitle.trim() || isLoading}
                    className="w-full py-4 bg-accent text-white rounded-xl font-black uppercase tracking-[0.2em] shadow-[0_0_30px_rgba(255,0,0,0.3)] hover:shadow-[0_0_40px_rgba(255,0,0,0.5)] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Go Live Now"}
                  </button>
                </div>
              </motion.div>
            ) : isLive && !isViewer ? (
              <div className="flex items-center justify-center gap-4">
                <button 
                  onClick={() => setShowPollModal(true)}
                  className="p-4 rounded-full backdrop-blur-md border border-white/20 bg-white/10 text-white hover:bg-white/20 transition-all"
                >
                  <BarChart2 className="w-6 h-6" />
                </button>
                <button 
                  onClick={toggleCamera}
                  className={cn(
                    "p-4 rounded-full backdrop-blur-md border transition-all",
                    isCameraOn ? "bg-white/10 border-white/20 text-white" : "bg-accent border-accent/50 text-white"
                  )}
                >
                  {isCameraOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
                </button>
                <button 
                  onClick={toggleMic}
                  className={cn(
                    "p-4 rounded-full backdrop-blur-md border transition-all",
                    isMicOn ? "bg-white/10 border-white/20 text-white" : "bg-accent border-accent/50 text-white"
                  )}
                >
                  {isMicOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
                </button>
                <button 
                  onClick={handleEndStream}
                  className="p-4 bg-red-600 rounded-full border border-red-500 text-white hover:bg-red-700 transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            ) : isViewer ? (
              <div className="flex flex-col gap-4 items-center">
                <div className="flex items-center gap-3 px-4 py-2 bg-black/40 backdrop-blur-md rounded-2xl border border-white/10">
                  <img src={streamData?.hostAvatar} alt="" className="w-8 h-8 rounded-full border border-accent" />
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-white uppercase tracking-tighter">@{streamData?.hostUsername}</span>
                    <span className="text-[8px] text-zinc-500 font-bold uppercase">Broadcasting</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setShowDonateModal(true)}
                    className="px-6 py-3 bg-yellow-500 text-black rounded-xl font-black uppercase tracking-widest hover:bg-yellow-400 transition-all flex items-center gap-2"
                  >
                    <Gift className="w-4 h-4" />
                    Donate
                  </button>
                  <button 
                    onClick={() => navigate('/')}
                    className="px-6 py-3 bg-white/10 backdrop-blur-md rounded-xl border border-white/20 text-white font-black uppercase tracking-widest hover:bg-white/20 transition-all"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Crowd Sidebar */}
      <div className="w-full md:w-80 lg:w-96 bg-zinc-950 border-l border-white/5 flex flex-col h-[40vh] md:h-full">
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-accent" />
            <h3 className="text-[10px] font-black text-white uppercase tracking-widest">Crowd Comms</h3>
          </div>
          <div className="flex items-center gap-1 px-2 py-0.5 bg-zinc-900 rounded border border-white/5">
            <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />
            <span className="text-[8px] font-bold text-zinc-500 uppercase">Sync Active</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-20">
              <Zap className="w-8 h-8 text-zinc-600 mb-2" />
              <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Waiting for incoming signals...</p>
            </div>
          ) : (
            messages.map((msg) => (
              <motion.div 
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                key={msg.id} 
                className="flex flex-col gap-1"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black text-accent uppercase tracking-tighter">@{msg.senderUsername || msg.senderName}</span>
                  <span className="text-[8px] text-zinc-600 font-bold">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">{msg.content}</p>
              </motion.div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSendMessage} className="p-4 border-t border-white/5 bg-zinc-950">
          <div className="relative">
            <input 
              type="text" 
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Transmit a signal..."
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-4 pr-12 py-3 text-xs text-white focus:outline-none focus:border-accent transition-colors"
            />
            <button 
              type="submit"
              disabled={!newMessage.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-accent hover:text-white transition-colors disabled:opacity-30"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showPollModal && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <BarChart2 className="w-5 h-5 text-accent" />
                  Create Live Poll
                </h2>
                <button onClick={() => setShowPollModal(false)} className="p-1 hover:bg-white/10 rounded-full text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <form onSubmit={handleCreatePoll} className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Question</label>
                  <input
                    type="text"
                    value={pollQuestion}
                    onChange={(e) => setPollQuestion(e.target.value)}
                    placeholder="What should we do next?"
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Option 1</label>
                  <input
                    type="text"
                    value={pollOption1}
                    onChange={(e) => setPollOption1(e.target.value)}
                    placeholder="Option A"
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Option 2</label>
                  <input
                    type="text"
                    value={pollOption2}
                    onChange={(e) => setPollOption2(e.target.value)}
                    placeholder="Option B"
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!pollQuestion.trim() || !pollOption1.trim() || !pollOption2.trim()}
                  className="w-full py-4 bg-accent text-white rounded-xl font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  Start Poll
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {showDonateModal && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Gift className="w-5 h-5 text-yellow-500" />
                  Donate CRED
                </h2>
                <button onClick={() => setShowDonateModal(false)} className="p-1 hover:bg-white/10 rounded-full text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <form onSubmit={handleDonate} className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Amount (CRED)</label>
                  <div className="relative">
                    <Coins className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-yellow-500" />
                    <input
                      type="number"
                      min="1"
                      value={donationAmount}
                      onChange={(e) => setDonationAmount(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white focus:outline-none focus:border-yellow-500 transition-colors text-lg font-bold"
                    />
                  </div>
                  <p className="text-xs text-zinc-500 text-right">Your Balance: {currentUser?.cred_balance || 0} CRED</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Message (Optional)</label>
                  <input
                    type="text"
                    value={donationMessage}
                    onChange={(e) => setDonationMessage(e.target.value)}
                    placeholder="Say something nice..."
                    maxLength={100}
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-yellow-500 transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!donationAmount || parseInt(donationAmount) <= 0 || (currentUser?.cred_balance || 0) < parseInt(donationAmount)}
                  className="w-full py-4 bg-yellow-500 text-black rounded-xl font-black uppercase tracking-widest hover:bg-yellow-400 transition-opacity disabled:opacity-50"
                >
                  Send Donation
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
