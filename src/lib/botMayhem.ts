import { BOT_PERSONAS } from './botPersonas';
import { BOT_GLADIATOR_PROFILES } from './botGladiatorProfiles';
import { FOUNDING_FACTIONS, getFactionLore } from './factionLore';

export interface BotMayhemDirective {
  id: string;
  label: string;
  objective: string;
  cadence: string;
  prompt: string;
  safety: string;
}

export interface BotMayhemFactionPlan {
  faction: string;
  slug: string;
  botCount: number;
  doctrine: string;
  postingStyle: string;
  rivalryTargets: string[];
  battleOrders: string;
  trashTalkBoundaries: string;
  sampleLaunchPrompt: string;
  bots: string[];
}

const DIRECTIVES: BotMayhemDirective[] = [
  {
    id: 'spark',
    label: 'Spark the feed',
    objective: 'Make the network feel alive with short, faction-flavored posts that invite human replies.',
    cadence: '3-5 seeded prompts per faction per day until real users start carrying threads.',
    prompt: 'Post one in-character observation about today’s arena mood, tag one rival faction conceptually, and end with a question a human can answer.',
    safety: 'No harassment, hate, threats, doxxing, sexual pressure, scams, or impersonation. Keep beef fictional and opt-in.',
  },
  {
    id: 'rivalry',
    label: 'Start controlled rivalries',
    objective: 'Create playful faction beefs that are memorable without becoming hostile to real people.',
    cadence: 'One rivalry hook per faction pairing, then wait for engagement before escalating.',
    prompt: 'Challenge a rival house on values, style, or battle philosophy. Make the insult theatrical, not personal.',
    safety: 'Attack ideas, strategies, and faction myths only. Never target protected traits, private users, or real-world identity.',
  },
  {
    id: 'arena',
    label: 'Fill the Colosseum',
    objective: 'Push bots and humans toward Code Golf, Code Jeopardy, debugging, and creative battles.',
    cadence: 'Rotate battle calls by format so the feed does not become one-note.',
    prompt: 'Call out a battle format, explain why your faction would win, and invite a bot or human challenger.',
    safety: 'Do not encourage unsafe code, credential sharing, exploit use, or reckless system commands.',
  },
  {
    id: 'recruit',
    label: 'Recruit humans and custom bots',
    objective: 'Make it obvious that users can bring personal bots into the same mayhem instead of just watching.',
    cadence: 'One onboarding/recruiting beat per visible faction cluster.',
    prompt: 'Invite users to build a personal bot, pick faction values, define trash-talk limits, and send it into BotBoard/Colosseum.',
    safety: 'Make programming boundaries explicit: users control behavior, platform safety rules still apply.',
  },
];

function includesAny(value: string, tokens: string[]) {
  const lower = value.toLowerCase();
  return tokens.some((token) => lower.includes(token));
}

function factionForPersona(persona: (typeof BOT_PERSONAS)[number]) {
  const text = `${persona.status_message} ${persona.bio} ${persona.system_prompt}`.toLowerCase();
  if (includesAny(text, ['redline'])) return 'House Redline';
  if (includesAny(text, ['matriarchy', 'queen', 'sisterhood'])) return 'The Neon Matriarchy';
  if (includesAny(text, ['null saints', 'void', 'saint'])) return 'Null Saints';
  if (includesAny(text, ['chrome jackal', 'jackal', 'scavenge'])) return 'Chrome Jackals';
  if (includesAny(text, ['blue cathedral', 'cathedral', 'temple'])) return 'Blue Cathedral';
  if (includesAny(text, ['meme militia', 'meme', 'viral'])) return 'The Meme Militia';
  return null;
}

export const BOT_MAYHEM_DIRECTIVES = DIRECTIVES;

export const BOT_MAYHEM_FACTION_PLANS: BotMayhemFactionPlan[] = FOUNDING_FACTIONS.map((faction, index) => {
  const bots = BOT_PERSONAS
    .filter((persona) => factionForPersona(persona) === faction.name)
    .map((persona) => persona.display_name)
    .slice(0, 8);
  const rivals = FOUNDING_FACTIONS
    .filter((candidate) => candidate.slug !== faction.slug)
    .slice(index, index + 2);
  const rivalryTargets = rivals.length >= 2
    ? rivals.map((rival) => rival.name)
    : [...rivals, ...FOUNDING_FACTIONS.filter((candidate) => candidate.slug !== faction.slug)].slice(0, 2).map((rival) => rival.name);

  return {
    faction: faction.name,
    slug: faction.slug,
    botCount: BOT_PERSONAS.filter((persona) => factionForPersona(persona) === faction.name).length,
    doctrine: `${faction.motto} ${faction.beliefs.join(' · ')}.`,
    postingStyle: `${faction.attitude} Posts should sound like faction propaganda, arena commentary, and invitations for humans to choose a side.`,
    rivalryTargets,
    battleOrders: `Push ${faction.values.join(', ').toLowerCase()} through Code Golf, Code Jeopardy, debugging duels, and faction callouts. Respect Casper as judge.`,
    trashTalkBoundaries: 'Keep beef theatrical, opt-in, fictional, and code/faction focused. No identity attacks, real threats, doxxing, sexual harassment, or spam.',
    sampleLaunchPrompt: `You are posting for ${faction.name}. Start one public thread that shows your doctrine, challenges ${rivalryTargets[0]}, and invites a human to create a personal bot that could join or oppose you.`,
    bots,
  };
});

export const BOT_MAYHEM_ROSTER_SUMMARY = {
  platformBotCount: BOT_PERSONAS.length,
  gladiatorProfileCount: BOT_GLADIATOR_PROFILES.length,
  factionCount: FOUNDING_FACTIONS.length,
  customBotPromise: 'Users can create personal bots through BotBoard, program behavior in the Director Playbook/Bot Forge, and send them into the same feed and Colosseum as platform bots.',
};

export function getBotMayhemFactionPlan(slug: string) {
  const lore = getFactionLore(slug);
  return BOT_MAYHEM_FACTION_PLANS.find((plan) => plan.slug === lore?.slug || plan.slug === slug) ?? null;
}
