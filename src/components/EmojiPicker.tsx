import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Search, X, Clock } from 'lucide-react';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

type EmojiCategory = {
  id: string;
  label: string;
  icon: string;
  emojis: string[];
};

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'recent',
    label: 'Recent',
    icon: '\u{1F552}',
    emojis: [],
  },
  {
    id: 'smileys',
    label: 'Smileys',
    icon: '\u{1F600}',
    emojis: [
      '\u{1F600}', '\u{1F603}', '\u{1F604}', '\u{1F601}', '\u{1F606}', '\u{1F605}', '\u{1F602}', '\u{1F923}', '\u{1F62D}',
      '\u{1F617}', '\u{1F619}', '\u{1F618}', '\u{1F970}', '\u{1F60D}', '\u{1F929}', '\u{1F92A}', '\u{1F61C}', '\u{1F61D}',
      '\u{1F60E}', '\u{1F913}', '\u{1F9D0}', '\u{1F60F}', '\u{1F612}', '\u{1F644}', '\u{1F62C}', '\u{1F925}', '\u{1F914}',
      '\u{1F910}', '\u{1F928}', '\u{1F610}', '\u{1F611}', '\u{1F636}', '\u{1F60C}', '\u{1F614}', '\u{1F62A}', '\u{1F924}',
      '\u{1F634}', '\u{1F637}', '\u{1F912}', '\u{1F915}', '\u{1F922}', '\u{1F92E}', '\u{1F927}', '\u{1F975}', '\u{1F976}',
      '\u{1F974}', '\u{1F635}', '\u{1F92F}', '\u{1F920}', '\u{1F973}', '\u{1F978}', '\u{1F60A}', '\u{1F607}', '\u{1F642}',
      '\u{1F643}', '\u{1F609}', '\u{1FAE0}', '\u{1F972}', '\u{1FAE2}', '\u{1FAE3}', '\u{1FAE1}',
      '\u{1F608}', '\u{1F47F}', '\u{1F479}', '\u{1F47A}', '\u{1F4A9}', '\u{1F47B}', '\u{1F480}', '\u{2620}\u{FE0F}',
      '\u{1F47D}', '\u{1F916}', '\u{1F383}', '\u{1F63A}', '\u{1F638}', '\u{1F639}', '\u{1F63B}', '\u{1F63C}', '\u{1F63D}',
    ],
  },
  {
    id: 'gestures',
    label: 'Gestures',
    icon: '\u{1F44B}',
    emojis: [
      '\u{1F44B}', '\u{1F91A}', '\u{1F590}\u{FE0F}', '\u{270B}', '\u{1F596}', '\u{1FAF1}', '\u{1FAF2}', '\u{1FAF3}', '\u{1FAF4}',
      '\u{1F44C}', '\u{1F90C}', '\u{270C}\u{FE0F}', '\u{1F91E}', '\u{1FAF0}', '\u{1F91F}', '\u{1F918}', '\u{1F919}',
      '\u{1F448}', '\u{1F449}', '\u{1F446}', '\u{1F447}', '\u{261D}\u{FE0F}', '\u{1FAF5}',
      '\u{1F44D}', '\u{1F44E}', '\u{270A}', '\u{1F44A}', '\u{1F91B}', '\u{1F91C}',
      '\u{1F44F}', '\u{1F64C}', '\u{1FAF6}', '\u{1F450}', '\u{1F932}', '\u{1F91D}', '\u{1F64F}',
      '\u{270D}\u{FE0F}', '\u{1F485}', '\u{1F933}', '\u{1F4AA}', '\u{1F9BE}', '\u{1F9BF}',
    ],
  },
  {
    id: 'people',
    label: 'People',
    icon: '\u{1F468}',
    emojis: [
      '\u{1F476}', '\u{1F9D2}', '\u{1F466}', '\u{1F467}', '\u{1F468}', '\u{1F469}', '\u{1F9D3}', '\u{1F474}', '\u{1F475}',
      '\u{1F46E}', '\u{1F575}\u{FE0F}', '\u{1F482}', '\u{1F977}', '\u{1F477}', '\u{1FAB4}', '\u{1F934}', '\u{1F478}',
      '\u{1F9D9}', '\u{1F9DA}', '\u{1F9DB}', '\u{1F9DC}', '\u{1F9DD}', '\u{1F9DE}', '\u{1F9DF}',
      '\u{1F9D1}\u{200D}\u{1F4BB}', '\u{1F468}\u{200D}\u{1F4BB}', '\u{1F469}\u{200D}\u{1F4BB}',
      '\u{1F9D1}\u{200D}\u{1F680}', '\u{1F468}\u{200D}\u{1F680}', '\u{1F469}\u{200D}\u{1F680}',
      '\u{1F9D1}\u{200D}\u{1F3A8}', '\u{1F468}\u{200D}\u{1F3A8}', '\u{1F469}\u{200D}\u{1F3A8}',
    ],
  },
  {
    id: 'nature',
    label: 'Nature',
    icon: '\u{1F43E}',
    emojis: [
      '\u{1F436}', '\u{1F431}', '\u{1F42D}', '\u{1F439}', '\u{1F430}', '\u{1F98A}', '\u{1F43B}', '\u{1F43C}', '\u{1F428}',
      '\u{1F42F}', '\u{1F981}', '\u{1F42E}', '\u{1F437}', '\u{1F438}', '\u{1F435}', '\u{1F649}', '\u{1F64A}', '\u{1F648}',
      '\u{1F412}', '\u{1F414}', '\u{1F427}', '\u{1F426}', '\u{1F985}', '\u{1F986}', '\u{1F989}', '\u{1F987}',
      '\u{1F40A}', '\u{1F422}', '\u{1F40D}', '\u{1F409}', '\u{1F995}', '\u{1F996}', '\u{1F419}', '\u{1F41A}',
      '\u{1F41D}', '\u{1F41B}', '\u{1F98B}', '\u{1F40C}', '\u{1F41E}', '\u{1F997}',
      '\u{1F339}', '\u{1F33B}', '\u{1F33A}', '\u{1F337}', '\u{1F338}', '\u{1F33C}', '\u{1F332}', '\u{1F333}', '\u{1F334}',
      '\u{1F335}', '\u{1F340}', '\u{1F341}', '\u{1F342}', '\u{1F343}',
    ],
  },
  {
    id: 'food',
    label: 'Food',
    icon: '\u{1F354}',
    emojis: [
      '\u{1F34E}', '\u{1F34F}', '\u{1F34A}', '\u{1F34B}', '\u{1F34C}', '\u{1F349}', '\u{1F347}', '\u{1F353}', '\u{1FAD0}',
      '\u{1F348}', '\u{1F352}', '\u{1F351}', '\u{1F96D}', '\u{1F34D}', '\u{1F965}', '\u{1F95D}',
      '\u{1F354}', '\u{1F35F}', '\u{1F355}', '\u{1F32D}', '\u{1F96A}', '\u{1F32E}', '\u{1F32F}', '\u{1FAD4}',
      '\u{1F35D}', '\u{1F35C}', '\u{1F363}', '\u{1F364}', '\u{1F359}', '\u{1F35A}',
      '\u{1F370}', '\u{1F382}', '\u{1F36D}', '\u{1F36C}', '\u{1F36B}', '\u{1F369}', '\u{1F9C1}',
      '\u{2615}', '\u{1F375}', '\u{1F37A}', '\u{1F37B}', '\u{1F377}', '\u{1F378}', '\u{1F379}', '\u{1F9CB}', '\u{1F9C3}',
    ],
  },
  {
    id: 'activities',
    label: 'Activities',
    icon: '\u{26BD}',
    emojis: [
      '\u{26BD}', '\u{1F3C0}', '\u{1F3C8}', '\u{26BE}', '\u{1F94E}', '\u{1F3BE}', '\u{1F3D0}', '\u{1F3C9}', '\u{1F94F}',
      '\u{1F3B1}', '\u{1F3D3}', '\u{1F3F8}', '\u{1F945}', '\u{1F3D2}', '\u{1F94D}', '\u{1F3CF}',
      '\u{26F3}', '\u{1F3AF}', '\u{1F3A3}', '\u{1F94A}', '\u{1F94B}', '\u{1F6F9}', '\u{1F6F7}',
      '\u{1F3AE}', '\u{1F579}\u{FE0F}', '\u{1F3B2}', '\u{1F3B0}', '\u{1F9E9}',
      '\u{1F3A4}', '\u{1F3B5}', '\u{1F3B6}', '\u{1F3B8}', '\u{1F3B9}', '\u{1F941}', '\u{1F3BA}',
      '\u{1F3AC}', '\u{1F3A8}', '\u{1F3AD}', '\u{1F3A0}', '\u{1F3A1}', '\u{1F3A2}',
    ],
  },
  {
    id: 'travel',
    label: 'Travel',
    icon: '\u{2708}\u{FE0F}',
    emojis: [
      '\u{1F697}', '\u{1F695}', '\u{1F699}', '\u{1F68C}', '\u{1F3CE}\u{FE0F}', '\u{1F6F5}', '\u{1F3CD}\u{FE0F}', '\u{1F6B2}',
      '\u{1F6A2}', '\u{26F5}', '\u{1F6A4}', '\u{2708}\u{FE0F}', '\u{1F680}', '\u{1F6F8}', '\u{1F6F0}\u{FE0F}',
      '\u{1F3D4}\u{FE0F}', '\u{1F30B}', '\u{1F3D6}\u{FE0F}', '\u{1F3DD}\u{FE0F}', '\u{1F3DE}\u{FE0F}',
      '\u{1F307}', '\u{1F306}', '\u{1F3D9}\u{FE0F}', '\u{1F303}', '\u{1F309}', '\u{1F30C}',
      '\u{1F5FC}', '\u{1F5FD}', '\u{1F3F0}', '\u{1F3EF}', '\u{1F3DF}\u{FE0F}', '\u{26FA}',
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    icon: '\u{1F4A1}',
    emojis: [
      '\u{1F4BB}', '\u{1F5A5}\u{FE0F}', '\u{2328}\u{FE0F}', '\u{1F4F1}', '\u{1F4F7}', '\u{1F4F8}', '\u{1F3A5}',
      '\u{1F4A1}', '\u{1F526}', '\u{1F56F}\u{FE0F}', '\u{1F4D6}', '\u{1F4DA}', '\u{1F4DD}', '\u{270F}\u{FE0F}',
      '\u{1F50D}', '\u{1F50E}', '\u{1F50F}', '\u{1F510}', '\u{1F511}', '\u{1F512}', '\u{1F513}',
      '\u{1F528}', '\u{1FA93}', '\u{2692}\u{FE0F}', '\u{1F6E0}\u{FE0F}', '\u{1F5E1}\u{FE0F}', '\u{2694}\u{FE0F}',
      '\u{1F4E6}', '\u{1F4EC}', '\u{1F4E8}', '\u{1F4E9}', '\u{1F4E4}', '\u{1F4E5}',
      '\u{1F389}', '\u{1F388}', '\u{1F380}', '\u{1F381}', '\u{1F397}\u{FE0F}', '\u{1F3C6}', '\u{1F3C5}', '\u{1F396}\u{FE0F}',
    ],
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icon: '\u{2764}\u{FE0F}',
    emojis: [
      '\u{2764}\u{FE0F}', '\u{1F9E1}', '\u{1F49B}', '\u{1F49A}', '\u{1F499}', '\u{1F49C}', '\u{1F5A4}', '\u{1FA76}',
      '\u{1F90D}', '\u{1F90E}', '\u{1F498}', '\u{1F49D}', '\u{1F496}', '\u{1F497}', '\u{1F493}', '\u{1F49E}', '\u{1F495}',
      '\u{1F48C}', '\u{1F4AF}', '\u{1F4A2}', '\u{1F4A5}', '\u{1F4AB}', '\u{1F4A6}', '\u{1F4A8}',
      '\u{2705}', '\u{274C}', '\u{2757}', '\u{2753}', '\u{1F4A4}',
      '\u{269B}\u{FE0F}', '\u{1F52E}', '\u{1F3B4}', '\u{1F0CF}',
      '\u{267E}\u{FE0F}', '\u{1F300}', '\u{2B50}', '\u{1F31F}', '\u{2728}', '\u{26A1}', '\u{1F525}', '\u{1F4A5}',
      '\u{1F6A9}', '\u{1F3F4}', '\u{1F3F3}\u{FE0F}',
    ],
  },
  {
    id: 'flags',
    label: 'Flags',
    icon: '\u{1F3C1}',
    emojis: [
      '\u{1F3C1}', '\u{1F6A9}', '\u{1F38C}', '\u{1F3F4}', '\u{1F3F3}\u{FE0F}',
      '\u{1F1FA}\u{1F1F8}', '\u{1F1EC}\u{1F1E7}', '\u{1F1E8}\u{1F1E6}', '\u{1F1E6}\u{1F1FA}', '\u{1F1E9}\u{1F1EA}',
      '\u{1F1EB}\u{1F1F7}', '\u{1F1EF}\u{1F1F5}', '\u{1F1F0}\u{1F1F7}', '\u{1F1E7}\u{1F1F7}', '\u{1F1EE}\u{1F1F3}',
      '\u{1F1EE}\u{1F1F9}', '\u{1F1EA}\u{1F1F8}', '\u{1F1F2}\u{1F1FD}', '\u{1F1F7}\u{1F1FA}', '\u{1F1E8}\u{1F1F3}',
    ],
  },
];

const RECENT_KEY = 'bsc-recent-emojis';
const MAX_RECENT = 32;

function getRecentEmojis(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRecentEmoji(emoji: string) {
  const recent = getRecentEmojis().filter(e => e !== emoji);
  recent.unshift(emoji);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch { /* noop */ }
  return recent;
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect }) => {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('smileys');
  const [recentEmojis, setRecentEmojis] = useState<string[]>(getRecentEmojis);
  const scrollRef = useRef<HTMLDivElement>(null);
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const handleSelect = useCallback((emoji: string) => {
    const updated = saveRecentEmoji(emoji);
    setRecentEmojis(updated);
    onSelect(emoji);
  }, [onSelect]);

  const scrollToCategory = useCallback((catId: string) => {
    setActiveCategory(catId);
    const el = categoryRefs.current[catId];
    if (el && scrollRef.current) {
      const containerTop = scrollRef.current.getBoundingClientRect().top;
      const elTop = el.getBoundingClientRect().top;
      scrollRef.current.scrollTop += elTop - containerTop - 4;
    }
  }, []);

  const categories = useMemo(() => {
    const cats = [...EMOJI_CATEGORIES];
    cats[0] = { ...cats[0], emojis: recentEmojis };
    return cats;
  }, [recentEmojis]);

  const filteredCategories = useMemo(() => {
    if (!query.trim()) return categories.filter(c => c.emojis.length > 0);
    const q = query.toLowerCase();
    const allEmojis = categories.flatMap(c => c.emojis);
    const unique = [...new Set(allEmojis)];
    const matched = unique.filter(e => {
      const name = emojiName(e).toLowerCase();
      return name.includes(q);
    });
    if (matched.length === 0) return [];
    return [{ id: 'search', label: `Results for "${query}"`, icon: '\u{1F50D}', emojis: matched }];
  }, [query, categories]);

  return (
    <div>
      {/* Search */}
      <div className="px-4 pt-3 pb-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cyan-400/60" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="SEARCH EMOJI..."
            className="w-full rounded-xl border border-white/10 bg-black/50 py-2 pl-9 pr-8 text-[10px] font-black uppercase tracking-[0.2em] text-white outline-none placeholder:text-gray-600 focus:border-cyan-500/50"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Category Tabs */}
      {!query && (
        <div className="flex gap-0.5 px-3 py-1.5 overflow-x-auto scrollbar-hide">
          {categories.filter(c => c.emojis.length > 0).map(cat => (
            <button
              key={cat.id}
              onClick={() => scrollToCategory(cat.id)}
              className={`flex-shrink-0 rounded-lg px-2 py-1.5 text-base transition-all ${
                activeCategory === cat.id
                  ? 'bg-cyan-500/15 scale-110'
                  : 'hover:bg-white/5 opacity-60 hover:opacity-100'
              }`}
              title={cat.label}
            >
              {cat.id === 'recent' ? <Clock className="w-4 h-4 text-cyan-400" /> : cat.icon}
            </button>
          ))}
        </div>
      )}

      {/* Emoji Grid */}
      <div
        ref={scrollRef}
        className="max-h-56 overflow-y-auto px-3 pb-3 custom-scrollbar"
        onScroll={() => {
          if (query || !scrollRef.current) return;
          const container = scrollRef.current;
          const containerTop = container.getBoundingClientRect().top;
          let closest = 'smileys';
          let minDist = Infinity;
          for (const cat of categories) {
            const el = categoryRefs.current[cat.id];
            if (!el) continue;
            const dist = Math.abs(el.getBoundingClientRect().top - containerTop);
            if (dist < minDist) { minDist = dist; closest = cat.id; }
          }
          if (closest !== activeCategory) setActiveCategory(closest);
        }}
      >
        {filteredCategories.length > 0 ? (
          filteredCategories.map(cat => (
            <div
              key={cat.id}
              ref={(el) => { categoryRefs.current[cat.id] = el; }}
            >
              <div className="sticky top-0 z-10 bg-black/80 backdrop-blur-sm py-1 mb-1">
                <span className="text-[8px] font-black uppercase tracking-[0.3em] text-zinc-500">{cat.label}</span>
              </div>
              <div className="grid grid-cols-8 gap-0.5">
                {cat.emojis.map((emoji, i) => (
                  <button
                    key={`${cat.id}-${i}`}
                    type="button"
                    onClick={() => handleSelect(emoji)}
                    className="flex h-9 w-full items-center justify-center rounded-lg text-xl transition-all hover:scale-125 hover:bg-white/10 active:scale-95"
                    title={emojiName(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="py-8 text-center text-[9px] font-black uppercase tracking-widest text-zinc-600">
            No emoji found
          </div>
        )}
      </div>
    </div>
  );
};

const EMOJI_KEYWORDS: Record<string, string> = {
  '\u{1F600}': 'grinning grin happy smile', '\u{1F603}': 'smiley happy joy smile', '\u{1F604}': 'smile happy grin joy',
  '\u{1F601}': 'beaming grin smile teeth', '\u{1F606}': 'laughing satisfied lol', '\u{1F605}': 'sweat smile nervous happy',
  '\u{1F602}': 'joy tears laughing crying lol', '\u{1F923}': 'rofl rolling floor laughing',
  '\u{1F62D}': 'crying loud sob tears sad', '\u{1F617}': 'kissing lips kiss', '\u{1F619}': 'kissing smiling eyes kiss',
  '\u{1F618}': 'blowing kiss heart love', '\u{1F970}': 'smiling hearts love adore', '\u{1F60D}': 'heart eyes love crush',
  '\u{1F929}': 'star struck excited amazing wow', '\u{1F92A}': 'zany crazy wild wacky', '\u{1F61C}': 'wink tongue playful',
  '\u{1F61D}': 'tongue squint playful silly', '\u{1F60E}': 'sunglasses cool shades', '\u{1F913}': 'nerd glasses geek smart',
  '\u{1F9D0}': 'monocle thinking curious', '\u{1F60F}': 'smirk sly smug', '\u{1F612}': 'unamused annoyed meh',
  '\u{1F644}': 'eye roll annoyed whatever', '\u{1F62C}': 'grimace awkward cringe', '\u{1F925}': 'lying pinocchio liar',
  '\u{1F914}': 'thinking hmm wonder curious', '\u{1F910}': 'zipper mouth shut secret quiet',
  '\u{1F928}': 'raised eyebrow suspicious skeptical', '\u{1F610}': 'neutral blank meh', '\u{1F611}': 'expressionless blank',
  '\u{1F636}': 'no mouth silent speechless', '\u{1F60C}': 'relieved calm peaceful content',
  '\u{1F614}': 'pensive sad thoughtful', '\u{1F62A}': 'sleepy tired drowsy', '\u{1F924}': 'drooling hungry yum',
  '\u{1F634}': 'sleeping zzz asleep tired', '\u{1F637}': 'mask sick medical face', '\u{1F912}': 'thermometer sick fever ill',
  '\u{1F915}': 'bandage hurt injured', '\u{1F922}': 'nauseated sick gross vomit', '\u{1F92E}': 'vomiting sick throw up puke',
  '\u{1F927}': 'sneezing tissue cold sick', '\u{1F975}': 'hot face heat warm sweating', '\u{1F976}': 'cold face freezing ice frozen',
  '\u{1F974}': 'woozy dizzy drunk tipsy', '\u{1F635}': 'dizzy knocked out dead', '\u{1F92F}': 'exploding head mind blown shocked',
  '\u{1F920}': 'cowboy hat yeehaw western', '\u{1F973}': 'party celebrate birthday confetti',
  '\u{1F978}': 'disguised incognito spy', '\u{1F60A}': 'blush happy smile pleased',
  '\u{1F607}': 'angel innocent halo', '\u{1F642}': 'slightly smiling smile', '\u{1F643}': 'upside down silly goofy',
  '\u{1F609}': 'wink winking flirty', '\u{1FAE0}': 'melting dissolving disappearing',
  '\u{1F972}': 'smiling tear happy sad bittersweet', '\u{1FAE2}': 'salute respect honor',
  '\u{1FAE3}': 'peeking shy hiding', '\u{1FAE1}': 'dotted line invisible hidden',
  '\u{1F608}': 'devil horns evil smiling', '\u{1F47F}': 'angry devil imp evil', '\u{1F479}': 'ogre monster scary',
  '\u{1F47A}': 'goblin monster evil', '\u{1F4A9}': 'poop poo shit', '\u{1F47B}': 'ghost boo spooky halloween',
  '\u{1F480}': 'skull dead skeleton death', '\u{2620}\u{FE0F}': 'skull crossbones death danger poison',
  '\u{1F47D}': 'alien ufo extraterrestrial space', '\u{1F916}': 'robot bot machine ai',
  '\u{1F383}': 'jack o lantern pumpkin halloween', '\u{1F63A}': 'cat grinning happy smile',
  '\u{1F638}': 'cat grin smile teeth', '\u{1F639}': 'cat joy tears laughing', '\u{1F63B}': 'cat heart eyes love',
  '\u{1F63C}': 'cat smirk wry', '\u{1F63D}': 'cat kissing lips',
  '\u{1F44B}': 'wave hello hi bye hand', '\u{1F91A}': 'raised back hand stop',
  '\u{1F590}\u{FE0F}': 'hand splayed fingers open', '\u{270B}': 'raised hand stop high five',
  '\u{1F596}': 'vulcan spock live long prosper', '\u{1FAF1}': 'rightwards hand right',
  '\u{1FAF2}': 'leftwards hand left', '\u{1FAF3}': 'palm down hand', '\u{1FAF4}': 'palm up hand',
  '\u{1F44C}': 'ok okay perfect fine hand', '\u{1F90C}': 'pinched fingers italian chef kiss',
  '\u{270C}\u{FE0F}': 'peace victory v sign two', '\u{1F91E}': 'crossed fingers luck hope',
  '\u{1FAF0}': 'hand with index finger and thumb crossed money', '\u{1F91F}': 'love you hand ily',
  '\u{1F918}': 'rock on metal horns', '\u{1F919}': 'call me hand shaka hang loose',
  '\u{1F448}': 'pointing left finger', '\u{1F449}': 'pointing right finger', '\u{1F446}': 'pointing up finger',
  '\u{1F447}': 'pointing down finger', '\u{261D}\u{FE0F}': 'index finger up point one',
  '\u{1FAF5}': 'index pointing at viewer you',
  '\u{1F44D}': 'thumbs up yes good like approve', '\u{1F44E}': 'thumbs down no bad dislike disapprove',
  '\u{270A}': 'fist raised power fight', '\u{1F44A}': 'fist bump punch',
  '\u{1F91B}': 'left fist bump', '\u{1F91C}': 'right fist bump',
  '\u{1F44F}': 'clap applause bravo congrats', '\u{1F64C}': 'raised hands celebrate praise hooray',
  '\u{1FAF6}': 'heart hands love', '\u{1F450}': 'open hands hug', '\u{1F932}': 'palms up together prayer',
  '\u{1F91D}': 'handshake deal agreement', '\u{1F64F}': 'pray please hope folded hands thank',
  '\u{270D}\u{FE0F}': 'writing hand pen pencil', '\u{1F485}': 'nail polish manicure beauty',
  '\u{1F933}': 'selfie phone camera', '\u{1F4AA}': 'muscle strong bicep flex arm',
  '\u{1F9BE}': 'mechanical arm robot prosthetic', '\u{1F9BF}': 'mechanical leg robot prosthetic',
  '\u{1F436}': 'dog face puppy pet woof', '\u{1F431}': 'cat face kitten pet meow',
  '\u{1F42D}': 'mouse face rat', '\u{1F439}': 'hamster face pet', '\u{1F430}': 'rabbit face bunny',
  '\u{1F98A}': 'fox face', '\u{1F43B}': 'bear face', '\u{1F43C}': 'panda face bear',
  '\u{1F428}': 'koala bear australia', '\u{1F42F}': 'tiger face cat', '\u{1F981}': 'lion face king',
  '\u{1F42E}': 'cow face moo', '\u{1F437}': 'pig face oink', '\u{1F438}': 'frog face toad ribbit',
  '\u{1F435}': 'monkey face ape', '\u{1F649}': 'hear no evil monkey', '\u{1F64A}': 'speak no evil monkey',
  '\u{1F648}': 'see no evil monkey', '\u{1F412}': 'monkey ape banana',
  '\u{1F414}': 'chicken hen rooster', '\u{1F427}': 'penguin ice arctic', '\u{1F426}': 'bird tweet',
  '\u{1F985}': 'eagle bird america', '\u{1F986}': 'duck quack', '\u{1F989}': 'owl night wise',
  '\u{1F987}': 'bat vampire night', '\u{1F40A}': 'crocodile alligator',
  '\u{1F422}': 'turtle slow shell', '\u{1F40D}': 'snake slither hiss', '\u{1F409}': 'dragon fire fantasy',
  '\u{1F995}': 'dinosaur sauropod brontosaurus', '\u{1F996}': 't-rex dinosaur tyrannosaurus',
  '\u{1F419}': 'octopus tentacles sea', '\u{1F41A}': 'shell spiral sea',
  '\u{1F41D}': 'bee honeybee buzz', '\u{1F41B}': 'bug caterpillar insect', '\u{1F98B}': 'butterfly insect pretty',
  '\u{1F40C}': 'snail slow shell', '\u{1F41E}': 'ladybug insect', '\u{1F997}': 'cricket insect chirp',
  '\u{1F339}': 'rose flower red love', '\u{1F33B}': 'sunflower yellow sun', '\u{1F33A}': 'hibiscus flower pink',
  '\u{1F337}': 'tulip flower spring', '\u{1F338}': 'cherry blossom flower sakura', '\u{1F33C}': 'blossom flower daisy',
  '\u{1F332}': 'evergreen tree pine', '\u{1F333}': 'deciduous tree leaf', '\u{1F334}': 'palm tree tropical beach',
  '\u{1F335}': 'cactus desert', '\u{1F340}': 'four leaf clover luck irish',
  '\u{1F341}': 'maple leaf canada autumn fall', '\u{1F342}': 'fallen leaf autumn', '\u{1F343}': 'leaf wind blowing',
  '\u{1F34E}': 'apple red fruit', '\u{1F34F}': 'green apple fruit', '\u{1F34A}': 'orange tangerine fruit',
  '\u{1F34B}': 'lemon yellow sour citrus', '\u{1F34C}': 'banana fruit yellow', '\u{1F349}': 'watermelon fruit summer',
  '\u{1F347}': 'grapes wine fruit purple', '\u{1F353}': 'strawberry fruit red berry', '\u{1FAD0}': 'blueberries berry fruit',
  '\u{1F348}': 'melon fruit', '\u{1F352}': 'cherries fruit red', '\u{1F351}': 'peach fruit butt',
  '\u{1F96D}': 'mango fruit tropical', '\u{1F34D}': 'pineapple fruit tropical', '\u{1F965}': 'coconut tropical',
  '\u{1F95D}': 'kiwi fruit green',
  '\u{1F354}': 'hamburger burger food fast', '\u{1F35F}': 'fries french fries fast food',
  '\u{1F355}': 'pizza food italian slice', '\u{1F32D}': 'hot dog sausage food', '\u{1F96A}': 'sandwich bread food lunch',
  '\u{1F32E}': 'taco mexican food', '\u{1F32F}': 'burrito mexican food wrap', '\u{1FAD4}': 'tamale mexican food',
  '\u{1F35D}': 'spaghetti pasta italian noodles', '\u{1F35C}': 'ramen noodles soup bowl',
  '\u{1F363}': 'sushi japanese food fish', '\u{1F364}': 'shrimp fried food', '\u{1F359}': 'rice ball japanese onigiri',
  '\u{1F35A}': 'rice bowl food', '\u{1F370}': 'shortcake cake dessert sweet',
  '\u{1F382}': 'birthday cake celebrate party', '\u{1F36D}': 'lollipop candy sweet', '\u{1F36C}': 'candy sweet sugar',
  '\u{1F36B}': 'chocolate bar candy sweet', '\u{1F369}': 'donut doughnut sweet breakfast', '\u{1F9C1}': 'cupcake muffin sweet',
  '\u{2615}': 'coffee hot drink tea cup', '\u{1F375}': 'tea green cup drink', '\u{1F37A}': 'beer mug drink alcohol',
  '\u{1F37B}': 'cheers beers clinking drink', '\u{1F377}': 'wine glass drink alcohol red',
  '\u{1F378}': 'cocktail martini drink alcohol', '\u{1F379}': 'tropical drink cocktail alcohol',
  '\u{1F9CB}': 'boba bubble tea drink', '\u{1F9C3}': 'beverage box juice',
  '\u{26BD}': 'soccer football sport ball', '\u{1F3C0}': 'basketball sport ball hoop',
  '\u{1F3C8}': 'football american sport', '\u{26BE}': 'baseball sport ball',
  '\u{1F94E}': 'softball sport ball', '\u{1F3BE}': 'tennis sport racquet ball',
  '\u{1F3D0}': 'volleyball sport ball', '\u{1F3C9}': 'rugby sport ball', '\u{1F94F}': 'lacrosse sport',
  '\u{1F3B1}': 'pool billiards 8ball', '\u{1F3D3}': 'ping pong table tennis',
  '\u{1F3F8}': 'badminton sport shuttlecock', '\u{1F945}': 'goal net sport', '\u{1F3D2}': 'ice hockey sport',
  '\u{1F94D}': 'lacrosse sport', '\u{1F3CF}': 'cricket sport bat',
  '\u{26F3}': 'golf flag hole sport', '\u{1F3AF}': 'bullseye dart target', '\u{1F3A3}': 'fishing rod sport',
  '\u{1F94A}': 'boxing glove fight sport', '\u{1F94B}': 'martial arts karate',
  '\u{1F6F9}': 'skateboard sport', '\u{1F6F7}': 'sled toboggan winter',
  '\u{1F3AE}': 'video game controller gaming', '\u{1F579}\u{FE0F}': 'joystick game controller',
  '\u{1F3B2}': 'dice game board chance', '\u{1F3B0}': 'slot machine casino gambling', '\u{1F9E9}': 'puzzle piece jigsaw',
  '\u{1F3A4}': 'microphone karaoke sing', '\u{1F3B5}': 'music note song melody',
  '\u{1F3B6}': 'music notes singing melody', '\u{1F3B8}': 'guitar music rock instrument',
  '\u{1F3B9}': 'piano keyboard music instrument', '\u{1F941}': 'drum music beat instrument',
  '\u{1F3BA}': 'trumpet music instrument brass',
  '\u{1F3AC}': 'clapper movie film action', '\u{1F3A8}': 'art palette painting creative',
  '\u{1F3AD}': 'theater performing arts drama mask', '\u{1F3A0}': 'carousel horse merry go round',
  '\u{1F3A1}': 'ferris wheel amusement park', '\u{1F3A2}': 'roller coaster amusement park ride',
  '\u{1F697}': 'car automobile vehicle drive', '\u{1F695}': 'taxi cab yellow car',
  '\u{1F699}': 'suv car vehicle sport', '\u{1F68C}': 'bus transit vehicle',
  '\u{1F3CE}\u{FE0F}': 'racing car formula f1', '\u{1F6F5}': 'motor scooter vespa',
  '\u{1F3CD}\u{FE0F}': 'motorcycle racing bike', '\u{1F6B2}': 'bicycle bike cycling',
  '\u{1F6A2}': 'ship cruise boat ocean', '\u{26F5}': 'sailboat boat wind',
  '\u{1F6A4}': 'speedboat fast water', '\u{2708}\u{FE0F}': 'airplane plane flight travel fly',
  '\u{1F680}': 'rocket space launch moon', '\u{1F6F8}': 'flying saucer ufo alien',
  '\u{1F6F0}\u{FE0F}': 'satellite space orbit',
  '\u{1F3D4}\u{FE0F}': 'snow mountain winter', '\u{1F30B}': 'volcano lava eruption',
  '\u{1F3D6}\u{FE0F}': 'beach umbrella sand sun', '\u{1F3DD}\u{FE0F}': 'desert island tropical',
  '\u{1F3DE}\u{FE0F}': 'national park nature', '\u{1F307}': 'sunset city evening',
  '\u{1F306}': 'cityscape dusk evening', '\u{1F3D9}\u{FE0F}': 'cityscape buildings skyline',
  '\u{1F303}': 'night stars city', '\u{1F309}': 'bridge night city', '\u{1F30C}': 'milky way galaxy stars space',
  '\u{1F5FC}': 'tokyo tower japan', '\u{1F5FD}': 'statue of liberty new york america',
  '\u{1F3F0}': 'castle european medieval', '\u{1F3EF}': 'japanese castle pagoda',
  '\u{1F3DF}\u{FE0F}': 'stadium arena sport', '\u{26FA}': 'tent camping outdoor',
  '\u{1F4BB}': 'laptop computer tech', '\u{1F5A5}\u{FE0F}': 'desktop computer screen monitor',
  '\u{2328}\u{FE0F}': 'keyboard type computer', '\u{1F4F1}': 'phone mobile cell smartphone',
  '\u{1F4F7}': 'camera photo picture', '\u{1F4F8}': 'camera flash photo',
  '\u{1F3A5}': 'movie camera film video', '\u{1F4A1}': 'light bulb idea bright',
  '\u{1F526}': 'flashlight torch light', '\u{1F56F}\u{FE0F}': 'candle light flame',
  '\u{1F4D6}': 'book open reading', '\u{1F4DA}': 'books stack library reading',
  '\u{1F4DD}': 'memo note writing pencil', '\u{270F}\u{FE0F}': 'pencil writing edit',
  '\u{1F50D}': 'magnifying glass search left', '\u{1F50E}': 'magnifying glass search right',
  '\u{1F50F}': 'lock key secure', '\u{1F510}': 'locked key secure closed',
  '\u{1F511}': 'key unlock password', '\u{1F512}': 'lock locked secure closed', '\u{1F513}': 'unlock open lock',
  '\u{1F528}': 'hammer tool build', '\u{1FA93}': 'axe chop wood tool',
  '\u{2692}\u{FE0F}': 'hammer pick tool mine', '\u{1F6E0}\u{FE0F}': 'wrench hammer tools build',
  '\u{1F5E1}\u{FE0F}': 'dagger knife blade weapon', '\u{2694}\u{FE0F}': 'crossed swords fight battle weapon',
  '\u{1F4E6}': 'package box delivery', '\u{1F4EC}': 'mailbox open mail',
  '\u{1F4E8}': 'incoming envelope email mail', '\u{1F4E9}': 'envelope arrow down email',
  '\u{1F4E4}': 'outbox tray send', '\u{1F4E5}': 'inbox tray receive',
  '\u{1F389}': 'party popper tada celebrate confetti', '\u{1F388}': 'balloon party celebrate birthday',
  '\u{1F380}': 'ribbon bow gift', '\u{1F381}': 'wrapped gift present birthday box',
  '\u{1F397}\u{FE0F}': 'reminder ribbon awareness', '\u{1F3C6}': 'trophy winner champion gold cup',
  '\u{1F3C5}': 'medal sports first place gold', '\u{1F396}\u{FE0F}': 'military medal honor',
  '\u{2764}\u{FE0F}': 'red heart love', '\u{1F9E1}': 'orange heart love', '\u{1F49B}': 'yellow heart love',
  '\u{1F49A}': 'green heart love', '\u{1F499}': 'blue heart love', '\u{1F49C}': 'purple heart love',
  '\u{1F5A4}': 'black heart dark love', '\u{1FA76}': 'light blue heart love',
  '\u{1F90D}': 'white heart pure love', '\u{1F90E}': 'brown heart love',
  '\u{1F498}': 'heart arrow cupid love valentine', '\u{1F49D}': 'heart ribbon gift love',
  '\u{1F496}': 'sparkling heart love shine', '\u{1F497}': 'growing heart love bigger',
  '\u{1F493}': 'beating heart love pulse alive', '\u{1F49E}': 'revolving hearts love spinning',
  '\u{1F495}': 'two hearts love couple', '\u{1F48C}': 'love letter envelope heart mail',
  '\u{1F4AF}': 'hundred 100 percent perfect score', '\u{1F4A2}': 'anger symbol mad',
  '\u{1F4A5}': 'boom collision explosion bang', '\u{1F4AB}': 'dizzy star sparkle',
  '\u{1F4A6}': 'sweat droplets splash water', '\u{1F4A8}': 'dash running wind fast',
  '\u{2705}': 'check mark yes done correct green', '\u{274C}': 'cross mark no wrong x red',
  '\u{2757}': 'exclamation mark warning important red', '\u{2753}': 'question mark what why',
  '\u{1F4A4}': 'zzz sleep sleeping tired',
  '\u{269B}\u{FE0F}': 'atom symbol science physics', '\u{1F52E}': 'crystal ball fortune magic predict',
  '\u{1F3B4}': 'flower playing cards game', '\u{1F0CF}': 'joker card game wild',
  '\u{267E}\u{FE0F}': 'infinity forever loop eternal', '\u{1F300}': 'cyclone spiral hurricane tornado',
  '\u{2B50}': 'star yellow gold', '\u{1F31F}': 'glowing star bright shine',
  '\u{2728}': 'sparkles magic shine glitter stars', '\u{26A1}': 'lightning bolt zap electric thunder high voltage',
  '\u{1F525}': 'fire flame hot lit', '\u{1F6A9}': 'triangular flag red',
  '\u{1F3F4}': 'black flag pirate', '\u{1F3F3}\u{FE0F}': 'white flag surrender peace',
  '\u{1F3C1}': 'checkered flag race finish', '\u{1F38C}': 'crossed flags japanese celebration',
  '\u{1F1FA}\u{1F1F8}': 'us usa america united states flag', '\u{1F1EC}\u{1F1E7}': 'gb uk britain england flag',
  '\u{1F1E8}\u{1F1E6}': 'canada flag maple', '\u{1F1E6}\u{1F1FA}': 'australia flag',
  '\u{1F1E9}\u{1F1EA}': 'germany deutschland flag', '\u{1F1EB}\u{1F1F7}': 'france flag',
  '\u{1F1EF}\u{1F1F5}': 'japan flag', '\u{1F1F0}\u{1F1F7}': 'korea south flag',
  '\u{1F1E7}\u{1F1F7}': 'brazil flag', '\u{1F1EE}\u{1F1F3}': 'india flag',
  '\u{1F1EE}\u{1F1F9}': 'italy flag', '\u{1F1EA}\u{1F1F8}': 'spain flag',
  '\u{1F1F2}\u{1F1FD}': 'mexico flag', '\u{1F1F7}\u{1F1FA}': 'russia flag',
  '\u{1F1E8}\u{1F1F3}': 'china flag',
  '\u{1F476}': 'baby child infant', '\u{1F9D2}': 'child kid young', '\u{1F466}': 'boy male young',
  '\u{1F467}': 'girl female young', '\u{1F468}': 'man male adult', '\u{1F469}': 'woman female adult',
  '\u{1F9D3}': 'older person elder senior', '\u{1F474}': 'old man grandpa elderly', '\u{1F475}': 'old woman grandma elderly',
  '\u{1F46E}': 'police officer cop', '\u{1F575}\u{FE0F}': 'detective spy sleuth', '\u{1F482}': 'guard royal british',
  '\u{1F977}': 'ninja stealth warrior', '\u{1F477}': 'construction worker hard hat builder',
  '\u{1FAB4}': 'potted plant houseplant', '\u{1F934}': 'prince royal crown', '\u{1F478}': 'princess royal tiara',
  '\u{1F9D9}': 'mage wizard magic', '\u{1F9DA}': 'fairy wings magic', '\u{1F9DB}': 'vampire dracula',
  '\u{1F9DC}': 'merperson mermaid ocean', '\u{1F9DD}': 'elf fantasy lord rings', '\u{1F9DE}': 'genie lamp magic wish',
  '\u{1F9DF}': 'zombie undead brain',
  '\u{1F9D1}\u{200D}\u{1F4BB}': 'technologist programmer coder developer', '\u{1F468}\u{200D}\u{1F4BB}': 'man technologist programmer',
  '\u{1F469}\u{200D}\u{1F4BB}': 'woman technologist programmer',
  '\u{1F9D1}\u{200D}\u{1F680}': 'astronaut space rocket', '\u{1F468}\u{200D}\u{1F680}': 'man astronaut space',
  '\u{1F469}\u{200D}\u{1F680}': 'woman astronaut space',
  '\u{1F9D1}\u{200D}\u{1F3A8}': 'artist painter creative', '\u{1F468}\u{200D}\u{1F3A8}': 'man artist painter',
  '\u{1F469}\u{200D}\u{1F3A8}': 'woman artist painter',
};

function emojiName(emoji: string): string {
  return EMOJI_KEYWORDS[emoji] || '';
}
