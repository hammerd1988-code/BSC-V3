---
name: testing-casper-studio
description: Test the Casper Studio (Visual Forge) image and video generation features. Use when verifying Runway API integration, image/video generation UI, or content creation studio changes.
---

# Testing Casper Studio (Visual Forge)

## Overview
Casper Studio is the content creation cockpit at `/casper/studio`. It supports image generation, video generation, and thumbnail creation via the Runway ML API.

## Devin Secrets Needed
- `SUPABASE_SERVICE_ROLE_KEY` — for server-side Supabase operations
- `SUPABASE_URL` or `VITE_SUPABASE_URL` — Supabase project URL (not currently provisioned)
- `RUNWAY_API_KEY` — Runway ML API key for image/video generation (not currently provisioned)
- A user login for `bloodsweatcode.org` if testing against production

## Architecture
- **Frontend:** `src/components/ContentCreationStudio.tsx` — React UI with image/video/thumbnail modes
- **Frontend API lib:** `src/lib/runway.ts` — `requestRunwayGeneration()` calls `/api/runway/generate`
- **Backend route:** `runwayRoutes.ts` — Express route that validates, checks subscription tier, then calls Runway API
- **Server entry:** `server.unified.ts` — registers runway routes via `registerRunwayRoutes()`

## Key API Details
- Runway API base: `https://api.dev.runwayml.com/v1`
- Image endpoint: `POST /v1/text_to_image`
- Video endpoint: `POST /v1/image_to_video`
- **IMPORTANT:** Runway API requires pixel-based ratios (e.g. `1920:1080`), NOT simple ratios (e.g. `16:9`). The backend has `normalizeImageRatio()` and `normalizeVideoRatio()` functions to handle conversion.
- Valid image ratios for `gen4_image` model: `1024:1024`, `1080:1080`, `1168:880`, `1360:768`, `1440:1080`, `1080:1440`, `1808:768`, `1920:1080`, `1080:1920`, `2112:912`, `1280:720`, `720:1280`, `720:720`, `960:720`, `720:960`, `1680:720`
- Valid video ratios: `1280:720`, `720:1280`, `960:960`
- Header required: `X-Runway-Version: 2024-11-06`

## Running Locally
```bash
# Full server (frontend + backend)
npm run dev:full
# or
npm run start:unified
```
Requires `.env` with at minimum: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `RUNWAY_API_KEY`.

## Testing Without Runway API Key
If `RUNWAY_API_KEY` is not set, `callRunway()` returns a 503 immediately. You can still test:
1. Payload construction logic by inspecting `normalizeImageRatio()` and `normalizeVideoRatio()`
2. TypeScript compilation: `npx tsc --noEmit` (aliased as `npm run lint`)
3. Frontend build: `npm run build`

## Testing With Runway API Key
1. Navigate to `/casper/studio` on the live site or local dev server
2. Select "IMAGE" mode
3. Enter a prompt (the default prompt is pre-filled)
4. Select a ratio (1:1, 16:9, 9:16, or 4:3)
5. Click the generate button
6. Verify no "Validation of body failed" error appears
7. Poll should show progress, then display the generated image

## Subscription/Tier Gating
Image and video generation require `pro` or `infinity` subscription tier. Free tier users get 0 uses. The backend checks `feature_usage` and `subscriptions` tables.

## Common Issues
- "Validation of body failed" — usually means the Runway API payload has an invalid field (e.g., wrong ratio format, unsupported `resolution` field)
- 503 from `/api/runway/generate` — `RUNWAY_API_KEY` is not set on the backend
- 401/402 from generation — user's subscription tier is insufficient or Supabase auth token is expired

## Deployment
- Production deploys via **Railway** (not Vercel). Vercel is only the original domain registrar.
- After merging backend changes, Railway auto-deploys. Check Railway dashboard for deployment status.
