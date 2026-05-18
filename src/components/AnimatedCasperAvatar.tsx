import React, { useEffect, useRef } from 'react';
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
  
  // Use the Runway character avatar for all sizes
  const imageSrc = size === 'sm' || size === 'md' 
    ? '/casper-runway-128.png' 
    : '/casper-runway-256.png';

  // Determine colors based on instability/mood
  const getGlowColor = () => {
    if (instability > 80) return 'rgba(255, 60, 60, 0.7)'; // Critical - Red
    if (instability > 50) return 'rgba(200, 100, 255, 0.6)'; // Elevated - Purple
    return 'rgba(100, 200, 255, 0.5)'; // Stable - Cyan/Blue
  };
  
  const glowColor = getGlowColor();
  const shadowIntensity = isActive ? '30px' : '15px';
  const animationDuration = isActive ? 2 : 4;

  // Particle canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    if (!showParticles || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let animationFrameId: number;
    let particles: {x: number, y: number, size: number, speedY: number, speedX: number, life: number, maxLife: number}[] = [];
    
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth * 1.5; // Make canvas slightly larger than avatar
        canvas.height = parent.clientHeight * 1.5;
      }
    };
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    const createParticle = () => {
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const radius = Math.min(canvas.width, canvas.height) * 0.35;
      
      // Random position around the edge of the circle
      const angle = Math.random() * Math.PI * 2;
      const distance = radius + (Math.random() * 10 - 5);
      
      return {
        x: centerX + Math.cos(angle) * distance,
        y: centerY + Math.sin(angle) * distance,
        size: Math.random() * 2 + 0.5,
        speedY: (Math.random() - 0.8) * (isActive ? 1.5 : 0.5), // Mostly floating up
        speedX: (Math.random() - 0.5) * (isActive ? 1 : 0.3),
        life: 0,
        maxLife: Math.random() * 60 + 40
      };
    };
    
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Add new particles
      const targetParticles = isActive ? 30 : 10;
      if (particles.length < targetParticles && Math.random() < 0.3) {
        particles.push(createParticle());
      }
      
      // Update and draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life++;
        
        if (p.life >= p.maxLife) {
          particles.splice(i, 1);
          continue;
        }
        
        p.x += p.speedX;
        p.y += p.speedY;
        
        // Fade in and out
        let alpha = 1;
        if (p.life < 10) alpha = p.life / 10;
        else if (p.life > p.maxLife - 20) alpha = (p.maxLife - p.life) / 20;
        
        // Use color based on instability
        const [r, g, b] = glowColor.match(/\d+/g) || ['100', '200', '255'];
        
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.8})`;
        ctx.fill();
        
        // Add subtle glow to particles
        ctx.shadowBlur = 5;
        ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 1)`;
      }
      
      animationFrameId = requestAnimationFrame(render);
    };
    
    render();
    
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, [isActive, instability, glowColor, showParticles]);

  return (
    <div className={cn("relative flex items-center justify-center", sizes[size], className)}>
      {/* Particle Canvas */}
      {showParticles && (
        <canvas 
          ref={canvasRef} 
          className="absolute pointer-events-none z-0"
          style={{ 
            width: '150%', 
            height: '150%',
            top: '-25%',
            left: '-25%'
          }}
        />
      )}
      
      {/* Main Avatar Container */}
      <motion.div
        animate={isActive 
          ? { y: [0, -4, 0], scale: [1, 1.02, 1] } 
          : { y: [0, -2, 0] }
        }
        transition={{ 
          duration: animationDuration, 
          repeat: Infinity, 
          ease: 'easeInOut' 
        }}
        className={cn("relative w-full h-full rounded-full z-10")}
      >
        {/* Outer Glow Ring */}
        <motion.div
          className="absolute inset-0 rounded-full z-0"
          animate={{ 
            boxShadow: [
              `0 0 ${isActive ? '15px' : '5px'} ${glowColor}`,
              `0 0 ${shadowIntensity} ${glowColor}`,
              `0 0 ${isActive ? '15px' : '5px'} ${glowColor}`
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
              filter: isActive ? 'brightness(1.2) contrast(1.1)' : 'brightness(1) contrast(1)'
            }}
          />
          
          {/* Scanline overlay for digital effect */}
          <div 
            className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-30"
            style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.8) 2px, rgba(0,0,0,0.8) 4px)'
            }}
          />
          
          {/* Pulse overlay when active */}
          {isActive && (
            <motion.div 
              className="absolute inset-0 pointer-events-none mix-blend-screen"
              animate={{ opacity: [0, 0.3, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              style={{ background: `radial-gradient(circle at center, ${glowColor} 0%, transparent 70%)` }}
            />
          )}
          
          {/* Speaking mouth glow — pulses at bottom of avatar when speaking */}
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
