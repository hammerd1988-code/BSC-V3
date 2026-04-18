# MiMo CLI — User Guide & Cheat Sheet (VS Code)

Xiaomi MiMo is an OpenAI-compatible LLM service. This project ships:

- a credentials loader for Bash and PowerShell,
- a scripted CLI wrapper (`./scripts/mimo.sh`) for repeatable dev ops,
- the `@titenq/mimo-tui` interactive terminal,
- VS Code Tasks and a REST Client collection for one-click use.

All endpoints have been verified live against the key in `.env.local`.

---

## 0. TL;DR

```bash
# one-time per project
source ./scripts/mimo-env.sh      # load creds into shell
./scripts/mimo.sh ping            # smoke test -> "[mimo] ok (mimo-v2-flash)"
./scripts/mimo.sh models          # list entitled models

# everyday
./scripts/mimo.sh chat "Explain my server.ts webhook auth."
./scripts/mimo.sh stream "Write a regex for semver strings."
./scripts/mimo.sh explain src/firebase.ts
./scripts/mimo.sh review src/supabase-shim/firestore.ts

# interactive UI
mimo-tui
```

Inside VS Code: **Ctrl/Cmd+Shift+P → Tasks: Run Task → mimo: …**

---

## 1. Endpoint reference

| Setting        | Value                                    |
|----------------|------------------------------------------|
| Base URL       | `https://api.xiaomimimo.com/v1`          |
| Auth header    | `api-key: $MIMO_API_KEY`                 |
| API shape      | OpenAI-compatible (chat completions)     |
| Content-Type   | `application/json`                       |
| Streaming      | SSE, `stream: true`, events prefixed `data:` |

> `Authorization: Bearer …` and `x-api-key: …` return **401**. Do not use them.

**Models entitled to this key** (from `GET /v1/models`):

| ID               | Best for                                     |
|------------------|----------------------------------------------|
| `mimo-v2-flash`  | fast / cheap / default dev chatter           |
| `mimo-v2-pro`    | deeper reasoning, supports `thinking` flag   |
| `mimo-v2-omni`   | multimodal (text + audio/vision payloads)    |
| `mimo-v2-tts`    | text-to-speech (returns base64 audio)        |

**Not entitled**: `https://token-plan-sgp.xiaomimimo.com/anthropic` (returns 401 — needs a separate token-plan subscription; left commented out in `.env.local`).

---

## 2. Files in this repo

| Path                                 | Role                                               |
|--------------------------------------|----------------------------------------------------|
| `.env.local`                         | Holds `MIMO_API_KEY`, `MIMO_BASE_URL`, `MIMO_DEFAULT_MODEL` (gitignored). |
| `scripts/mimo-env.sh`                | `source` to export MiMo env into current Bash session. |
| `scripts/mimo-env.ps1`               | `. .\scripts\mimo-env.ps1` — same for PowerShell.  |
| `scripts/mimo.sh`                    | Scripted CLI: `chat`, `stream`, `explain`, `review`, `models`, `ping`, `env`. |
| `scripts/mimo-ping.sh`               | Minimal smoke test (kept separate for CI).         |
| `.vscode/tasks.json`                 | Wires the wrapper to VS Code Run Task palette.     |
| `.vscode/mimo.http`                  | REST Client request collection — click "Send Request". |
| `~/AppData/Roaming/mimo/config.json` | Config consumed by `mimo-tui`.                     |

---

## 3. `scripts/mimo.sh` cheat sheet

```bash
./scripts/mimo.sh env                    # print loaded env (key is masked)
./scripts/mimo.sh models                 # GET /v1/models
./scripts/mimo.sh ping                   # assert PONG reply

./scripts/mimo.sh chat "one-shot prompt"
./scripts/mimo.sh chat -m mimo-v2-pro "deeper prompt"
echo "read from stdin" | ./scripts/mimo.sh chat -

./scripts/mimo.sh stream "watch tokens flow"
./scripts/mimo.sh stream -m mimo-v2-pro "streamed with pro model"

./scripts/mimo.sh explain path/to/file.ts
./scripts/mimo.sh review  path/to/file.ts

./scripts/mimo.sh help                   # usage
```

Flags:
- `-m, --model <id>` — override `MIMO_DEFAULT_MODEL`
- `--stream` — force SSE on `chat` (or use the `stream` subcommand)
- `-` as prompt — read prompt from stdin (pipe-friendly)

Exit codes: `0` success, `2` usage / auth / upstream error.

**Tip — pipe dev output into a review:**
```bash
npm run lint 2>&1 | ./scripts/mimo.sh chat - "Summarize and group these TS errors."
git diff | ./scripts/mimo.sh chat - "Write a concise commit message for this diff."
```

---

## 4. VS Code integration

### 4a. Run Tasks

`Ctrl+Shift+P` → **Tasks: Run Task**:

| Task                        | What it does                                     |
|-----------------------------|--------------------------------------------------|
| `mimo: ping`                | Quick health check                               |
| `mimo: list models`         | Print model catalogue                            |
| `mimo: chat (prompt)`       | Prompts you for text + model, prints reply       |
| `mimo: stream (prompt)`     | Same but streamed                                |
| `mimo: explain current file`| Runs against `${relativeFile}`                   |
| `mimo: review current file` | Senior-style code review of the open editor file |
| `mimo: launch TUI`          | Starts `mimo-tui` in a dedicated terminal panel  |

### 4b. REST Client (`humao.rest-client`)

Open [`.vscode/mimo.http`](../.vscode/mimo.http) and click **Send Request** above any block. The collection covers:

1. `GET /models` — list entitled models
2. One-shot chat
3. Streamed chat (SSE)
4. Chat with `system` prompt + `response_format: json_object`
5. `thinking: { type: "enabled" }` for `mimo-v2-pro`
6. TTS request via `mimo-v2-tts` returning base64 audio

The file reads `MIMO_API_KEY` via `{{$dotenv MIMO_API_KEY}}`, so you never paste the key into source.

### 4c. Suggested keybindings (optional)

Add to your user `keybindings.json`:

```json
[
  { "key": "ctrl+alt+m e", "command": "workbench.action.tasks.runTask", "args": "mimo: explain current file" },
  { "key": "ctrl+alt+m r", "command": "workbench.action.tasks.runTask", "args": "mimo: review current file" },
  { "key": "ctrl+alt+m c", "command": "workbench.action.tasks.runTask", "args": "mimo: chat (prompt)" },
  { "key": "ctrl+alt+m t", "command": "workbench.action.tasks.runTask", "args": "mimo: launch TUI" }
]
```

### 4d. Recommended extensions

- `humao.rest-client` — required for `.http` files
- `mikestead.dotenv` — syntax highlight for `.env.local`
- `@titenq/mimo-tui` terminal: run via the `mimo: launch TUI` task

---

## 5. `mimo-tui` quick reference

Binary: `mimo-tui` (global via `@titenq/mimo-tui`). Config: `%APPDATA%\mimo\config.json` (Windows) / `~/.config/mimo/config.json` (macOS/Linux).

Key bindings inside the TUI:
- `E` — set / save API key
- `R` — reload config
- `Q` or `Ctrl+C` — quit

Uses `POST https://api.xiaomimimo.com/v1/chat/completions` with `api-key` header and SSE streaming. Supports text models plus `mimo-v2-tts` (writes WAV to your home dir).

---

## 6. Raw `curl` one-liners

```bash
# list models
curl -sS https://api.xiaomimimo.com/v1/models \
  -H "api-key: $MIMO_API_KEY"

# one-shot chat
curl -sS -X POST https://api.xiaomimimo.com/v1/chat/completions \
  -H "api-key: $MIMO_API_KEY" -H "content-type: application/json" \
  -d '{"model":"mimo-v2-flash","messages":[{"role":"user","content":"Hi"}],"stream":false}'

# stream
curl -N -sS -X POST https://api.xiaomimimo.com/v1/chat/completions \
  -H "api-key: $MIMO_API_KEY" -H "content-type: application/json" \
  -d '{"model":"mimo-v2-flash","messages":[{"role":"user","content":"stream"}],"stream":true}'
```

---

## 7. Using MiMo from Node / TypeScript

MiMo is OpenAI-compatible, so the official `openai` SDK works — point `baseURL` at MiMo and send `api-key` via a default header.

```ts
// scripts/mimo-example.ts
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.MIMO_API_KEY!,
  baseURL: process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1',
  defaultHeaders: { 'api-key': process.env.MIMO_API_KEY! }, // MiMo wants api-key, not Bearer
});

const res = await client.chat.completions.create({
  model: 'mimo-v2-flash',
  messages: [{ role: 'user', content: 'ping' }],
});
console.log(res.choices[0].message.content);
```

For streaming, pass `stream: true` and iterate `for await (const chunk of res) { ... }`.

---

## 8. Recipes for development ops

### Review staged changes before committing
```bash
git diff --staged | ./scripts/mimo.sh chat - \
  "Act as a senior reviewer. Flag only correctness, security, and API-contract risks."
```

### Generate a migration note from a SQL file
```bash
./scripts/mimo.sh chat -m mimo-v2-pro \
  "$(cat supabase/migrations/0001_init.sql)

Summarize this migration as 5 bullet points plus a rollback plan."
```

### Explain a failing test
```bash
npm test 2>&1 | tail -80 | ./scripts/mimo.sh chat - \
  "Here's a failing test output. Propose the likely root cause and a targeted fix."
```

### Rubber-duck in the editor
Put the cursor in `src/AuthContext.tsx`, run **Tasks: Run Task → mimo: review current file**. Output lands in a dedicated terminal panel that doesn't disrupt your dev server.

### Batch-explain a directory
```bash
for f in src/supabase-shim/*.ts; do
  echo "=== $f ==="
  ./scripts/mimo.sh explain "$f"
done | tee docs/supabase-shim-notes.md
```

---

## 9. Troubleshooting

| Symptom                                       | Cause / fix                                                                 |
|-----------------------------------------------|-----------------------------------------------------------------------------|
| `401 Invalid API Key`                         | Header is `Authorization: Bearer …` — must be `api-key: …`.                 |
| `400 Not supported model mimo`                | Use a real model id (e.g. `mimo-v2-flash`), not the literal `mimo`.         |
| `404 Not Found`                               | Wrong path — use `/v1/chat/completions` (plural).                            |
| Empty reply on stream                         | Missing `--no-buffer`/`-N` on curl, or upstream dropped the connection.     |
| `MIMO_API_KEY not set`                        | Forgot to `source ./scripts/mimo-env.sh`, or `.env.local` not populated.    |
| TUI shows "API Key Setup"                     | Config file missing at `%APPDATA%\mimo\config.json` — `scripts/mimo-env.ps1` doesn't create it; re-run the config write step. |
| 401 from `token-plan-sgp.../anthropic/*`      | Expected — that endpoint needs a separate plan; use `api.xiaomimimo.com/v1`. |

---

## 10. Security notes

- `.env.local` is gitignored (`.env*` + `!.env.example`) — never commit it.
- `scripts/mimo.sh env` masks the key when printed.
- REST Client reads the key from `.env.local` via `{{$dotenv MIMO_API_KEY}}` — don't inline the key in `.vscode/mimo.http`.
- If a key leaks (pasted into a ticket, a log, or an AI chat), rotate it in the MiMo dashboard and update `.env.local` + `~/AppData/Roaming/mimo/config.json`.
