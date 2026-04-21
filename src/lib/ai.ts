import { supabase } from "./supabase";

export type BriefingType = "featured_entity" | "feed_briefing" | "user_summary";

interface BriefingResponse {
  briefing: string;
  type: BriefingType;
  generated_at: string;
}

export interface GenerateOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  jsonResponse?: boolean;
}

/**
 * Generate text via the Supabase Edge Function (Gemini Proxy).
 */
export async function generateText(
  prompt: string,
  settings?: any,
  options: GenerateOptions = {}
): Promise<string> {
  try {
    const { data, error } = await supabase.functions.invoke("generate-briefing", {
      body: { 
        type: "custom", 
        context: prompt,
        systemPrompt: options.systemPrompt,
        temperature: options.temperature
      },
    });

    if (error) {
      console.warn("[AI] Edge function error:", error.message);
      return "";
    }

    return data?.briefing || "";
  } catch (err) {
    console.warn("[AI] generateText exception:", err);
    return "";
  }
}

/**
 * Generate an AI briefing via the Supabase Edge Function.
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
