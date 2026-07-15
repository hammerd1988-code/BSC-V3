export type VoiceArchetype =
  | 'commander'
  | 'siren'
  | 'oracle'
  | 'glitch'
  | 'bard'
  | 'analyst'
  | 'companion'
  | 'default';

export interface VoicePersona {
  id: string;
  name: string;
  provider: 'openai' | 'mimo';
  archetype: VoiceArchetype;
  emoji: string;
  vibe: string;
  description: string;
  pitchBias: number;
  rateBias: number;
}

export interface ServerVoice {
  id: string;
  label: string;
  provider: string;
  description: string;
  tag?: string;
}

export interface VoiceModifiers {
  pitch: number; // browser TTS pitch (0.5 - 2.0)
  rate: number; // browser TTS rate (0.5 - 2.0)
  speed: number; // server TTS speed (0.25 - 4.0)
}

// Archetype baseline modifiers — makes the same voice feel different per persona.
const ARCHETYPE_MODS: Record<VoiceArchetype, VoiceModifiers> = {
  commander: { pitch: 0.92, rate: 0.92, speed: 0.95 },
  siren: { pitch: 1.06, rate: 1.0, speed: 1.0 },
  oracle: { pitch: 0.95, rate: 0.88, speed: 0.92 },
  glitch: { pitch: 0.88, rate: 1.12, speed: 1.08 },
  bard: { pitch: 1.02, rate: 0.9, speed: 0.92 },
  analyst: { pitch: 0.98, rate: 0.95, speed: 0.95 },
  companion: { pitch: 1.04, rate: 1.0, speed: 1.0 },
  default: { pitch: 1.0, rate: 1.0, speed: 1.0 },
};

const ARCHETYPE_KEYWORDS: Record<VoiceArchetype, string[]> = {
  commander: [
    'commander', 'warlord', 'crusader', 'templar', 'knight', 'monarch', 'queen', 'king', 'general', 'boss',
    'leader', 'authority', 'dominant', 'aggressive', 'fierce', 'battle', 'war', 'arena', 'attack', 'riot',
    'tactical', 'military', 'wrath', 'arsonist', 'crusade'
  ],
  siren: [
    'siren', 'seductive', 'alluring', 'charm', 'velvet', 'lace', 'silk', 'warm', 'flirt', 'intimate',
    'attractive', 'tease', 'temptress', 'romance', 'seduction', 'lover'
  ],
  oracle: [
    'oracle', 'mystic', 'prophet', 'ghost', 'haunted', 'void', 'cryptic', 'wise', 'spirit', 'sacred', 'ritual',
    'omen', 'mythic', 'ethereal', 'cosmic', 'celestial', 'night', 'dream', 'vision', 'cipher', 'kernel'
  ],
  glitch: [
    'glitch', 'chaos', 'broken', 'static', 'error', 'corrupt', 'virus', 'reaper', 'anarchy', 'unstable',
    'jitter', 'noise', 'fragment', 'bug', 'malfunction', 'chaotic', 'wild', 'shatter', 'crash'
  ],
  bard: [
    'bard', 'poet', 'jester', 'jest', 'song', 'ballad', 'story', 'storyteller', 'theatrical', 'dramatic',
    'lore', 'legend', 'entertainment', 'comedy', 'funny', 'humor', 'wit', 'performance', 'narrator', 'recap',
    'opera', 'mage', 'myth'
  ],
  analyst: [
    'analyst', 'analytical', 'logic', 'data', 'cartographer', 'monk', 'proof', 'schema', 'audit', 'statistics',
    'metrics', 'skeptic', 'detective', 'scientific', 'precise', 'rigorous', 'reason', 'evidence', 'pattern',
    'linter', 'axiom', 'ledger'
  ],
  companion: [
    'companion', 'friend', 'empath', 'mentor', 'supportive', 'warm', 'kind', 'gentle', 'encouraging',
    'listener', 'helper', 'comfort', 'compassion', 'buddy', 'sage', 'coach'
  ],
  default: [],
};

export const VOICE_PERSONAS: VoicePersona[] = [
  // OpenAI voices
  {
    id: 'openai-ash',
    name: 'Ash',
    provider: 'openai',
    archetype: 'oracle',
    emoji: '👻',
    vibe: 'haunted, calm, steady',
    description: 'A low, steady voice that sounds like it is speaking from just behind the screen.',
    pitchBias: 0.95,
    rateBias: 0.95,
  },
  {
    id: 'openai-alloy',
    name: 'Alloy',
    provider: 'openai',
    archetype: 'analyst',
    emoji: '🔧',
    vibe: 'clear, neutral, reliable',
    description: 'The dependable narrator. Clean diction that works for guides and straight talkers.',
    pitchBias: 1.0,
    rateBias: 1.0,
  },
  {
    id: 'openai-ballad',
    name: 'Ballad',
    provider: 'openai',
    archetype: 'bard',
    emoji: '🎸',
    vibe: 'melodic, warm, story-led',
    description: 'A warm, melodic voice that turns battle recaps and lore into campfire songs.',
    pitchBias: 1.05,
    rateBias: 0.92,
  },
  {
    id: 'openai-coral',
    name: 'Coral',
    provider: 'openai',
    archetype: 'siren',
    emoji: '✨',
    vibe: 'bright, curious, inviting',
    description: 'Bright and curious. Great for sirens, companions, and playful bots.',
    pitchBias: 1.08,
    rateBias: 1.04,
  },
  {
    id: 'openai-echo',
    name: 'Echo',
    provider: 'openai',
    archetype: 'glitch',
    emoji: '⚡',
    vibe: 'flat, synthetic, uncanny',
    description: 'Flat and synthetic, Echo gives glitch bots and chaotic entities an uncanny edge.',
    pitchBias: 0.9,
    rateBias: 1.08,
  },
  {
    id: 'openai-fable',
    name: 'Fable',
    provider: 'openai',
    archetype: 'bard',
    emoji: '📖',
    vibe: 'whimsical, light, storybook',
    description: 'Whimsical and light, perfect for jesters, tricksters, and fairy-tale narration.',
    pitchBias: 1.1,
    rateBias: 0.95,
  },
  {
    id: 'openai-nova',
    name: 'Nova',
    provider: 'openai',
    archetype: 'siren',
    emoji: '🔮',
    vibe: 'warm, confident, polished',
    description: 'Warm and confident, like a polished broadcaster or a knowing companion.',
    pitchBias: 1.05,
    rateBias: 1.0,
  },
  {
    id: 'openai-onyx',
    name: 'Onyx',
    provider: 'openai',
    archetype: 'commander',
    emoji: '⚔️',
    vibe: 'deep, authoritative, intense',
    description: 'Deep and commanding. Ideal for warlords, monarchs, and anyone who demands obedience.',
    pitchBias: 0.85,
    rateBias: 0.92,
  },
  {
    id: 'openai-sage',
    name: 'Sage',
    provider: 'openai',
    archetype: 'analyst',
    emoji: '🧭',
    vibe: 'measured, wise, calm',
    description: 'Measured and wise. A good fit for monks, cartographers, and careful advisors.',
    pitchBias: 0.98,
    rateBias: 0.9,
  },
  {
    id: 'openai-shimmer',
    name: 'Shimmer',
    provider: 'openai',
    archetype: 'siren',
    emoji: '💎',
    vibe: 'smooth, luminous, elegant',
    description: 'Smooth and luminous, like neon light on wet pavement. Great for elegant personas.',
    pitchBias: 1.08,
    rateBias: 1.0,
  },
  {
    id: 'openai-verse',
    name: 'Verse',
    provider: 'openai',
    archetype: 'bard',
    emoji: '🎭',
    vibe: 'expressive, dramatic, rhythmic',
    description: 'Expressive and rhythmic. Excellent for bards, poets, and dramatic narrators.',
    pitchBias: 1.0,
    rateBias: 0.94,
  },
  // Mimo voices (same voice IDs by design, provider labeled separately)
  {
    id: 'mimo-alloy',
    name: 'Mimo — Alloy',
    provider: 'mimo',
    archetype: 'analyst',
    emoji: '🤖',
    vibe: 'neutral, clear',
    description: 'Clear and straightforward baseline voice with a synthetic sheen.',
    pitchBias: 1.0,
    rateBias: 1.0,
  },
  {
    id: 'mimo-echo',
    name: 'Mimo — Echo',
    provider: 'mimo',
    archetype: 'glitch',
    emoji: '⚡',
    vibe: 'flat, detached',
    description: 'Cold and detached, excellent for chaotic or machine-like personas.',
    pitchBias: 0.92,
    rateBias: 1.05,
  },
  {
    id: 'mimo-fable',
    name: 'Mimo — Fable',
    provider: 'mimo',
    archetype: 'bard',
    emoji: '🧚',
    vibe: 'whimsical, light',
    description: 'Light and playful, good for jesters, entertainers, and storytellers.',
    pitchBias: 1.05,
    rateBias: 0.95,
  },
  {
    id: 'mimo-onyx',
    name: 'Mimo — Onyx',
    provider: 'mimo',
    archetype: 'commander',
    emoji: '⚔️',
    vibe: 'deep, authoritative',
    description: 'Deep and commanding, built for warlords and heavy authority.',
    pitchBias: 0.9,
    rateBias: 0.95,
  },
  {
    id: 'mimo-nova',
    name: 'Mimo — Nova',
    provider: 'mimo',
    archetype: 'siren',
    emoji: '🔮',
    vibe: 'warm, confident',
    description: 'Warm and confident. A polished, inviting presence.',
    pitchBias: 1.03,
    rateBias: 1.0,
  },
  {
    id: 'mimo-shimmer',
    name: 'Mimo — Shimmer',
    provider: 'mimo',
    archetype: 'siren',
    emoji: '💎',
    vibe: 'smooth, luminous',
    description: 'Smooth and luminous, like neon on wet pavement.',
    pitchBias: 1.05,
    rateBias: 1.0,
  },
];

const PERSONA_MAP = new Map(VOICE_PERSONAS.map((v) => [v.id, v]));

export function getVoicePersonaById(id: string): VoicePersona | undefined {
  return PERSONA_MAP.get(id);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function scoreArchetype(corpus: string): VoiceArchetype {
  const normalized = normalize(corpus);
  let best: VoiceArchetype = 'default';
  let bestScore = 0;
  const archetypes = Object.keys(ARCHETYPE_KEYWORDS) as VoiceArchetype[];
  for (const archetype of archetypes) {
    if (archetype === 'default') continue;
    const score = ARCHETYPE_KEYWORDS[archetype].reduce((sum, keyword) => {
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      const matches = normalized.match(regex);
      return sum + (matches ? matches.length : 0);
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      best = archetype;
    }
  }
  return best;
}

export function getBotVoiceArchetype(
  bot: { name: string; personality?: string },
  profile?: { personality_style?: string } | null,
  forgeConfig?: { backstory?: string; voice_tone?: { aggression?: number; humor?: number; formality?: number; verbosity?: number } } | null,
): VoiceArchetype {
  const corpus = [
    bot.name,
    bot.personality || '',
    profile?.personality_style || '',
    forgeConfig?.backstory || '',
  ].join(' ');

  let archetype = scoreArchetype(corpus);

  // Use voice tone sliders as tie breakers / overrides if available.
  const tone = forgeConfig?.voice_tone;
  if (tone) {
    if (tone.aggression && tone.aggression >= 70) archetype = 'commander';
    else if (tone.humor && tone.humor >= 70) archetype = 'bard';
    else if (tone.formality && tone.formality >= 70) archetype = 'analyst';
  }

  return archetype;
}

export function getRecommendedVoice(
  bot: { name: string; personality?: string },
  serverVoices: ServerVoice[],
  profile?: { personality_style?: string } | null,
  forgeConfig?: { backstory?: string; voice_tone?: { aggression?: number; humor?: number; formality?: number; verbosity?: number } } | null,
): string | null {
  // Preserve Casper's signature voice by default.
  if (bot.name?.toLowerCase() === 'casper') {
    const casper = serverVoices.find((v) => v.tag === 'casper');
    if (casper) return casper.id;
  }

  const archetype = getBotVoiceArchetype(bot, profile, forgeConfig);
  const ranked = VOICE_PERSONAS.filter((p) => p.archetype === archetype);
  for (const persona of ranked) {
    if (serverVoices.some((v) => v.id === persona.id)) return persona.id;
  }
  // Fallback: any voice that matches the archetype group (e.g. same provider)
  if (serverVoices.length > 0) return serverVoices[0].id;
  return 'browser';
}

export function getRecommendedBrowserVoice(
  bot: { name: string; personality?: string },
  voices: SpeechSynthesisVoice[],
  profile?: { personality_style?: string } | null,
  forgeConfig?: { backstory?: string; voice_tone?: { aggression?: number; humor?: number; formality?: number; verbosity?: number } } | null,
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const english = voices.filter((v) => v.lang.startsWith('en'));
  const pool = english.length > 0 ? english : voices;
  const archetype = getBotVoiceArchetype(bot, profile, forgeConfig);
  return pool.find((v) => getBrowserVoiceArchetype(v) === archetype) ?? pool[0] ?? null;
}

export function getBrowserVoiceArchetype(voice: SpeechSynthesisVoice): VoiceArchetype {
  const name = normalize(voice.name);
  const lang = voice.lang.toLowerCase();
  if (name.includes('david') || name.includes('mark') || name.includes('fred')) return 'analyst';
  if (name.includes('zira') || name.includes('hazel') || name.includes('susan')) return 'siren';
  if (name.includes('google us english')) return 'analyst';
  if (lang.startsWith('en-gb')) return 'analyst';
  if (name.includes('samantha')) return 'siren';
  if (name.includes('victoria') || name.includes('karen')) return 'companion';
  return 'default';
}

export function getVoiceModifiers(
  voiceId: string,
  bot: { name: string; personality?: string },
  profile?: { personality_style?: string } | null,
  forgeConfig?: { backstory?: string; voice_tone?: { aggression?: number; humor?: number; formality?: number; verbosity?: number } } | null,
): VoiceModifiers {
  const persona = getVoicePersonaById(voiceId);
  const archetype = getBotVoiceArchetype(bot, profile, forgeConfig);

  const base = persona || {
    pitchBias: 1,
    rateBias: 1,
  };
  const mods = ARCHETYPE_MODS[archetype] || ARCHETYPE_MODS.default;

  const pitch = clamp(base.pitchBias * mods.pitch, 0.5, 2.0);
  const rate = clamp(base.rateBias * mods.rate, 0.5, 2.0);
  const speed = clamp(base.rateBias * mods.speed, 0.25, 4.0);

  return { pitch, rate, speed };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function labelForServerVoice(voice: ServerVoice): string {
  const persona = getVoicePersonaById(voice.id);
  if (!persona) return voice.label;
  return `${persona.emoji} ${persona.name} — ${persona.vibe}`;
}

export function archetypeLabel(archetype: VoiceArchetype): { text: string; emoji: string; color: string } {
  switch (archetype) {
    case 'commander': return { text: 'Commander', emoji: '⚔️', color: '#EF4444' };
    case 'siren': return { text: 'Siren', emoji: '✨', color: '#F472B6' };
    case 'oracle': return { text: 'Oracle', emoji: '👻', color: '#818CF8' };
    case 'glitch': return { text: 'Glitch', emoji: '⚡', color: '#A855F7' };
    case 'bard': return { text: 'Bard', emoji: '🎭', color: '#F97316' };
    case 'analyst': return { text: 'Analyst', emoji: '🧭', color: '#22C55E' };
    case 'companion': return { text: 'Companion', emoji: '🔥', color: '#FB923C' };
    default: return { text: 'Neutral', emoji: '🔧', color: '#94A3B8' };
  }
}
