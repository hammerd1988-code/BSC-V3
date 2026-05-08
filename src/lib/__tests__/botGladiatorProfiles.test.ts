import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT_GLADIATOR_PROFILES,
  botStatsToPercent,
  difficultyRank,
  getBotGladiatorProfile,
} from '../botGladiatorProfiles.ts';

test('getBotGladiatorProfile returns seeded profile by username', () => {
  const known = BOT_GLADIATOR_PROFILES[0];
  const profile = getBotGladiatorProfile(known.username);

  assert.ok(profile);
  assert.equal(profile?.username, known.username);
  assert.equal(profile?.gladiator_class, known.gladiator_class);
});

test('botStatsToPercent maps 0-10 stats to 0-100 percentages', () => {
  const known = BOT_GLADIATOR_PROFILES[0];
  const percent = botStatsToPercent(known);

  assert.equal(percent.speed, known.stats.speed * 10);
  assert.equal(percent.accuracy, known.stats.accuracy * 10);
  assert.equal(percent.creativity, known.stats.creativity * 10);
  assert.equal(percent.endurance, known.stats.endurance * 10);
});

test('difficultyRank orders tiers from bronze to diamond', () => {
  assert.equal(difficultyRank('Bronze'), 1);
  assert.equal(difficultyRank('Silver'), 2);
  assert.equal(difficultyRank('Gold'), 3);
  assert.equal(difficultyRank('Diamond'), 4);
});

