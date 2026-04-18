import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize2, X, RotateCcw, Loader2, Zap, MonitorPlay, FastForward, Rewind } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface CustomVideoPlayerProps {
  src: string;
  className?: string;
  isVoidArchitect?: boolean;
}

export const CustomVideoPlayer: React.FC<CustomVideoPlayerProps> = ({ src, className, isVoidArchitect }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [duration, setDuration] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPipSupported, setIsPipSupported] = useState(false);
  const [isPipActive, setIsPipActive] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState(0);
  const [bufferProgress, setBufferProgress] = useState(0);
  const [seekIndicator, setSeekIndicator] = useState<{ side: 'left' | 'right' | null, id: number }>({ side: null, id: 0 });
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const seekIndicatorTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setIsPipSupported(document.pictureInPictureEnabled);
  }, []);

  const handleBuffer = () => {
    if (videoRef.current && videoRef.current.buffered.length > 0) {
      const bufferedEnd = videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
      const duration = videoRef.current.duration;
      if (duration > 0) {
        setBufferProgress((bufferedEnd / duration) * 100);
      }
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const showSeekIndicator = (side: 'left' | 'right') => {
    setSeekIndicator(prev => ({ side, id: prev.id + 1 }));
    if (seekIndicatorTimeoutRef.current) {
      clearTimeout(seekIndicatorTimeoutRef.current);
    }
    seekIndicatorTimeoutRef.current = setTimeout(() => {
      setSeekIndicator(prev => ({ ...prev, side: null }));
    }, 800);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 2) {
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
      showSeekIndicator('left');
    } else {
      videoRef.current.currentTime = Math.min(videoRef.current.duration, videoRef.current.currentTime + 10);
      showSeekIndicator('right');
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    setVolume(value);
    if (videoRef.current) {
      videoRef.current.volume = value;
      videoRef.current.muted = value === 0;
      setIsMuted(value === 0);
    }
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    setProgress(value);
    if (videoRef.current) {
      videoRef.current.currentTime = (value / 100) * videoRef.current.duration;
    }
  };

  const handleSeekMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    setHoverPosition(percentage * 100);
    setHoverTime(percentage * duration);
  };

  const updateProgress = () => {
    if (videoRef.current) {
      const value = (videoRef.current.currentTime / videoRef.current.duration) * 100;
      setProgress(value);
      handleBuffer();
    }
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      setIsLoading(false);
    }
  };

  const toggleExpansion = () => {
    setIsExpanded(!isExpanded);
    // Lock scroll when expanded
    if (!isExpanded) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  };

  const togglePip = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (error) {
      console.error('PiP Error:', error);
    }
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onEnterPip = () => setIsPipActive(true);
    const onLeavePip = () => setIsPipActive(false);

    video.addEventListener('enterpictureinpicture', onEnterPip);
    video.addEventListener('leavepictureinpicture', onLeavePip);

    return () => {
      video.removeEventListener('enterpictureinpicture', onEnterPip);
      video.removeEventListener('leavepictureinpicture', onLeavePip);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      document.body.style.overflow = '';
    };
  }, []);

  const PlayerContent = (isPortal: boolean) => (
    <div 
      className={cn(
        "relative group bg-black overflow-hidden flex items-center justify-center transition-all duration-500",
        isPortal ? "fixed inset-0 z-[200] w-screen h-screen" : className
      )}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      onDoubleClick={handleDoubleClick}
    >
      {/* Background Blur Layer for Letterboxing */}
      <video
        src={src}
        className={cn(
          "absolute inset-0 w-full h-full object-cover blur-2xl opacity-30 scale-110 pointer-events-none",
          isVoidArchitect && "grayscale"
        )}
        muted
        autoPlay
        loop
        playsInline
      />

      {/* Neural Scan Line (Thematic) */}
      <motion.div 
        initial={{ top: "-10%" }}
        animate={{ top: "110%" }}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
        className="absolute left-0 right-0 h-[2px] bg-accent/20 z-20 pointer-events-none shadow-[0_0_15px_rgba(255,0,0,0.5)]"
      />

      <video
        ref={videoRef}
        src={src}
        className={cn(
          "relative z-10 max-w-full max-h-full object-contain transition-all duration-500",
          isVoidArchitect && "grayscale contrast-125 shadow-[0_0_50px_rgba(255,255,255,0.1)]",
          isPortal && "scale-100"
        )}
        onTimeUpdate={updateProgress}
        onLoadedMetadata={handleLoadedMetadata}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => setIsLoading(false)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onClick={togglePlay}
        loop
        playsInline
      />

      {/* Loading Indicator */}
      <AnimatePresence>
        {isLoading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-12 h-12 text-accent animate-spin" />
              <span className="text-[10px] font-black text-white uppercase tracking-[0.3em] animate-pulse">Syncing Neural Data...</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Seek Indicators */}
      <AnimatePresence>
        {seekIndicator.side === 'left' && (
          <motion.div
            key={`seek-left-${seekIndicator.id}`}
            initial={{ opacity: 0, scale: 0.5, x: -50 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 1.5 }}
            className="absolute left-1/4 top-1/2 -translate-y-1/2 -translate-x-1/2 z-30 flex flex-col items-center justify-center pointer-events-none bg-black/40 rounded-full p-6 backdrop-blur-sm"
          >
            <Rewind className="w-12 h-12 text-white mb-2" />
            <span className="text-white font-bold text-lg">-10s</span>
          </motion.div>
        )}
        {seekIndicator.side === 'right' && (
          <motion.div
            key={`seek-right-${seekIndicator.id}`}
            initial={{ opacity: 0, scale: 0.5, x: 50 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 1.5 }}
            className="absolute right-1/4 top-1/2 -translate-y-1/2 translate-x-1/2 z-30 flex flex-col items-center justify-center pointer-events-none bg-black/40 rounded-full p-6 backdrop-blur-sm"
          >
            <FastForward className="w-12 h-12 text-white mb-2" />
            <span className="text-white font-bold text-lg">+10s</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Persistent Bottom Progress Bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10 z-30 overflow-hidden">
        <div 
          className={cn("h-full bg-accent transition-all duration-100", isVoidArchitect && "bg-white")}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Overlay Controls */}
      <AnimatePresence>
        {showControls && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-gradient-to-t from-black/90 via-transparent to-black/40 flex flex-col justify-between p-6"
          >
            {/* Top Bar */}
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
                <span className="text-[10px] font-black text-white uppercase tracking-[0.4em] italic opacity-70">
                  {isPortal ? "NEURAL EXPANSION ACTIVE" : "LOCAL MAINFRAME"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {isPipSupported && (
                  <button 
                    onClick={togglePip}
                    className={cn(
                      "p-2 bg-white/5 hover:bg-white/10 rounded-xl transition-all border border-white/5",
                      isPipActive ? "text-accent border-accent/20 bg-accent/5" : "text-white/70 hover:text-white"
                    )}
                    title="Neural Overlay (PiP)"
                  >
                    <MonitorPlay className="w-5 h-5" />
                  </button>
                )}
                <button 
                  onClick={toggleExpansion}
                  className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-white/70 hover:text-white transition-all border border-white/5"
                >
                  {isPortal ? <Minimize2 className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                </button>
                {isPortal && (
                  <button 
                    onClick={toggleExpansion}
                    className="p-2 bg-accent/10 hover:bg-accent/20 rounded-xl text-accent transition-all border border-accent/20"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>

            {/* Center Play Button */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <motion.button
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                whileTap={{ scale: 0.9 }}
                className="p-8 bg-accent/10 backdrop-blur-xl rounded-full border border-accent/30 text-white pointer-events-auto shadow-[0_0_40px_rgba(255,0,0,0.2)]"
                onClick={togglePlay}
              >
                {isPlaying ? <Pause className="w-10 h-10 fill-current" /> : <Play className="w-10 h-10 fill-current ml-1" />}
              </motion.button>
            </div>

            {/* Bottom Controls */}
            <div className="space-y-4 mb-4">
              {/* Interactive Scrubbing Bar */}
              <div 
                className="relative group/progress h-3 flex items-center"
                onMouseMove={handleSeekMouseMove}
                onMouseLeave={() => setHoverTime(null)}
              >
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="0.1"
                  value={progress}
                  onChange={handleProgressChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                />
                
                {/* Hover Time Tooltip */}
                <AnimatePresence>
                  {hoverTime !== null && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10, scale: 0.8 }}
                      animate={{ opacity: 1, y: -30, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.8 }}
                      className="absolute bg-accent text-white text-[10px] font-black px-2 py-1 rounded border border-white/20 pointer-events-none z-30 shadow-[0_0_15px_rgba(255,0,0,0.4)]"
                      style={{ left: `${hoverPosition}%`, transform: 'translateX(-50%)' }}
                    >
                      {formatTime(hoverTime)}
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden group-hover/progress:h-2.5 transition-all relative">
                  {/* Buffer Bar */}
                  <div 
                    className="absolute inset-y-0 left-0 bg-white/20 transition-all duration-300"
                    style={{ width: `${bufferProgress}%` }}
                  />
                  
                  {/* Progress Bar */}
                  <div 
                    className={cn("h-full bg-accent transition-all duration-100 relative z-10", isVoidArchitect && "bg-white")}
                    style={{ width: `${progress}%` }}
                  >
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,0.8)] scale-0 group-hover/progress:scale-100 transition-transform" />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <button 
                    onClick={togglePlay}
                    className="text-white hover:text-accent transition-colors"
                  >
                    {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                  </button>

                  <div className="flex items-center gap-3 group/volume">
                    <button 
                      onClick={toggleMute}
                      className="text-white hover:text-accent transition-colors"
                    >
                      {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      className="w-0 group-hover/volume:w-24 transition-all duration-500 h-1 bg-white/20 rounded-full accent-accent cursor-pointer"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-[10px] font-black text-white/50 uppercase tracking-[0.2em] italic">
                    {videoRef.current ? (
                      `${formatTime(videoRef.current.currentTime)} / ${formatTime(videoRef.current.duration)}`
                    ) : '0:00 / 0:00'}
                  </div>
                  <div className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[8px] font-black text-zinc-500 uppercase tracking-widest">
                    4K NEURAL STREAM
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <>
      {PlayerContent(false)}
      <AnimatePresence>
        {isExpanded && createPortal(
          <motion.div
            initial={{ opacity: 0, scale: 0.9, filter: "blur(20px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 1.1, filter: "blur(20px)" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-0 z-[200] bg-black"
          >
            {PlayerContent(true)}
          </motion.div>,
          document.body
        )}
      </AnimatePresence>
    </>
  );
};
