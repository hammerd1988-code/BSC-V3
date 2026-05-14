---
name: testing-casper-studio
description: Test the Casper Studio (Visual Forge) image, thumbnail, upload, and publishing features. Use when verifying Runway API integration, Studio asset upload, or feed publishing changes.
---

# Testing Casper Studio (Visual Forge)

## Overview
Casper Studio is the content creation cockpit at `/casper/studio`. It supports image generation, video generation, thumbnail creation, and publishing Studio assets to the BSC feed.

## Devin Secrets Needed
- `VITE_SUPABASE_URL` or `SUPABASE_URL` — Supabase project URL.
- `VITE_SUPABASE_ANON_KEY` or `SUPABASE_PERISHABLE_KEY` — browser-safe Supabase key. Prefer publishable-key aliases when testing browser inserts.
- `SUPABASE_SERVICE_ROLE_KEY` — for admin magic-link auth and DB verification queries.
- `RUNWAY_API_KEY` — Runway ML API key for image/video generation smoke tests.

## Architecture
- **Route:** `src/App.tsx` registers `/casper/studio`.
- **Frontend:** `src/components/ContentCreationStudio.tsx` — image/video/thumbnail modes, export, upload-before-post, and composer actions.
- **Frontend API lib:** `src/lib/runway.ts` — `requestRunwayGeneration()` and `uploadStudioAsset()` call the Express API.
- **Backend route:** `runwayRoutes.ts` — validates Runway generation and Studio asset upload requests, uploads Studio assets into Supabase Storage.
- **Server entries:** `server.ts`, `server.prod.ts`, and `server.unified.ts` register Runway routes and must allow large Studio upload JSON bodies.
- **Feed rendering:** `src/components/Feed.tsx` and `src/components/PostCard.tsx` render published media posts.

## Local Setup
```bash
npm run dev:full
```
Use `http://localhost:3001/casper/studio` for full-stack testing. `npm run dev` is Vite-only and does not serve the Express API routes.

For admin browser auth, use the approved Supabase service-role magic-link flow and inject the resulting session into `localStorage` key `sb-<project-ref>-auth-token`. When verifying magic links, Supabase expects `token_hash`, not `token`.

When starting local dev for tests, ensure the browser receives a valid publishable/anon key. If both stale anon keys and newer publishable keys are present, prefer the publishable key aliases (`VITE_SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_PERISHABLE_KEY`) for the browser env.

## Primary E2E Test: Thumbnail Export → Upload → Feed Post
1. Navigate to `/casper/studio` and select `thumbnail` mode.
2. Set title to `BLOOD SWEAT CODE` and subtitle to `Test Thumbnail`.
3. Click `Export Thumbnail`.
   - Pass: Generation History shows `thumbnail // 16:9` and the preview shows the exact title/subtitle.
   - Fail: no history item appears or the exported asset remains unusable.
4. Enter feed copy in the composer and click `Post Now`.
   - Pass: UI shows `Uploading`, then `Posted to the BSC feed.` within 60 seconds.
   - Fail: status shows `Invalid API key`, `Posting failed`, SVG MIME rejection, HTTP 413, or `Uploading` remains longer than 60 seconds.
5. Query the newest matching `posts` row.
   - Pass: `type = media`, `media_type = image`, `content` matches the composer text, and `media_url` contains `/storage/v1/object/public/media/casper-studio/` and ends with `.png`.
   - Fail: `media_url` is `data:`/`blob:`, ends in `.svg`, or type/media_type are wrong.
6. Navigate to `/` and scroll the matching feed post into view.
   - Pass: card text is visible and the image has `naturalWidth = 1280`, `naturalHeight = 720`, rendered width > 100 px, rendered height > 50 px.
   - Fail: card is missing, image is broken, or rendered dimensions are 0.

## Runway Smoke Test
1. Return to `/casper/studio`, select `image` mode, choose `16:9`, enter a prompt, and click `Generate Image`.
2. Pass if generation starts or the provider returns an account/credit limitation that does **not** contain `Validation of body failed`, `ratio`, or `resolution` schema errors.
3. Fail if the UI immediately reports a Runway request schema validation error.

## Evidence to Capture
- Recording of the UI flow with annotations for export, upload/post, DB evidence, feed rendering, and Runway smoke.
- Screenshot of Studio preview before posting.
- Screenshot of `Posted to the BSC feed.` state.
- DB evidence showing `type`, `media_type`, and Storage `.png` URL.
- Feed screenshot showing the posted thumbnail visibly rendered.

## Common Issues
- `Uploading` might last tens of seconds locally because the PNG is sent as a data URL; use a concrete 60-second timeout before marking it failed.
- `PayloadTooLargeError` means the Express JSON body limit is too small for Studio uploads.
- `mime type image/svg+xml is not supported` means the thumbnail export/upload path is sending SVG instead of PNG.
- `Invalid API key` during feed insert usually means the browser used a stale anon key instead of a valid publishable key.
- Feed image natural size can be correct while rendered size is 0 if the feed layout collapses; always verify rendered dimensions.
- Runway credit/account limits are not schema failures. Only treat `Validation of body failed` or ratio/resolution payload errors as Runway schema failures.

## Deployment
- Production deploys via **Railway** (not Vercel). Vercel is only the original domain registrar and its failures should not block this repo's Railway deployment decisions.
