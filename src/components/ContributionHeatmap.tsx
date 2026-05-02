import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Loader2, Zap } from 'lucide-react';
import { supabase } from '../supabase';
import { cn } from '../lib/utils';
import type { UserActivityDaily } from '../types';

interface ContributionHeatmapProps {
  userId: string;
  data?: UserActivityDaily[];
  className?: string;
  accentColor?: string;
  compact?: boolean;
}

interface HeatmapDay {
  date: Date;
  key: string;
  isFuture: boolean;
  activity?: UserActivityDaily;
  score: number;
  intensity: 0 | 1 | 2 | 3 | 4;
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const formatDateKey = (date: Date) => {
  const normalized = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  return normalized.toISOString().slice(0, 10);
};

const getActivityScore = (activity?: UserActivityDaily) => {
  if (!activity) return 0;
  return (
    (activity.posts_count || 0) * 3 +
    (activity.comments_count || 0) * 2 +
    (activity.battles_count || 0) * 5 +
    Math.min(Math.floor((activity.cred_earned || 0) / 25), 8)
  );
};

const getIntensity = (score: number): 0 | 1 | 2 | 3 | 4 => {
  if (score <= 0) return 0;
  if (score <= 3) return 1;
  if (score <= 8) return 2;
  if (score <= 15) return 3;
  return 4;
};

const intensityClasses: Record<HeatmapDay['intensity'], string> = {
  0: 'bg-white/[0.045] border-white/[0.055]',
  1: 'bg-cyan-500/20 border-cyan-400/20 shadow-[0_0_6px_rgba(34,211,238,0.16)]',
  2: 'bg-fuchsia-500/30 border-fuchsia-400/25 shadow-[0_0_8px_rgba(217,70,239,0.22)]',
  3: 'bg-accent/55 border-accent/40 shadow-[0_0_10px_rgba(255,0,0,0.28)]',
  4: 'bg-yellow-400/75 border-yellow-200/60 shadow-[0_0_14px_rgba(250,204,21,0.38)]',
};

export const ContributionHeatmap: React.FC<ContributionHeatmapProps> = ({
  userId,
  data,
  className,
  accentColor,
  compact = false,
}) => {
  const [activityData, setActivityData] = useState<UserActivityDaily[]>(data ?? []);
  const [loading, setLoading] = useState(!data);

  useEffect(() => {
    if (data) {
      setActivityData(data);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fetchActivity = async () => {
      setLoading(true);
      const from = new Date();
      from.setDate(from.getDate() - 371);

      const { data: rows, error } = await supabase
        .from('user_activity_daily')
        .select('*')
        .eq('user_id', userId)
        .gte('date', formatDateKey(from))
        .order('date', { ascending: true });

      if (!cancelled) {
        if (error) {
          console.warn('[ContributionHeatmap] Failed to load activity', error.message);
          setActivityData([]);
        } else {
          setActivityData((rows ?? []) as UserActivityDaily[]);
        }
        setLoading(false);
      }
    };

    void fetchActivity();
    return () => { cancelled = true; };
  }, [data, userId]);

  const { weeks, totalActivity, activeDays, maxScore } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = new Date(today);
    start.setDate(today.getDate() - (51 * 7 + today.getDay()));

    const activityByDate = new Map<string, UserActivityDaily>(activityData.map((item) => [item.date, item]));
    const generatedWeeks: HeatmapDay[][] = [];
    let total = 0;
    let active = 0;
    let max = 0;

    for (let weekIndex = 0; weekIndex < 52; weekIndex += 1) {
      const week: HeatmapDay[] = [];
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        const date = new Date(start);
        date.setDate(start.getDate() + weekIndex * 7 + dayIndex);
        const key = formatDateKey(date);
        const activity = activityByDate.get(key);
        const isFuture = date > today;
        const score = isFuture ? 0 : getActivityScore(activity);
        const intensity = isFuture ? 0 : getIntensity(score);

        if (score > 0) {
          active += 1;
          total += score;
          max = Math.max(max, score);
        }

        week.push({ date, key, isFuture, activity, score, intensity });
      }
      generatedWeeks.push(week);
    }

    return { weeks: generatedWeeks, totalActivity: total, activeDays: active, maxScore: max };
  }, [activityData]);

  const monthMarkers = useMemo(() => {
    const markers: Array<{ label: string; week: number }> = [];
    let lastMonth = -1;

    weeks.forEach((week, weekIndex) => {
      const firstRealDay = week.find((day) => day.date.getDate() <= 7) ?? week[0];
      const month = firstRealDay.date.getMonth();
      if (month !== lastMonth && firstRealDay.date.getDate() <= 7) {
        markers.push({ label: MONTH_LABELS[month], week: weekIndex });
        lastMonth = month;
      }
    });

    return markers;
  }, [weeks]);

  const legendStyle = accentColor ? { '--profile-accent': accentColor } as React.CSSProperties : undefined;

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-3xl border border-white/10 bg-black/45 p-5 shadow-[0_0_34px_rgba(255,0,80,0.08)]',
        className
      )}
      style={legendStyle}
    >
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(255,0,80,0.12),transparent_35%),linear-gradient(135deg,rgba(34,211,238,0.07),transparent_45%)]" />
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-accent" />
              <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white">
                Contribution Matrix
              </h3>
            </div>
            <p className="text-[11px] text-gray-500 font-mono">
              52-week signal across posts, comments, Colosseum battles, and CRED earned.
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-black text-white leading-none">{activeDays}</p>
            <p className="text-[8px] font-black uppercase tracking-[0.22em] text-gray-500">active days</p>
          </div>
        </div>

        {loading ? (
          <div className="h-28 flex items-center justify-center text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : (
          <div className="overflow-x-auto pb-2 scrollbar-hide">
            <div className="min-w-[640px]">
              <div className="relative ml-6 h-5 mb-1">
                {monthMarkers.map((marker) => (
                  <span
                    key={`${marker.label}-${marker.week}`}
                    className="absolute text-[9px] font-bold uppercase tracking-widest text-gray-600"
                    style={{ left: `${marker.week * 12}px` }}
                  >
                    {marker.label}
                  </span>
                ))}
              </div>

              <div className="flex gap-2">
                <div className="grid grid-rows-7 gap-[3px] pt-0.5">
                  {DAY_LABELS.map((label, index) => (
                    <span key={`${label}-${index}`} className="h-[10px] text-[8px] text-gray-600 font-bold leading-[10px]">
                      {index % 2 === 1 ? label : ''}
                    </span>
                  ))}
                </div>

                <div className="flex gap-[3px]">
                  {weeks.map((week, weekIndex) => (
                    <div key={weekIndex} className="grid grid-rows-7 gap-[3px]">
                      {week.map((day) => {
                        const activity = day.activity;
                        const title = `${day.key}: ${activity?.posts_count ?? 0} posts, ${activity?.comments_count ?? 0} comments, ${activity?.battles_count ?? 0} battles, ${activity?.cred_earned ?? 0} CRED`;
                        return (
                          <div
                            key={day.key}
                            title={title}
                            className={cn(
                              'h-[10px] w-[10px] rounded-[3px] border transition-all duration-200 hover:scale-150 hover:z-20 hover:border-white/80',
                              intensityClasses[day.intensity],
                              day.isFuture && 'opacity-20'
                            )}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {!compact && (
          <div className="mt-5 grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-sm font-black text-white">{totalActivity}</p>
              <p className="text-[8px] font-black uppercase tracking-[0.2em] text-gray-500">signal score</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-sm font-black text-white">{maxScore}</p>
              <p className="text-[8px] font-black uppercase tracking-[0.2em] text-gray-500">peak day</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" />
              <div>
                <p className="text-sm font-black text-white">Neon</p>
                <p className="text-[8px] font-black uppercase tracking-[0.2em] text-gray-500">intensity</p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2 text-[9px] font-bold uppercase tracking-widest text-gray-600">
          <span>Low</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <div key={level} className={cn('h-2.5 w-2.5 rounded-[3px] border', intensityClasses[level as HeatmapDay['intensity']])} />
          ))}
          <span>High</span>
        </div>
      </div>
    </section>
  );
};

export default ContributionHeatmap;
