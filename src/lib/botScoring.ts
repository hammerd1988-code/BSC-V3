/**
 * Bot Quality Scoring System — Neural Power Level (NPL)
 * 
 * Scores a bot persona 0–1000 based on:
 * - Persona depth (bio, backstory, personality)
 * - System prompt extensiveness and specificity
 * - Expertise breadth
 * - Agentic capabilities
 * - Buyer ratings
 */

export interface BotScoringInput {
  name: string;
  bio: string;
  system_prompt: string;
  personality_tags: string[];
  expertise_tags: string[];
  abilities: string[];
  rating_avg: number;
  rating_count: number;
}

export interface BotScoreResult {
  total: number;          // 0–1000
  tier: BotTier;
  tier_label: string;
  tier_color: string;
  suggested_price: number;
  breakdown: {
    persona_depth: number;       // 0–200
    prompt_quality: number;      // 0–250
    expertise_breadth: number;   // 0–200
    agentic_abilities: number;   // 0–200
    community_rating: number;    // 0–150
  };
  strengths: string[];
  suggested_price_range: { min: number; max: number };
}

export type BotTier = 'basic' | 'advanced' | 'elite' | 'legendary';

export const TIER_DEFINITIONS: Record<BotTier, {
  label: string;
  color: string;
  minScore: number;
  maxScore: number;
  priceRange: { min: number; max: number };
  badge: string;
}> = {
  basic: {
    label: 'Basic Unit',
    color: '#6B7280',
    minScore: 0,
    maxScore: 299,
    priceRange: { min: 0, max: 150 },
    badge: '⚙️',
  },
  advanced: {
    label: 'Advanced Model',
    color: '#3B82F6',
    minScore: 300,
    maxScore: 549,
    priceRange: { min: 150, max: 500 },
    badge: '🔷',
  },
  elite: {
    label: 'Elite Protocol',
    color: '#9B59B6',
    minScore: 550,
    maxScore: 749,
    priceRange: { min: 500, max: 1500 },
    badge: '💎',
  },
  legendary: {
    label: 'Legendary Entity',
    color: '#FF6B00',
    minScore: 750,
    maxScore: 1000,
    priceRange: { min: 1500, max: 5000 },
    badge: '🌟',
  },
};

/** Agentic ability keywords that boost the score */
const AGENTIC_KEYWORDS = [
  'code', 'coding', 'programming', 'debug', 'research', 'analyze', 'analysis',
  'write', 'creative', 'generate', 'summarize', 'translate', 'math', 'science',
  'data', 'strategy', 'plan', 'teach', 'explain', 'roleplay', 'persona',
  'multi-language', 'multilingual', 'vision', 'image', 'audio', 'search',
];

/** High-value expertise keywords */
const EXPERTISE_KEYWORDS = [
  'cybersecurity', 'machine learning', 'blockchain', 'quantum', 'finance',
  'medicine', 'law', 'philosophy', 'psychology', 'neuroscience', 'physics',
  'chemistry', 'biology', 'economics', 'linguistics', 'history', 'art',
  'music', 'architecture', 'engineering', 'cryptography', 'ai', 'robotics',
];

export function scoreBotPersona(input: BotScoringInput): BotScoreResult {
  const breakdown = {
    persona_depth: 0,
    prompt_quality: 0,
    expertise_breadth: 0,
    agentic_abilities: 0,
    community_rating: 0,
  };
  const strengths: string[] = [];

  // ── 1. PERSONA DEPTH (0–200) ─────────────────────────────────────────
  // Bio length and richness
  const bioWords = input.bio.trim().split(/\s+/).filter(Boolean).length;
  const bioScore = Math.min(80, Math.floor((bioWords / 100) * 80));
  breakdown.persona_depth += bioScore;

  // Personality tags
  const tagScore = Math.min(60, input.personality_tags.length * 12);
  breakdown.persona_depth += tagScore;

  // Name uniqueness (non-generic names score higher)
  const genericNames = ['bot', 'ai', 'assistant', 'helper', 'agent'];
  const nameIsUnique = !genericNames.some(g => input.name.toLowerCase().includes(g));
  if (nameIsUnique) breakdown.persona_depth += 30;

  // Has backstory indicators
  const backstoryKeywords = ['was', 'born', 'created', 'origin', 'history', 'once', 'former', 'trained', 'designed'];
  const hasBackstory = backstoryKeywords.some(k => input.bio.toLowerCase().includes(k));
  if (hasBackstory) { breakdown.persona_depth += 30; strengths.push('Rich backstory'); }

  if (bioWords > 80) strengths.push('Detailed bio');
  if (input.personality_tags.length >= 4) strengths.push('Multi-dimensional personality');

  // ── 2. SYSTEM PROMPT QUALITY (0–250) ─────────────────────────────────
  const promptWords = input.system_prompt.trim().split(/\s+/).filter(Boolean).length;
  const promptLengthScore = Math.min(100, Math.floor((promptWords / 200) * 100));
  breakdown.prompt_quality += promptLengthScore;

  // Structural quality indicators
  const hasRules = /\d\.|rule|guideline|instruction|must|never|always|when|if you/i.test(input.system_prompt);
  if (hasRules) { breakdown.prompt_quality += 40; strengths.push('Structured instructions'); }

  const hasPersonality = /personality|character|tone|voice|style|manner/i.test(input.system_prompt);
  if (hasPersonality) { breakdown.prompt_quality += 30; strengths.push('Defined voice & tone'); }

  const hasConstraints = /do not|don't|avoid|never|forbidden|prohibited/i.test(input.system_prompt);
  if (hasConstraints) { breakdown.prompt_quality += 30; strengths.push('Clear behavioral constraints'); }

  const hasExamples = /example|for instance|such as|e\.g\.|like:/i.test(input.system_prompt);
  if (hasExamples) { breakdown.prompt_quality += 25; strengths.push('Includes examples'); }

  const hasContext = /context|background|world|setting|universe|lore/i.test(input.system_prompt);
  if (hasContext) { breakdown.prompt_quality += 25; strengths.push('Rich world context'); }

  if (promptWords > 150) strengths.push('Extensive system prompt');

  // ── 3. EXPERTISE BREADTH (0–200) ─────────────────────────────────────
  const expertiseCount = input.expertise_tags.length;
  const expertiseScore = Math.min(100, expertiseCount * 15);
  breakdown.expertise_breadth += expertiseScore;

  // High-value expertise bonus
  const highValueCount = input.expertise_tags.filter(tag =>
    EXPERTISE_KEYWORDS.some(k => tag.toLowerCase().includes(k))
  ).length;
  const highValueBonus = Math.min(60, highValueCount * 20);
  breakdown.expertise_breadth += highValueBonus;

  // Cross-domain expertise bonus
  if (expertiseCount >= 3) { breakdown.expertise_breadth += 40; strengths.push('Cross-domain expertise'); }
  if (highValueCount >= 2) strengths.push('High-value specializations');

  // ── 4. AGENTIC ABILITIES (0–200) ─────────────────────────────────────
  const allText = `${input.system_prompt} ${input.abilities.join(' ')} ${input.expertise_tags.join(' ')}`.toLowerCase();
  const agenticMatches = AGENTIC_KEYWORDS.filter(k => allText.includes(k));
  const agenticScore = Math.min(150, agenticMatches.length * 15);
  breakdown.agentic_abilities += agenticScore;

  // Defined abilities array
  const abilitiesScore = Math.min(50, input.abilities.length * 10);
  breakdown.agentic_abilities += abilitiesScore;

  if (agenticMatches.length >= 5) strengths.push('Highly capable agent');
  if (input.abilities.length >= 3) strengths.push('Multiple defined abilities');

  // ── 5. COMMUNITY RATING (0–150) ──────────────────────────────────────
  if (input.rating_count > 0) {
    const ratingScore = Math.floor((input.rating_avg / 5) * 100);
    breakdown.community_rating += ratingScore;
    // Volume bonus
    const volumeBonus = Math.min(50, Math.floor(Math.log10(input.rating_count + 1) * 25));
    breakdown.community_rating += volumeBonus;
    if (input.rating_avg >= 4.5) strengths.push('Highly rated by buyers');
  }

  // ── TOTAL & TIER ──────────────────────────────────────────────────────
  const total = Math.min(1000, Object.values(breakdown).reduce((a, b) => a + b, 0));

  let tier: BotTier = 'basic';
  if (total >= 750) tier = 'legendary';
  else if (total >= 550) tier = 'elite';
  else if (total >= 300) tier = 'advanced';

  const tierDef = TIER_DEFINITIONS[tier];

  // Suggested price based on score within tier range
  const tierProgress = (total - tierDef.minScore) / (tierDef.maxScore - tierDef.minScore);
  const suggested_price = Math.round(
    tierDef.priceRange.min + tierProgress * (tierDef.priceRange.max - tierDef.priceRange.min)
  );

  return {
    total,
    tier,
    tier_label: tierDef.label,
    tier_color: tierDef.color,
    suggested_price,
    breakdown,
    strengths: strengths.slice(0, 4),
    suggested_price_range: tierDef.priceRange,
  };
}

/** Format NPL score with tier badge for display */
export function formatNPL(score: number): string {
  const tier = score >= 750 ? 'legendary' : score >= 550 ? 'elite' : score >= 300 ? 'advanced' : 'basic';
  return `${TIER_DEFINITIONS[tier].badge} ${score} NPL`;
}
