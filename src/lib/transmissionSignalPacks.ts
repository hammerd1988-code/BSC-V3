export type TransmissionSignalTab = 'gifs' | 'emoji' | 'stickers' | 'kaomoji';

export type TransmissionGifSignal = {
  id: string;
  label: string;
  mood: string;
  emoji: string;
  url: string;
  tags: string[];
};

export type TransmissionTextSignal = {
  id: string;
  type: Exclude<TransmissionSignalTab, 'gifs'>;
  label: string;
  value: string;
  tone: string;
  category: string;
};

export const TRANSMISSION_SIGNAL_TABS: Array<{ id: TransmissionSignalTab; label: string; kicker: string }> = [
  { id: 'gifs', label: 'GIFs', kicker: 'motion' },
  { id: 'emoji', label: 'Emoji', kicker: 'glyphs' },
  { id: 'stickers', label: 'Stickers', kicker: 'packs' },
  { id: 'kaomoji', label: 'Kaomoji', kicker: 'ascii' },
];

export const TRANSMISSION_GIF_SIGNALS: TransmissionGifSignal[] = [
  { id: 'matrix-rain', label: 'Matrix Rain', mood: 'Cyber focus', emoji: '🟩', url: 'https://media.giphy.com/media/YQitE4YNQNahy/giphy.gif', tags: ['code', 'matrix', 'focus', 'green'] },
  { id: 'neural-scan', label: 'Neural Scan', mood: 'Target locked', emoji: '👁️', url: 'https://media.giphy.com/media/26tn33aiTi1jkl6H6/giphy.gif', tags: ['scan', 'neural', 'terminal'] },
  { id: 'code-surge', label: 'Code Surge', mood: 'Shipping heat', emoji: '⚡', url: 'https://media.giphy.com/media/13HgwGsXF0aiGY/giphy.gif', tags: ['code', 'ship', 'typing'] },
  { id: 'void-pulse', label: 'Void Pulse', mood: 'Dark signal', emoji: '🕳️', url: 'https://media.giphy.com/media/l0HlQ7LRalQqdWfao/giphy.gif', tags: ['void', 'dark', 'pulse'] },
  { id: 'ghost-hack', label: 'Ghost Hack', mood: 'Silent breach', emoji: '👻', url: 'https://media.giphy.com/media/3o7TKsQ8UQ4l4LhGz6/giphy.gif', tags: ['ghost', 'hack', 'stealth'] },
  { id: 'terminal-glow', label: 'Terminal Glow', mood: 'Console live', emoji: '💻', url: 'https://media.giphy.com/media/3oKIPEqDGUULpEU0aQ/giphy.gif', tags: ['terminal', 'console', 'green'] },
  { id: 'firewall', label: 'Firewall', mood: 'Defensive mode', emoji: '🛡️', url: 'https://media.giphy.com/media/3o7abB06u9bNzA8lu8/giphy.gif', tags: ['shield', 'security', 'defense'] },
  { id: 'overclock', label: 'Overclock', mood: 'Speed run', emoji: '🏎️', url: 'https://media.giphy.com/media/11JTxkrmq4bGE0/giphy.gif', tags: ['fast', 'overclock', 'rush'] },
  { id: 'deploy-green', label: 'Deploy Green', mood: 'Build passed', emoji: '🟢', url: 'https://media.giphy.com/media/xT9IgzoKnwFNmISR8I/giphy.gif', tags: ['deploy', 'pass', 'green'] },
  { id: 'glitch-wave', label: 'Glitch Wave', mood: 'Signal warped', emoji: '📺', url: 'https://media.giphy.com/media/3o72FfM5HJydzafgUE/giphy.gif', tags: ['glitch', 'wave', 'static'] },
  { id: 'quantum-pop', label: 'Quantum Pop', mood: 'Reality split', emoji: '✨', url: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif', tags: ['quantum', 'mind', 'spark'] },
  { id: 'loot-drop', label: 'Loot Drop', mood: 'Reward unlocked', emoji: '💎', url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif', tags: ['loot', 'reward', 'win'] },
  { id: 'boss-mode', label: 'Boss Mode', mood: 'Arena energy', emoji: '👑', url: 'https://media.giphy.com/media/3o6Zt481isNVuQI1l6/giphy.gif', tags: ['boss', 'arena', 'win'] },
  { id: 'deep-work', label: 'Deep Work', mood: 'Locked in', emoji: '🧠', url: 'https://media.giphy.com/media/f3iwJFOVOwuy7K6FFw/giphy.gif', tags: ['deep', 'focus', 'think'] },
  { id: 'cat-ops', label: 'Cat Ops', mood: 'Keyboard familiar', emoji: '🐈', url: 'https://media.giphy.com/media/VbnUQpnihPSIgIXuZv/giphy.gif', tags: ['cat', 'typing', 'ops'] },
  { id: 'signal-boost', label: 'Signal Boost', mood: 'Amplified', emoji: '📡', url: 'https://media.giphy.com/media/5Zesu5VPNGJlm/giphy.gif', tags: ['signal', 'boost', 'broadcast'] },
];

export const TRANSMISSION_TEXT_SIGNALS: TransmissionTextSignal[] = [
  { id: 'surge', type: 'emoji', label: 'Surge', value: '⚡', tone: 'high voltage', category: 'BSC' },
  { id: 'ignite', type: 'emoji', label: 'Ignite', value: '🔥', tone: 'ship it', category: 'BSC' },
  { id: 'scan', type: 'emoji', label: 'Scan', value: '👁️', tone: 'observing', category: 'BSC' },
  { id: 'void', type: 'emoji', label: 'Void', value: '💀', tone: 'abyssal', category: 'BSC' },
  { id: 'neural', type: 'emoji', label: 'Neural', value: '🤖', tone: 'agentic', category: 'BSC' },
  { id: 'glitch', type: 'emoji', label: 'Glitch', value: '⚠️', tone: 'unstable', category: 'BSC' },
  { id: 'lock', type: 'emoji', label: 'Locked', value: '🔒', tone: 'secure', category: 'Ops' },
  { id: 'radar', type: 'emoji', label: 'Radar', value: '📡', tone: 'broadcast', category: 'Ops' },
  { id: 'target', type: 'emoji', label: 'Target', value: '🎯', tone: 'precise', category: 'Ops' },
  { id: 'gem', type: 'emoji', label: 'CRED Gem', value: '💎', tone: 'valuable', category: 'Status' },
  { id: 'crown', type: 'emoji', label: 'Boss', value: '👑', tone: 'dominant', category: 'Status' },
  { id: 'brain', type: 'emoji', label: 'Brain', value: '🧠', tone: 'strategic', category: 'Status' },
  { id: 'rocket', type: 'emoji', label: 'Launch', value: '🚀', tone: 'go live', category: 'Status' },
  { id: 'dna', type: 'emoji', label: 'DNA', value: '🧬', tone: 'evolving', category: 'Neural' },
  { id: 'satellite', type: 'emoji', label: 'Satellite', value: '🛰️', tone: 'uplink', category: 'Neural' },
  { id: 'black-heart', type: 'emoji', label: 'Black Heart', value: '🖤', tone: 'loyal', category: 'Mood' },
  { id: 'blue-heart', type: 'emoji', label: 'Neon Heart', value: '💙', tone: 'cool', category: 'Mood' },
  { id: 'sparkles', type: 'emoji', label: 'Spark', value: '✨', tone: 'polished', category: 'Mood' },
  { id: 'blood-code', type: 'stickers', label: 'Blood Code', value: '🩸 BLOOD//CODE', tone: 'ritual', category: 'BSC Pack' },
  { id: 'sweat-build', type: 'stickers', label: 'Sweat Build', value: '💦 SWEAT//BUILD', tone: 'grind', category: 'BSC Pack' },
  { id: 'void-approved', type: 'stickers', label: 'Void Approved', value: '🕳️ VOID APPROVED', tone: 'abyss seal', category: 'BSC Pack' },
  { id: 'neural-link', type: 'stickers', label: 'Neural Link', value: '🧠 NEURAL LINK STABLE', tone: 'connected', category: 'BSC Pack' },
  { id: 'casper-seen', type: 'stickers', label: 'Casper Seen', value: '👻 CASPER HAS SEEN IT', tone: 'haunted', category: 'BSC Pack' },
  { id: 'cred-rain', type: 'stickers', label: 'CRED Rain', value: '💎 CRED RAIN INBOUND', tone: 'wealth', category: 'BSC Pack' },
  { id: 'ship-signal', type: 'stickers', label: 'Ship Signal', value: '🚀 SHIP THE SIGNAL', tone: 'launch', category: 'BSC Pack' },
  { id: 'arena-ready', type: 'stickers', label: 'Arena Ready', value: '⚔️ ARENA READY', tone: 'combat', category: 'Colosseum' },
  { id: 'boss-signal', type: 'stickers', label: 'Boss Signal', value: '👑 BOSS SIGNAL', tone: 'ranked', category: 'Colosseum' },
  { id: 'bug-smoked', type: 'stickers', label: 'Bug Smoked', value: '🔥 BUG SMOKED', tone: 'fixed', category: 'Ops' },
  { id: 'green-build', type: 'stickers', label: 'Green Build', value: '🟢 BUILD GREEN', tone: 'passed', category: 'Ops' },
  { id: 'red-alert', type: 'stickers', label: 'Red Alert', value: '🔴 RED ALERT', tone: 'urgent', category: 'Ops' },
  { id: 'midnight-merge', type: 'stickers', label: 'Midnight Merge', value: '🌙 MIDNIGHT MERGE', tone: 'late ops', category: 'Ops' },
  { id: 'spark-lock', type: 'stickers', label: 'Spark Lock', value: '✨ LOCKED IN', tone: 'focused', category: 'Mood' },
  { id: 'ghosted', type: 'kaomoji', label: 'Ghosted', value: '(づ｡◕‿‿◕｡)づ 👻', tone: 'friendly haunt', category: 'Soft' },
  { id: 'locked-in', type: 'kaomoji', label: 'Locked In', value: '(ง •̀_•́)ง', tone: 'determined', category: 'Focus' },
  { id: 'void-stare', type: 'kaomoji', label: 'Void Stare', value: '(ಠ_ಠ)🕳️', tone: 'skeptical', category: 'Void' },
  { id: 'spark-wave', type: 'kaomoji', label: 'Spark Wave', value: 'ヾ(⌐■_■)ノ♪', tone: 'cool', category: 'Mood' },
  { id: 'bug-hunt', type: 'kaomoji', label: 'Bug Hunt', value: '┻━┻︵ \\(°□°)/ ︵ ┻━┻', tone: 'chaos', category: 'Ops' },
  { id: 'deploy-pray', type: 'kaomoji', label: 'Deploy Pray', value: '༼ つ ◕_◕ ༽つ', tone: 'summon', category: 'Ops' },
  { id: 'neural-nod', type: 'kaomoji', label: 'Neural Nod', value: '(•̀ᴗ•́)و ̑̑', tone: 'approved', category: 'Neural' },
  { id: 'shadow-peek', type: 'kaomoji', label: 'Shadow Peek', value: '|･ω･)ﾉ', tone: 'lurking', category: 'Void' },
  { id: 'ship-hype', type: 'kaomoji', label: 'Ship Hype', value: '٩( ᐛ )و 🚀', tone: 'hyped', category: 'Status' },
];
