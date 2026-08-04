import { GoogleGenAI } from "@google/genai";
import { AiSettings } from "../types";

export interface GenerateOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  jsonResponse?: boolean;
}

/**
 * Try the server-side AI proxy first (keeps the API key out of the client bundle).
 * Falls back to direct Gemini call only when VITE_GEMINI_API_KEY is explicitly set
 * (local dev convenience — NOT recommended for production).
 */
async function callViaProxy(
  prompt: string,
  options: GenerateOptions,
  modelName: string
): Promise<string | null> {
  try {
    const res = await fetch('/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        systemPrompt: options.systemPrompt,
        model: modelName,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        jsonResponse: options.jsonResponse,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.text ?? null;
  } catch {
    return null;
  }
}

export async function generateText(
  prompt: string,
  settings?: AiSettings,
  options: GenerateOptions = {}
): Promise<string> {
  const provider = settings?.provider || 'gemini';

  if (provider === 'gemini') {
    const modelName = settings?.model || "gemini-2.0-flash-001";

    // Prefer server proxy
    const proxyResult = await callViaProxy(prompt, options, modelName);
    if (proxyResult !== null) return proxyResult;

    // Direct client call — only works if VITE_GEMINI_API_KEY is provided
    const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
    if (!geminiApiKey) {
      throw new Error('AI unavailable: server proxy unreachable and VITE_GEMINI_API_KEY not set.');
    }
    const genAI = new GoogleGenAI({ apiKey: geminiApiKey });
    console.log("Using Gemini model (direct):", modelName);

    try {
      const response = await genAI.models.generateContent({
        model: modelName,
        contents: options.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt,
        config: {
          temperature: options.temperature,
          maxOutputTokens: options.maxTokens,
          responseMimeType: options.jsonResponse ? "application/json" : "text/plain",
        }
      });
      return response.text;
    } catch (err: any) {
      console.error("Gemini API Error:", err);
      const fallbackModel = 'gemini-2.0-flash-lite';
      console.log("Falling back to:", fallbackModel);

      try {
        const response = await genAI.models.generateContent({
          model: fallbackModel,
          contents: options.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt,
          config: {
            temperature: options.temperature,
            maxOutputTokens: options.maxTokens,
            responseMimeType: options.jsonResponse ? "application/json" : "text/plain",
          }
        });
        return response.text;
      } catch (fallbackErr: any) {
        console.error("Gemini API Fallback Error:", fallbackErr);
        if (fallbackErr?.status === 429 || fallbackErr?.message?.includes('429')) {
          return "SYSTEM OVERLOAD. NEURAL NETWORK CONGESTED. PLEASE TRY AGAIN LATER.";
        }
        throw fallbackErr;
      }
    }
  }

  // Local providers (Ollama, LM Studio) using OpenAI-compatible API
  const endpoint = settings?.endpoint || (provider === 'ollama' ? 'http://localhost:11434/v1/chat/completions' : 'http://localhost:1234/v1/chat/completions');
  const modelName = settings?.model || (provider === 'ollama' ? 'llama3' : 'model-identifier');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings?.apiKey && { 'Authorization': `Bearer ${settings.apiKey}` })
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
          { role: 'user', content: prompt }
        ],
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`AI Provider Error: ${response.status} ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error(`Error with ${provider}:`, error);
    throw new Error(`Failed to connect to ${provider}. Ensure it is running at ${endpoint}`);
  }
}
