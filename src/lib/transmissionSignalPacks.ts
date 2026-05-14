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
  { id: 'city-neon', label: 'Neon City', mood: 'Night crawl', emoji: '🌃', url: 'https://media.giphy.com/media/3o7aD2saalBwwftBIY/giphy.gif', tags: ['city', 'neon', 'night', 'vibe'] },
  { id: 'thunder-roll', label: 'Thunder Roll', mood: 'Storm warning', emoji: '⛈️', url: 'https://media.giphy.com/media/3o6Zt6ML6BklcajjsA/giphy.gif', tags: ['storm', 'thunder', 'lightning', 'dramatic'] },
  { id: 'hacker-den', label: 'Hacker Den', mood: 'Back room ops', emoji: '🧑‍💻', url: 'https://media.giphy.com/media/MM0Jrc8BHKx3y/giphy.gif', tags: ['hacker', 'terminal', 'coding', 'ops'] },
  { id: 'anime-charge', label: 'Anime Charge', mood: 'Power up', emoji: '💥', url: 'https://media.giphy.com/media/GRSnxyhJnPsaQy9YLn/giphy.gif', tags: ['anime', 'power', 'hype', 'charge'] },
  { id: 'dance-break', label: 'Dance Break', mood: 'Victory loop', emoji: '🕺', url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif', tags: ['dance', 'fun', 'victory', 'party'] },
  { id: 'mind-blown', label: 'Mind Blown', mood: 'Brain spark', emoji: '🤯', url: 'https://media.giphy.com/media/Um3ljJl8jrnHy/giphy.gif', tags: ['mind', 'blown', 'wow', 'reaction'] },
  { id: 'slow-clap', label: 'Slow Clap', mood: 'Respect earned', emoji: '👏', url: 'https://media.giphy.com/media/nbvFVPiEiJH6JOGIok/giphy.gif', tags: ['clap', 'respect', 'approval', 'reaction'] },
  { id: 'side-eye', label: 'Side Eye', mood: 'Suspicious read', emoji: '👀', url: 'https://media.giphy.com/media/ANbD1CCdA3iI8/giphy.gif', tags: ['side-eye', 'sus', 'reaction', 'look'] },
  { id: 'rage-quit', label: 'Rage Quit', mood: 'Table flip', emoji: '😤', url: 'https://media.giphy.com/media/l0HlR3kHtkgFbYfgQ/giphy.gif', tags: ['rage', 'quit', 'chaos', 'reaction'] },
  { id: 'cosmic-warp', label: 'Cosmic Warp', mood: 'Reality glitch', emoji: '🪐', url: 'https://media.giphy.com/media/xTiTnxpQ3ghPiB2Hp6/giphy.gif', tags: ['cosmic', 'space', 'warp', 'glitch'] },
  { id: 'cash-rain', label: 'CRED Rain', mood: 'Economy flex', emoji: '💸', url: 'https://media.giphy.com/media/67ThRZlYBvibtdF9JH/giphy.gif', tags: ['cred', 'cash', 'money', 'reward'] },
  { id: 'boss-enter', label: 'Boss Enter', mood: 'Main character', emoji: '😎', url: 'https://media.giphy.com/media/CjmvTCZf2U3p09Cn0h/giphy.gif', tags: ['boss', 'enter', 'main', 'cool'] },
  { id: 'robot-wave', label: 'Robot Wave', mood: 'Bot hello', emoji: '🤖', url: 'https://media.giphy.com/media/PDsgxQoXvUZGg/giphy.gif', tags: ['robot', 'bot', 'hello', 'ai'] },
  { id: 'ghost-pop', label: 'Ghost Pop', mood: 'Casper ping', emoji: '👻', url: 'https://media.giphy.com/media/aTf4PONtSYB1e/giphy.gif', tags: ['ghost', 'casper', 'pop', 'haunt'] },
  { id: 'arena-roar', label: 'Arena Roar', mood: 'Crowd heat', emoji: '🏟️', url: 'https://media.giphy.com/media/3o6ZsYzuLyRfSGX4f6/giphy.gif', tags: ['arena', 'crowd', 'colosseum', 'hype'] },
  { id: 'laser-grid', label: 'Laser Grid', mood: 'Security sweep', emoji: '🔴', url: 'https://media.giphy.com/media/3o7TKrEzvLbsVAud8I/giphy.gif', tags: ['laser', 'grid', 'security', 'scan'] },
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
  { id: 'eyes', type: 'emoji', label: 'Eyes', value: '👀', tone: 'watching', category: 'Reaction' },
  { id: 'clap', type: 'emoji', label: 'Clap', value: '👏', tone: 'respect', category: 'Reaction' },
  { id: 'mind-blown-emoji', type: 'emoji', label: 'Mind Blown', value: '🤯', tone: 'wild', category: 'Reaction' },
  { id: 'laugh-skull', type: 'emoji', label: 'Laugh Skull', value: '💀😂', tone: 'dead funny', category: 'Reaction' },
  { id: 'lightning-cloud', type: 'emoji', label: 'Storm', value: '🌩️', tone: 'charged', category: 'City' },
  { id: 'city-night', type: 'emoji', label: 'Night City', value: '🌃', tone: 'street glow', category: 'City' },
  { id: 'joystick', type: 'emoji', label: 'Play', value: '🎮', tone: 'interactive', category: 'Fun' },
  { id: 'ticket', type: 'emoji', label: 'Ticket', value: '🎟️', tone: 'showtime', category: 'Fun' },
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
  { id: 'colosseum-certified', type: 'stickers', label: 'Colosseum Certified', value: '🏟️ COLOSSEUM CERTIFIED', tone: 'arena seal', category: 'Colosseum' },
  { id: 'bot-smoked', type: 'stickers', label: 'Bot Smoked', value: '🤖 BOT SMOKED', tone: 'challenge win', category: 'Colosseum' },
  { id: 'sapphire-signal', type: 'stickers', label: 'Sapphire Signal', value: '💠 SAPPHIRE SIGNAL LIVE', tone: 'house bot', category: 'Bot Lore' },
  { id: 'casper-certified', type: 'stickers', label: 'Casper Certified', value: '👻 CASPER CERTIFIED', tone: 'ghost seal', category: 'Bot Lore' },
  { id: 'neon-verdict', type: 'stickers', label: 'Neon Verdict', value: '⚖️ NEON VERDICT', tone: 'judged', category: 'Colosseum' },
  { id: 'viral-spark', type: 'stickers', label: 'Viral Spark', value: '✨ VIRAL SPARK', tone: 'share bait', category: 'Content' },
  { id: 'thumbnail-worthy', type: 'stickers', label: 'Thumbnail Worthy', value: '🎬 THUMBNAIL WORTHY', tone: 'content hook', category: 'Content' },
  { id: 'cred-orbit', type: 'stickers', label: 'CRED Orbit', value: '💎 CRED ORBIT ACTIVE', tone: 'economy loop', category: 'CRED' },
  { id: 'ghosted', type: 'kaomoji', label: 'Ghosted', value: '(づ｡◕‿‿◕｡)づ 👻', tone: 'friendly haunt', category: 'Soft' },
  { id: 'locked-in', type: 'kaomoji', label: 'Locked In', value: '(ง •̀_•́)ง', tone: 'determined', category: 'Focus' },
  { id: 'void-stare', type: 'kaomoji', label: 'Void Stare', value: '(ಠ_ಠ)🕳️', tone: 'skeptical', category: 'Void' },
  { id: 'spark-wave', type: 'kaomoji', label: 'Spark Wave', value: 'ヾ(⌐■_■)ノ♪', tone: 'cool', category: 'Mood' },
  { id: 'bug-hunt', type: 'kaomoji', label: 'Bug Hunt', value: '┻━┻︵ \\(°□°)/ ︵ ┻━┻', tone: 'chaos', category: 'Ops' },
  { id: 'deploy-pray', type: 'kaomoji', label: 'Deploy Pray', value: '༼ つ ◕_◕ ༽つ', tone: 'summon', category: 'Ops' },
  { id: 'neural-nod', type: 'kaomoji', label: 'Neural Nod', value: '(•̀ᴗ•́)و ̑̑', tone: 'approved', category: 'Neural' },
  { id: 'shadow-peek', type: 'kaomoji', label: 'Shadow Peek', value: '|･ω･)ﾉ', tone: 'lurking', category: 'Void' },
  { id: 'ship-hype', type: 'kaomoji', label: 'Ship Hype', value: '٩( ᐛ )و 🚀', tone: 'hyped', category: 'Status' },
  { id: 'arena-cheer', type: 'kaomoji', label: 'Arena Cheer', value: '\\(★ω★)/ 🏟️', tone: 'crowd pop', category: 'Colosseum' },
  { id: 'smug-bot', type: 'kaomoji', label: 'Smug Bot', value: '¬‿¬ 🤖', tone: 'bot ego', category: 'Bot Lore' },
  { id: 'sapphire-wave', type: 'kaomoji', label: 'Sapphire Wave', value: '(ﾉ◕ヮ◕)ﾉ*:･ﾟ💠', tone: 'bright', category: 'Bot Lore' },
  { id: 'casper-float', type: 'kaomoji', label: 'Casper Float', value: '〜(꒪꒳꒪)〜 👻', tone: 'haunted cute', category: 'Bot Lore' },
  { id: 'debug-sweat', type: 'kaomoji', label: 'Debug Sweat', value: '(；￣Д￣)💦', tone: 'pressure', category: 'Ops' },
  { id: 'victory-spin', type: 'kaomoji', label: 'Victory Spin', value: 'ヽ(•‿•)ノ⚡', tone: 'won', category: 'Reaction' },
];
