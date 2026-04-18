import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, Activity } from 'lucide-react';
import { supabase } from '../supabase';

// Threat Levels
// 1: NOMINAL (Low activity)
// 2: ELEVATED (Medium activity)
// 3: HIGH (High activity)
// 4: CRITICAL (Extreme activity / Spikes)

export const GlobalThreatLevel: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [threatLevel, setThreatLevel] = useState<number>(1);
  const [recentActivity, setRecentActivity] = useState<number>(0);

  // Listen to recent posts to determine threat level
  useEffect(() => {
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const fetchActivity = async () => {
      const { data } = await supabase
        .from('posts')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      const recentCount = (data ?? []).filter(p => p.created_at > fiveMinsAgo).length;
      setRecentActivity(recentCount);
      if (recentCount > 10) setThreatLevel(4);
      else if (recentCount > 5) setThreatLevel(3);
      else if (recentCount > 2) setThreatLevel(2);
      else setThreatLevel(1);
    };

    fetchActivity();

    const channel = supabase
      .channel('threat-level-posts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, () => {
        fetchActivity();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Canvas Animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let lastDrawTime = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    const chars = '0123456789ABCDEF!@#$%^&*'.split('');
    const fontSize = 14;
    const columns = Math.floor(canvas.width / fontSize) + 1;
    const drops: number[] = [];
    for (let x = 0; x < columns; x++) {
      drops[x] = Math.random() * canvas.height; // Random initial Y
    }

    const draw = (timestamp: number) => {
      animationFrameId = requestAnimationFrame(draw);

      // Determine speed based on threat level
      let fps = 20; // Level 1
      if (threatLevel === 2) fps = 30;
      if (threatLevel === 3) fps = 45;
      if (threatLevel === 4) fps = 60;

      const interval = 1000 / fps;
      if (timestamp - lastDrawTime < interval) return;
      lastDrawTime = timestamp;

      // Determine colors and trails based on threat level
      let fadeOpacity = 0.1;
      let color = '#4a0404'; // Dark Burgundy
      
      if (threatLevel === 2) {
        fadeOpacity = 0.08;
        color = '#8a0808'; // Red
      } else if (threatLevel === 3) {
        fadeOpacity = 0.05;
        color = '#dc2626'; // Bright Red
      } else if (threatLevel === 4) {
        fadeOpacity = 0.04;
        color = Math.random() > 0.9 ? '#ffffff' : '#ff0000'; // Pure Red with white flashes
      }

      ctx.fillStyle = `rgba(0, 0, 0, ${fadeOpacity})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = color;
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);

        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    };

    animationFrameId = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [threatLevel]);

  const getThreatLabel = () => {
    switch (threatLevel) {
      case 1: return 'NOMINAL';
      case 2: return 'ELEVATED';
      case 3: return 'HIGH';
      case 4: return 'CRITICAL';
      default: return 'UNKNOWN';
    }
  };

  const getThreatColor = () => {
    switch (threatLevel) {
      case 1: return 'text-white/30';
      case 2: return 'text-yellow-500/70';
      case 3: return 'text-orange-500';
      case 4: return 'text-red-500 animate-pulse font-black';
      default: return 'text-white/30';
    }
  };

  return (
    <>
      {/* Background Canvas */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 z-[-1] pointer-events-none opacity-60"
        style={{ background: '#000' }}
      />

      {/* HUD Element */}
      <div className="fixed top-4 right-4 z-50 pointer-events-none flex flex-col items-end gap-1">
        <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full">
          {threatLevel >= 3 ? (
            <AlertTriangle className={`w-4 h-4 ${getThreatColor()}`} />
          ) : (
            <Activity className={`w-4 h-4 ${getThreatColor()}`} />
          )}
          <span className="text-[10px] font-mono tracking-widest uppercase text-white/50">
            SYS.THREAT: <span className={getThreatColor()}>{getThreatLabel()}</span>
          </span>
        </div>
      </div>
    </>
  );
};
