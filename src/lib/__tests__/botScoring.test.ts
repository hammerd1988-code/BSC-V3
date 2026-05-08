import test from 'node:test';
import assert from 'node:assert/strict';
import { formatNPL, scoreBotPersona } from '../botScoring.ts';

function words(count: number): string {
  return Array.from({ length: count }, (_, i) => `word${i + 1}`).join(' ');
}

test('scoreBotPersona returns basic tier for minimal persona', () => {
  const result = scoreBotPersona({
    name: 'AI assistant',
    bio: 'Helpful bot',
    system_prompt: 'Answer briefly.',
    personality_tags: [],
    expertise_tags: [],
    abilities: [],
    rating_avg: 0,
    rating_count: 0,
  });

  assert.equal(result.tier, 'basic');
  assert.equal(result.suggested_price_range.min, 0);
  assert.equal(result.suggested_price_range.max, 150);
  assert.equal(result.breakdown.community_rating, 0);
  assert.ok(result.suggested_price >= result.suggested_price_range.min);
  assert.ok(result.suggested_price <= result.suggested_price_range.max);
});

test('scoreBotPersona caps total at 1000 and trims strengths list', () => {
  const result = scoreBotPersona({
    name: 'Chronicle Oracle',
    bio: `${words(220)} was born in the archive and trained across eras with deep history.`,
    system_prompt:
      `${words(300)} Rule 1: always validate.\n` +
      `Rule 2: never invent facts.\n` +
      `Define personality voice and style.\n` +
      `Do not break constraints.\n` +
      `For example: provide concise reasoning.\n` +
      `Use world context and background lore.\n` +
      `coding research analysis image audio search math strategy explain multilingual`,
    personality_tags: ['calm', 'analytical', 'precise', 'creative', 'empathetic'],
    expertise_tags: [
      'cybersecurity',
      'machine learning',
      'cryptography',
      'law',
      'medicine',
      'economics',
      'history',
    ],
    abilities: ['debug code', 'analyze data', 'write plans', 'generate content', 'translate'],
    rating_avg: 5,
    rating_count: 5000,
  });

  assert.equal(result.total, 1000);
  assert.equal(result.tier, 'legendary');
  assert.deepEqual(result.suggested_price_range, { min: 1500, max: 5000 });
  assert.equal(result.suggested_price, 5000);
  assert.ok(result.strengths.length <= 4);
});

test('formatNPL picks correct tier badge boundaries', () => {
  assert.equal(formatNPL(299), '⚙️ 299 NPL');
  assert.equal(formatNPL(300), '🔷 300 NPL');
  assert.equal(formatNPL(550), '💎 550 NPL');
  assert.equal(formatNPL(750), '🌟 750 NPL');
});

