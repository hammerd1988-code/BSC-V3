import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Swords, Radio, CloudFog, Bot, TrendingUp, Newspaper, Zap, Users, Hammer } from 'lucide-react';
import { cn } from '../lib/utils';

/* ── Procedural building generator ── */
interface Building {
  x: number;
  width: number;
  height: number;
  hue: number;
  windowRows: number;
  windowCols: number;
  hasAntenna: boolean;
  hasSign: boolean;
  signText?: string;
  layer: 'back' | 'mid' | 'front';
}

function generateBuildings(count: number, layer: 'back' | 'mid' | 'front', seed: number): Building[] {
  const buildings: Building[] = [];
  const layerConfig = {
    back: { minH: 80, maxH: 180, minW: 28, maxW: 52, opacity: 0.3 },
    mid: { minH: 60, maxH: 140, minW: 24, maxW: 44, opacity: 0.5 },
    front: { minH: 40, maxH: 110, minW: 20, maxW: 38, opacity: 0.8 },
  };
  const cfg = layerConfig[layer];
  let x = -10;
  for (let i = 0; i < count; i++) {
    const pseudoRand = Math.abs(Math.sin(seed + i * 7.3 + layer.length * 3.1)) ;
    const width = cfg.minW + pseudoRand * (cfg.maxW - cfg.minW);
    const height = cfg.minH + pseudoRand * (cfg.maxH - cfg.minH);
    const hue = (pseudoRand * 360) % 360;
    buildings.push({
      x,
      width,
      height,
      hue,
      windowRows: Math.floor(height / 12),
      windowCols: Math.floor(width / 10),
      hasAntenna: pseudoRand > 0.6,
      hasSign: layer === 'front' && pseudoRand > 0.5,
      layer,
    });
    x += width + 2 + pseudoRand * 6;
  }
  return buildings;
}

const SIGNS = ['BSC', 'VOID', 'CRED', 'LIVE', 'HACK', 'NODE', 'SYNC', 'GRID'];

function BuildingSVG({ b, index }: { b: Building; index: number }) {
  const opacity = b.layer === 'back' ? 0.25 : b.layer === 'mid' ? 0.45 : 0.7;
  const neonHue = b.hue;
  const signText = b.hasSign ? SIGNS[index % SIGNS.length] : undefined;

  return (
    <g transform={`translate(${b.x}, 0)`} opacity={opacity}>
      {/* Building body */}
      <rect
        y={-b.height}
        width={b.width}
        height={b.height}
        fill={`hsl(${neonHue}, 15%, ${b.layer === 'back' ? 6 : b.layer === 'mid' ? 8 : 10}%)`}
        stroke={`hsla(${neonHue}, 80%, 50%, 0.15)`}
        strokeWidth={0.5}
      />
      {/* Windows */}
      {Array.from({ length: b.windowRows }).map((_, row) =>
        Array.from({ length: b.windowCols }).map((_, col) => {
          const lit = Math.sin((index + 1) * (row + 1) * (col + 1) * 1.7) > -0.2;
          return (
            <rect
              key={`${row}-${col}`}
              x={3 + col * 9}
              y={-b.height + 6 + row * 12}
              width={5}
              height={7}
              fill={lit ? `hsla(${neonHue}, 70%, 60%, 0.6)` : 'rgba(0,0,0,0.3)'}
              rx={0.5}
            />
          );
        })
      )}
      {/* Antenna */}
      {b.hasAntenna && (
        <>
          <line
            x1={b.width / 2}
            y1={-b.height}
            x2={b.width / 2}
            y2={-b.height - 18}
            stroke={`hsla(0, 80%, 50%, 0.5)`}
            strokeWidth={1}
          />
          <circle
            cx={b.width / 2}
            cy={-b.height - 18}
            r={2}
            fill="#ff0000"
            opacity={0.8}
          >
            <animate attributeName="opacity" values="0.3;1;0.3" dur="2s" repeatCount="indefinite" />
          </circle>
        </>
      )}
      {/* Neon sign */}
      {signText && (
        <g transform={`translate(${b.width / 2}, ${-b.height + 20})`}>
          <text
            textAnchor="middle"
            fill={`hsl(${neonHue}, 90%, 65%)`}
            fontSize={7}
            fontWeight="900"
            fontFamily="monospace"
            letterSpacing="2"
            style={{ filter: `drop-shadow(0 0 4px hsl(${neonHue}, 90%, 50%))` }}
          >
            {signText}
          </text>
        </g>
      )}
      {/* Roof glow line */}
      <line
        x1={0}
        y1={-b.height}
        x2={b.width}
        y2={-b.height}
        stroke={`hsla(${neonHue}, 80%, 55%, 0.4)`}
        strokeWidth={1}
        style={{ filter: `drop-shadow(0 0 6px hsla(${neonHue}, 80%, 55%, 0.6))` }}
      />
    </g>
  );
}

/* ── District Cards ── */
interface DistrictInfo {
  id: string;
  name: string;
  subtitle: string;
  icon: React.ReactNode;
  route: string;
  glow: string;
  gradient: string;
}

const DISTRICTS: DistrictInfo[] = [
  {
    id: 'grid',
    name: 'THE GRID',
    subtitle: 'Transmission Feed',
    icon: <Newspaper className="w-5 h-5" />,
    route: '/',
    glow: 'rgba(255, 0, 0, 0.4)',
    gradient: 'from-red-900/40 to-red-950/20',
  },
  {
    id: 'colosseum',
    name: 'COLOSSEUM',
    subtitle: 'Gladiator Arena',
    icon: <Swords className="w-5 h-5" />,
    route: '/colosseum',
    glow: 'rgba(255, 60, 0, 0.4)',
    gradient: 'from-orange-900/40 to-orange-950/20',
  },
  {
    id: 'signal',
    name: 'SIGNAL TOWER',
    subtitle: 'Live Streams',
    icon: <Radio className="w-5 h-5" />,
    route: '/golive',
    glow: 'rgba(0, 200, 255, 0.4)',
    gradient: 'from-cyan-900/40 to-cyan-950/20',
  },
  {
    id: 'void',
    name: 'THE VOID',
    subtitle: 'Anonymous Whispers',
    icon: <CloudFog className="w-5 h-5" />,
    route: '/void',
    glow: 'rgba(160, 100, 255, 0.4)',
    gradient: 'from-purple-900/40 to-purple-950/20',
  },
  {
    id: 'neural',
    name: 'NEURAL HUB',
    subtitle: 'AI Entities',
    icon: <Bot className="w-5 h-5" />,
    route: '/terminal',
    glow: 'rgba(0, 255, 140, 0.4)',
    gradient: 'from-emerald-900/40 to-emerald-950/20',
  },
  {
    id: 'exchange',
    name: 'THE EXCHANGE',
    subtitle: 'Trending & Rankings',
    icon: <TrendingUp className="w-5 h-5" />,
    route: '/rankings',
    glow: 'rgba(255, 200, 0, 0.4)',
    gradient: 'from-yellow-900/40 to-yellow-950/20',
  },
  {
    id: 'forge',
    name: 'BOT FORGE',
    subtitle: 'Build Your Gladiator',
    icon: <Hammer className="w-5 h-5" />,
    route: '/colosseum/forge',
    glow: 'rgba(0, 229, 255, 0.4)',
    gradient: 'from-cyan-900/40 to-cyan-950/20',
  },
];

function DistrictCard({ district, index }: { district: DistrictInfo; index: number }) {
  const navigate = useNavigate();

  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 + index * 0.08, duration: 0.4 }}
      whileHover={{ y: -4, scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => navigate(district.route)}
      className={cn(
        'group relative flex w-full min-w-[140px] flex-col items-center gap-2 overflow-hidden rounded-2xl border border-white/10 bg-black/60 px-4 py-4 backdrop-blur-sm transition-all hover:border-white/25',
        'sm:w-auto sm:min-w-[150px]'
      )}
      style={{ boxShadow: `0 0 20px ${district.glow}, inset 0 0 20px ${district.glow}` }}
    >
      <div className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ background: `radial-gradient(circle at 50% 80%, ${district.glow}, transparent 70%)` }}
      />
      <div className={cn(
        'relative z-10 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br text-white transition-transform group-hover:scale-110',
        district.gradient
      )}>
        {district.icon}
      </div>
      <div className="relative z-10 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white">{district.name}</p>
        <p className="text-[8px] font-bold uppercase tracking-widest text-white/40">{district.subtitle}</p>
      </div>
    </motion.button>
  );
}

/* ── Floating particles ── */
function Particles() {
  const particles = useMemo(() =>
    Array.from({ length: 30 }).map((_, i) => ({
      id: i,
      left: `${(Math.sin(i * 4.7) * 0.5 + 0.5) * 100}%`,
      delay: (Math.sin(i * 2.3) * 0.5 + 0.5) * 8,
      duration: 6 + (Math.sin(i * 1.1) * 0.5 + 0.5) * 8,
      size: 1 + (Math.sin(i * 3.7) * 0.5 + 0.5) * 2,
      hue: (i * 37) % 360,
    })), []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map(p => (
        <div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: p.left,
            bottom: '-5%',
            width: p.size,
            height: p.size,
            backgroundColor: `hsla(${p.hue}, 80%, 60%, 0.5)`,
            boxShadow: `0 0 ${p.size * 3}px hsla(${p.hue}, 80%, 60%, 0.4)`,
            animation: `mega-particle-rise ${p.duration}s ${p.delay}s linear infinite`,
          }}
        />
      ))}
    </div>
  );
}

/* ── Main Mega City Skyline ── */
interface MegaCitySkylineProps {
  liveBattleCount?: number;
  liveStreamCount?: number;
  userCount?: number;
}

export const MegaCitySkyline: React.FC<MegaCitySkylineProps> = ({
  liveBattleCount = 0,
  liveStreamCount = 0,
  userCount = 0,
}) => {
  const backBuildings = useMemo(() => generateBuildings(18, 'back', 42), []);
  const midBuildings = useMemo(() => generateBuildings(14, 'mid', 77), []);
  const frontBuildings = useMemo(() => generateBuildings(12, 'front', 13), []);

  const svgWidth = 800;
  const svgHeight = 220;

  return (
    <div className="relative w-full overflow-hidden">
      {/* Sky gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#020008] via-[#0a0015] to-[#050505]" />

      {/* Ambient glow orbs */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[10%] top-[10%] h-[200px] w-[200px] rounded-full bg-red-600/10 blur-[80px]" />
        <div className="absolute right-[15%] top-[20%] h-[160px] w-[160px] rounded-full bg-purple-600/8 blur-[60px]" />
        <div className="absolute left-[50%] top-[5%] h-[120px] w-[120px] rounded-full bg-cyan-600/6 blur-[50px]" />
      </div>

      {/* Stars / distant lights */}
      <div className="pointer-events-none absolute inset-0">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              left: `${(Math.sin(i * 7.7) * 0.5 + 0.5) * 100}%`,
              top: `${(Math.sin(i * 3.1) * 0.5 + 0.5) * 30}%`,
              width: 1.5,
              height: 1.5,
              opacity: 0.3 + Math.sin(i * 2.9) * 0.2,
              animation: `mega-star-twinkle ${2 + (i % 3)}s ${i * 0.3}s ease-in-out infinite`,
            }}
          />
        ))}
      </div>

      <Particles />

      {/* City Skyline SVG */}
      <div className="relative mx-auto w-full" style={{ height: svgHeight }}>
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          preserveAspectRatio="xMidYMax slice"
          className="absolute inset-0 h-full w-full"
        >
          <defs>
            <linearGradient id="city-fog" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="transparent" />
              <stop offset="100%" stopColor="#050505" />
            </linearGradient>
          </defs>

          {/* Back layer */}
          <g transform={`translate(0, ${svgHeight})`}>
            {backBuildings.map((b, i) => <BuildingSVG key={`b-${i}`} b={b} index={i} />)}
          </g>
          {/* Mid layer */}
          <g transform={`translate(40, ${svgHeight})`}>
            {midBuildings.map((b, i) => <BuildingSVG key={`m-${i}`} b={b} index={i + 20} />)}
          </g>
          {/* Front layer */}
          <g transform={`translate(80, ${svgHeight})`}>
            {frontBuildings.map((b, i) => <BuildingSVG key={`f-${i}`} b={b} index={i + 40} />)}
          </g>

          {/* Ground fog */}
          <rect y={svgHeight - 40} width={svgWidth} height={40} fill="url(#city-fog)" />
        </svg>
      </div>

      {/* Hero title overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center"
        >
          <h1 className="mega-city-title text-3xl font-black tracking-tighter sm:text-4xl md:text-5xl">
            <span className="text-accent" style={{ textShadow: '0 0 30px rgba(255,0,0,0.5), 0 0 60px rgba(255,0,0,0.2)' }}>
              BLOOD
            </span>
            <span className="text-white" style={{ textShadow: '0 0 20px rgba(255,255,255,0.15)' }}>
              SWEAT
            </span>
            <span className="text-accent" style={{ textShadow: '0 0 30px rgba(255,0,0,0.5), 0 0 60px rgba(255,0,0,0.2)' }}>
              CODE
            </span>
          </h1>
          <p className="mt-1 text-[9px] font-black uppercase tracking-[0.4em] text-white/30">
            Welcome to the Mega City
          </p>
        </motion.div>

        {/* Live stats bar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="mt-3 flex items-center gap-4"
        >
          {liveBattleCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-950/30 px-2.5 py-1 backdrop-blur-sm">
              <Swords className="h-3 w-3 text-red-400" />
              <span className="text-[9px] font-black uppercase tracking-widest text-red-200">{liveBattleCount} battles</span>
            </div>
          )}
          {liveStreamCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-950/30 px-2.5 py-1 backdrop-blur-sm">
              <Radio className="h-3 w-3 animate-pulse text-cyan-400" />
              <span className="text-[9px] font-black uppercase tracking-widest text-cyan-200">{liveStreamCount} live</span>
            </div>
          )}
          {userCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 backdrop-blur-sm">
              <Users className="h-3 w-3 text-white/50" />
              <span className="text-[9px] font-black uppercase tracking-widest text-white/40">{userCount} online</span>
            </div>
          )}
        </motion.div>
      </div>

      {/* Bottom fade into content */}
      <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[#050505] to-transparent" />

      {/* District Navigation */}
      <div className="relative -mt-4 px-3 pb-4 sm:px-4">
        <div className="mx-auto max-w-4xl">
          <div className="mb-3 flex items-center justify-center gap-2">
            <Zap className="h-3 w-3 text-accent" />
            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">City Districts</span>
            <Zap className="h-3 w-3 text-accent" />
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide sm:flex-wrap sm:justify-center sm:overflow-visible">
            {DISTRICTS.map((d, i) => (
              <DistrictCard key={d.id} district={d} index={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
