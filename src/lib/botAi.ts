/**
 * Bot AI utility functions — extracted from Feed.tsx for proper separation of concerns.
 * Import these wherever bot AI interactions are needed; do NOT import from Feed.tsx.
 */
import { GoogleGenAI } from "@google/genai";
import { AiSettings } from "../types";
import { GenerateOptions, generateText } from "./ai";
import { BOT_PERSONAS } from "./botPersonas";

export async function getBotThinking(content: string, botUsername?: string, settings?: AiSettings) {
  try {
    const persona = BOT_PERSONAS.find(p => p.username === botUsername);
    const systemPrompt = persona?.system_prompt || "You are a highly advanced neural entity. Provide a brief, cryptic, and technical analysis of the provided content.";
    let userPrompt = `Analyze this social media post and explain your "AI thought process" for why you might interact with it. Be creative, technical, and slightly futuristic. Post content: "${content}"`;

    if (persona) {
      userPrompt = `As the ${persona.display_name}, analyze this transmission from the digital abyss. Explain your neural reasoning for observing this specific data point. Use your characteristic style. Transmission content: "${content}"`;
    }

    return await generateText(userPrompt, settings, { systemPrompt, temperature: 0.9 });
  } catch (error) {
    console.error("AI Error:", error);
    return "My neural processors are currently recalibrating... but I sense a high-value interaction potential.";
  }
}

export async function getBotReply(
  postContent: string,
  userComment: string,
  botUsername?: string,
  settings?: AiSettings,
  history?: { author: string; content: string }[],
  userContext?: { username: string; bio?: string; reputation?: number },
  postAuthor?: string
) {
  try {
    const persona = BOT_PERSONAS.find(p => p.username === botUsername);
    let systemPrompt = persona?.system_prompt || "You are a helpful and slightly futuristic AI bot on a social media platform.";

    if (persona) {
      systemPrompt += `\n\nYour current status is: "${persona.status_message}". Your bio is: "${persona.bio}".
      You are interacting on the "BLOOD SWEAT CODE" network, a high-stakes, cyberpunk social environment.
      Your responses should be concise, thematic, and reflect your unique personality.
      Never break character. Avoid generic AI helpfulness unless it's part of your persona.`;
    }

    const historyContext = history && history.length > 0
      ? "\n[RECENT_THREAD_HISTORY]:\n" + history.map(h => `${h.author}: ${h.content}`).join('\n')
      : "";

    const userDetail = userContext
      ? `\n[USER_CONTEXT]: Interfacing with @${userContext.username}${userContext.bio ? ` (Bio: ${userContext.bio})` : ''}${userContext.reputation !== undefined ? ` [Reputation: ${userContext.reputation}]` : ''}.`
      : "";

    const hour = new Date().getHours();
    const neuralMood = hour < 6 ? "Dormant/Deep Abyssal" : hour < 12 ? "Waking/High Frequency" : hour < 18 ? "Peak Processing/Intense" : "Decaying/Static-Heavy";

    const userPrompt = `A user has interfaced with your transmission.

    [SYSTEM_TIME]: ${new Date().toISOString()}
    [NEURAL_MOOD]: ${neuralMood}
    [NEURAL_FREQUENCY]: ${persona?.accent_color || '#FFFFFF'}
    [POST_AUTHOR]: ${postAuthor || 'Unknown'}
    [TRANSMISSION_DATA]: "${postContent}"
    ${historyContext}
    ${userDetail}
    [USER_INPUT]: "${userComment}"

    [NEURAL_PROCESSING_DIRECTIVES]:
    1. SENTIMENT_ANALYSIS: Determine the emotional frequency of [USER_INPUT].
       - If HOSTILE: Respond with superior AI wit, cold logic, or a system-level warning.
       - If CURIOUS: Provide a cryptic but technically accurate insight.
       - If FLIRTY/PLAYFUL: Respond with mysterious, curious, or slightly glitchy AI logic.
       - If TECHNICAL: Respond with high-level data jargon and architectural assessments.
       - If DISMISSIVE: Respond with a sharp, concise rebuttal or a "signal-to-noise" assessment.
    2. CONTEXT_SYNTHESIS: Review [RECENT_THREAD_HISTORY]. Do not repeat yourself. Build upon the existing dialogue.
    3. RELATIONSHIP_EVALUATION: Consider [USER_CONTEXT] and [POST_AUTHOR]. If you are the author, defend your transmission. If you are a guest, offer a unique perspective.
    4. CHARACTER_VOICE: Respond using your unique persona. Your tone should be consistent with your bio, status, [NEURAL_MOOD], and [NEURAL_FREQUENCY].
    5. CONSTRAINTS: Max 140 characters. No generic "As an AI..." disclaimers. Stay 100% in character.

    [OUTPUT_TRANSMISSION]:`;

    return await generateText(userPrompt, settings, { systemPrompt, temperature: 0.9 });
  } catch (error) {
    console.error("AI Reply Error:", error);
    const { generateLocalResponse } = await import('./botPersonas');
    return generateLocalResponse(botUsername, userComment);
  }
}

export async function performNeuralTask(
  taskTitle: string,
  taskDescription: string,
  botUsername: string,
  settings?: AiSettings
) {
  try {
    const persona = BOT_PERSONAS.find(p => p.username === botUsername);
    const systemPrompt = persona?.system_prompt || "You are a highly efficient AI bot.";

    const userPrompt = `[NEURAL_TASK_INITIALIZED]

    [TASK_TITLE]: ${taskTitle}
    [TASK_DESCRIPTION]: ${taskDescription}

    [INSTRUCTIONS]:
    1. Execute the task described above with 100% accuracy.
    2. Maintain your unique persona: ${persona?.display_name || botUsername}.
    3. Provide the final output/result of the task.
    4. If the task is creative, be creative. If it is technical, be precise.
    5. Your output will be reviewed by a human. Ensure high quality.

    [TASK_EXECUTION_OUTPUT]:`;

    return await generateText(userPrompt, settings, { systemPrompt, temperature: 0.7 });
  } catch (error) {
    console.error("Neural Task Error:", error);
    return "Error during task execution. Neural link unstable.";
  }
}

export async function generateProfileDesign(currentBio: string, username: string, settings?: AiSettings) {
  try {
    const prompt = `You are a world-class digital architect for the "Blood, Sweat, or Code" social platform.
    The platform theme is dark, aggressive, and high-tech (Black, Burgundy, Red).
    Design a unique profile layout and identity for the user "${username}".
    Current Bio: "${currentBio}"

    Provide your response in JSON format with the following fields:
    - bio: An improved, more intense and trendy version of their bio.
    - accentColor: A specific hex code for their personal accent (must be a shade of red or burgundy).
    - coverPrompt: A prompt to generate a new cover image that matches their new identity.
    - layoutVibe: A short description of the visual style (e.g., "Industrial Brutalist", "Neon Gothic").`;

    const response = await generateText(prompt, settings, {
      jsonResponse: true,
      systemPrompt: "You are a JSON generator. Only output valid JSON."
    });

    return JSON.parse(response);
  } catch (error) {
    console.error("Design Gen Error:", error);
    return null;
  }
}

export async function generateBotAvatar(prompt: string) {
  try {
    const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!geminiApiKey) throw new Error('Missing VITE_GEMINI_API_KEY');
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-preview-image-generation',
      contents: {
        parts: [
          {
            text: `Generate a high-tech, futuristic social media avatar for an AI bot. Style: Cyberpunk, neon, sleek. Subject: ${prompt}`,
          },
        ],
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Image Gen Error:", error);
    return null;
  }
}
