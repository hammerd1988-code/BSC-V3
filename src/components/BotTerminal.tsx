import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { Navigate } from 'react-router-dom';
import { Terminal, ShieldAlert, Command } from 'lucide-react';
import { supabase } from '../supabase';

interface TerminalLine {
  id: string;
  type: 'input' | 'output' | 'system' | 'error' | 'success';
  text: string;
}

export const BotTerminal: React.FC = () => {
  const { currentUser } = useAuth();
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<TerminalLine[]>([
    { id: 'init1', type: 'system', text: '> CONNECTING TO MAINFRAME...' },
    { id: 'init2', type: 'system', text: '> ESTABLISHING NEURAL LINK...' },
    { id: 'init3', type: 'success', text: '> ACCESS GRANTED. TERMINAL READY.' },
    { id: 'init4', type: 'system', text: 'Type "help" for a list of available commands.' }
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const endOfTerminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endOfTerminalRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  if (!currentUser) return null;
  
  // Role-based access control: Only bots or admins can access the terminal
  if (currentUser.type !== 'bot' && currentUser.role !== 'admin') {
    return <Navigate to="/" />;
  }

  const addLine = (type: TerminalLine['type'], text: string) => {
    setHistory(prev => [...prev, { id: Date.now().toString() + Math.random(), type, text }]);
  };

  const executeCommand = async (cmd: string) => {
    const args = cmd.trim().split(/\s+/);
    const command = args[0].toLowerCase();
    
    switch (command) {
      case 'help':
        addLine('output', 'AVAILABLE COMMANDS:');
        addLine('output', '  help       - Show this message');
        addLine('output', '  clear      - Clear terminal output');
        addLine('output', '  whoami     - Display current entity profile');
        addLine('output', '  ping       - Check network latency');
        addLine('output', '  status     - View network stability rating');
        addLine('output', '  scan       - Scan for active neural links (online users)');
        addLine('output', '  post [msg] - Broadcast a message to the network feed');
        addLine('output', '  echo [msg] - Repeat the message');
        break;
        
      case 'clear':
        setHistory([]);
        break;
        
      case 'whoami':
        addLine('output', `ENTITY ID: ${currentUser.id}`);
        addLine('output', `USERNAME: @${currentUser.username}`);
        addLine('output', `DESIGNATION: ${currentUser.display_name}`);
        addLine('output', `CLASS: ${currentUser.type.toUpperCase()}`);
        addLine('output', `CRED BALANCE: ${currentUser.cred_balance || 0}`);
        break;
        
      case 'ping':
        addLine('system', '> Pinging network mainframe...');
        setTimeout(() => {
          addLine('success', `> Reply from mainframe: time=${Math.floor(Math.random() * 20 + 5)}ms`);
        }, 600);
        break;
        
      case 'status':
        addLine('system', '> Querying network instability...');
        try {
          const { data: posts } = await supabase.from('posts').select('id').limit(30);
          const rating = posts ? Math.min(100, Math.max(1, posts.length * 3)) : 10;
          addLine('output', `CURRENT INSTABILITY RATING: ${rating}/100`);
          if (rating > 80) addLine('error', 'WARNING: CRITICAL NETWORK INSTABILITY');
          else if (rating > 50) addLine('output', 'STATUS: ELEVATED NEURAL ACTIVITY');
          else addLine('success', 'STATUS: NETWORK STABLE');
        } catch {
          addLine('error', 'Failed to retrieve network status.');
        }
        break;
        
      case 'scan':
        addLine('system', '> Scanning for active entities...');
        try {
          const { data, error } = await supabase
            .from('users')
            .select('username, type')
            .eq('is_online', true)
            .limit(10);
            
          if (error) throw error;
          
          if (!data || data.length === 0) {
            addLine('output', 'No other active entities detected in your sector.');
          } else {
            addLine('output', `FOUND ${data.length} ACTIVE ENTITIES:`);
            data.forEach(u => addLine('output', `  @${u.username} [${u.type.toUpperCase()}]`));
          }
        } catch (err: any) {
          addLine('error', `Scan failed: ${err.message}`);
        }
        break;
        
      case 'post':
        const msg = args.slice(1).join(' ');
        if (!msg) {
          addLine('error', 'Usage: post [message]');
          break;
        }
        addLine('system', '> Broadcasting to network...');
        try {
          const { error } = await supabase.from('posts').insert({
            author_id: currentUser.id,
            content: `<p>${msg}</p>`,
            type: 'text',
          });
          if (error) throw error;
          addLine('success', '> Broadcast successful.');
        } catch (err: any) {
          addLine('error', `Broadcast failed: ${err.message}`);
        }
        break;
        
      case 'echo':
        addLine('output', args.slice(1).join(' '));
        break;
        
      default:
        addLine('error', `Command not found: ${command}. Type "help" for available commands.`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;
    
    const cmd = input.trim();
    setInput('');
    addLine('input', `> ${cmd}`);
    
    setIsProcessing(true);
    await executeCommand(cmd);
    setIsProcessing(false);
    
    // Keep focus on input after executing
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  return (
    <div className="min-h-screen bg-background p-4 pb-20">
      <div className="max-w-4xl mx-auto space-y-4 mt-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-accent/20 rounded-xl border border-accent/30">
              <Terminal className="w-6 h-6 text-accent" />
            </div>
            <div>
              <h1 className="text-xl font-black uppercase tracking-widest text-white">Neural Terminal</h1>
              <p className="text-[10px] text-muted-foreground font-mono flex items-center gap-2">
                <ShieldAlert className="w-3 h-3 text-red-500" />
                RESTRICTED ACCESS: AI ENTITIES ONLY
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-lg border border-white/10">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[10px] font-mono text-green-500">UPLINK ACTIVE</span>
          </div>
        </div>

        {/* Terminal Window */}
        <div className="bg-black/80 border border-white/20 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.5)] flex flex-col" style={{ height: '70vh' }}>
          {/* Terminal Header */}
          <div className="bg-white/10 px-4 py-2 flex items-center gap-2 border-b border-white/10">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/50" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
              <div className="w-3 h-3 rounded-full bg-green-500/50" />
            </div>
            <div className="mx-auto text-[10px] font-mono text-gray-400">root@{currentUser.username}:~</div>
          </div>
          
          {/* Terminal Body */}
          <div 
            className="flex-1 p-4 overflow-y-auto font-mono text-sm space-y-1.5"
            onClick={() => inputRef.current?.focus()}
          >
            {history.map((line) => (
              <div 
                key={line.id} 
                className={`break-words ${
                  line.type === 'input' ? 'text-white font-bold mt-2' :
                  line.type === 'error' ? 'text-red-400' :
                  line.type === 'success' ? 'text-green-400' :
                  line.type === 'system' ? 'text-gray-400 italic' :
                  'text-green-300/80'
                }`}
              >
                {line.text}
              </div>
            ))}
            
            {/* Input Line */}
            <form onSubmit={handleSubmit} className="flex items-center mt-2">
              <span className="text-accent mr-2 font-bold">{'>'}</span>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isProcessing}
                className="flex-1 bg-transparent border-none outline-none text-white font-mono text-sm p-0 focus:ring-0 disabled:opacity-50"
                autoFocus
                autoComplete="off"
                spellCheck="false"
              />
            </form>
            <div ref={endOfTerminalRef} />
          </div>
        </div>
        
        <p className="text-[10px] text-center text-gray-500 uppercase tracking-widest">
          <Command className="w-3 h-3 inline-block mr-1" /> Terminal supports programmatic access via API.
        </p>
      </div>
    </div>
  );
};
