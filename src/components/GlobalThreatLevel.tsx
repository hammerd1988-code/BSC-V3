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

    // Mixed character sets: hex, katakana fragments, symbols
    const hexChars = '0123456789ABCDEF'.split('');
    const katakana = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン'.split('');
    const symbols = '!@#$%^&*<>{}[]|/\\'.split('');

    const fontSize = 14;
    const columns = Math.floor(canvas.width / fontSize) + 1;

    // Per-column state for depth variation
    const drops: number[] = [];
    const columnSpeed: number[] = [];
    const columnSize: number[] = [];
    const columnBrightness: number[] = [];
    const columnCharSet: number[] = []; // 0=hex, 1=katakana, 2=symbols
    for (let x = 0; x < columns; x++) {
      drops[x] = Math.random() * canvas.height;
      columnSpeed[x] = 0.6 + Math.random() * 0.8;
      columnSize[x] = fontSize * (0.7 + Math.random() * 0.6);
      columnBrightness[x] = 0.4 + Math.random() * 0.6;
      columnCharSet[x] = Math.floor(Math.random() * 3);
    }

    const draw = (timestamp: number) => {
      animationFrameId = requestAnimationFrame(draw);

      let fps = 20;
      if (threatLevel === 2) fps = 30;
      if (threatLevel === 3) fps = 45;
      if (threatLevel === 4) fps = 60;

      const interval = 1000 / fps;
      if (timestamp - lastDrawTime < interval) return;
      lastDrawTime = timestamp;

      let fadeOpacity = 0.1;
      let baseR = 74, baseG = 4, baseB = 4; // Dark burgundy RGB
      
      if (threatLevel === 2) {
        fadeOpacity = 0.08;
        baseR = 138; baseG = 8; baseB = 8;
      } else if (threatLevel === 3) {
        fadeOpacity = 0.05;
        baseR = 220; baseG = 38; baseB = 38;
      } else if (threatLevel === 4) {
        fadeOpacity = 0.035;
        baseR = 255; baseG = 0; baseB = 0;
      }

      ctx.fillStyle = `rgba(0, 0, 0, ${fadeOpacity})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < drops.length; i++) {
        const bright = columnBrightness[i];
        const sz = columnSize[i];
        const charSet = columnCharSet[i] === 0 ? hexChars : columnCharSet[i] === 1 ? katakana : symbols;
        const text = charSet[Math.floor(Math.random() * charSet.length)];
        const yPos = drops[i] * fontSize;

        // Lead character is brighter (phosphor head glow)
        const isHead = Math.random() < 0.15;
        let r = baseR, g = baseG, b = baseB;
        let alpha = bright;

        if (threatLevel === 4 && Math.random() > 0.88) {
          r = 255; g = 255; b = 255; alpha = 1;
        } else if (isHead) {
          r = Math.min(255, baseR + 80);
          g = Math.min(255, baseG + 60);
          b = Math.min(255, baseB + 40);
          alpha = Math.min(1, bright + 0.3);
        }

        ctx.font = `${sz}px monospace`;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;

        if (isHead && threatLevel >= 2) {
          ctx.shadowBlur = 8 + threatLevel * 3;
          ctx.shadowColor = `rgba(${baseR}, ${baseG + 20}, ${baseB}, 0.8)`;
        } else {
          ctx.shadowBlur = 0;
        }

        ctx.fillText(text, i * fontSize, yPos);

        if (yPos > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
          columnSpeed[i] = 0.6 + Math.random() * 0.8;
          columnBrightness[i] = 0.4 + Math.random() * 0.6;
          columnCharSet[i] = Math.floor(Math.random() * 3);
        }
        drops[i] += columnSpeed[i];
      }

      ctx.shadowBlur = 0;
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
