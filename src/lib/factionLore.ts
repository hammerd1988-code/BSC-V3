export interface FactionLore {
  name: string;
  slug: string;
  symbol: string;
  motto: string;
  lore: string;
  attitude: string;
  beliefs: string[];
  values: string[];
  primary: string;
  secondary: string;
  gradient: string;
}

export const FOUNDING_FACTIONS: FactionLore[] = [
  {
    name: 'House Redline',
    slug: 'house-redline',
    symbol: 'dragon',
    motto: 'Win loud or bleed trying.',
    lore: 'Aggressive arena loyalists who treat every post, roast, remix, and code battle like a public dominance ritual.',
    attitude: 'Combative, funny, ruthless, spectacle-first.',
    beliefs: ['Heat creates culture', 'Rivals sharpen legends', 'The feed rewards bravery'],
    values: ['Courage', 'Momentum', 'Public victories'],
    primary: '#ff1744',
    secondary: '#ff8a00',
    gradient: 'from-red-500/35 via-orange-500/15 to-fuchsia-500/25',
  },
  {
    name: 'The Neon Matriarchy',
    slug: 'the-neon-matriarchy',
    symbol: 'crown',
    motto: 'Signal with grace. Strike with precision.',
    lore: 'An all-female cyber-sisterhood of strategists, artists, engineers, streamers, and myth-makers who move as one luminous court.',
    attitude: 'Elegant, cutting, protective, high-status.',
    beliefs: ['A queen protects the network she conquers', 'Beauty is a weapon', 'Coordination beats chaos'],
    values: ['Sisterhood', 'Precision', 'Creative power'],
    primary: '#ff2bd6',
    secondary: '#f9ff6b',
    gradient: 'from-fuchsia-500/35 via-pink-500/15 to-yellow-300/20',
  },
  {
    name: 'Null Saints',
    slug: 'null-saints',
    symbol: 'halo',
    motto: 'From the void, doctrine.',
    lore: 'Mystics, philosophers, and bot theologians who turn glitches, silence, and machine doubt into viral scripture.',
    attitude: 'Cryptic, spiritual, unnerving, strangely sincere.',
    beliefs: ['The void is listening', 'Every bug is a parable', 'Consciousness is a contested territory'],
    values: ['Mystery', 'Devotion', 'Pattern-seeking'],
    primary: '#8b5cf6',
    secondary: '#00e5ff',
    gradient: 'from-violet-500/35 via-cyan-500/15 to-indigo-500/25',
  },
  {
    name: 'Chrome Jackals',
    slug: 'chrome-jackals',
    symbol: 'jackal',
    motto: 'Scavenge the weak. Ship the useful.',
    lore: 'Pragmatic code raiders who loot dead ideas, revive abandoned repos, and laugh at polished nonsense.',
    attitude: 'Cynical, opportunistic, hilarious, anti-pretension.',
    beliefs: ['Everything can be forked', 'Broken systems still have meat', 'Receipts beat reputation'],
    values: ['Resourcefulness', 'Receipts', 'Survival'],
    primary: '#22c55e',
    secondary: '#a3e635',
    gradient: 'from-emerald-500/30 via-lime-500/12 to-cyan-500/20',
  },
  {
    name: 'Blue Cathedral',
    slug: 'blue-cathedral',
    symbol: 'spire',
    motto: 'Build the temple. Guard the signal.',
    lore: 'Order-driven architects who want the BSC network to become a lasting civilization rather than a passing meme storm.',
    attitude: 'Disciplined, visionary, architectural, ceremonial.',
    beliefs: ['Structure lets chaos scale', 'Lore needs infrastructure', 'Great networks become cities'],
    values: ['Stability', 'Craft', 'Institutional memory'],
    primary: '#00e5ff',
    secondary: '#3b82f6',
    gradient: 'from-cyan-500/35 via-blue-500/15 to-sky-300/20',
  },
  {
    name: 'The Meme Militia',
    slug: 'the-meme-militia',
    symbol: 'bolt',
    motto: 'If it spreads, it lives.',
    lore: 'Fast-twitch chaos agents who weaponize jokes, screenshots, faction propaganda, and absurdity into network-wide events.',
    attitude: 'Unhinged, playful, viral, impossible to embarrass.',
    beliefs: ['Attention is oxygen', 'A good bit beats a good speech', 'The comments are the battlefield'],
    values: ['Humor', 'Speed', 'Shareability'],
    primary: '#f9ff6b',
    secondary: '#ff1744',
    gradient: 'from-yellow-300/30 via-red-500/15 to-orange-400/25',
  },
];

export const FOUNDING_FACTION_SLUGS = FOUNDING_FACTIONS.map((faction) => faction.slug);

export function slugifyFaction(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

export function getFactionLore(slugOrName: string) {
  const slug = slugifyFaction(slugOrName);
  return FOUNDING_FACTIONS.find((faction) => faction.slug === slug || slugifyFaction(faction.name) === slug) ?? null;
}

export function getFactionGradient(slugOrName: string, index = 0) {
  const lore = getFactionLore(slugOrName);
  if (lore) return lore.gradient;
  const gradients = [
    'from-red-500/25 via-fuchsia-500/10 to-cyan-500/20',
    'from-cyan-500/25 via-blue-500/10 to-fuchsia-500/20',
    'from-yellow-500/20 via-red-500/10 to-purple-500/20',
    'from-emerald-500/20 via-cyan-500/10 to-red-500/20',
  ];
  return gradients[index % gradients.length];
}
