import { GoogleGenAI } from "@google/genai";
import { AiSettings } from "../types";

export interface GenerateOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  jsonResponse?: boolean;
}

export async function generateText(
  prompt: string,
  settings?: AiSettings,
  options: GenerateOptions = {}
): Promise<string> {
  const provider = settings?.provider || 'gemini';

  if (provider === 'gemini') {
    const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
    const modelName = settings?.model || "gemini-3-flash-preview";
    console.log("Using Gemini model:", modelName);
    
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
      // Fallback to lite if preview fails
      const fallbackModel = modelName === 'gemini-3-flash-preview' ? 'gemini-3.1-flash-lite-preview' : 'gemini-3-flash-preview';
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
        // If rate limited, return a generic message instead of crashing
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
