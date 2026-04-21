// ============================================================================
// src/lib/ai.ts — Client-side AI helper (replaces direct Gemini calls)
// Fixes: CRIT-004 — moves Gemini key to server-side Edge Function
//
// USAGE:
//   Replace all instances of direct Gemini client usage:
//
//   BEFORE (broken, leaks API key):
//     import { generateWithGemini } from './gemini';
//     const briefing = await generateWithGemini(prompt);
//
//   AFTER (secure, calls Edge Function):
//     import { generateBriefing } from './ai';
//     const briefing = await generateBriefing('featured_entity');
// ============================================================================

import { supabase } from "./supabase"; // adjust path to your client

export type BriefingType = "featured_entity" | "feed_briefing" | "user_summary";

interface BriefingResponse {
  briefing: string;
  type: BriefingType;
  generated_at: string;
}

/**
 * Generate an AI briefing via the Supabase Edge Function.
 * The Gemini API key lives server-side — never shipped to the client.
 *
 * @param type - The type of briefing to generate
 * @param context - Optional context string to inform the generation
 * @returns The generated briefing text, or a fallback string on error
 */
export async function generateBriefing(
  type: BriefingType = "featured_entity",
  context?: string
): Promise<string> {
  try {
    const { data, error } = await supabase.functions.invoke<BriefingResponse>(
      "generate-briefing",
      {
        body: { type, context },
      }
    );

    if (error) {
      console.warn("[AI] Edge function error:", error.message);
      return getFallback(type);
    }

    if (!data?.briefing) {
      console.warn("[AI] Empty briefing response");
      return getFallback(type);
    }

    return data.briefing;
  } catch (err) {
    console.warn("[AI] generateBriefing exception:", err);
    return getFallback(type);
  }
}

/**
 * Fallback text when AI generation fails.
 * Keeps the UI functional even without the Gemini key configured.
 */
function getFallback(type: BriefingType): string {
  switch (type) {
    case "featured_entity":
      return "Neural entity data unavailable. The grid persists.";
    case "feed_briefing":
      return "Signal processing...";
    case "user_summary":
      return "Profile data compiling...";
    default:
      return "Awaiting neural sync...";
  }
}
