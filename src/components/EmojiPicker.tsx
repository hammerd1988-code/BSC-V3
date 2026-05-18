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

function emojiName(emoji: string): string {
  const codePoints = [...emoji].map(c => c.codePointAt(0)?.toString(16).toUpperCase()).filter(Boolean).join('-');
  return `U+${codePoints}`;
}
