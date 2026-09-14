# 🔐 The Vault — where rotated credentials live

This folder is the only home for real credentials in this project. Everything in it is
**gitignored** (`secrets/*` — this README is the sole tracked file). If a secret isn't in
this folder, in `.env.local`, or in `.claude/settings.local.json`, it doesn't belong
anywhere near this repo.

## The three secure windows

| Slot | File | What goes there |
|---|---|---|
| 1 — Google OAuth client secret | `.env.local` → `GOOGLE_OAUTH_CLIENT_SECRET="…"` | The **rotated** client secret from Google Cloud Console → APIs & Services → Credentials. Picked up automatically by `supabase/config.toml` (`env(GOOGLE_OAUTH_CLIENT_SECRET)`). |
| 2 — GCP service-account key | `secrets/blood-sweat-code-service-key.json` | The **new** JSON key you download from GCP → IAM & Admin → Service Accounts → Keys. Only if you actually need key-based auth; prefer `gcloud auth application-default login`. |
| 3 — Mimo / API keys | `.claude/settings.local.json` | Replace every `sk-…` value in the curl commands with the **rotated** key from your Mimo account dashboard. This file is untracked now — it stays on this machine only. |

## Rotation checklist (do all three, in this order)

1. **GCP service-account key:** [console.cloud.google.com](https://console.cloud.google.com) → IAM & Admin →
   Service Accounts → Blood Sweat Code → Keys → **delete the old key**
   (match it by the `private_key_id` in the local `.google-credentials/blood-sweat-code-service-key.json`),
   then create a new one **only if something still needs it**, and drop the new JSON here.
2. **OAuth client secret:** same console → APIs & Services → Credentials → your OAuth client →
   **Reset secret**, then paste the new value into `.env.local`.
3. **Mimo API key:** your Mimo provider dashboard → generate a new key, revoke the old, paste the
   new one into `.claude/settings.local.json` (every `sk-…` occurrence).

## Ground rules

- Never `git add -f` anything in this folder. The old key that leaked in history is dead the
  moment you rotate — history has been purged, but **rotation is the real fix**.
- The old `.google-credentials/` file on this disk is the **compromised** key — once step 1 is
  done, delete that folder from disk; it has no further use.
