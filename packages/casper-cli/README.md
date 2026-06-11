# @bsc/casper-cli

> Casper AI agent for your local machine — shell access, file operations, git, process management, and remote orchestration.

## Installation

```bash
npm install -g @bsc/casper-cli
```

## Quick Start

```bash
# Interactive chat
casper

# One-shot command
casper exec "run the tests and fix any failures"

# Quick question with local context
casper ask "what's in my git stash?"
```

## Configuration

```bash
# Set your OpenAI API key
casper config set openaiApiKey sk-...

# Or use a local LLM (LM Studio / Ollama)
casper config set localLlmUrl http://localhost:1234/v1
casper config set preferLocalLlm true

# Set preferred model
casper config set model gpt-4.1-mini
```

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

## Architecture

```
casper chat → REPL → LLM (tool-calling loop) → local tool executors → your machine
casper daemon → WebSocket → Railway relay → accepts remote directives from mobile/web
```

## License

MIT
