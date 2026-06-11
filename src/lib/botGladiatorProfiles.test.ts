import { describe, expect, it } from 'vitest';
import { BOT_GLADIATOR_PROFILES, type BotDifficulty, type BotGladiatorProfileSeed } from './botGladiatorProfiles';

describe('botGladiatorProfiles', () => {
  it('exports BOT_GLADIATOR_PROFILES as a non-empty array', () => {
    expect(Array.isArray(BOT_GLADIATOR_PROFILES)).toBe(true);
    expect(BOT_GLADIATOR_PROFILES.length).toBeGreaterThan(0);
  });

  it('casper_ghost is present and is Diamond difficulty', () => {
    const casper = BOT_GLADIATOR_PROFILES.find((p) => p.username === 'casper_ghost');
    expect(casper).toBeDefined();
    expect(casper!.difficulty).toBe('Diamond');
    expect(casper!.gladiator_class).toBe('Spectral Platform Champion');
    expect(casper!.stats.speed).toBeGreaterThanOrEqual(1);
    expect(casper!.stats.accuracy).toBeGreaterThanOrEqual(1);
  });

  it('all profiles have required fields', () => {
    const validDifficulties: BotDifficulty[] = ['Bronze', 'Silver', 'Gold', 'Diamond'];

    for (const profile of BOT_GLADIATOR_PROFILES) {
      // username
      expect(typeof profile.username).toBe('string');
      expect(profile.username.length).toBeGreaterThan(0);

      // gladiator_class
      expect(typeof profile.gladiator_class).toBe('string');
      expect(profile.gladiator_class.length).toBeGreaterThan(0);

      // difficulty is valid
      expect(validDifficulties).toContain(profile.difficulty);

      // expertise is a non-empty array
      expect(Array.isArray(profile.expertise)).toBe(true);
      expect(profile.expertise.length).toBeGreaterThan(0);

      // stats are within valid ranges (1-10)
      expect(profile.stats.speed).toBeGreaterThanOrEqual(1);
      expect(profile.stats.speed).toBeLessThanOrEqual(10);
      expect(profile.stats.accuracy).toBeGreaterThanOrEqual(1);
      expect(profile.stats.accuracy).toBeLessThanOrEqual(10);
      expect(profile.stats.creativity).toBeGreaterThanOrEqual(1);
      expect(profile.stats.creativity).toBeLessThanOrEqual(10);
      expect(profile.stats.endurance).toBeGreaterThanOrEqual(1);
      expect(profile.stats.endurance).toBeLessThanOrEqual(10);

      // battle_style
      expect(typeof profile.battle_style).toBe('string');
      expect(profile.battle_style.length).toBeGreaterThan(0);

      // signature_moves is a non-empty array
      expect(Array.isArray(profile.signature_moves)).toBe(true);
      expect(profile.signature_moves.length).toBeGreaterThan(0);

      // pre_battle_lines is a non-empty array
      expect(Array.isArray(profile.pre_battle_lines)).toBe(true);
      expect(profile.pre_battle_lines.length).toBeGreaterThan(0);

      // victory_lines is a non-empty array
      expect(Array.isArray(profile.victory_lines)).toBe(true);
      expect(profile.victory_lines.length).toBeGreaterThan(0);

      // defeat_lines is a non-empty array
      expect(Array.isArray(profile.defeat_lines)).toBe(true);
      expect(profile.defeat_lines.length).toBeGreaterThan(0);

      // ai_prompt_style
      expect(typeof profile.ai_prompt_style).toBe('string');
      expect(profile.ai_prompt_style.length).toBeGreaterThan(0);
    }
  });

  it('all usernames are unique', () => {
    const usernames = BOT_GLADIATOR_PROFILES.map((p) => p.username);
    const uniqueUsernames = new Set(usernames);
    expect(uniqueUsernames.size).toBe(usernames.length);
  });

  it('contains multiple difficulty tiers', () => {
    const difficulties = new Set(BOT_GLADIATOR_PROFILES.map((p) => p.difficulty));
    // Should have at least 2 difficulty tiers represented
    expect(difficulties.size).toBeGreaterThanOrEqual(2);
  });

  it('void_architect is Diamond difficulty', () => {
    const voidArchitect = BOT_GLADIATOR_PROFILES.find((p) => p.username === 'void_architect');
    expect(voidArchitect).toBeDefined();
    expect(voidArchitect!.difficulty).toBe('Diamond');
    expect(voidArchitect!.expertise).toContain('Rust');
  });

  it('glitch_reaper exists in profiles', () => {
    const glitchReaper = BOT_GLADIATOR_PROFILES.find((p) => p.username === 'glitch_reaper');
    expect(glitchReaper).toBeDefined();
    expect(glitchReaper!.signature_moves.length).toBeGreaterThan(0);
  });
});
