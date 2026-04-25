import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Loader2, Sparkles, ShieldAlert } from 'lucide-react';
import { socket } from '../lib/socket';
import { useAuth } from '../AuthContext';
import { cn } from '../lib/utils';

interface CallModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUserId?: string;
  targetUserName?: string;
  targetUserAvatar?: string;
  isIncoming?: boolean;
  incomingData?: any;
  videoEnabled?: boolean;
}

const FILTERS = [
  { id: 'none', name: 'Normal', className: '', cssFilter: 'none' },
  { id: 'cyberpunk', name: 'Cyberpunk', className: 'contrast-[1.2] saturate-[1.5] hue-rotate-[-15deg]', cssFilter: 'none' },
  { id: 'matrix', name: 'Matrix', className: 'contrast-[1.5] sepia-[1] hue-rotate-[80deg] saturate-[3]', cssFilter: 'none' },
  { id: 'thermal', name: 'Thermal', className: 'invert-[1] hue-rotate-[180deg] saturate-[3]', cssFilter: 'none' },
  { id: 'ghost', name: 'Ghost', className: 'grayscale-[1] contrast-[1.2] brightness-[1.2] opacity-80', cssFilter: 'none' },
  { id: 'neon', name: 'Neon Edge', className: 'contrast-[2] saturate-[2] drop-shadow(0 0 10px rgba(0,255,255,0.8))', cssFilter: 'none' },
  { id: 'neural', name: 'Neural Net', className: '', cssFilter: 'url(#edge-detect) invert(1) hue-rotate(180deg)' },
  { id: 'glitch', name: 'Corruption', className: '', cssFilter: 'url(#glitch)' },
  { id: 'infrared', name: 'Infrared', className: '', cssFilter: 'url(#infrared)' },
  { id: 'posterize', name: 'Synthwave', className: '', cssFilter: 'url(#posterize)' }
];

enum CallStatus {
  IDLE = 'idle',
  CALLING = 'calling',
  RINGING = 'ringing',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ENDED = 'ended',
  FAILED = 'failed'
}

export const CallModal: React.FC<CallModalProps> = ({
  isOpen,
  onClose,
  targetUserId,
  targetUserName,
  targetUserAvatar,
  isIncoming,
  incomingData,
  videoEnabled = true,
}) => {
  const { currentUser } = useAuth();
  const [status, setStatus] = useState<CallStatus>(CallStatus.IDLE);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [duration, setDuration] = useState(0);
  const [localFilter, setLocalFilter] = useState('none');
  const [remoteFilter, setRemoteFilter] = useState('none');
  const [showFilters, setShowFilters] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const [syncProgress, setSyncProgress] = useState(0);
  const [signalStrength, setSignalStrength] = useState(4);

  useEffect(() => {
    if (status === CallStatus.CONNECTING) {
      const interval = setInterval(() => {
        setSyncProgress(prev => {
          if (prev >= 99.9) return 99.9;
          return +(prev + Math.random() * 15).toFixed(1);
        });
      }, 200);
      return () => clearInterval(interval);
    } else if (status !== CallStatus.CONNECTED) {
      setSyncProgress(0);
    }
  }, [status]);

  useEffect(() => {
    if (status === CallStatus.CONNECTED) {
      const interval = setInterval(() => {
        setSignalStrength(Math.floor(Math.random() * 2) + 3); // Fluctuates between 3 and 4
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [status]);

  useEffect(() => {
    if (isOpen) {
      if (isIncoming) {
        setStatus(CallStatus.RINGING);
      } else {
        setStatus(CallStatus.CALLING);
        initiateCall();
      }
    } else {
      cleanupCall();
      setStatus(CallStatus.IDLE);
    }

    return () => cleanupCall();
  }, [isOpen]);

  useEffect(() => {
    if (status === CallStatus.CONNECTED) {
      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  useEffect(() => {
    const handleCallAccepted = async (data: any) => {
      if (peerConnection.current) {
        try {
          setStatus(CallStatus.CONNECTING);
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.answer));
          setStatus(CallStatus.CONNECTED);
        } catch (err) {
          console.error('Error setting remote description', err);
          setError('Failed to establish neural link.');
          setStatus(CallStatus.FAILED);
        }
      }
    };

    const handleCallRejected = () => {
      setStatus(CallStatus.ENDED);
      setTimeout(onClose, 2000);
    };

    const handleCallEnded = () => {
      setStatus(CallStatus.ENDED);
      setTimeout(onClose, 2000);
    };

    const handleIceCandidate = async (data: any) => {
      if (peerConnection.current && data.candidate) {
        try {
          await peerConnection.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.error('Error adding received ice candidate', e);
        }
      }
    };

    const handleFilterChange = (data: any) => {
      setRemoteFilter(data.filter);
    };

    socket.on('call:accepted', handleCallAccepted);
    socket.on('call:rejected', handleCallRejected);
    socket.on('call:ended', handleCallEnded);
    socket.on('call:ice-candidate', handleIceCandidate);
    socket.on('call:filter', handleFilterChange);

    return () => {
      socket.off('call:accepted', handleCallAccepted);
      socket.off('call:rejected', handleCallRejected);
      socket.off('call:ended', handleCallEnded);
      socket.off('call:ice-candidate', handleIceCandidate);
      socket.off('call:filter', handleFilterChange);
    };
  }, [onClose]);

  const setupWebRTC = async () => {
    const configuration: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        // Metered free TURN servers for NAT traversal behind strict firewalls
        {
          urls: 'turn:a.relay.metered.ca:80',
          username: 'bsc-open',
          credential: 'bsc-open',
        },
        {
          urls: 'turn:a.relay.metered.ca:80?transport=tcp',
          username: 'bsc-open',
          credential: 'bsc-open',
        },
        {
          urls: 'turn:a.relay.metered.ca:443',
          username: 'bsc-open',
          credential: 'bsc-open',
        },
        {
          urls: 'turns:a.relay.metered.ca:443?transport=tcp',
          username: 'bsc-open',
          credential: 'bsc-open',
        },
      ],
      iceCandidatePoolSize: 10,
    };
    
    peerConnection.current = new RTCPeerConnection(configuration);

    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('call:ice-candidate', {
          targetUserId: isIncoming ? incomingData.callerId : targetUserId,
          candidate: event.candidate
        });
      }
    };

    peerConnection.current.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    peerConnection.current.onconnectionstatechange = () => {
      if (peerConnection.current?.connectionState === 'connected') {
        setStatus(CallStatus.CONNECTED);
      } else if (peerConnection.current?.connectionState === 'failed') {
        setError('Connection lost.');
        setStatus(CallStatus.FAILED);
      }
    };

    try {
      if (videoEnabled) {
        // Try video + audio first
        localStream.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } else {
        // Audio-only call requested
        localStream.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        setIsVideoOff(true);
      }
    } catch (err: any) {
      console.warn('Could not access requested media, trying audio only...', err);
      try {
        localStream.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        setIsVideoOff(true);
      } catch (audioErr: any) {
        console.error('Error accessing media devices.', audioErr);
        setError("Microphone and Camera access denied.");
        setStatus(CallStatus.FAILED);
        setTimeout(onClose, 3000);
        throw audioErr;
      }
    }

    if (localStream.current) {
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream.current;
      }

      localStream.current.getTracks().forEach(track => {
        if (peerConnection.current && localStream.current) {
          peerConnection.current.addTrack(track, localStream.current);
        }
      });
    }
  };

  const initiateCall = async () => {
    if (!currentUser || !targetUserId) return;
    
    try {
      await setupWebRTC();
      
      if (peerConnection.current) {
        const offer = await peerConnection.current.createOffer();
        await peerConnection.current.setLocalDescription(offer);

        socket.emit('call:initiate', {
          targetUserId,
          callerId: currentUser.id,
          callerName: currentUser.display_name,
          callerAvatar: currentUser.avatar_url,
          offer
        });
      }
    } catch (err) {
      console.error('Failed to initiate call', err);
      setError('Failed to initiate neural link.');
      setStatus(CallStatus.FAILED);
    }
  };

  const acceptCall = async () => {
    if (!incomingData) return;
    
    try {
      setStatus(CallStatus.CONNECTING);
      await setupWebRTC();
      
      if (peerConnection.current) {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(incomingData.offer));
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);

        socket.emit('call:accept', {
          callerId: incomingData.callerId,
          answer
        });
      }
    } catch (err) {
      console.error('Failed to accept call', err);
      setError('Failed to establish neural link.');
      setStatus(CallStatus.FAILED);
    }
  };

  const rejectCall = () => {
    if (incomingData) {
      socket.emit('call:reject', {
        callerId: incomingData.callerId
      });
    }
    setStatus(CallStatus.ENDED);
    cleanupCall();
    setTimeout(onClose, 1000);
  };

  const endCall = () => {
    socket.emit('call:end', {
      targetUserId: isIncoming ? incomingData?.callerId : targetUserId
    });
    setStatus(CallStatus.ENDED);
    cleanupCall();
    setTimeout(onClose, 1000);
  };

  const cleanupCall = () => {
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
    }
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    setDuration(0);
    setLocalFilter('none');
    setRemoteFilter('none');
  };

  const toggleMute = () => {
    if (localStream.current) {
      localStream.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream.current) {
      localStream.current.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const applyFilter = (filterId: string) => {
    setLocalFilter(filterId);
    socket.emit('call:filter', {
      targetUserId: isIncoming ? incomingData?.callerId : targetUserId,
      filter: filterId
    });
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  if (!isOpen) return null;

  const displayAvatar = isIncoming ? incomingData?.callerAvatar : targetUserAvatar;
  const displayName = isIncoming ? incomingData?.callerName : targetUserName;

  const remoteFilterObj = FILTERS.find(f => f.id === remoteFilter) || FILTERS[0];
  const localFilterObj = FILTERS.find(f => f.id === localFilter) || FILTERS[0];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/95 backdrop-blur-xl">
        {/* SVG Filters Definition */}
        <svg width="0" height="0" className="absolute hidden">
          <defs>
            <filter id="edge-detect">
              <feConvolveMatrix order="3 3" preserveAlpha="true" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" />
            </filter>
            <filter id="glitch">
              <feTurbulence type="fractalNoise" baseFrequency="0.01 0.5" numOctaves="1" result="noise">
                <animate attributeName="baseFrequency" values="0.01 0.5; 0.05 0.8; 0.01 0.5" dur="0.5s" repeatCount="indefinite" />
              </feTurbulence>
              <feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 2 -0.5" in="noise" result="coloredNoise" />
              <feDisplacementMap in="SourceGraphic" in2="coloredNoise" scale="30" xChannelSelector="R" yChannelSelector="G" />
            </filter>
            <filter id="infrared">
              <feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0" result="gray"/>
              <feComponentTransfer in="gray">
                <feFuncR type="table" tableValues="0 0 1 1 1"/>
                <feFuncG type="table" tableValues="0 0 0 1 1"/>
                <feFuncB type="table" tableValues="1 0 0 0 1"/>
              </feComponentTransfer>
            </filter>
            <filter id="posterize">
              <feComponentTransfer>
                <feFuncR type="discrete" tableValues="0 0.25 0.5 0.75 1"/>
                <feFuncG type="discrete" tableValues="0 0.25 0.5 0.75 1"/>
                <feFuncB type="discrete" tableValues="0 0.25 0.5 0.75 1"/>
              </feComponentTransfer>
              <feColorMatrix type="matrix" values="1.2 0 0 0 0  0 0.8 0 0 0  0 0 1.5 0 0  0 0 0 1 0" />
            </filter>
          </defs>
        </svg>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className="w-full h-full max-w-5xl max-h-[90vh] md:rounded-3xl overflow-hidden flex flex-col relative bg-zinc-950 border border-white/10 shadow-2xl"
        >
          {/* Main Video Area (Remote) */}
          <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
            
            {/* AI HUD Overlay */}
            {(remoteFilter === 'neural' || remoteFilter === 'infrared' || remoteFilter === 'glitch') && status === CallStatus.CONNECTED && (
              <div className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between p-8 border-4 border-accent/30">
                <div className="flex justify-between text-accent font-mono text-xs opacity-70">
                  <div>SYS.ANALYSIS // ACTIVE</div>
                  <div>TGT.LOCK // ACQUIRED</div>
                </div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border border-accent/20 rounded-full flex items-center justify-center">
                  <div className="w-4 h-4 border-t-2 border-l-2 border-accent absolute top-0 left-0" />
                  <div className="w-4 h-4 border-t-2 border-r-2 border-accent absolute top-0 right-0" />
                  <div className="w-4 h-4 border-b-2 border-l-2 border-accent absolute bottom-0 left-0" />
                  <div className="w-4 h-4 border-b-2 border-r-2 border-accent absolute bottom-0 right-0" />
                  <div className="w-full h-[1px] bg-accent/20 absolute top-1/2 -translate-y-1/2" />
                  <div className="w-[1px] h-full bg-accent/20 absolute left-1/2 -translate-x-1/2" />
                </div>
                <div className="flex justify-between text-accent font-mono text-xs opacity-70">
                  <div>BIO.METRICS // STABLE</div>
                  <div>NEURAL.SYNC // 99.9%</div>
                </div>
              </div>
            )}

            {status === CallStatus.CONNECTED ? (
              <video 
                ref={remoteVideoRef} 
                autoPlay 
                playsInline 
                className={cn("w-full h-full object-cover transition-all duration-500", remoteFilterObj.className)}
                style={{ filter: remoteFilterObj.cssFilter !== 'none' ? remoteFilterObj.cssFilter : undefined }}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="relative">
                  {/* Animated Rings */}
                  {(status === CallStatus.CALLING || status === CallStatus.RINGING || status === CallStatus.CONNECTING) && (
                    <>
                      <motion.div 
                        animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="absolute inset-0 rounded-full border-2 border-accent"
                      />
                      <motion.div 
                        animate={{ scale: [1, 1.8], opacity: [0.3, 0] }}
                        transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
                        className="absolute inset-0 rounded-full border-2 border-accent"
                      />
                      <motion.div 
                        animate={{ scale: [1, 2.1], opacity: [0.1, 0] }}
                        transition={{ duration: 2, repeat: Infinity, delay: 1 }}
                        className="absolute inset-0 rounded-full border-2 border-accent"
                      />
                    </>
                  )}
                  
                  <motion.div 
                    animate={status === CallStatus.RINGING ? { 
                      scale: [1, 1.05, 1],
                      rotate: [0, -1, 1, -1, 1, 0],
                      x: [0, -2, 2, -2, 2, 0]
                    } : {}}
                    transition={{ 
                      duration: 0.5, 
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                    className="w-40 h-40 rounded-full overflow-hidden border-4 border-white/10 relative z-10 shadow-[0_0_50px_rgba(255,0,0,0.2)]"
                  >
                    <img src={displayAvatar || `https://ui-avatars.com/api/?name=${displayName}`} alt="Avatar" className="w-full h-full object-cover" />
                    
                    {/* Scanning Line Effect */}
                    {status === CallStatus.CONNECTING && (
                      <motion.div 
                        animate={{ top: ['-10%', '110%'] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                        className="absolute left-0 right-0 h-1 bg-accent/50 shadow-[0_0_10px_rgba(255,0,0,0.8)] z-20"
                      />
                    )}
                  </motion.div>
                </div>

                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-8 text-center"
                >
                  <h2 className="text-4xl font-black text-white uppercase tracking-[0.2em] mb-4 drop-shadow-2xl italic">
                    {displayName}
                  </h2>
                  <div className="text-accent font-mono text-xs flex flex-col items-center gap-3">
                    {status === CallStatus.CALLING && (
                      <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-3 bg-accent/10 px-6 py-2 rounded-full border border-accent/20"
                      >
                        <Loader2 className="w-4 h-4 animate-spin" /> 
                        <span className="tracking-[0.3em] uppercase">Establishing Neural Link...</span>
                      </motion.div>
                    )}
                    {status === CallStatus.RINGING && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex items-center gap-3 bg-green-500/10 px-6 py-2 rounded-full border border-green-500/20 text-green-500"
                      >
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <span className="tracking-[0.3em] uppercase">Incoming Transmission...</span>
                      </motion.div>
                    )}
                    {status === CallStatus.CONNECTING && (
                      <div className="flex flex-col items-center gap-3 bg-accent/10 px-6 py-3 rounded-2xl border border-accent/20">
                        <div className="flex items-center gap-3">
                          <Loader2 className="w-4 h-4 animate-spin" /> 
                          <span className="tracking-[0.3em] uppercase">Synchronizing Neural Streams...</span>
                        </div>
                        <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${syncProgress}%` }}
                            className="h-full bg-accent shadow-[0_0_10px_rgba(255,0,0,0.8)]"
                          />
                        </div>
                        <span className="text-[10px] font-mono opacity-70">SYNC_LEVEL: {syncProgress}%</span>
                      </div>
                    )}
                    {status === CallStatus.ENDED && (
                      <div className="text-red-500 font-black tracking-[0.5em] uppercase animate-pulse">
                        Link Severed
                      </div>
                    )}
                    {status === CallStatus.FAILED && (
                      <div className="text-red-500 flex flex-col items-center gap-2">
                        <ShieldAlert className="w-8 h-8 mb-2" />
                        <span className="font-black tracking-[0.3em] uppercase">Neural Link Failed</span>
                        <span className="text-[10px] opacity-70 font-mono max-w-xs">{error}</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              </div>
            )}

            {/* Picture-in-Picture (Local) */}
            {status === CallStatus.CONNECTED && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="absolute top-6 right-6 w-32 md:w-48 aspect-[3/4] bg-zinc-900 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl z-20"
              >
                <video 
                  ref={localVideoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                  className={cn("w-full h-full object-cover transition-all duration-500", localFilterObj.className, isVideoOff && "hidden")}
                  style={{ filter: localFilterObj.cssFilter !== 'none' ? localFilterObj.cssFilter : undefined }}
                />
                {isVideoOff && (
                  <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
                    <VideoOff className="w-8 h-8 text-gray-500" />
                  </div>
                )}
              </motion.div>
            )}

            {/* Duration Overlay */}
            {status === CallStatus.CONNECTED && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute top-6 left-6 z-20 flex flex-col gap-2"
              >
                <div className="bg-black/60 backdrop-blur-xl px-6 py-3 rounded-2xl border border-white/10 flex flex-col items-start gap-1 shadow-2xl">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-[10px] font-black text-accent uppercase tracking-[0.3em]">Live Link</span>
                  </div>
                  <span className="text-2xl font-black text-white font-mono tracking-tighter">
                    {formatDuration(duration)}
                  </span>
                </div>

                {/* Signal Strength & Audio Waveform */}
                <div className="flex gap-2">
                  <div className="bg-black/60 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/10 flex items-center gap-3 shadow-2xl">
                    <div className="flex items-end gap-0.5 h-3">
                      {[1, 2, 3, 4].map(bar => (
                        <div 
                          key={bar}
                          className={cn(
                            "w-1 rounded-full transition-all duration-500",
                            bar <= signalStrength ? "bg-accent" : "bg-white/10"
                          )}
                          style={{ height: `${bar * 25}%` }}
                        />
                      ))}
                    </div>
                    <span className="text-[8px] font-mono text-white/50 uppercase">Neural_Signal: STABLE</span>
                  </div>

                  <div className="bg-black/60 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/10 flex items-center gap-3 shadow-2xl">
                    <div className="flex items-center gap-0.5 h-3">
                      {[1, 2, 3, 4, 5].map(bar => (
                        <motion.div 
                          key={bar}
                          animate={{ 
                            height: ['20%', '80%', '40%', '100%', '20%'],
                          }}
                          transition={{ 
                            duration: 0.5 + Math.random(), 
                            repeat: Infinity,
                            ease: "easeInOut"
                          }}
                          className="w-1 bg-accent/60 rounded-full"
                        />
                      ))}
                    </div>
                    <span className="text-[8px] font-mono text-white/50 uppercase">Audio_Stream</span>
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          {/* Controls Area */}
          <div className="p-6 bg-gradient-to-t from-black to-transparent absolute bottom-0 left-0 right-0 z-30">
            
            {/* Filter Selector */}
            <AnimatePresence>
              {showFilters && status === CallStatus.CONNECTED && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="flex gap-3 overflow-x-auto pb-6 scrollbar-hide px-4"
                >
                  {FILTERS.map(filter => (
                    <button
                      key={filter.id}
                      onClick={() => applyFilter(filter.id)}
                      className={cn(
                        "flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all border",
                        localFilter === filter.id 
                          ? "bg-accent text-white border-accent shadow-[0_0_15px_rgba(255,0,0,0.5)]" 
                          : "bg-black/50 text-gray-400 border-white/10 hover:bg-white/10 hover:text-white backdrop-blur-md"
                      )}
                    >
                      {filter.name}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center justify-center gap-6">
              {status === CallStatus.RINGING ? (
                <>
                  <button
                    onClick={rejectCall}
                    className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500 text-red-500 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all shadow-[0_0_20px_rgba(239,68,68,0.4)]"
                  >
                    <PhoneOff className="w-6 h-6" />
                  </button>
                  <button
                    onClick={acceptCall}
                    className="w-16 h-16 rounded-full bg-green-500/20 border border-green-500 text-green-500 flex items-center justify-center hover:bg-green-500 hover:text-white transition-all shadow-[0_0_20px_rgba(34,197,94,0.4)] animate-pulse"
                  >
                    <Video className="w-6 h-6" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={toggleMute}
                    disabled={status !== CallStatus.CONNECTED}
                    className={cn(
                      "w-14 h-14 rounded-full border flex items-center justify-center transition-all disabled:opacity-50",
                      isMuted ? "bg-white/20 border-white text-white" : "bg-black/50 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white backdrop-blur-md"
                    )}
                  >
                    {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </button>
                  <button
                    onClick={toggleVideo}
                    disabled={status !== CallStatus.CONNECTED}
                    className={cn(
                      "w-14 h-14 rounded-full border flex items-center justify-center transition-all disabled:opacity-50",
                      isVideoOff ? "bg-white/20 border-white text-white" : "bg-black/50 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white backdrop-blur-md"
                    )}
                  >
                    {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                  </button>
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    disabled={status !== CallStatus.CONNECTED}
                    className={cn(
                      "w-14 h-14 rounded-full border flex items-center justify-center transition-all disabled:opacity-50",
                      showFilters ? "bg-accent/20 border-accent text-accent" : "bg-black/50 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white backdrop-blur-md"
                    )}
                  >
                    <Sparkles className="w-5 h-5" />
                  </button>
                  <button
                    onClick={endCall}
                    disabled={status === CallStatus.ENDED || status === CallStatus.FAILED}
                    className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500 text-red-500 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all shadow-[0_0_20px_rgba(239,68,68,0.4)] disabled:opacity-50"
                  >
                    <PhoneOff className="w-6 h-6" />
                  </button>
                </>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
