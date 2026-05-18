import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

type DistrictVariant = 'colosseum' | 'forge' | 'factions' | 'admin' | 'visual';

interface DistrictCityBackdropProps {
  variant?: DistrictVariant;
  title: string;
  subtitle?: string;
  className?: string;
  compact?: boolean;
}

interface DistrictBuilding {
  x: number;
  width: number;
  height: number;
  hue: number;
  rows: number;
  cols: number;
  label?: string;
  spire: boolean;
}

const DISTRICT_THEME: Record<DistrictVariant, { accent: string; glow: string; labels: string[]; seed: number }> = {
  colosseum: { accent: '#ff1744', glow: 'rgba(255,23,68,0.34)', labels: ['PIT', 'DUEL', 'CODE', 'LIVE'], seed: 11 },
  forge: { accent: '#d946ef', glow: 'rgba(217,70,239,0.3)', labels: ['FORGE', 'BOTS', 'SOUL', 'RULES'], seed: 23 },
  factions: { accent: '#facc15', glow: 'rgba(250,204,21,0.28)', labels: ['HOUSE', 'SIGIL', 'BEEF', 'CREW'], seed: 37 },
  admin: { accent: '#22d3ee', glow: 'rgba(34,211,238,0.3)', labels: ['WATCH', 'CASPER', 'AUDIT', 'SAFE'], seed: 47 },
  visual: { accent: '#00e5ff', glow: 'rgba(0,229,255,0.28)', labels: ['POSTER', 'MEME', 'ART', 'DROP'], seed: 59 },
};

function buildDistrictBuildings(seed: number): DistrictBuilding[] {
  let x = -18;
  return Array.from({ length: 18 }, (_, index) => {
    const wave = Math.abs(Math.sin(seed + index * 5.81));
    const width = 24 + wave * 30;
    const height = 44 + wave * 104 + (index % 4) * 8;
    const building = {
      x,
      width,
      height,
      hue: (seed * 9 + index * 31) % 360,
      rows: Math.max(3, Math.floor(height / 15)),
      cols: Math.max(2, Math.floor(width / 11)),
      spire: wave > 0.58,
    };
    x += width + 4 + wave * 5;
    return building;
  });
}

function DistrictBuildingSvg({ building, index, labels }: { building: DistrictBuilding; index: number; labels: string[] }) {
  const sign = index % 4 === 0 ? labels[index % labels.length] : building.label;

  return (
    <g transform={`translate(${building.x}, 0)`}>
      <rect
        y={-building.height}
        width={building.width}
        height={building.height}
        rx={index % 3 === 0 ? 4 : 1}
        fill={`hsla(${building.hue}, 20%, 8%, 0.92)`}
        stroke={`hsla(${building.hue}, 88%, 62%, 0.24)`}
      />
      {Array.from({ length: building.rows }).map((_, row) =>
        Array.from({ length: building.cols }).map((_, col) => {
          const lit = Math.sin((index + 2) * (row + 1) * (col + 2)) > -0.38;
          return (
            <rect
              key={`${row}-${col}`}
              x={4 + col * 10}
              y={-building.height + 8 + row * 14}
              width={5}
              height={7}
              rx={1}
              fill={lit ? `hsla(${building.hue}, 90%, 66%, 0.58)` : 'rgba(0,0,0,0.36)'}
              style={lit && (row + col + index) % 5 === 0 ? { animation: `district-window-flicker ${3 + (index % 4)}s ${index * 0.12}s ease-in-out infinite` } : undefined}
            />
          );
        })
      )}
      {building.spire && (
        <path
          d={`M${building.width / 2} ${-building.height - 24} L${building.width / 2 - 8} ${-building.height} L${building.width / 2 + 8} ${-building.height} Z`}
          fill={`hsla(${building.hue}, 80%, 50%, 0.18)`}
          stroke={`hsla(${building.hue}, 90%, 70%, 0.36)`}
        />
      )}
      {sign && (
        <text
          x={building.width / 2}
          y={-Math.max(18, building.height - 24)}
          textAnchor="middle"
          fill={`hsla(${building.hue}, 95%, 72%, 0.9)`}
          fontSize={7}
          fontWeight={900}
          fontFamily="monospace"
          letterSpacing={1.4}
          style={{ filter: `drop-shadow(0 0 5px hsla(${building.hue}, 90%, 60%, 0.8))` }}
        >
          {sign}
        </text>
      )}
      <line
        x1={0}
        y1={-building.height}
        x2={building.width}
        y2={-building.height}
        stroke={`hsla(${building.hue}, 90%, 64%, 0.48)`}
        strokeWidth={1.2}
      />
    </g>
  );
}

export function DistrictCityBackdrop({ variant = 'colosseum', title, subtitle, className, compact = false }: DistrictCityBackdropProps) {
  const theme = DISTRICT_THEME[variant];
  const buildings = useMemo(() => buildDistrictBuildings(theme.seed), [theme.seed]);
  const height = compact ? 150 : 220;

  return (
    <section className={cn('relative overflow-hidden rounded-[2rem] border border-white/10 bg-black/70 shadow-[0_0_58px_rgba(255,23,68,0.1)]', className)}>
      <div className="absolute inset-0 bg-gradient-to-b from-[#05000d] via-[#090111] to-black" />
      <div className="district-city-scan absolute inset-0 opacity-50" />
      <div className="absolute -left-20 top-0 h-64 w-64 rounded-full blur-3xl" style={{ backgroundColor: theme.glow }} />
      <div className="absolute right-0 top-8 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black via-black/60 to-transparent" />

      <div className="relative h-full min-h-40">
        <svg className="absolute inset-x-0 bottom-0 h-full w-full" viewBox={`0 0 820 ${height}`} preserveAspectRatio="xMidYMax slice">
          <g transform={`translate(0, ${height - 12})`} opacity={0.48}>
            {buildings.slice(0, 10).map((building, index) => (
              <DistrictBuildingSvg key={`back-${index}`} building={{ ...building, x: building.x + 12, height: building.height * 0.78 }} index={index + 20} labels={theme.labels} />
            ))}
          </g>
          <g transform={`translate(74, ${height - 8})`} opacity={0.78}>
            {buildings.map((building, index) => (
              <DistrictBuildingSvg key={`front-${index}`} building={building} index={index} labels={theme.labels} />
            ))}
          </g>
          <rect y={height - 40} width={820} height={42} fill="url(#fade)" opacity={0.8} />
          <defs>
            <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="transparent" />
              <stop offset="100%" stopColor="#000" />
            </linearGradient>
          </defs>
        </svg>

        <div className="pointer-events-none absolute inset-0">
          {Array.from({ length: compact ? 10 : 18 }).map((_, index) => (
            <motion.span
              key={index}
              className="absolute h-1 w-1 rounded-full"
              style={{
                left: `${(Math.sin(index * 4.4 + theme.seed) * 0.5 + 0.5) * 100}%`,
                top: `${14 + (Math.sin(index * 2.1) * 0.5 + 0.5) * 52}%`,
                backgroundColor: index % 3 === 0 ? theme.accent : '#67e8f9',
                boxShadow: `0 0 14px ${index % 3 === 0 ? theme.accent : '#67e8f9'}`,
              }}
              animate={{ y: [0, -18, 0], opacity: [0.18, 0.8, 0.18] }}
              transition={{ duration: 3.5 + (index % 4), delay: index * 0.15, repeat: Infinity, ease: 'easeInOut' }}
            />
          ))}
        </div>

        <div className={cn('relative z-10 flex min-h-40 flex-col justify-end p-5', compact ? 'sm:p-5' : 'sm:min-h-56 sm:p-7')}>
          <p className="text-[10px] font-black uppercase tracking-[0.38em]" style={{ color: theme.accent }}>{subtitle ?? 'BSC District Online'}</p>
          <h2 className={cn('mt-2 max-w-3xl font-black uppercase italic tracking-tight text-white drop-shadow-[0_0_18px_rgba(255,255,255,0.2)]', compact ? 'text-2xl sm:text-3xl' : 'text-3xl sm:text-5xl')}>
            {title}
          </h2>
        </div>
      </div>
    </section>
  );
}
