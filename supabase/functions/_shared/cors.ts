// supabase/functions/_shared/cors.ts
// Shared CORS headers for all BSC Edge Functions

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // tighten to your domain in production
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
