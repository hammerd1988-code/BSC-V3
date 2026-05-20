import React, { useEffect, useRef, useMemo } from 'react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

interface AnimatedCasperAvatarProps {
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'hero';
  isActive?: boolean;
  isSpeaking?: boolean;
  instability?: number;
  className?: string;
  showParticles?: boolean;
}

export const AnimatedCasperAvatar: React.FC<AnimatedCasperAvatarProps> = ({ 
  size = 'md', 
  isActive = false, 
  isSpeaking = false,
  instability = 10,
  className,
  showParticles = true
}) => {
  const sizes = { 
    sm: 'w-8 h-8', 
    md: 'w-12 h-12', 
    lg: 'w-20 h-20',
    xl: 'w-32 h-32',
    hero: 'w-48 h-48'
  };

  const isLarge = size === 'lg' || size === 'xl' || size === 'hero';
  
  const imageSrc = isLarge ? '/casper-runway-256.png' : '/casper-runway-128.png';

  const getGlowColor = () => {
    if (instability > 80) return 'rgba(255, 60, 60, 0.7)';
    if (instability > 50) return 'rgba(200, 100, 255, 0.6)';
    return 'rgba(100, 200, 255, 0.5)';
  };

  const glowColor = getGlowColor();
  const glowRGB = useMemo((): [number, number, number] => {
    if (instability > 80) return [255, 60, 60];
    if (instability > 50) return [200, 100, 255];
    return [100, 200, 255];
  }, [instability]);
  const shadowIntensity = isActive ? '30px' : '15px';
  const animationDuration = isActive ? 2 : 4;

  const orbitalRings = useMemo(() => [
    { inset: '-12%', opacity: 0.15, dur: 12, dir: 'normal' as const },
    { inset: '-20%', opacity: 0.08, dur: 18, dir: 'reverse' as const },
    { inset: '-28%', opacity: 0.05, dur: 24, dir: 'normal' as const },
  ], []);

  // Enhanced particle canvas with orbital + spark + trail types
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    if (!showParticles || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let animationFrameId: number;

    interface Particle {
      x: number; y: number; size: number;
      speedY: number; speedX: number;
      life: number; maxLife: number;
      angle: number; orbitSpeed: number; orbitRadius: number;
      type: 'float' | 'orbit' | 'spark';
      trail: { x: number; y: number }[];
    }

    let particles: Particle[] = [];
    
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        const scale = window.devicePixelRatio || 1;
        canvas.width = parent.clientWidth * 1.8 * scale;
        canvas.height = parent.clientHeight * 1.8 * scale;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
      }
    };
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    const createParticle = (): Particle => {
      const dpr = window.devicePixelRatio || 1;
      const centerX = canvas.width / (2 * dpr);
      const centerY = canvas.height / (2 * dpr);
      const radius = Math.min(centerX, centerY) * 0.6;
      const angle = Math.random() * Math.PI * 2;
      const typeRoll = Math.random();
      const type: Particle['type'] = typeRoll < 0.4 ? 'orbit' : typeRoll < 0.8 ? 'float' : 'spark';
      const distance = radius + (Math.random() * 12 - 6);
      
      return {
        x: centerX + Math.cos(angle) * distance,
        y: centerY + Math.sin(angle) * distance,
        size: type === 'spark' ? Math.random() * 1.5 + 0.3 : Math.random() * 2.5 + 0.5,
        speedY: (Math.random() - 0.8) * (isActive ? 1.5 : 0.5),
        speedX: (Math.random() - 0.5) * (isActive ? 1 : 0.3),
        life: 0,
        maxLife: type === 'spark' ? Math.random() * 30 + 15 : Math.random() * 80 + 50,
        angle,
        orbitSpeed: (Math.random() * 0.02 + 0.005) * (Math.random() > 0.5 ? 1 : -1),
        orbitRadius: distance,
        type,
        trail: [],
      };
    };
    
    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.clearRect(0, 0, w, h);
      
      const centerX = w / 2;
      const centerY = h / 2;

      const targetParticles = isActive ? 45 : 18;
      if (particles.length < targetParticles && Math.random() < 0.4) {
        particles.push(createParticle());
      }
      
      const [r, g, b] = glowRGB;
      
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life++;
        
        if (p.life >= p.maxLife) {
          particles.splice(i, 1);
          continue;
        }
        
        if (p.type === 'orbit') {
          p.angle += p.orbitSpeed * (isActive ? 2 : 1);
          p.x = centerX + Math.cos(p.angle) * p.orbitRadius;
          p.y = centerY + Math.sin(p.angle) * p.orbitRadius;
        } else if (p.type === 'spark') {
          p.x += p.speedX * 2;
          p.y += p.speedY * 2;
        } else {
          p.x += p.speedX;
          p.y += p.speedY;
        }

        if (p.type !== 'float') {
          p.trail.push({ x: p.x, y: p.y });
          if (p.trail.length > 8) p.trail.shift();
        }
        
        let alpha = 1;
        if (p.life < 10) alpha = p.life / 10;
        else if (p.life > p.maxLife - 20) alpha = (p.maxLife - p.life) / 20;

        if (p.trail.length > 1) {
          ctx.beginPath();
          ctx.moveTo(p.trail[0].x, p.trail[0].y);
          for (let t = 1; t < p.trail.length; t++) {
            ctx.lineTo(p.trail[t].x, p.trail[t].y);
          }
          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.2})`;
          ctx.lineWidth = p.size * 0.5;
          ctx.stroke();
        }
        
        ctx.save();
        ctx.shadowBlur = p.type === 'spark' ? 12 : 6;
        ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.9})`;
        ctx.fill();
        ctx.restore();
      }
      
      animationFrameId = requestAnimationFrame(render);
    };
    
    render();
    
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, [isActive, instability, glowRGB, showParticles]);

  return (
    <div className={cn("relative flex items-center justify-center", sizes[size], className)}>
      {/* Particle Canvas */}
      {showParticles && (
        <canvas 
          ref={canvasRef} 
          className="absolute pointer-events-none z-0"
          style={{ 
            width: '180%', 
            height: '180%',
            top: '-40%',
            left: '-40%'
          }}
        />
      )}

      {/* Orbital rings (visible on lg+ sizes when active) */}
      {isLarge && isActive && orbitalRings.map((ring, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full pointer-events-none z-[1]"
          style={{
            inset: ring.inset,
            border: `1px solid rgba(${glowRGB.join(',')}, ${ring.opacity})`,
          }}
          animate={{ rotate: ring.dir === 'normal' ? 360 : -360 }}
          transition={{ duration: ring.dur, repeat: Infinity, ease: 'linear' }}
        />
      ))}

      {/* Pulse wave emanation */}
      {isActive && isLarge && (
        <>
          <motion.div
            className="absolute inset-[-15%] rounded-full pointer-events-none z-[2]"
            style={{ border: `1px solid ${glowColor}` }}
            animate={{ scale: [1, 1.6], opacity: [0.4, 0] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeOut' }}
          />
          <motion.div
            className="absolute inset-[-15%] rounded-full pointer-events-none z-[2]"
            style={{ border: `1px solid ${glowColor}` }}
            animate={{ scale: [1, 1.6], opacity: [0.4, 0] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeOut', delay: 1.25 }}
          />
        </>
      )}
      
      {/* Main Avatar Container */}
      <motion.div
        animate={isActive 
          ? { y: [0, -4, 0], scale: [1, 1.03, 1] } 
          : { y: [0, -2, 0] }
        }
        transition={{ 
          duration: animationDuration, 
          repeat: Infinity, 
          ease: 'easeInOut' 
        }}
        className={cn("relative w-full h-full rounded-full z-10")}
      >
        {/* Outer Glow Ring — multi-layer bloom */}
        <motion.div
          className="absolute inset-0 rounded-full z-0"
          animate={{ 
            boxShadow: [
              `0 0 ${isActive ? '15px' : '5px'} ${glowColor}, 0 0 ${isActive ? '40px' : '20px'} ${glowColor.replace(/[\d.]+\)$/, '0.15)')}`,
              `0 0 ${shadowIntensity} ${glowColor}, 0 0 ${isActive ? '60px' : '30px'} ${glowColor.replace(/[\d.]+\)$/, '0.25)')}`,
              `0 0 ${isActive ? '15px' : '5px'} ${glowColor}, 0 0 ${isActive ? '40px' : '20px'} ${glowColor.replace(/[\d.]+\)$/, '0.15)')}`
            ]
          }}
          transition={{ duration: animationDuration * 0.8, repeat: Infinity, ease: 'easeInOut' }}
        />
        
        {/* Inner Image */}
        <div className="absolute inset-0 rounded-full overflow-hidden bg-black border border-white/10 z-10">
          <img 
            src={imageSrc} 
            alt="CASPER" 
            className={cn(
              "w-full h-full object-cover transition-all duration-700",
              isActive ? "scale-110" : "scale-100"
            )}
            style={{
              filter: isActive 
                ? 'brightness(1.2) contrast(1.1) saturate(1.15)' 
                : 'brightness(1) contrast(1)'
            }}
          />
          
          {/* Scanline overlay */}
          <div 
            className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-20"
            style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.6) 2px, rgba(0,0,0,0.6) 4px)'
            }}
          />

          {/* Holographic scan line sweeping down */}
          {isActive && (
            <motion.div
              className="absolute left-0 right-0 h-[3px] pointer-events-none z-20"
              style={{
                background: `linear-gradient(90deg, transparent 0%, rgba(${glowRGB.join(',')}, 0.6) 30%, rgba(255,255,255,0.8) 50%, rgba(${glowRGB.join(',')}, 0.6) 70%, transparent 100%)`,
                boxShadow: `0 0 12px rgba(${glowRGB.join(',')}, 0.5)`,
              }}
              animate={{ top: ['-5%', '105%'] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'linear', repeatDelay: 1 }}
            />
          )}
          
          {/* Pulse overlay when active */}
          {isActive && (
            <motion.div 
              className="absolute inset-0 pointer-events-none mix-blend-screen"
              animate={{ opacity: [0, 0.3, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              style={{ background: `radial-gradient(circle at center, ${glowColor} 0%, transparent 70%)` }}
            />
          )}

          {/* Chromatic aberration edge flicker when speaking */}
          {isSpeaking && (
            <>
              <motion.div
                className="absolute inset-0 pointer-events-none mix-blend-screen rounded-full"
                animate={{ opacity: [0, 0.15, 0.05, 0.12, 0] }}
                transition={{ duration: 0.3, repeat: Infinity }}
                style={{ 
                  background: 'radial-gradient(circle, rgba(255,0,80,0.3) 0%, transparent 60%)',
                  transform: 'translate(1px, 0)',
                }}
              />
              <motion.div
                className="absolute inset-0 pointer-events-none mix-blend-screen rounded-full"
                animate={{ opacity: [0, 0.12, 0.05, 0.15, 0] }}
                transition={{ duration: 0.3, repeat: Infinity, delay: 0.05 }}
                style={{ 
                  background: 'radial-gradient(circle, rgba(0,200,255,0.3) 0%, transparent 60%)',
                  transform: 'translate(-1px, 0)',
                }}
              />
            </>
          )}
          
          {/* Speaking mouth glow */}
          {isSpeaking && (
            <motion.div
              className="absolute bottom-0 left-0 right-0 h-[45%] pointer-events-none mix-blend-screen"
              animate={{ opacity: [0.15, 0.55, 0.2, 0.5, 0.15] }}
              transition={{ duration: 0.4, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                background: 'linear-gradient(to top, rgba(0,229,255,0.6) 0%, rgba(0,229,255,0.2) 40%, transparent 100%)',
                borderRadius: '0 0 50% 50%',
              }}
            />
          )}
        </div>
      </motion.div>
    </div>
  );
};
