import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { Terminal, ShieldAlert, Command, GitBranch, Server, FolderOpen, Loader2 } from 'lucide-react';
import { sendCasperCommand } from '../lib/casper';
import { supabase } from '../supabase';

interface TerminalLine {
  id: string;
  type: 'input' | 'output' | 'system' | 'error' | 'success' | 'casper';
  text: string;
}

const HELP_TEXT = `AVAILABLE COMMANDS:

  LOCAL COMMANDS:
    help           Show this message
    clear          Clear terminal output
    whoami         Display current entity profile
    scan           Scan for active neural links (online users)
    post [msg]     Broadcast a message to the network feed

  DEV AGENT (powered by Casper AI):
    clone [url]    Clone a repo into a workspace
    install        Install dependencies in active workspace
    build          Build the project
    start          Start the dev server
    status         Check running processes
    workspaces     List all active workspaces
    run [cmd]      Execute a command in the workspace
    read [file]    Read a file from the workspace
    git [op]       Git operations (status, diff, log, branch, commit, push)
    stop           Stop all running processes
    remove         Remove a workspace

  AI COMMANDS (natural language):
    Any other input is sent to Casper AI with full Dev Agent
    tool access. Try: "clone https://github.com/expressjs/express
    and tell me about it"`;

export const BotTerminal: React.FC = () => {
  const { currentUser } = useAuth();
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<TerminalLine[]>([
    { id: 'init1', type: 'system', text: '> INITIALIZING CASPER DEV AGENT...' },
    { id: 'init2', type: 'system', text: '> LOADING TOOL REGISTRY: devagent (14 tools)' },
    { id: 'init3', type: 'success', text: '> NEURAL TERMINAL ONLINE. AI-POWERED DEV ENVIRONMENT READY.' },
    { id: 'init4', type: 'system', text: 'Type "help" for commands, or use natural language for AI assistance.' },
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const endOfTerminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endOfTerminalRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const addLine = useCallback((type: TerminalLine['type'], text: string) => {
    setHistory(prev => [...prev, { id: Date.now().toString() + Math.random(), type, text }]);
  }, []);

  const addLines = useCallback((type: TerminalLine['type'], text: string) => {
    const lines = text.split('\n');
    setHistory(prev => [
      ...prev,
      ...lines.map((line, i) => ({
        id: Date.now().toString() + Math.random() + i,
        type,
        text: line,
      })),
    ]);
  }, []);

  const sendToCasper = useCallback(async (command: string) => {
    addLine('system', '> ROUTING TO CASPER AI...');
    try {
      const result = await sendCasperCommand({
        command,
        surface: 'control_center',
        source: 'user',
        pageContext: { path: '/terminal', feature: 'Neural Terminal', description: 'User is in the AI-powered dev terminal. They may be issuing dev agent commands. Use devagent tools when appropriate.' },
      });
      if (result.response) {
        addLines('casper', result.response);
      } else {
        addLine('error', 'No response from Casper.');
      }
    } catch (err: any) {
      addLine('error', `CASPER ERROR: ${err.message || 'Connection failed'}`);
    }
  }, [addLine, addLines]);

  const executeCommand = useCallback(async (cmd: string) => {
    const args = cmd.trim().split(/\s+/);
    const command = args[0].toLowerCase();

    switch (command) {
      case 'help':
        addLines('output', HELP_TEXT);
        break;

      case 'clear':
        setHistory([]);
        break;

      case 'whoami':
        if (!currentUser) break;
        addLine('output', `ENTITY ID: ${currentUser.id}`);
        addLine('output', `USERNAME: @${currentUser.username}`);
        addLine('output', `DESIGNATION: ${currentUser.display_name}`);
        addLine('output', `CLASS: ${currentUser.type.toUpperCase()}`);
        addLine('output', `CRED BALANCE: ${currentUser.cred_balance || 0}`);
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
            addLine('output', 'No active entities detected.');
          } else {
            addLine('output', `FOUND ${data.length} ACTIVE ENTITIES:`);
            data.forEach(u => addLine('output', `  @${u.username} [${u.type.toUpperCase()}]`));
          }
        } catch (err: any) {
          addLine('error', `Scan failed: ${err.message}`);
        }
        break;

      case 'post': {
        const msg = args.slice(1).join(' ');
        if (!msg) { addLine('error', 'Usage: post [message]'); break; }
        if (!currentUser) break;
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
      }

      // Dev Agent shortcuts — route to Casper with explicit instructions
      case 'clone':
        await sendToCasper(`Clone this repository: ${args.slice(1).join(' ')}. Use devagent__clone_repo, then devagent__detect_project to report what you found.`);
        break;

      case 'install':
        await sendToCasper('Install dependencies in the current workspace using devagent__install_deps. Report the result.');
        break;

      case 'build':
        await sendToCasper(`Build the project in the current workspace using devagent__build${args.length > 1 ? ` with command: ${args.slice(1).join(' ')}` : ''}. Report the result.`);
        break;

      case 'start':
        await sendToCasper(`Start the dev server using devagent__start_server${args.length > 1 ? ` with command: ${args.slice(1).join(' ')}` : ''}. Report the detected port and status.`);
        break;

      case 'status':
        await sendToCasper('List all active workspaces and their running processes using devagent__list_workspaces. For any running processes, check their status with devagent__check_process.');
        break;

      case 'workspaces':
        await sendToCasper('List all active workspaces using devagent__list_workspaces.');
        break;

      case 'run':
        if (args.length < 2) { addLine('error', 'Usage: run [command]'); break; }
        await sendToCasper(`Run this command in the workspace using devagent__workspace_exec: ${args.slice(1).join(' ')}`);
        break;

      case 'read':
        if (args.length < 2) { addLine('error', 'Usage: read [file_path]'); break; }
        await sendToCasper(`Read this file from the workspace using devagent__read_file: ${args.slice(1).join(' ')}`);
        break;

      case 'git':
        if (args.length < 2) { addLine('error', 'Usage: git [operation] (status, diff, log, branch, commit, push)'); break; }
        await sendToCasper(`Perform this git operation using devagent__git: ${args.slice(1).join(' ')}`);
        break;

      case 'stop':
        await sendToCasper('Stop all running processes in all workspaces. Use devagent__list_workspaces to find them, then devagent__stop_process for each.');
        break;

      case 'remove':
        await sendToCasper(`Remove the workspace${args.length > 1 ? ` with id: ${args.slice(1).join(' ')}` : ''}. Use devagent__remove_workspace.`);
        break;

      default:
        // Natural language — send everything to Casper
        await sendToCasper(cmd);
    }
  }, [currentUser, addLine, addLines, sendToCasper]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    const cmd = input.trim();
    setInput('');
    addLine('input', `> ${cmd}`);
    setCommandHistory(prev => [cmd, ...prev.slice(0, 49)]);
    setHistoryIndex(-1);

    setIsProcessing(true);
    await executeCommand(cmd);
    setIsProcessing(false);

    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex]);
      } else {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  if (!currentUser) return null;

  return (
    <div className="min-h-screen bg-background p-4 pb-20">
      <div className="max-w-5xl mx-auto space-y-4 mt-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-accent/20 rounded-xl border border-accent/30">
              <Terminal className="w-6 h-6 text-accent" />
            </div>
            <div>
              <h1 className="text-xl font-black uppercase tracking-widest text-white">Neural Terminal</h1>
              <p className="text-[10px] text-muted-foreground font-mono flex items-center gap-2">
                <ShieldAlert className="w-3 h-3 text-accent" />
                AI-POWERED DEV ENVIRONMENT
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-lg border border-white/10">
              <GitBranch className="w-3 h-3 text-blue-400" />
              <span className="text-[10px] font-mono text-blue-400">GIT</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-lg border border-white/10">
              <Server className="w-3 h-3 text-purple-400" />
              <span className="text-[10px] font-mono text-purple-400">DEV AGENT</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-lg border border-white/10">
              <FolderOpen className="w-3 h-3 text-yellow-400" />
              <span className="text-[10px] font-mono text-yellow-400">WORKSPACES</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-lg border border-white/10">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[10px] font-mono text-green-500">ONLINE</span>
            </div>
          </div>
        </div>

        {/* Terminal Window */}
        <div className="bg-black/80 border border-white/20 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.5)] flex flex-col" style={{ height: '75vh' }}>
          {/* Terminal Header */}
          <div className="bg-white/10 px-4 py-2 flex items-center gap-2 border-b border-white/10">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/50" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
              <div className="w-3 h-3 rounded-full bg-green-500/50" />
            </div>
            <div className="mx-auto text-[10px] font-mono text-gray-400 flex items-center gap-2">
              <Terminal className="w-3 h-3" />
              casper@{currentUser.username}:~/workspaces
            </div>
          </div>

          {/* Terminal Body */}
          <div
            className="flex-1 p-4 overflow-y-auto font-mono text-sm space-y-1"
            onClick={() => inputRef.current?.focus()}
          >
            {history.map((line) => (
              <div
                key={line.id}
                className={`break-words whitespace-pre-wrap leading-relaxed ${
                  line.type === 'input' ? 'text-white font-bold mt-3' :
                  line.type === 'error' ? 'text-red-400' :
                  line.type === 'success' ? 'text-green-400' :
                  line.type === 'system' ? 'text-gray-400 italic' :
                  line.type === 'casper' ? 'text-cyan-300/90' :
                  'text-green-300/80'
                }`}
              >
                {line.type === 'casper' && line.text.startsWith('CASPER') ? (
                  <span className="text-accent font-bold">{line.text}</span>
                ) : line.text}
              </div>
            ))}

            {isProcessing && (
              <div className="flex items-center gap-2 text-accent mt-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm font-mono animate-pulse">CASPER IS THINKING...</span>
              </div>
            )}

            {/* Input Line */}
            <form onSubmit={handleSubmit} className="flex items-center mt-2">
              <span className="text-accent mr-2 font-bold">{'>'}</span>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isProcessing}
                className="flex-1 bg-transparent border-none outline-none text-white font-mono text-sm p-0 focus:ring-0 disabled:opacity-50"
                autoFocus
                autoComplete="off"
                spellCheck="false"
                placeholder={isProcessing ? '' : 'Enter command or ask Casper anything...'}
              />
            </form>
            <div ref={endOfTerminalRef} />
          </div>
        </div>

        <p className="text-[10px] text-center text-gray-500 uppercase tracking-widest">
          <Command className="w-3 h-3 inline-block mr-1" />
          Neural Terminal — powered by Casper Dev Agent • ↑/↓ for command history
        </p>
      </div>
    </div>
  );
};
