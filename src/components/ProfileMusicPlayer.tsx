import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Music, Volume2, VolumeX, Play, Pause, ExternalLink } from 'lucide-react';
import { cn } from '../lib/utils';

interface ProfileMusicPlayerProps {
  musicUrl: string;
  musicTitle?: string | null;
  musicArtist?: string | null;
  accentColor?: string;
}

function getEmbedUrl(url: string): { type: 'youtube' | 'soundcloud' | 'direct' | 'unknown'; embedUrl: string } {
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) {
    return {
      type: 'youtube',
      embedUrl: `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&mute=1&loop=1&playlist=${ytMatch[1]}&controls=0&showinfo=0&rel=0`,
    };
  }
  // SoundCloud
  if (url.includes('soundcloud.com')) {
    return {
      type: 'soundcloud',
      embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=false`,
    };
  }
  // Direct audio
  if (/\.(mp3|ogg|wav|m4a|aac|flac)(\?.*)?$/i.test(url)) {
    return { type: 'direct', embedUrl: url };
  }
  return { type: 'unknown', embedUrl: url };
}

export const ProfileMusicPlayer: React.FC<ProfileMusicPlayerProps> = ({
  musicUrl,
  musicTitle,
  musicArtist,
  accentColor = '#FF0000',
}) => {
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const { type, embedUrl } = getEmbedUrl(musicUrl);

  // For direct audio files
  useEffect(() => {
    if (type !== 'direct' || !audioRef.current) return;
    audioRef.current.muted = isMuted;
    if (isPlaying) {
      audioRef.current.play().catch(() => {});
    } else {
      audioRef.current.pause();
    }
  }, [isMuted, isPlaying, type]);

  const toggleMute = () => {
    setIsMuted(m => {
      if (audioRef.current) audioRef.current.muted = !m;
      return !m;
    });
  };

  const togglePlay = () => {
    setIsPlaying(p => {
      if (audioRef.current) {
        if (p) audioRef.current.pause();
        else audioRef.current.play().catch(() => {});
      }
      return !p;
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "fixed bottom-20 right-4 z-40 rounded-2xl border shadow-2xl overflow-hidden transition-all",
        isMinimized ? "w-14 h-14" : "w-64"
      )}
      style={{
        backgroundColor: accentColor + '15',
        borderColor: accentColor + '40',
        boxShadow: `0 0 30px ${accentColor}30`,
      }}
    >
      {isMinimized ? (
        <button
          onClick={() => setIsMinimized(false)}
          className="w-full h-full flex items-center justify-center"
          style={{ color: accentColor }}
        >
          <motion.div
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <Music className="w-6 h-6" />
          </motion.div>
        </button>
      ) : (
        <div className="p-3">
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <motion.div
                animate={isPlaying ? { rotate: 360 } : { rotate: 0 }}
                transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                className="w-6 h-6 rounded-full flex items-center justify-center"
                style={{ backgroundColor: accentColor + '30', border: `1px solid ${accentColor}60` }}
              >
                <Music className="w-3 h-3" style={{ color: accentColor }} />
              </motion.div>
              <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: accentColor }}>
                Now Playing
              </span>
            </div>
            <button
              onClick={() => setIsMinimized(true)}
              className="text-gray-500 hover:text-white transition-colors text-[10px]"
            >
              —
            </button>
          </div>

          {/* Track info */}
          <div className="mb-3">
            <p className="text-xs font-bold text-white truncate">{musicTitle || 'Unknown Track'}</p>
            <p className="text-[10px] text-gray-400 truncate">{musicArtist || 'Unknown Artist'}</p>
          </div>

          {/* Waveform animation */}
          {isPlaying && (
            <div className="flex items-end gap-0.5 h-6 mb-3">
              {Array.from({ length: 20 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="w-1 rounded-full"
                  style={{ backgroundColor: accentColor }}
                  animate={{ height: [4, Math.random() * 20 + 4, 4] }}
                  transition={{ duration: 0.5 + Math.random() * 0.5, repeat: Infinity, delay: i * 0.05 }}
                />
              ))}
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
              style={{ color: accentColor }}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              onClick={toggleMute}
              className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
              style={{ color: isMuted ? '#666' : accentColor }}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <span className="text-[9px] text-gray-600 flex-1">
              {isMuted ? 'Click 🔊 to unmute' : 'Playing'}
            </span>
            <a
              href={musicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg text-gray-600 hover:text-white transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Embedded players */}
          {type === 'youtube' && (
            <iframe
              src={embedUrl}
              className="hidden"
              allow="autoplay"
              title="profile-music"
            />
          )}
          {type === 'soundcloud' && (
            <iframe
              src={embedUrl}
              className="hidden"
              allow="autoplay"
              title="profile-music"
            />
          )}
          {type === 'direct' && (
            <audio
              ref={audioRef}
              src={musicUrl}
              loop
              muted={isMuted}
              autoPlay
              className="hidden"
            />
          )}
        </div>
      )}
    </motion.div>
  );
};
