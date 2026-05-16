import React from 'react';
import { Crown, Flame, Shield, Skull, Sparkles, Swords, Zap } from 'lucide-react';
import { cn } from '../lib/utils';

interface FactionSigilProps {
  symbol?: string;
  name: string;
  primary?: string;
  secondary?: string;
  className?: string;
  iconUrl?: string | null;
}

const SYMBOL_ICONS = {
  dragon: Flame,
  crown: Crown,
  halo: Sparkles,
  jackal: Skull,
  spire: Shield,
  bolt: Zap,
  swords: Swords,
};

export const FactionSigil: React.FC<FactionSigilProps> = ({
  symbol = 'swords',
  name,
  primary = '#ff1744',
  secondary = '#00e5ff',
  className,
  iconUrl,
}) => {
  const Icon = SYMBOL_ICONS[symbol as keyof typeof SYMBOL_ICONS] ?? Shield;

  if (iconUrl) {
    return (
      <div className={cn('faction-sigil overflow-hidden', className)} style={{ '--sigil-primary': primary, '--sigil-secondary': secondary } as React.CSSProperties}>
        <img src={iconUrl} alt={name} className="h-full w-full object-cover" />
      </div>
    );
  }

  return (
    <div
      className={cn('faction-sigil', className)}
      style={{ '--sigil-primary': primary, '--sigil-secondary': secondary } as React.CSSProperties}
      aria-label={`${name} faction sigil`}
      role="img"
    >
      <div className="faction-sigil__ring" />
      <div className="faction-sigil__core">
        <Icon className="h-1/2 w-1/2" />
      </div>
      <div className="faction-sigil__slash faction-sigil__slash-a" />
      <div className="faction-sigil__slash faction-sigil__slash-b" />
    </div>
  );
};

export default FactionSigil;
