import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  BellOff,
  Camera,
  Check,
  Clapperboard,
  Eye,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  MonitorUp,
  Play,
  Radio,
  Repeat2,
  Search,
  Send,
  Share2,
  Sparkles,
  Square,
  Tv,
  Users,
  Video,
  VideoOff,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { cn } from '../lib/utils';
import { handleDbError } from '../lib/errors';
import { requestLiveKitToken } from '../lib/livekit';
import { repostReplayToFeed, shareStreamLink } from '../lib/streamReplays';
import { Room, RoomEvent, Track } from 'livekit-client';

const STREAM_CATEGORIES = ['Coding', 'Tutorials', 'Code Battles', 'Gaming', 'Music', 'Art', 'Reactions', 'Q&A', 'Creative', 'Other'] as const;
type StreamCategory = typeof STREAM_CATEGORIES[number];
type StreamStatus = 'live' | 'ended';

export interface StreamRow {
  id: string;
  user_id?: string | null;
  host_id?: string | null;
  host_display_name?: string | null;
  host_username?: string | null;
  host_avatar?: string | null;
  title?: string | null;
  category?: StreamCategory | string | null;
  status?: StreamStatus | string | null;
  is_live?: boolean | null;
  thumbnail_url?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  crowd_size?: number | null;
  viewer_count?: number | null;
  replay_url?: string | null;
  description?: string | null;
}

interface ChatRow {
  id: string;
  stream_id: string;
  user_id?: string | null;
  sender_id?: string | null;
  sender_name?: string | null;
  message?: string | null;
  text?: string | null;
  created_at: string;
}

const REACTIONS = [
  { key: 'fire', label: '🔥' },
  { key: 'skull', label: '☠' },
  { key: '100', label: '100' },
  { key: 'clap', label: '👏' },
  { key: 'zap', label: '⚡' },
  { key: 'heart', label: '❤' },
] as const;

const normalizeStream = (row: any): StreamRow => ({
  ...row,
  user_id: row?.user_id ?? row?.host_id,
  host_id: row?.host_id ?? row?.user_id,
  status: row?.status ?? (row?.is_live ? 'live' : 'ended'),
  is_live: row?.is_live ?? row?.status === 'live',
  viewer_count: row?.viewer_count ?? row?.crowd_size ?? 0,
  crowd_size: row?.crowd_size ?? row?.viewer_count ?? 0,
  category: row?.category ?? 'Other',
});

const formatDuration = (stream: StreamRow) => {
  const start = stream.started_at ? new Date(stream.started_at).getTime() : Date.now();
  const end = stream.ended_at ? new Date(stream.ended_at).getTime() : Date.now();
  const minutes = Math.max(1, Math.round((end - start) / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export const StreamCard: React.FC<{ stream: StreamRow; onOpen?: (id: string) => void }> = ({ stream, onOpen }) => {
  const isLive = stream.status === 'live' || stream.is_live;
  return (
    <motion.button
      type="button"
      whileHover={onOpen ? { y: -4, scale: 1.01 } : {}}
      whileTap={onOpen ? { scale: 0.98 } : {}}
      onClick={onOpen ? () => onOpen(stream.id) : undefined}
      disabled={!onOpen}
      className="group relative overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950/80 text-left shadow-[0_0_36px_rgba(0,229,255,0.08)] transition hover:border-cyan-300/40 disabled:cursor-default disabled:pointer-events-none"
    >
      <div className="aspect-video bg-black relative overflow-hidden">
        {stream.thumbnail_url ? (
          <img src={stream.thumbnail_url} alt="Stream thumbnail" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(255,0,80,0.25),transparent_35%),radial-gradient(circle_at_70%_80%,rgba(0,229,255,0.18),transparent_35%)]">
            <Tv className="h-14 w-14 text-white/20" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />
        <div className="absolute left-4 top-4 flex items-center gap-2">
          <span className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest', isLive ? 'bg-red-500 text-white shadow-[0_0_18px_rgba(239,68,68,0.45)]' : 'bg-white/10 text-zinc-200')}>
            {isLive && <span className="h-2 w-2 animate-pulse rounded-full bg-white" />}
            {isLive ? 'Live' : 'Replay'}
          </span>
          <span className="rounded-full border border-cyan-300/20 bg-black/60 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-cyan-100">
            {stream.category || 'Other'}
          </span>
        </div>
        <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black uppercase tracking-wide text-white">{stream.title || 'Untitled Transmission'}</h3>
            <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-widest text-zinc-400">@{stream.host_username || 'creator'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-full bg-black/70 px-3 py-1 text-[10px] font-black text-white">
            <Eye className="h-3.5 w-3.5 text-cyan-300" />
            {isLive ? stream.viewer_count || 0 : formatDuration(stream)}
          </div>
        </div>
      </div>
    </motion.button>
  );
};

export const GoLive: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const viewerStreamId = searchParams.get('streamId');
  const { currentUser } = useAuth();

  const [streamId, setStreamId] = useState<string | null>(viewerStreamId);
  const [streamData, setStreamData] = useState<StreamRow | null>(null);
  const [activeStreams, setActiveStreams] = useState<StreamRow[]>([]);
  const [replays, setReplays] = useState<StreamRow[]>([]);
  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [reactions, setReactions] = useState<Record<string, number>>({});
  const [followed, setFollowed] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'All' | StreamCategory>('All');

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<StreamCategory>('Coding');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [description, setDescription] = useState('');
  const [chatText, setChatText] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [mediaSource, setMediaSource] = useState<'camera' | 'screen'>('camera');
  const [localReady, setLocalReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [replayWarning, setReplayWarning] = useState<string | null>(null);
  const [repostState, setRepostState] = useState<'idle' | 'working' | 'done'>('idle');
  const [shareCopied, setShareCopied] = useState(false);
  const [liveKitStatus, setLiveKitStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [liveKitError, setLiveKitError] = useState<string | null>(null);
  const [liveKitParticipantCount, setLiveKitParticipantCount] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const roomRef = useRef<Room | null>(null);
  const remoteAudioElementsRef = useRef<HTMLMediaElement[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isLiveRef = useRef(false);
  const endedRef = useRef(false);
  const streamIdRef = useRef<string | null>(null);
  const currentUserRef = useRef(currentUser);
  const isViewer = !!viewerStreamId && !isLive;
  const activeStreamId = streamId || viewerStreamId;
  const filteredStreams = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return activeStreams.filter((stream) => {
      const matchesCategory = categoryFilter === 'All' || stream.category === categoryFilter;
      const haystack = `${stream.title ?? ''} ${stream.host_username ?? ''} ${stream.category ?? ''}`.toLowerCase();
      return matchesCategory && (!query || haystack.includes(query));
    });
  }, [activeStreams, categoryFilter, searchTerm]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const fetchDirectory = async () => {
    const { data: liveData, error: liveError } = await supabase
      .from('streams')
      .select('*')
      .eq('status', 'live')
      .order('started_at', { ascending: false })
      .limit(24);
    if (liveError) handleDbError(liveError, 'LIST', 'streams/live');
    setActiveStreams((liveData ?? []).map(normalizeStream));

    const { data: replayData, error: replayError } = await supabase
      .from('streams')
      .select('*')
      .eq('status', 'ended')
      .order('ended_at', { ascending: false })
      .limit(12);
    if (replayError) handleDbError(replayError, 'LIST', 'streams/replays');
    setReplays((replayData ?? []).map(normalizeStream));
  };

  useEffect(() => {
    void fetchDirectory();
    const channel = supabase
      .channel('universal-stream-directory')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'streams' }, () => void fetchDirectory())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const attachLocalStream = (media: MediaStream) => {
    streamRef.current = media;
    if (videoRef.current) {
      videoRef.current.srcObject = media;
      videoRef.current.play().catch(() => undefined);
    }
    setCameraOn(media.getVideoTracks().some((track) => track.enabled));
    setMicOn(media.getAudioTracks().some((track) => track.enabled));
    // Signal that a local preview source is ready so the self-view effect
    // re-binds srcObject immediately — independent of LiveKit connection state.
    setLocalReady(true);
  };

  const startMedia = async (source: 'camera' | 'screen' = 'camera') => {
    if (!currentUser) return;
    stopMedia();
    setMediaSource(source);
    try {
      const media = source === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        : await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
      attachLocalStream(media);
    } catch (err) {
      console.error('[GoLive] Media capture failed:', err);
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
        attachLocalStream(audioOnly);
        setCameraOn(false);
      } catch (audioErr) {
        console.error('[GoLive] Audio capture failed:', audioErr);
      }
    }
  };

  const detachRemoteAudio = () => {
    remoteAudioElementsRef.current.forEach((element) => {
      element.pause();
      element.remove();
    });
    remoteAudioElementsRef.current = [];
  };

  const disconnectLiveKit = () => {
    detachRemoteAudio();
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    setLiveKitParticipantCount(0);
    setLiveKitStatus('idle');
  };

  const attachLiveKitTrack = (track: any) => {
    if (!track) return;
    if (track.kind === 'video' && videoRef.current) {
      track.attach(videoRef.current);
      videoRef.current.play().catch(() => undefined);
    } else if (track.kind === 'audio') {
      const element = track.attach() as HTMLMediaElement;
      element.autoplay = true;
      element.hidden = true;
      document.body.appendChild(element);
      remoteAudioElementsRef.current.push(element);
    }
  };

  const startReplayRecording = (id: string) => {
    if (!streamRef.current || typeof MediaRecorder === 'undefined') return;
    try {
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
          ? 'video/webm;codecs=vp8,opus'
          : 'video/webm';
      const recorder = new MediaRecorder(streamRef.current, { mimeType });
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      // Chunk every 5s so partial recordings survive an abrupt tab close.
      recorder.start(5000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setReplayWarning(null);
      void id;
    } catch (err) {
      console.warn('[GoLive] Replay recording unavailable:', err);
      setReplayWarning('Recording unavailable in this browser — this broadcast will not be saved as a replay.');
    }
  };

  const stopReplayRecordingAndUpload = async (id: string): Promise<string | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return null;

    const blob = await new Promise<Blob | null>((resolve) => {
      const finalize = () => {
        if (!recordingChunksRef.current.length) return resolve(null);
        resolve(new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'video/webm' }));
      };
      recorder.onstop = finalize;
      if (recorder.state === 'inactive') finalize();
      else recorder.stop();
    });

    mediaRecorderRef.current = null;
    recordingChunksRef.current = [];
    setIsRecording(false);
    const user = currentUserRef.current;
    if (!blob || !user) return null;

    try {
      const path = `${user.id}/${id}-${Date.now()}.webm`;
      const { error } = await supabase.storage.from('stream-replays').upload(path, blob, {
        cacheControl: '31536000',
        contentType: blob.type || 'video/webm',
        upsert: true,
      });
      if (error) throw error;
      const { data } = supabase.storage.from('stream-replays').getPublicUrl(path);
      return data.publicUrl;
    } catch (err) {
      console.warn('[GoLive] Replay upload failed. Create a public Supabase Storage bucket named stream-replays to persist recordings.', err);
      setReplayWarning('Replay could not be saved. Ask an admin to ensure the public "stream-replays" Supabase Storage bucket exists and allows authenticated uploads.');
      return null;
    }
  };

  const stopMedia = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setLocalReady(false);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const connectLiveKitStream = async (id: string, role: 'host' | 'viewer', source: 'camera' | 'screen' = 'camera') => {
    if (!currentUser) return;
    disconnectLiveKit();
    setLiveKitStatus('connecting');
    setLiveKitError(null);

    try {
      const credentials = await requestLiveKitToken({
        roomType: 'stream',
        resourceId: id,
        role,
        displayName: currentUser.display_name || currentUser.username,
        avatarUrl: currentUser.avatar_url,
      });

      const room = new Room({ adaptiveStream: true, dynacast: role === 'host' });
      roomRef.current = room;

      const updateParticipantCount = () => {
        setLiveKitParticipantCount(room.remoteParticipants.size + 1);
      };

      room.on(RoomEvent.TrackSubscribed, (track) => attachLiveKitTrack(track));
      room.on(RoomEvent.ParticipantConnected, updateParticipantCount);
      room.on(RoomEvent.ParticipantDisconnected, updateParticipantCount);
      room.on(RoomEvent.Disconnected, () => setLiveKitStatus('idle'));

      await room.connect(credentials.url, credentials.token);
      updateParticipantCount();

      if (role === 'host') {
        const localTracks = streamRef.current?.getTracks() ?? [];
        for (const mediaTrack of localTracks) {
          await room.localParticipant.publishTrack(mediaTrack, {
            source: mediaTrack.kind === 'video'
              ? (source === 'screen' ? Track.Source.ScreenShare : Track.Source.Camera)
              : Track.Source.Microphone,
          });
        }
      } else {
        room.remoteParticipants.forEach((participant) => {
          participant.trackPublications.forEach((publication) => {
            if (publication.track) attachLiveKitTrack(publication.track);
          });
        });
      }

      setLiveKitStatus('connected');
    } catch (err: any) {
      console.error('[GoLive] LiveKit connection failed:', err);
      const status = err?.status;
      const message = status === 503
        ? 'LiveKit is not configured on the server. Contact the admin to set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.'
        : err?.message || 'LiveKit connection failed.';
      setLiveKitError(message);
      setLiveKitStatus('error');
    }
  };

  // Stop recording, upload the replay, and persist the ended state. Guarded so it
  // runs at most once whether triggered by End, unmount, or stopMedia.
  const finalizeBroadcast = async (id: string): Promise<void> => {
    if (endedRef.current) return;
    endedRef.current = true;
    try {
      const replayUrl = await stopReplayRecordingAndUpload(id);
      const { error: streamError } = await supabase.from('streams').update({
        status: 'ended',
        is_live: false,
        ended_at: new Date().toISOString(),
        ...(replayUrl ? { replay_url: replayUrl } : {}),
      }).eq('id', id);
      if (streamError) throw streamError;
      const user = currentUserRef.current;
      if (user) {
        // Clearing the host's live flags is best-effort: the broadcast has already
        // been marked ended above, so a failure here shouldn't surface a fatal error.
        const { error: userError } = await supabase.from('users').update({ is_live: false, active_stream_id: null }).eq('id', user.id);
        if (userError) console.warn('[GoLive] Failed to clear host live flags:', userError);
      }
    } catch (err) {
      handleDbError(err, 'UPDATE', `streams/${id}`);
    }
  };

  useEffect(() => { isLiveRef.current = isLive; }, [isLive]);
  useEffect(() => { endedRef.current = hasEnded; }, [hasEnded]);
  useEffect(() => { streamIdRef.current = streamId || viewerStreamId; }, [streamId, viewerStreamId]);
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);

  useEffect(() => () => {
    // On unmount (e.g. host closes the tab / navigates away) make sure an
    // in-progress broadcast is finalized so the recording isn't lost.
    if (isLiveRef.current && !endedRef.current && streamIdRef.current) {
      void finalizeBroadcast(streamIdRef.current);
    }
    disconnectLiveKit();
    stopMedia();
  }, []);

  // Real-time self-view: keep the host's own camera/screen bound to the video
  // element as soon as the local stream is ready — independent of LiveKit status.
  useEffect(() => {
    if (hasEnded) return;
    if (isLive && streamRef.current && videoRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => undefined);
    }
  }, [isLive, localReady, hasEnded]);

  const fetchStreamBundle = async (id: string) => {
    const { data, error } = await supabase.from('streams').select('*').eq('id', id).maybeSingle();
    if (error) handleDbError(error, 'READ', `streams/${id}`);
    const normalized = normalizeStream(data);
    setStreamData(normalized);
    setTitle(normalized?.title ?? '');
    setCategory((normalized?.category as StreamCategory) || 'Other');
    setThumbnailUrl(normalized?.thumbnail_url ?? '');
    setDescription(normalized?.description ?? '');
    setIsLive(normalized?.status === 'live' && normalized?.host_id === currentUser?.id);
    setHasEnded(normalized?.status === 'ended');
  };

  useEffect(() => {
    if (!activeStreamId) return;
    void fetchStreamBundle(activeStreamId);
    const streamChannel = supabase
      .channel(`universal-stream-${activeStreamId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'streams', filter: `id=eq.${activeStreamId}` }, ({ new: row }) => {
        const normalized = normalizeStream(row);
        setStreamData(normalized);
        setHasEnded(normalized.status === 'ended');
      })
      .subscribe();
    return () => { supabase.removeChannel(streamChannel); };
  }, [activeStreamId, currentUser?.id, viewerStreamId]);

  useEffect(() => {
    if (!viewerStreamId) return;
    void supabase.rpc('increment_counter', { p_table: 'streams', p_id: viewerStreamId, p_field: 'viewer_count', p_amount: 1 });
    void supabase.rpc('increment_counter', { p_table: 'streams', p_id: viewerStreamId, p_field: 'crowd_size', p_amount: 1 });
    return () => {
      void supabase.rpc('increment_counter', { p_table: 'streams', p_id: viewerStreamId, p_field: 'viewer_count', p_amount: -1 });
      void supabase.rpc('increment_counter', { p_table: 'streams', p_id: viewerStreamId, p_field: 'crowd_size', p_amount: -1 });
    };
  }, [viewerStreamId]);

  useEffect(() => {
    if (!viewerStreamId || !currentUser || hasEnded || isLive) return;
    const streamerId = streamData?.user_id || streamData?.host_id;
    if (streamerId && streamerId === currentUser.id) return;
    void connectLiveKitStream(viewerStreamId, 'viewer');
    return () => disconnectLiveKit();
  }, [viewerStreamId, currentUser?.id, hasEnded, isLive, streamData?.user_id, streamData?.host_id]);

  const fetchMessages = async () => {
    if (!activeStreamId) return;
    const { data, error } = await supabase
      .from('stream_chat')
      .select('*')
      .eq('stream_id', activeStreamId)
      .order('created_at', { ascending: true })
      .limit(150);
    if (error) handleDbError(error, 'LIST', `stream_chat/${activeStreamId}`);
    setMessages((data ?? []) as ChatRow[]);
  };

  const fetchReactions = async () => {
    if (!activeStreamId) return;
    const { data, error } = await supabase
      .from('stream_reactions')
      .select('reaction_type')
      .eq('stream_id', activeStreamId);
    if (error) {
      handleDbError(error, 'LIST', `stream_reactions/${activeStreamId}`);
      return;
    }
    const next: Record<string, number> = {};
    (data ?? []).forEach((row: any) => {
      next[row.reaction_type] = (next[row.reaction_type] ?? 0) + 1;
    });
    setReactions(next);
  };

  useEffect(() => {
    if (!activeStreamId) return;
    void fetchMessages();
    void fetchReactions();
    const channel = supabase
      .channel(`universal-stream-chat-reactions-${activeStreamId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stream_chat', filter: `stream_id=eq.${activeStreamId}` }, () => void fetchMessages())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stream_reactions', filter: `stream_id=eq.${activeStreamId}` }, () => void fetchReactions())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeStreamId]);

  useEffect(() => {
    const streamerId = streamData?.user_id || streamData?.host_id;
    if (!currentUser || !streamerId || currentUser.id === streamerId) {
      setFollowed(false);
      return;
    }
    supabase
      .from('stream_followers')
      .select('id')
      .eq('streamer_id', streamerId)
      .eq('follower_id', currentUser.id)
      .maybeSingle()
      .then(({ data }) => setFollowed(!!data));
  }, [currentUser?.id, streamData?.user_id, streamData?.host_id]);

  const handleStartStream = async (source: 'camera' | 'screen' = 'camera') => {
    if (!currentUser || !title.trim()) return;
    setIsStarting(true);
    try {
      await startMedia(source);
      const payload = {
        user_id: currentUser.id,
        host_id: currentUser.id,
        host_display_name: currentUser.display_name,
        host_username: currentUser.username,
        host_avatar: currentUser.avatar_url,
        title: title.trim(),
        description: description.trim() || null,
        category,
        thumbnail_url: thumbnailUrl.trim() || null,
        status: 'live',
        is_live: true,
        viewer_count: 0,
        crowd_size: 0,
        started_at: new Date().toISOString(),
      };
      const { data, error } = await supabase.from('streams').insert(payload).select().single();
      if (error) throw error;
      const normalized = normalizeStream(data);
      endedRef.current = false;
      setStreamId(normalized.id);
      streamIdRef.current = normalized.id;
      setStreamData(normalized);
      setIsLive(true);
      setHasEnded(false);
      // Record every broadcast (camera AND screen) from the raw local stream,
      // independent of the LiveKit connection succeeding.
      startReplayRecording(normalized.id);
      await supabase.from('users').update({ is_live: true, active_stream_id: normalized.id }).eq('id', currentUser.id);
      await connectLiveKitStream(normalized.id, 'host', source);
      navigate(`/golive?streamId=${normalized.id}`, { replace: true });
    } catch (err) {
      handleDbError(err, 'CREATE', 'streams');
    } finally {
      setIsStarting(false);
    }
  };

  const handleEndStream = async () => {
    if (!activeStreamId || !currentUser) return;
    await finalizeBroadcast(activeStreamId);
    setIsLive(false);
    setHasEnded(true);
    disconnectLiveKit();
    stopMedia();
  };

  const handleSendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentUser || !activeStreamId || !chatText.trim()) return;
    try {
      const { error } = await supabase.from('stream_chat').insert({
        stream_id: activeStreamId,
        user_id: currentUser.id,
        sender_id: currentUser.id,
        sender_name: currentUser.display_name || currentUser.username,
        message: chatText.trim(),
        text: chatText.trim(),
      });
      if (error) throw error;
      setChatText('');
    } catch (err) {
      handleDbError(err, 'CREATE', `stream_chat/${activeStreamId}`);
    }
  };

  const handleReaction = async (reactionType: string) => {
    if (!currentUser || !activeStreamId) return;
    setReactions((prev) => ({ ...prev, [reactionType]: (prev[reactionType] ?? 0) + 1 }));
    const { error } = await supabase.from('stream_reactions').insert({
      stream_id: activeStreamId,
      user_id: currentUser.id,
      reaction_type: reactionType,
    });
    if (error) handleDbError(error, 'CREATE', `stream_reactions/${activeStreamId}`);
  };

  const toggleFollow = async () => {
    const streamerId = streamData?.user_id || streamData?.host_id;
    if (!currentUser || !streamerId || currentUser.id === streamerId) return;
    if (followed) {
      await supabase.from('stream_followers').delete().eq('streamer_id', streamerId).eq('follower_id', currentUser.id);
      setFollowed(false);
    } else {
      const { error } = await supabase.from('stream_followers').insert({ streamer_id: streamerId, follower_id: currentUser.id });
      if (error) handleDbError(error, 'CREATE', 'stream_followers');
      setFollowed(true);
    }
  };

  const copyStreamLink = async () => {
    if (!activeStreamId) return;
    const ok = await shareStreamLink(activeStreamId);
    if (ok) {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1800);
    }
  };

  const handleRepostReplay = async () => {
    if (!currentUser || !activeStreamId || repostState === 'working') return;
    setRepostState('working');
    const ok = await repostReplayToFeed(
      {
        id: activeStreamId,
        title: streamData?.title,
        replay_url: streamData?.replay_url,
        thumbnail_url: streamData?.thumbnail_url,
        category: streamData?.category as string | null | undefined,
      },
      currentUser,
    );
    setRepostState(ok ? 'done' : 'idle');
    if (ok) setTimeout(() => setRepostState('idle'), 2200);
  };

  const toggleTrack = (kind: 'audio' | 'video') => {
    const track = kind === 'audio' ? streamRef.current?.getAudioTracks()[0] : streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    if (kind === 'audio') setMicOn(track.enabled);
    if (kind === 'video') setCameraOn(track.enabled);
  };

  if (!viewerStreamId && !currentUser) {
    return (
      <div className="min-h-screen bg-black px-6 py-10 text-white">
        <div className="mx-auto flex max-w-2xl flex-col items-center justify-center rounded-[2rem] border border-white/10 bg-zinc-950/80 p-10 text-center shadow-[0_0_50px_rgba(255,0,80,0.12)]">
          <Radio className="mb-5 h-12 w-12 text-accent" />
          <h1 className="text-3xl font-black uppercase italic tracking-tight">Live Network Locked</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">Sign in to browse live creators, start a broadcast, follow streamers, and chat with the crowd.</p>
          <button onClick={() => navigate('/')} className="mt-8 rounded-2xl bg-accent px-8 py-3 text-xs font-black uppercase tracking-widest text-white shadow-[0_0_24px_rgba(255,0,80,0.35)]">Return to Login</button>
        </div>
      </div>
    );
  }

  if (!viewerStreamId && !isLive) {
    return (
      <div className="min-h-screen bg-black pb-28 text-white">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,0,80,0.16),transparent_34%),radial-gradient(circle_at_80%_10%,rgba(0,229,255,0.14),transparent_32%),linear-gradient(180deg,transparent,rgba(0,0,0,0.9))]" />
        <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <header className="mb-8 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div>
              <button onClick={() => navigate('/')} className="mb-5 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white">
                <ArrowLeft className="h-4 w-4" /> Back to Feed
              </button>
              <p className="text-[10px] font-black uppercase tracking-[0.35em] text-cyan-300">Universal Live Streaming</p>
              <h1 className="mt-2 text-4xl font-black uppercase italic tracking-tighter sm:text-6xl">Neon Broadcast Grid</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">Go live for coding, gaming, music, art, podcasts, reactions, tutorials, unboxings, Q&A, or anything else the network needs to see.</p>
            </div>
            <Link to="/casper/studio" className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-cyan-100 hover:bg-cyan-300/20">
              <Sparkles className="h-4 w-4" /> Plan with Casper
            </Link>
          </header>

          <section className="grid gap-6 lg:grid-cols-[420px_1fr]">
            <div className="rounded-[2rem] border border-red-400/20 bg-zinc-950/90 p-5 shadow-[0_0_40px_rgba(255,0,80,0.1)]">
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-2xl bg-accent/15 p-3 text-accent"><Radio className="h-5 w-5" /></div>
                <div>
                  <h2 className="text-sm font-black uppercase tracking-widest">Streamer Dashboard</h2>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Title, category, thumbnail, controls</p>
                </div>
              </div>
              <div className="space-y-4">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Stream title" className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-accent" />
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description or show notes" className="min-h-24 w-full resize-none rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition focus:border-accent" />
                <select value={category} onChange={(e) => setCategory(e.target.value as StreamCategory)} className="w-full rounded-2xl border border-white/10 bg-black/80 px-4 py-3 text-xs font-black uppercase tracking-widest text-white outline-none focus:border-cyan-300">
                  {STREAM_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <div className="relative">
                  <ImageIcon className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input value={thumbnailUrl} onChange={(e) => setThumbnailUrl(e.target.value)} placeholder="Thumbnail URL (optional)" className="w-full rounded-2xl border border-white/10 bg-black/50 py-3 pl-11 pr-4 text-sm text-white outline-none transition focus:border-cyan-300" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => void handleStartStream('camera')} disabled={!title.trim() || isStarting} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-4 text-[10px] font-black uppercase tracking-widest text-white shadow-[0_0_24px_rgba(255,0,80,0.35)] transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40">
                    {isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} Camera Live
                  </button>
                  <button onClick={() => void handleStartStream('screen')} disabled={!title.trim() || isStarting} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-4 text-[10px] font-black uppercase tracking-widest text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-40">
                    <MonitorUp className="h-4 w-4" /> Screen Share
                  </button>
                </div>
                <div className="rounded-2xl border border-green-300/20 bg-green-400/10 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-green-200">Classic streaming active</p>
                  <p className="mt-2 text-xs leading-5 text-zinc-300">Go-live, live chat, replay capture, and arena broadcasts are open to every BSC node.</p>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-cyan-200">Live signals online</p>
                  <p className="mt-2 text-2xl font-black text-white">{activeStreams.length}</p>
                  <p className="text-xs text-zinc-400">Broadcasts currently running across the network.</p>
                </div>
                <div className="rounded-3xl border border-fuchsia-300/20 bg-fuchsia-300/10 p-5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-fuchsia-200">Overlay forge open</p>
                  <p className="mt-2 text-sm text-zinc-300">Custom stream overlays can be generated from Visual Forge and attached to upcoming broadcasts.</p>
                </div>
              </div>

              <div className="rounded-[2rem] border border-white/10 bg-zinc-950/80 p-4">
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-widest">Live Discovery</h2>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Find the signal worth joining</p>
                  </div>
                  <div className="flex flex-1 gap-2 md:max-w-md">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                      <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search streams" className="w-full rounded-xl border border-white/10 bg-black/50 py-2 pl-9 pr-3 text-xs text-white outline-none focus:border-cyan-300" />
                    </div>
                    <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as 'All' | StreamCategory)} className="rounded-xl border border-white/10 bg-black px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white outline-none">
                      <option value="All">All</option>
                      {STREAM_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </div>
                </div>
                {filteredStreams.length ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {filteredStreams.map((stream) => <StreamCard key={stream.id} stream={stream} onOpen={(id) => navigate(`/golive?streamId=${id}`)} />)}
                  </div>
                ) : (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-black/30 p-10 text-center">
                    <Radio className="mx-auto mb-4 h-10 w-10 text-zinc-700" />
                    <p className="text-xs font-black uppercase tracking-widest text-zinc-500">No live signals match this filter.</p>
                  </div>
                )}
              </div>

              <div className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-widest">Replay Archive</h2>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-600">Replay archive is open for BSC Classic broadcasts.</p>
                  </div>
                  <Clapperboard className="h-5 w-5 text-zinc-500" />
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {replays.slice(0, 6).map((stream) => <StreamCard key={stream.id} stream={stream} onOpen={(id) => navigate(`/golive?streamId=${id}`)} />)}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  const streamerId = streamData?.user_id || streamData?.host_id;
  const isOwnStream = !!currentUser && streamerId === currentUser.id;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-black text-white md:flex-row">
      <div className="relative flex min-h-0 flex-1 flex-col bg-zinc-950">
        <div className="flex items-center justify-between border-b border-white/10 bg-black/60 p-4 backdrop-blur-xl">
          <button onClick={() => navigate('/golive')} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Streams
          </button>
          <div className="flex items-center gap-2">
            <span className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest', hasEnded ? 'bg-white/10 text-zinc-300' : 'bg-red-500 text-white')}>
              {!hasEnded && <span className="h-2 w-2 animate-ping rounded-full bg-white" />}
              {hasEnded ? 'Replay' : 'Live'}
            </span>
            <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-cyan-100">{streamData?.category || category}</span>
          </div>
        </div>

        <div className="relative flex-1 overflow-hidden bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isOwnStream}
            controls={hasEnded && !!streamData?.replay_url}
            src={hasEnded ? streamData?.replay_url ?? undefined : undefined}
            style={isOwnStream && !hasEnded && mediaSource === 'camera' ? { transform: 'scaleX(-1)' } : undefined}
            className={cn('h-full w-full object-contain', hasEnded && !streamData?.replay_url ? 'opacity-0' : 'opacity-100')}
          />
          {!hasEnded && (
            <div className="absolute left-4 top-4 flex flex-wrap items-center gap-2">
              <span className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[9px] font-black uppercase tracking-widest backdrop-blur-xl', liveKitStatus === 'connected' ? 'border-emerald-300/30 bg-emerald-400/15 text-emerald-100' : liveKitStatus === 'error' ? 'border-red-400/30 bg-red-500/15 text-red-100' : 'border-cyan-300/30 bg-cyan-400/10 text-cyan-100')}>
                <span className={cn('h-2 w-2 rounded-full', liveKitStatus === 'connected' ? 'bg-emerald-300' : liveKitStatus === 'error' ? 'bg-red-300' : 'animate-pulse bg-cyan-300')} />
                LiveKit {liveKitStatus}
              </span>
              {liveKitParticipantCount > 0 && (
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-white backdrop-blur-xl">
                  <Users className="h-3 w-3 text-cyan-300" /> {liveKitParticipantCount}
                </span>
              )}
              {isOwnStream && isRecording && (
                <span className="inline-flex items-center gap-2 rounded-full border border-red-400/30 bg-red-500/15 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-red-100 backdrop-blur-xl">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
                  Recording
                </span>
              )}
            </div>
          )}
          {isOwnStream && replayWarning && (
            <div className="absolute left-4 right-4 top-16 z-10 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/15 px-3 py-2 text-[10px] font-bold text-amber-100 backdrop-blur-xl">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{replayWarning}</span>
            </div>
          )}
          {((isViewer && liveKitStatus !== 'connected') || hasEnded) && !streamData?.replay_url && (
            <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_50%_25%,rgba(255,0,80,0.2),transparent_34%),radial-gradient(circle_at_50%_80%,rgba(0,229,255,0.14),transparent_36%)] p-8 text-center">
              <div className="max-w-lg">
                {streamData?.host_avatar ? <img src={streamData.host_avatar} alt="Host" className="mx-auto mb-6 h-28 w-28 rounded-full border-4 border-accent object-cover shadow-[0_0_40px_rgba(255,0,80,0.4)]" /> : <div className="mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-full border-4 border-accent bg-zinc-900"><Tv className="h-12 w-12 text-accent" /></div>}
                <h1 className="text-3xl font-black uppercase italic tracking-tighter">{streamData?.title || title || 'Neural Transmission'}</h1>
                <p className="mt-3 text-sm leading-6 text-zinc-400">{hasEnded ? 'This broadcast has ended. Replay media will appear here when the host recording is available.' : liveKitError || 'Connecting to the LiveKit broadcast. The stream will appear here as soon as the host publishes camera, microphone, or screen media.'}</p>
                <div className="mt-6 flex items-center justify-center gap-3 text-xs font-black uppercase tracking-widest text-zinc-300">
                  <Users className="h-4 w-4 text-cyan-300" /> {Math.max(streamData?.viewer_count ?? 0, liveKitParticipantCount)} viewers
                </div>
              </div>
            </div>
          )}
          <AnimatePresence>
            {hasEnded && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black to-transparent p-8 text-center">
                <p className="text-xs font-black uppercase tracking-[0.25em] text-zinc-400">Transmission archived</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="border-t border-white/10 bg-zinc-950/95 p-4 backdrop-blur-xl">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-black uppercase italic tracking-tight">{streamData?.title || title || 'Neural Transmission'}</h1>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">@{streamData?.host_username || currentUser?.username || 'creator'} · {streamData?.description || 'Universal creator stream'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!isOwnStream && currentUser && (
                <button onClick={() => void toggleFollow()} className={cn('inline-flex items-center gap-2 rounded-xl px-4 py-3 text-[10px] font-black uppercase tracking-widest transition', followed ? 'border border-cyan-300/30 bg-cyan-300/10 text-cyan-100' : 'bg-accent text-white shadow-[0_0_18px_rgba(255,0,80,0.35)]')}>
                  {followed ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                  {followed ? 'Signal Locked' : 'Lock Stream Signal'}
                </button>
              )}
              {REACTIONS.map((reaction) => (
                <button key={reaction.key} onClick={() => void handleReaction(reaction.key)} disabled={!currentUser || hasEnded} className="inline-flex min-w-14 items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-white/10 disabled:opacity-40">
                  <span>{reaction.label}</span>
                  <span className="text-cyan-300">{reactions[reaction.key] ?? 0}</span>
                </button>
              ))}
              <button onClick={() => void copyStreamLink()} title="Copy share link" className={cn('inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition hover:text-white', shareCopied && 'border-emerald-300/40 text-emerald-200')}>
                {shareCopied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
                <span className="hidden sm:inline">{shareCopied ? 'Copied' : 'Share'}</span>
              </button>
              {isOwnStream && hasEnded && (
                <button onClick={() => void handleRepostReplay()} disabled={repostState === 'working'} className={cn('inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-[10px] font-black uppercase tracking-widest transition disabled:opacity-40', repostState === 'done' ? 'border-emerald-300/40 bg-emerald-400/10 text-emerald-200' : 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20')}>
                  {repostState === 'working' ? <Loader2 className="h-4 w-4 animate-spin" /> : repostState === 'done' ? <Check className="h-4 w-4" /> : <Repeat2 className="h-4 w-4" />}
                  {repostState === 'done' ? 'Reposted' : 'Repost to Feed'}
                </button>
              )}
              {isOwnStream && !hasEnded && (
                <>
                  <button onClick={() => toggleTrack('video')} className={cn('rounded-xl border p-3', cameraOn ? 'border-white/10 bg-white/5 text-white' : 'border-red-400/40 bg-red-500/10 text-red-300')}>{cameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}</button>
                  <button onClick={() => toggleTrack('audio')} className={cn('rounded-xl border p-3', micOn ? 'border-white/10 bg-white/5 text-white' : 'border-red-400/40 bg-red-500/10 text-red-300')}>{micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}</button>
                  <button onClick={() => void handleEndStream()} className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white"><Square className="h-4 w-4" /> End</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <aside className="flex h-[42vh] w-full flex-col border-l border-white/10 bg-zinc-950 md:h-full md:w-96">
        <div className="border-b border-white/10 bg-black/40 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MessageCircle className="h-5 w-5 text-accent" />
              <h2 className="text-[10px] font-black uppercase tracking-[0.28em]">Live Chat</h2>
            </div>
              <div className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-zinc-400">
                <Eye className="h-3.5 w-3.5 text-cyan-300" /> {Math.max(streamData?.viewer_count ?? 0, liveKitParticipantCount)}
              </div>

          </div>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {messages.length ? messages.map((msg) => (
            <div key={msg.id} className="rounded-2xl border border-white/5 bg-white/[0.03] p-3">
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="truncate text-[10px] font-black uppercase tracking-widest text-cyan-300">@{msg.sender_name || 'viewer'}</span>
                <span className="text-[9px] font-bold text-zinc-600">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <p className="text-xs leading-5 text-zinc-300">{msg.message || msg.text}</p>
            </div>
          )) : (
            <div className="flex h-full flex-col items-center justify-center text-center opacity-40">
              <Zap className="mb-4 h-10 w-10 text-zinc-600" />
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">No chat packets yet</p>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        {currentUser && !hasEnded ? (
          <form onSubmit={handleSendMessage} className="border-t border-white/10 p-4">
            <div className="relative">
              <input value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder="Transmit to chat..." className="w-full rounded-2xl border border-white/10 bg-black/50 py-4 pl-4 pr-14 text-sm text-white outline-none focus:border-accent" />
              <button type="submit" disabled={!chatText.trim()} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-accent p-3 text-white disabled:opacity-30"><Send className="h-4 w-4" /></button>
            </div>
          </form>
        ) : (
          <div className="border-t border-white/10 p-4 text-center text-[10px] font-black uppercase tracking-widest text-zinc-500">{hasEnded ? 'Chat archived' : 'Sign in to chat'}</div>
        )}
      </aside>
    </div>
  );
};
