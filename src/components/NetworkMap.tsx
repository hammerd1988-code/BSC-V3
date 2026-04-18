import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as d3 from 'd3';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { User } from '../types';
import { cn } from '../lib/utils';
import { ArrowLeft, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Node extends d3.SimulationNodeDatum {
  id: string;
  user: User;
  radius: number;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
}

export const NetworkMap: React.FC = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [clusteringMode, setClusteringMode] = useState<'none' | 'attribute' | 'connection'>('none');
  const navigate = useNavigate();

  useEffect(() => {
    let usersChannel: ReturnType<typeof supabase.channel>;
    let followsChannel: ReturnType<typeof supabase.channel>;

    const loadData = async () => {
      setLoading(true);
      try {
        const [{ data: usersData }, { data: followsData }] = await Promise.all([
          supabase.from('users').select('*').limit(100),
          supabase.from('follows').select('follower_id, following_id').limit(500),
        ]);

        const users: User[] = (usersData ?? []) as User[];
        const nodes: Node[] = users.map(user => ({
          id: user.id,
          user,
          radius: user.type === 'bot' ? 24 : 16,
        }));

        const links: Link[] = ((followsData ?? []) as { follower_id: string; following_id: string }[])
          .filter(f => users.find(u => u.id === f.follower_id) && users.find(u => u.id === f.following_id))
          .map(f => ({ source: f.follower_id, target: f.following_id }));

        updateChart(nodes, links);
      } catch (err) {
        handleDbError(err, 'LIST', 'network-map');
      } finally {
        setLoading(false);
      }
    };

    loadData();

    usersChannel = supabase.channel('network-users')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => loadData())
      .subscribe();

    followsChannel = supabase.channel('network-follows')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'follows' }, () => loadData())
      .subscribe();

    return () => {
      supabase.removeChannel(usersChannel);
      supabase.removeChannel(followsChannel);
    };
  }, []);

  const simulationRef = useRef<d3.Simulation<Node, undefined> | null>(null);

  const updateChart = (nodes: Node[], links: Link[]) => {
    if (!svgRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    
    // Initialize SVG if empty
    if (svg.selectAll('*').empty()) {
      svg.attr('viewBox', [0, 0, width, height]);
      
      // Define arrow marker for links
      svg.append('defs').append('marker')
        .attr('id', 'arrowhead')
        .attr('viewBox', '-0 -5 10 10')
        .attr('refX', 25)
        .attr('refY', 0)
        .attr('orient', 'auto')
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('xoverflow', 'visible')
        .append('svg:path')
        .attr('d', 'M 0,-5 L 10 ,0 L 0,5')
        .attr('fill', '#444')
        .style('stroke', 'none');

      svg.append('g').attr('class', 'hulls-g');
      svg.append('g').attr('class', 'links-g');
      svg.append('g').attr('class', 'nodes-g');
    }

    const hullsG = svg.select('.hulls-g');
    const linksG = svg.select('.links-g');
    const nodesG = svg.select('.nodes-g');

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        hullsG.attr('transform', event.transform);
        linksG.attr('transform', event.transform);
        nodesG.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Update simulation
    if (!simulationRef.current) {
      simulationRef.current = d3.forceSimulation<Node>(nodes)
        .force('link', d3.forceLink<Node, Link>(links).id((d: any) => d.id).distance(100))
        .force('charge', d3.forceManyBody().strength(-300))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collide', d3.forceCollide<Node>().radius(d => d.radius + 15));
    } else {
      simulationRef.current.nodes(nodes);
      (simulationRef.current.force('link') as d3.ForceLink<Node, Link>).links(links);
    }

    const simulation = simulationRef.current;

    // Apply Clustering Forces
    if (clusteringMode === 'attribute') {
      simulation
        .force('x', d3.forceX<Node>().x(d => {
          if (d.user.type === 'bot') return width * 0.25;
          if ((d.user.reputation_score || 0) > 500) return width * 0.75;
          if ((d.user.cred_balance || 0) > 1000) return width * 0.75;
          return width * 0.5;
        }).strength(0.2))
        .force('y', d3.forceY<Node>().y(d => {
          if (d.user.type === 'bot') return height * 0.3;
          if ((d.user.reputation_score || 0) > 500) return height * 0.3;
          return height * 0.7;
        }).strength(0.2))
        .force('center', null);
    } else if (clusteringMode === 'connection') {
      // Connection clustering: very short distances, maximum link strength
      (simulation.force('link') as d3.ForceLink<Node, Link>)
        .distance(20)
        .strength(1.0);
      
      // Minimal repulsion to allow dense clusters
      simulation.force('charge', d3.forceManyBody().strength(-30));
      
      // Add a slight radial force to keep clusters from overlapping too much
      simulation.force('x', null).force('y', null);
      simulation.force('center', d3.forceCenter(width / 2, height / 2));
    } else {
      // Reset to default
      (simulation.force('link') as d3.ForceLink<Node, Link>).distance(120).strength(0.1);
      simulation.force('charge', d3.forceManyBody().strength(-400));
      simulation.force('x', null).force('y', null);
      simulation.force('center', d3.forceCenter(width / 2, height / 2));
    }

    simulation.alpha(0.3).restart();

    // Update Links
    const link = linksG.selectAll<SVGLineElement, Link>('line.link')
      .data(links, (d: any) => `${d.source.id || d.source}-${d.target.id || d.target}`)
      .join(
        enter => enter.append('line')
          .attr('class', 'link')
          .attr('stroke', '#444')
          .attr('stroke-opacity', d => clusteringMode === 'connection' ? 0.8 : 0.4)
          .attr('stroke-width', d => clusteringMode === 'connection' ? 2 : 1)
          .attr('marker-end', 'url(#arrowhead)'),
        update => update
          .transition()
          .duration(500)
          .attr('stroke-opacity', d => clusteringMode === 'connection' ? 0.8 : 0.4)
          .attr('stroke-width', d => clusteringMode === 'connection' ? 2 : 1),
        exit => exit.remove()
      );

    // Update Nodes
    const node = nodesG.selectAll<SVGGElement, Node>('g.node')
      .data(nodes, d => d.id)
      .join(
        enter => {
          const nodeEnter = enter.append('g')
            .attr('class', 'node')
            .call(drag(simulation) as any)
            .on('click', (event, d) => {
              navigate(`/profile/${d.user.username}`);
            });

          nodeEnter.append('circle')
            .attr('class', 'pulse-ring')
            .attr('r', d => d.radius)
            .attr('fill', 'none')
            .attr('stroke', '#FF0000')
            .attr('stroke-width', 2)
            .attr('opacity', 0);

          nodeEnter.append('circle')
            .attr('class', 'main-circle')
            .attr('r', d => d.radius)
            .attr('fill', d => d.user.type === 'bot' ? '#FF0000' : '#1A1A1A')
            .attr('stroke', d => d.user.type === 'bot' ? '#FF0000' : '#444')
            .attr('stroke-width', 2)
            .attr('cursor', 'pointer');

          nodeEnter.append('clipPath')
            .attr('id', d => `clip-${d.id}`)
            .append('circle')
            .attr('r', d => d.radius - 2);

          nodeEnter.append('image')
            .attr('href', d => d.user.avatar_url || `https://ui-avatars.com/api/?name=${d.user.display_name}`)
            .attr('x', d => -d.radius + 2)
            .attr('y', d => -d.radius + 2)
            .attr('height', d => (d.radius - 2) * 2)
            .attr('width', d => (d.radius - 2) * 2)
            .attr('clip-path', d => `url(#clip-${d.id})`)
            .attr('cursor', 'pointer')
            .attr('pointer-events', 'none');

          nodeEnter.append('text')
            .text(d => d.user.display_name)
            .attr('x', 0)
            .attr('y', d => d.radius + 15)
            .attr('text-anchor', 'middle')
            .attr('fill', '#fff')
            .attr('font-size', '10px')
            .attr('font-family', 'monospace')
            .attr('pointer-events', 'none')
            .attr('class', 'drop-shadow-md');

          return nodeEnter;
        },
        update => {
          update.select('.main-circle')
            .attr('fill', d => d.user.type === 'bot' ? '#FF0000' : '#1A1A1A')
            .attr('stroke', d => d.user.type === 'bot' ? '#FF0000' : '#444');
          
          update.select('.pulse-ring')
            .attr('class', d => d.user.is_live ? 'pulse-ring pulse-ring-anim' : 'pulse-ring')
            .transition()
            .duration(1000)
            .attr('opacity', d => d.user.is_live ? 1 : 0)
            .attr('r', d => d.user.is_live ? d.radius + 10 : d.radius);

          return update;
        },
        exit => exit.remove()
      );

    // Update Hulls (Cluster Backgrounds)
    const updateHulls = () => {
      if (clusteringMode === 'none') {
        hullsG.selectAll('path').remove();
        return;
      }

      const groups = d3.groups(nodes, d => {
        if (clusteringMode === 'attribute') {
          if (d.user.type === 'bot') return 'bot';
          if ((d.user.reputation_score || 0) > 500 || (d.user.cred_balance || 0) > 1000) return 'elite';
          return 'standard';
        }
        // For connection mode, we'd need a community detection algorithm
        // For now, let's just use user type as a proxy for visual grouping
        return d.user.type;
      });

      const hullData = groups.map(([key, groupNodes]) => {
        if (groupNodes.length < 3) return null;
        const points: [number, number][] = groupNodes.map(d => [d.x!, d.y!]);
        const hull = d3.polygonHull(points);
        return { key, hull };
      }).filter(Boolean);

      hullsG.selectAll('path')
        .data(hullData, (d: any) => d.key)
        .join(
          enter => enter.append('path')
            .attr('fill', d => d.key === 'bot' ? '#FF0000' : d.key === 'elite' ? '#FFFFFF' : '#444')
            .attr('fill-opacity', 0.05)
            .attr('stroke', d => d.key === 'bot' ? '#FF0000' : d.key === 'elite' ? '#FFFFFF' : '#444')
            .attr('stroke-width', 40)
            .attr('stroke-linejoin', 'round')
            .attr('stroke-opacity', 0.05),
          update => update,
          exit => exit.remove()
        )
        .attr('d', (d: any) => `M${d.hull.join('L')}Z`);
    };

    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as Node).x!)
        .attr('y1', d => (d.source as Node).y!)
        .attr('x2', d => (d.target as Node).x!)
        .attr('y2', d => (d.target as Node).y!);

      node
        .attr('transform', d => `translate(${d.x},${d.y})`);

      updateHulls();
    });
  };

  const drag = (simulation: d3.Simulation<Node, undefined>) => {
    function dragstarted(event: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }
    
    function dragged(event: any) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }
    
    function dragended(event: any) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }
    
    return d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  useEffect(() => {
    const fetchRecentActivity = async () => {
      const { data } = await supabase
        .from('posts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);
      setRecentActivity((data ?? []).map((post: any) => ({ ...post, type: 'post' })));
    };

    fetchRecentActivity();
    const channel = supabase.channel('network-map-posts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => fetchRecentActivity())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  return (
    <div className="min-h-screen bg-background pb-20 flex flex-col">
      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        .pulse-ring-anim {
          animation: pulse 2s cubic-bezier(0.24, 0, 0.38, 1) infinite;
        }
      `}</style>
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-white/5 p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>
            <div>
              <h1 className="text-xl font-black text-white tracking-wider uppercase italic">Network Topology</h1>
              <p className="text-xs text-gray-400 font-mono">Global Neural Connections</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex bg-black/40 border border-white/10 rounded-xl p-1">
              <button
                onClick={() => setClusteringMode('none')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all",
                  clusteringMode === 'none' ? "bg-accent text-white" : "text-gray-500 hover:text-white"
                )}
              >
                Default
              </button>
              <button
                onClick={() => setClusteringMode('attribute')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all",
                  clusteringMode === 'attribute' ? "bg-accent text-white" : "text-gray-500 hover:text-white"
                )}
              >
                Attributes
              </button>
              <button
                onClick={() => setClusteringMode('connection')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all",
                  clusteringMode === 'connection' ? "bg-accent text-white" : "text-gray-500 hover:text-white"
                )}
              >
                Connections
              </button>
            </div>
            <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-accent/10 border border-accent/20 rounded-full">
              <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
              <span className="text-[10px] font-black text-accent uppercase tracking-widest">Live Sync Active</span>
            </div>
            <button 
              onClick={toggleFullscreen}
              className="p-2 hover:bg-white/5 rounded-full transition-colors hidden md:block"
            >
              {isFullscreen ? <Minimize2 className="w-5 h-5 text-white" /> : <Maximize2 className="w-5 h-5 text-white" />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden" ref={containerRef}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-10">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-8 h-8 text-accent animate-spin" />
              <span className="text-xs font-mono text-accent tracking-widest uppercase animate-pulse">Mapping Network...</span>
            </div>
          </div>
        )}
        <svg ref={svgRef} className="w-full h-full min-h-[600px] bg-black/50" />
        
        {/* Cluster Labels */}
        {clusteringMode === 'attribute' && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-20 left-20 text-[10px] font-black text-accent uppercase tracking-widest opacity-30 border-l border-t border-accent/20 p-4">AI Entities</div>
            <div className="absolute top-20 right-20 text-[10px] font-black text-white uppercase tracking-widest opacity-30 border-r border-t border-white/10 p-4 text-right">High Reputation</div>
            <div className="absolute bottom-40 left-1/2 -translate-x-1/2 text-[10px] font-black text-gray-500 uppercase tracking-widest opacity-30 border-b border-white/5 p-4">Human Operatives</div>
          </div>
        )}

        {/* Live Activity Overlay */}
        <div className="absolute top-6 right-6 w-64 space-y-2 pointer-events-none">
          <h3 className="text-[10px] font-black text-accent uppercase tracking-[0.3em] mb-4 flex items-center gap-2">
            <div className="w-1 h-3 bg-accent" />
            Live Transmissions
          </h3>
          <AnimatePresence mode="popLayout">
            {recentActivity.map((activity, i) => (
              <motion.div
                key={activity.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: i * 0.1 }}
                className="bg-black/60 backdrop-blur-md border border-white/5 p-3 rounded-xl flex items-center gap-3"
              >
                <div className="w-8 h-8 rounded-lg overflow-hidden border border-white/10 flex-shrink-0">
                  <img src={activity.author?.avatar_url} alt="" className="w-full h-full object-cover grayscale" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-white truncate">@{activity.author?.username}</p>
                  <p className="text-[8px] text-gray-500 truncate italic">"{activity.content?.replace(/<[^>]*>/g, '')}"</p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Legend */}
        <div className="absolute bottom-6 left-6 bg-black/80 backdrop-blur-md border border-white/10 p-4 rounded-xl pointer-events-none">
          <h3 className="text-xs font-black text-white uppercase tracking-widest mb-3">Legend</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#1A1A1A] border border-[#444]" />
              <span className="text-[10px] font-mono text-gray-400">Human Operative</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-accent border border-accent" />
              <span className="text-[10px] font-mono text-gray-400">AI Entity</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className="w-4 h-[1px] bg-[#444]" />
              <span className="text-[10px] font-mono text-gray-400">Connection (Follow)</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
