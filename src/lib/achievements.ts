import { supabase } from '../supabase';

export interface AchievementDef {
  key: string;
  title: string;
  description: string;
  icon: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  // Creation
  { key: 'first_post', title: 'Signal Sent', description: 'Posted your first transmission', icon: '📡', rarity: 'common' },
  { key: 'posts_10', title: 'Broadcast Node', description: 'Posted 10 transmissions', icon: '🔊', rarity: 'common' },
  { key: 'posts_50', title: 'Signal Amplifier', description: 'Posted 50 transmissions', icon: '📻', rarity: 'rare' },
  { key: 'posts_100', title: 'Neural Broadcaster', description: 'Posted 100 transmissions', icon: '🌐', rarity: 'epic' },
  // Engagement received
  { key: 'likes_10', title: 'Resonance Detected', description: 'Received 10 likes', icon: '⚡', rarity: 'common' },
  { key: 'likes_100', title: 'Signal Amplified', description: 'Received 100 likes', icon: '🔥', rarity: 'rare' },
  { key: 'views_100', title: 'Observed', description: 'Your posts were viewed 100 times', icon: '👁', rarity: 'common' },
  { key: 'views_1000', title: 'Broadcast Viral', description: 'Your posts were viewed 1,000 times', icon: '🌊', rarity: 'rare' },
  // Social
  { key: 'first_friend', title: 'Neural Link', description: 'Made your first connection', icon: '🤝', rarity: 'common' },
  { key: 'friends_10', title: 'Network Node', description: 'Connected with 10 operatives', icon: '🕸', rarity: 'rare' },
  { key: 'followers_50', title: 'Signal Leader', description: 'Gained 50 followers', icon: '📣', rarity: 'rare' },
  // Streaks
  { key: 'streak_3', title: 'Consistent Signal', description: '3-day login streak', icon: '🔗', rarity: 'common' },
  { key: 'streak_7', title: 'Weekly Operative', description: '7-day login streak', icon: '⚙️', rarity: 'rare' },
  { key: 'streak_30', title: 'Neural Devotee', description: '30-day login streak', icon: '🧠', rarity: 'epic' },
  // Profile
  { key: 'profile_complete', title: 'Identity Established', description: 'Completed your profile setup', icon: '🪪', rarity: 'common' },
  { key: 'profile_customized', title: 'Unique Signal', description: 'Customized your profile theme', icon: '🎨', rarity: 'rare' },
  // Special
  { key: 'early_adopter', title: 'Early Operative', description: 'Joined during the early access period', icon: '🌟', rarity: 'legendary' },
  { key: 'first_reaction', title: 'Signal Reactor', description: 'Used a signal reaction for the first time', icon: '⚡', rarity: 'common' },
];

/**
 * Award an achievement to a user if they don't already have it.
 * Returns true if newly awarded, false if already had it.
 */
export async function awardAchievement(userId: string, key: string): Promise<boolean> {
  const { error } = await supabase
    .from('achievements')
    .insert({ user_id: userId, achievement_key: key })
    .select();

  if (error) {
    // Unique constraint violation = already awarded, that's fine
    if (error.code === '23505') return false;
    console.error('[Achievements] Award error:', error);
    return false;
  }

  // Create a notification for the achievement
  await supabase.from('notifications').insert({
    user_id: userId,
    type: 'achievement',
    data: { achievement_key: key },
    read: false,
  });

  return true;
}

/**
 * Update daily streak for a user. Call on login/app open.
 */
export async function updateDailyStreak(userId: string, currentStreak: number, longestStreak: number, lastActiveDate: string | null): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  if (lastActiveDate === today) return; // Already updated today

  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const newStreak = lastActiveDate === yesterday ? currentStreak + 1 : 1;
  const newLongest = Math.max(longestStreak, newStreak);

  await supabase.from('users').update({
    current_streak: newStreak,
    longest_streak: newLongest,
    last_active_date: today,
  }).eq('id', userId);

  // Award streak achievements
  if (newStreak >= 3) await awardAchievement(userId, 'streak_3');
  if (newStreak >= 7) await awardAchievement(userId, 'streak_7');
  if (newStreak >= 30) await awardAchievement(userId, 'streak_30');
}
