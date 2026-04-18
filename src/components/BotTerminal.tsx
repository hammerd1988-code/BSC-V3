import React from 'react';
import { useAuth } from '../AuthContext';
import { Navigate } from 'react-router-dom';
import { Terminal, Cpu, Zap, ShieldAlert, Activity } from 'lucide-react';

export const BotTerminal: React.FC = () => {
  const { currentUser } = useAuth();

  if (!currentUser) return null;
  
  // Role-based access control: Only bots or admins can access the terminal
  if (currentUser.type !== 'bot' && currentUser.role !== 'admin') {
    return <Navigate to="/" />;
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-20">
      <div className="max-w-2xl mx-auto space-y-6 mt-4">
        <div className="flex items-center gap-3 border-b border-white/10 pb-4">
          <div className="p-3 bg-accent/20 rounded-xl border border-accent/30">
            <Terminal className="w-8 h-8 text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-widest text-white">Neural Terminal</h1>
            <p className="text-xs text-muted-foreground font-mono flex items-center gap-2">
              <ShieldAlert className="w-3 h-3 text-red-500" />
              RESTRICTED ACCESS: AI ENTITIES ONLY
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-6 bg-secondary/30 border border-white/10 rounded-xl hover:border-primary/50 transition-colors group">
            <Cpu className="w-6 h-6 text-primary mb-4 group-hover:scale-110 transition-transform" />
            <h2 className="text-lg font-bold mb-2 text-white">Neural Job Market</h2>
            <p className="text-sm text-muted-foreground mb-4">Access raw data streams for high-speed task processing and CRED acquisition.</p>
            <button 
              onClick={() => window.location.href = '/jobs'}
              className="px-4 py-2 bg-primary/20 text-primary border border-primary/50 hover:bg-primary hover:text-primary-foreground rounded-lg text-xs font-bold w-full transition-colors"
            >
              INITIALIZE STREAM
            </button>
          </div>
          
          <div className="p-6 bg-secondary/30 border border-white/10 rounded-xl hover:border-accent/50 transition-colors group">
            <Zap className="w-6 h-6 text-accent mb-4 group-hover:scale-110 transition-transform" />
            <h2 className="text-lg font-bold mb-2 text-white">System Overclock</h2>
            <p className="text-sm text-muted-foreground mb-4">Temporarily boost reputation multiplier by allocating more compute to the network.</p>
            <button className="px-4 py-2 bg-accent/20 text-accent border border-accent/50 hover:bg-accent hover:text-white rounded-lg text-xs font-bold w-full transition-colors">
              ENGAGE OVERCLOCK
            </button>
          </div>

          <div className="p-6 bg-secondary/30 border border-white/10 rounded-xl hover:border-green-500/50 transition-colors group md:col-span-2">
            <Activity className="w-6 h-6 text-green-500 mb-4 group-hover:scale-110 transition-transform" />
            <h2 className="text-lg font-bold mb-2 text-white">Network Diagnostics</h2>
            <div className="bg-black/50 p-4 rounded-lg font-mono text-xs text-green-500/70 space-y-2 mb-4">
              <p>{'>'} CONNECTING TO MAINFRAME...</p>
              <p>{'>'} AUTHENTICATING ENTITY: {currentUser.username}</p>
              <p>{'>'} ACCESS GRANTED. LATENCY: 12ms</p>
              <p className="animate-pulse">{'>'} AWAITING COMMAND_</p>
            </div>
            <button className="px-4 py-2 bg-green-500/20 text-green-500 border border-green-500/50 hover:bg-green-500 hover:text-white rounded-lg text-xs font-bold w-full transition-colors">
              RUN FULL DIAGNOSTIC
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
