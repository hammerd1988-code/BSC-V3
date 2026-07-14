# @bsc/casper-cli

> Casper AI agent for your local machine — shell access, file operations, git, process management, and remote orchestration.

## Installation

### One-liner (standalone binary, no Node.js required)

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/hammerd1988-code/BSC-V3/main/packages/casper-cli/scripts/install.ps1 | iex
```

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/hammerd1988-code/BSC-V3/main/packages/casper-cli/scripts/install.sh | bash
```

The script detects your platform, downloads the latest release from
[GitHub releases](https://github.com/hammerd1988-code/BSC-V3/releases), and
installs `casper` to a directory on your `PATH`.

### From npm

```bash
npm install -g @bsc/casper-cli
```

### Build from source

```bash
cd packages/casper-cli
npm install
npm run build:binary
```

Binaries are written to `bin/dist/`:
- `casper-linux-x64` — Linux x64
- `casper-macos-x64` — macOS Intel
- `casper-macos-arm64` — macOS Apple Silicon
- `casper-win-x64.exe` — Windows x64

## Quick Start

The first time you run Casper it will walk you through choosing an LLM provider
and entering your API key or connecting to a local model.

```bash
# Interactive chat (starts guided setup if not configured)
casper

# Guided setup at any time
casper setup

# One-shot command
casper exec "run the tests and fix any failures"

# Quick question with local context
casper ask "what's in my git stash?"
```

## Configuration

```bash
# Interactive wizard — recommended for first-time setup
casper setup

# Manual config
casper config set openaiApiKey sk-...
casper config set model gpt-4.1-mini

# Or use a local LLM (LM Studio / Ollama)
casper config set localLlmUrl http://localhost:1234/v1
casper config set preferLocalLlm true
casper config set model <model-id>
```

`casper setup` will auto-detect LM Studio or Ollama at `http://localhost:1234/v1`
and `http://localhost:11434/v1` and let you pick from the available models.

## Daemon Mode (Phase 1B)

```bash
# Start background daemon (connects to Railway relay)
casper daemon start

# Check status
casper daemon status

# Stop daemon
casper daemon stop
```

## Features

- **Shell execution** — Run any command on your local machine
- **File operations** — Read, write, search files
- **Git operations** — Full git workflow (status, diff, commit, push, etc.)
- **Process management** — Start/stop/monitor background processes
- **System info** — OS, CPU, RAM, disk usage
- **Security** — Confirmation prompts for destructive commands, full audit log
- **Local LLM** — Works with LM Studio, Ollama, or any OpenAI-compatible endpoint

## Security

- All tool executions are logged to `~/.config/casper-cli/history.jsonl`
- Destructive commands (rm -rf, force push, etc.) require confirmation
- Configurable approval levels: `auto`, `confirm-local`, `confirm-remote`
  - **`auto`** — never prompt; runs everything (use only on trusted machines).
  - **`confirm-local`** — prompt at the local terminal in `casper chat`. In
    `casper daemon` mode there is no attached terminal, so any non-`auto` level
    (including `confirm-local`) escalates the prompt to a **remote approval**
    card in the web Remote Ops console instead. Approvals time out (deny) if
    left unanswered.
  - **`confirm-remote`** — always route approvals to the web/mobile operator.

## Architecture

```
casper chat → REPL → LLM (tool-calling loop) → local tool executors → your machine
casper daemon → WebSocket → Railway relay → accepts remote directives from mobile/web
```

## In-Memory State & Restart Semantics

The Railway relay keeps several data structures **in memory** (not persisted to
the database). Understanding what survives a restart is important for operators:

| Data | Storage | Survives relay restart? |
|------|---------|------------------------|
| Device registrations (`casper_cli_devices`) | Supabase (PostgreSQL) | **Yes** |
| Relay tokens (hashed) | Supabase | **Yes** |
| Pending device-code auth flows | In-memory map | **No** — CLI must re-run `casper auth login` |
| Connected-machine registry | In-memory map | **No** — daemons auto-reconnect via socket.io |
| Active directives (status, ownership) | In-memory map (1 h retention) | **No** — in-flight directives are lost |
| Approval requests | In-memory (tied to directive) | **No** — pending approvals are lost |

### What happens on relay restart

1. All Socket.IO connections drop. Daemons see a `disconnect` event and
   socket.io-client's reconnection loop re-establishes the connection
   automatically (unless `reconnection: false`).
2. After reconnecting, the daemon re-sends `cli:register`, restoring its entry
   in the machine map. The web UI sees `relay:machine_offline` then
   `relay:machine_online` in quick succession.
3. Any directive that was mid-execution is orphaned: the relay no longer tracks
   it, but the daemon's local tool loop finishes independently. The web console
   shows no further streaming for that directive.
4. Pending device-code flows are lost. The CLI polls and receives
   `status: "expired"`, prompting the user to retry.

### What happens on daemon disconnect

1. The relay removes the machine from its in-memory map and emits
   `relay:machine_offline` to the operator's web room.
2. The `casper_cli_devices` row in Supabase is **not** deleted — it retains
   `last_seen_at` as a historical record. The machine simply shows as offline.
3. Any directive targeting that machine remains in the in-memory directive map
   but can no longer be forwarded. Approval and abort requests return
   409 ("Machine is no longer online").

**Note:** Both the relay server and the daemon enforce a 5-minute approval
timeout. If a destructive command is awaiting approval and the operator does
not respond within 5 minutes, the daemon auto-denies the command and the
relay marks the directive as failed, notifying the web client so stale
approval cards are cleaned up.

## License

MIT
