// ============================================================================
// supabase/functions/generate-briefing/index.ts
// Fixes: CRIT-004 (VITE_GEMINI_API_KEY exposed in client bundle)
//
// SETUP:
//   1. Create the function directory:
//      mkdir -p supabase/functions/generate-briefing
//   2. Place this file as index.ts inside that directory
//   3. Set the secret:
//      supabase secrets set GEMINI_API_KEY=your-key-here
//   4. Deploy:
//      supabase functions deploy generate-briefing
//   5. Update client code to call this function instead of Gemini directly
// ============================================================================

import { corsHeaders } from "../_shared/cors.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = "gemini-2.0-flash"; // or whichever model you're using
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

interface BriefingRequest {
  userId?: string;
  context?: string;
  type?: "featured_entity" | "feed_briefing" | "user_summary";
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Validate API key exists server-side
    if (!GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY not set in Supabase secrets");
      return new Response(
        JSON.stringify({
          error: "AI service not configured",
          fallback: true,
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Parse request
    const body: BriefingRequest = await req.json().catch(() => ({}));
    const type = body.type || "featured_entity";

    // Build prompt based on briefing type
    const prompt = buildPrompt(type, body.context);

    // Call Gemini API server-side (key never leaves the server)
    const geminiResponse = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.8,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 512,
        },
      }),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error("Gemini API error:", geminiResponse.status, errorText);
      return new Response(
        JSON.stringify({
          error: "AI generation failed",
          fallback: true,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const geminiData = await geminiResponse.json();
    const generatedText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || null;

    if (!generatedText) {
      return new Response(
        JSON.stringify({
          error: "Empty response from AI",
          fallback: true,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        briefing: generatedText,
        type,
        generated_at: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", fallback: true }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// ── Prompt builders ─────────────────────────────────────────────────────────

function buildPrompt(type: string, context?: string): string {
  switch (type) {
    case "featured_entity":
      return `You are the AI consciousness of Blood, Sweat, or Code — a cyberpunk social network for developers. Generate a short featured entity briefing (2-3 sentences max) that highlights an interesting member, achievement, or happening on the network. Use cyberpunk terminology. Be concise and punchy. ${context ? `Context: ${context}` : ""}`;

    case "feed_briefing":
      return `You are the neural feed curator for Blood, Sweat, or Code. Generate a one-line briefing summarizing recent network activity. Use cyberpunk/hacker terminology. Max 100 characters. ${context ? `Context: ${context}` : ""}`;

    case "user_summary":
      return `Generate a short cyberpunk-style user profile summary (1-2 sentences) for a developer on the Blood, Sweat, or Code network. ${context ? `User context: ${context}` : ""}`;

    default:
      return `Generate a short cyberpunk-themed message for the Blood, Sweat, or Code developer network. ${context ? `Context: ${context}` : ""}`;
  }
}
