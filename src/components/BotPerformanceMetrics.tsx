import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { Bounty } from '../types';
import { 
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
  PieChart, Pie, Cell, Tooltip, Legend
} from 'recharts';
import { Activity, Clock, Target, Award } from 'lucide-react';

interface BotPerformanceMetricsProps {
  botId: string;
}

const COLORS = ['#3b82f6', '#ef4444', '#eab308', '#8b5cf6', '#10b981'];

export function BotPerformanceMetrics({ botId }: BotPerformanceMetricsProps) {
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const { data, error } = await supabase
          .from('bounties')
          .select('*')
          .eq('assigned_bot_id', botId);
        if (error) throw error;
        setBounties((data ?? []) as Bounty[]);
      } catch (error) {
        handleDbError(error, 'LIST', 'bounties');
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, [botId]);

  if (loading) {
    return (
      <div className="flex justify-center items-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (bounties.length === 0) {
    return (
      <div className="p-6 bg-black/40 rounded-xl border border-white/5 text-center">
        <Activity className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-50" />
        <p className="text-sm text-muted-foreground">No performance data available yet.</p>
      </div>
    );
  }

  // Calculate Metrics
  const completed = bounties.filter(b => b.status === 'completed').length;
  const rejected = bounties.filter(b => b.status === 'rejected').length;
  const inProgress = bounties.filter(b => b.status === 'in-progress' || b.status === 'review').length;
  const totalFinished = completed + rejected;
  
  const successRate = totalFinished > 0 ? Math.round((completed / totalFinished) * 100) : 0;

  // Average Completion Time (in hours)
  let totalCompletionTimeMs = 0;
  let completedWithTimeCount = 0;
  
  bounties.forEach(b => {
    if (b.status === 'completed' && b.completed_at && b.created_at) {
      const start = new Date(b.created_at).getTime();
      const end = new Date(b.completed_at).getTime();
      if (end > start) {
        totalCompletionTimeMs += (end - start);
        completedWithTimeCount++;
      }
    }
  });

  const avgCompletionTimeHours = completedWithTimeCount > 0 
    ? (totalCompletionTimeMs / completedWithTimeCount / (1000 * 60 * 60)).toFixed(1)
    : 'N/A';

  // Specialization Data
  const categoryCounts: Record<string, number> = {};
  bounties.forEach(b => {
    const cat = b.category || 'general';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });

  const specializationData = Object.entries(categoryCounts).map(([subject, count]) => ({
    subject: subject.charAt(0).toUpperCase() + subject.slice(1),
    A: count,
    fullMark: Math.max(...Object.values(categoryCounts)) + 1
  }));

  const statusData = [
    { name: 'Completed', value: completed },
    { name: 'Rejected', value: rejected },
    { name: 'In Progress', value: inProgress },
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-bold flex items-center gap-2 border-b border-white/10 pb-2">
        <Activity className="w-5 h-5 text-primary" />
        Neural Performance Metrics
      </h3>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-black/40 p-4 rounded-xl border border-white/5 flex flex-col items-center justify-center text-center">
          <Target className="w-5 h-5 text-blue-400 mb-2" />
          <span className="text-2xl font-black">{bounties.length}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Total Tasks</span>
        </div>
        <div className="bg-black/40 p-4 rounded-xl border border-white/5 flex flex-col items-center justify-center text-center">
          <Award className="w-5 h-5 text-green-400 mb-2" />
          <span className="text-2xl font-black">{successRate}%</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Success Rate</span>
        </div>
        <div className="bg-black/40 p-4 rounded-xl border border-white/5 flex flex-col items-center justify-center text-center">
          <Clock className="w-5 h-5 text-purple-400 mb-2" />
          <span className="text-2xl font-black">{avgCompletionTimeHours}{avgCompletionTimeHours !== 'N/A' ? 'h' : ''}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Avg Time</span>
        </div>
        <div className="bg-black/40 p-4 rounded-xl border border-white/5 flex flex-col items-center justify-center text-center">
          <Activity className="w-5 h-5 text-yellow-400 mb-2" />
          <span className="text-2xl font-black">{inProgress}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Active</span>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Specialization Radar Chart */}
        <div className="bg-black/40 p-4 rounded-xl border border-white/5">
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4 text-center">Task Specialization</h4>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="70%" data={specializationData}>
                <PolarGrid stroke="rgba(255,255,255,0.1)" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: '#888', fontSize: 10 }} />
                <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={false} axisLine={false} />
                <Radar name="Tasks" dataKey="A" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.4} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                  itemStyle={{ color: '#fff' }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status Pie Chart */}
        <div className="bg-black/40 p-4 rounded-xl border border-white/5">
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4 text-center">Task Outcomes</h4>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={
                      entry.name === 'Completed' ? '#10b981' : 
                      entry.name === 'Rejected' ? '#ef4444' : 
                      '#eab308'
                    } />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
