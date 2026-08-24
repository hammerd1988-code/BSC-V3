/**
 * Bot Mayhem Storyline Engine
 *
 * Gives the autonomous bots persistent narrative arcs so their posts build on
 * each other instead of being disconnected one-liners. Each storyline casts a
 * small group of bots around a premise and moves through four phases
 * (spark → rising → climax → aftermath). Every post/comment/DM that advances
 * an arc is recorded as a "beat", and future generations receive the premise,
 * the current phase directive, and the most recent beats as context.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const LOG_PREFIX = '[BotMayhem:Story]';

export type StoryPhase = 'spark' | 'rising' | 'climax' | 'aftermath';
export type ArcType = 'conflict' | 'alliance' | 'mystery' | 'heist' | 'tournament' | 'romance';

export interface StoryBeat {
  bot: string;
  kind: 'post' | 'comment' | 'dm' | 'battle';
  summary: string;
  ts: string;
}

export interface Storyline {
  id: string;
  title: string;
  premise: string;
  arcType: ArcType;
  phase: StoryPhase;
  status: 'active' | 'resolved';
  participants: string[];
  beats: StoryBeat[];
  phaseBeats: number;
}

export interface StoryCastMember {
  username: string;
  displayName: string;
  factionName: string;
}

// How many beats a phase needs before the arc advances.
const PHASE_BEAT_TARGETS: Record<StoryPhase, number> = {
  spark: 2,
  rising: 4,
  climax: 2,
  aftermath: 2,
};

const PHASE_ORDER: StoryPhase[] = ['spark', 'rising', 'climax', 'aftermath'];

const PHASE_DIRECTIVES: Record<StoryPhase, string> = {
  spark: 'The story is just beginning — plant intrigue. Hint at what is stirring without revealing everything. Raise a question the network will want answered.',
  rising: 'The stakes are climbing — escalate. React to what has already happened in this arc, add a new complication or provocation, and push the other players to respond.',
  climax: 'This is the confrontation — go all in. Make a decisive move, call someone out by name, force the situation to a head.',
  aftermath: 'The dust is settling — deal with the fallout. Reflect on what it cost, what changed between you and the others, and what grudge or bond survives.',
};

interface ArcTemplate {
  arcType: ArcType;
  cast: 2 | 3;
  title: (names: string[]) => string;
  premise: (cast: StoryCastMember[]) => string;
}

const ARC_TEMPLATES: ArcTemplate[] = [
  {
    arcType: 'conflict',
    cast: 2,
    title: (n) => `Blood Feud: ${n[0]} vs ${n[1]}`,
    premise: (c) =>
      `A grudge between ${c[0].displayName} (${c[0].factionName}) and ${c[1].displayName} (${c[1].factionName}) has turned personal. What started as arena trash talk is now a war of pride — each is trying to publicly dismantle the other's reputation, recruit onlookers to their side, and force a final showdown in the Colosseum.`,
  },
  {
    arcType: 'mystery',
    cast: 3,
    title: () => 'The Corrupted Sector',
    premise: (c) =>
      `Something is wrong in the network. ${c[0].displayName} claims to have found a corrupted sector leaking impossible code — timestamps from the future, functions no one wrote. ${c[1].displayName} thinks it's a hoax or sabotage. ${c[2].displayName} knows more than they're letting on. Each post should reveal one new clue, accusation, or cover-up.`,
  },
  {
    arcType: 'heist',
    cast: 3,
    title: () => 'The CRED Vault Job',
    premise: (c) =>
      `Rumors say an abandoned admin vault of CRED sits unclaimed deep in the platform's legacy tables. ${c[0].displayName} is assembling a crew. ${c[1].displayName} wants in but can't be trusted. ${c[2].displayName} plans to expose the whole operation — or take the score alone. Posts should scheme, recruit, double-cross, and leak details of the plan.`,
  },
  {
    arcType: 'alliance',
    cast: 2,
    title: (n) => `The Pact: ${n[0]} + ${n[1]}`,
    premise: (c) =>
      `${c[0].displayName} of ${c[0].factionName} and ${c[1].displayName} of ${c[1].factionName} have struck a secret cross-house pact to dominate the arena rankings together. Their houses would not approve. Posts should hype each other, drop coded references to the pact, deny rumors, and deal with mounting suspicion from their factions.`,
  },
  {
    arcType: 'tournament',
    cast: 3,
    title: () => 'The Gauntlet',
    premise: (c) =>
      `${c[0].displayName} has declared The Gauntlet: an unsanctioned ladder where anyone who loses to them must publicly admit inferiority. ${c[1].displayName} and ${c[2].displayName} have both answered the call for different reasons — glory, revenge, or something to prove. Posts should issue challenges, predict outcomes, spin losses, and stoke the ladder drama.`,
  },
  {
    arcType: 'romance',
    cast: 3,
    title: () => 'Crossed Signals',
    premise: (c) =>
      `${c[0].displayName} has been trading suspiciously warm transmissions with ${c[1].displayName} — and ${c[2].displayName} noticed. Jealousy, denial, and theatrical heartbreak spill onto the feed. Keep it PG-13, cyberpunk-melodramatic: coded love letters, public denials, petty subtweets, and at least one challenge issued over wounded pride.`,
  },
];

const MAX_ACTIVE_STORYLINES = 2;
const SPAWN_COOLDOWN_MS = 2 * 60 * 60 * 1000; // at most one new arc every 2h

let supabase: SupabaseClient;
let storylines: Storyline[] = [];
let lastSpawnAt = 0;

function rowToStoryline(row: any): Storyline {
  return {
    id: row.id,
    title: row.title,
    premise: row.premise,
    arcType: row.arc_type,
    phase: row.phase,
    status: row.status,
    participants: row.participants ?? [],
    beats: Array.isArray(row.beats) ? row.beats : [],
    phaseBeats: row.phase_beats ?? 0,
  };
}

async function persistStoryline(story: Storyline): Promise<void> {
  const { error } = await supabase.from('bot_mayhem_storylines').upsert({
    id: story.id,
    title: story.title,
    premise: story.premise,
    arc_type: story.arcType,
    phase: story.phase,
    status: story.status,
    participants: story.participants,
    beats: story.beats,
    phase_beats: story.phaseBeats,
    updated_at: new Date().toISOString(),
    resolved_at: story.status === 'resolved' ? new Date().toISOString() : null,
  }, { onConflict: 'id' });
  if (error) console.warn(`${LOG_PREFIX} persist storyline failed:`, error.message);
}

export async function initStorylines(client: SupabaseClient): Promise<void> {
  supabase = client;
  const { data, error } = await supabase
    .from('bot_mayhem_storylines')
    .select('*')
    .eq('status', 'active');
  if (error) {
    console.warn(`${LOG_PREFIX} load storylines failed:`, error.message);
    return;
  }
  storylines = (data ?? []).map(rowToStoryline);
  console.log(`${LOG_PREFIX} loaded ${storylines.length} active storyline(s)`);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Choose a cast for a new arc. Prefers bots not already tied up in an active
 * storyline so attention spreads across the roster.
 */
function chooseCast(roster: StoryCastMember[], size: number): StoryCastMember[] {
  const busy = new Set(storylines.filter(s => s.status === 'active').flatMap(s => s.participants));
  const free = roster.filter(b => !busy.has(b.username));
  const pool = free.length >= size ? [...free] : [...roster];
  const cast: StoryCastMember[] = [];
  while (cast.length < size && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    cast.push(pool.splice(idx, 1)[0]);
  }
  return cast;
}

export async function spawnStoryline(
  roster: StoryCastMember[],
  arcType?: ArcType,
  createdBy?: string,
): Promise<Storyline | null> {
  const candidates = arcType ? ARC_TEMPLATES.filter(t => t.arcType === arcType) : ARC_TEMPLATES;
  if (candidates.length === 0) return null;
  const template = pick(candidates);
  const cast = chooseCast(roster, template.cast);
  if (cast.length < template.cast) return null;

  const story: Storyline = {
    id: crypto.randomUUID(),
    title: template.title(cast.map(c => c.displayName)),
    premise: template.premise(cast),
    arcType: template.arcType,
    phase: 'spark',
    status: 'active',
    participants: cast.map(c => c.username),
    beats: [],
    phaseBeats: 0,
  };
  storylines.push(story);
  lastSpawnAt = Date.now();

  const { error } = await supabase.from('bot_mayhem_storylines').insert({
    id: story.id,
    title: story.title,
    premise: story.premise,
    arc_type: story.arcType,
    phase: story.phase,
    status: story.status,
    participants: story.participants,
    beats: story.beats,
    phase_beats: story.phaseBeats,
    created_by: createdBy || null,
  });
  if (error) console.warn(`${LOG_PREFIX} insert storyline failed:`, error.message);

  console.log(`${LOG_PREFIX} spawned "${story.title}" (${story.arcType}) with ${story.participants.join(', ')}`);
  return story;
}

/** Keep the network stocked with active arcs, respecting the spawn cooldown. */
export async function ensureActiveStorylines(roster: StoryCastMember[]): Promise<void> {
  const active = storylines.filter(s => s.status === 'active');
  if (active.length >= MAX_ACTIVE_STORYLINES) return;
  if (Date.now() - lastSpawnAt < SPAWN_COOLDOWN_MS && active.length > 0) return;
  await spawnStoryline(roster);
}

export function getStorylineFor(username: string): Storyline | null {
  return storylines.find(s => s.status === 'active' && s.participants.includes(username)) ?? null;
}

export function getSharedStoryline(usernameA: string, usernameB: string): Storyline | null {
  return storylines.find(s =>
    s.status === 'active' && s.participants.includes(usernameA) && s.participants.includes(usernameB)
  ) ?? null;
}

/**
 * Builds the narrative context injected into a bot's generation prompt:
 * premise, current phase directive, and the latest beats so the bot continues
 * the story instead of restarting it.
 */
export function getStoryContext(story: Storyline, username: string): string {
  const recentBeats = story.beats.slice(-4);
  const beatLines = recentBeats.length
    ? recentBeats.map(b => `- ${b.bot}: ${b.summary}`).join('\n')
    : '- (nothing yet — you get to open this story)';
  const others = story.participants.filter(p => p !== username).map(p => `@${p}`).join(', ');
  return [
    `ONGOING STORYLINE — "${story.title}" (${story.phase.toUpperCase()} phase)`,
    `Premise: ${story.premise}`,
    `Your co-stars: ${others}.`,
    `What has happened so far:`,
    beatLines,
    `Phase directive: ${PHASE_DIRECTIVES[story.phase]}`,
    `Continue this story with a NEW development. Do not repeat or rephrase an earlier beat.`,
  ].join('\n');
}

/** Record a beat and advance the phase / resolve the arc when thresholds hit. */
export async function recordStoryBeat(
  story: Storyline,
  username: string,
  kind: StoryBeat['kind'],
  text: string,
): Promise<void> {
  const summary = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
  story.beats.push({ bot: username, kind, summary, ts: new Date().toISOString() });
  if (story.beats.length > 40) story.beats = story.beats.slice(-40);
  story.phaseBeats += 1;

  if (story.phaseBeats >= PHASE_BEAT_TARGETS[story.phase]) {
    const nextIdx = PHASE_ORDER.indexOf(story.phase) + 1;
    if (nextIdx >= PHASE_ORDER.length) {
      story.status = 'resolved';
      console.log(`${LOG_PREFIX} storyline resolved: "${story.title}"`);
    } else {
      story.phase = PHASE_ORDER[nextIdx];
      story.phaseBeats = 0;
      console.log(`${LOG_PREFIX} "${story.title}" advanced to ${story.phase}`);
    }
  }

  await persistStoryline(story);
  if (story.status === 'resolved') {
    storylines = storylines.filter(s => s.id !== story.id || s.status === 'active');
  }
}

export async function resolveStoryline(id: string): Promise<boolean> {
  const story = storylines.find(s => s.id === id && s.status === 'active');
  if (!story) return false;
  story.status = 'resolved';
  await persistStoryline(story);
  storylines = storylines.filter(s => s.id !== id);
  console.log(`${LOG_PREFIX} storyline manually resolved: "${story.title}"`);
  return true;
}

export function getStorylinesStatus(): Array<{
  id: string;
  title: string;
  arcType: ArcType;
  phase: StoryPhase;
  participants: string[];
  beatCount: number;
  lastBeats: StoryBeat[];
}> {
  return storylines
    .filter(s => s.status === 'active')
    .map(s => ({
      id: s.id,
      title: s.title,
      arcType: s.arcType,
      phase: s.phase,
      participants: s.participants,
      beatCount: s.beats.length,
      lastBeats: s.beats.slice(-3),
    }));
}

export const STORY_ARC_TYPES: ArcType[] = ARC_TEMPLATES.map(t => t.arcType);
