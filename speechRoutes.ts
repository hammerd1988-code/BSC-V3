import type { Express, RequestHandler } from 'express';
import multer from 'multer';
import fs from 'fs';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const OPENAI_TTS_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] as const;

type WhisperProvider = { name: string; url: string; key: string; model: string };

// Speech synthesis and transcription. Extracted from the server entrypoints so
// the OpenAI, Mimo, and Whisper routes exist exactly once.
export function registerSpeechRoutes(app: Express, aiRateLimit: RequestHandler) {
  // ── Text-to-Speech (OpenAI) ──
  app.post('/api/tts', aiRateLimit, async (req, res) => {
    try {
      const { text, voice, speed } = req.body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text is required' });
      }

      const apiKey = process.env.OPENAI_TTS_KEY || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.warn('[tts] OPENAI_TTS_KEY/OPENAI_API_KEY is not configured');
        return res.status(503).json({ error: 'OpenAI TTS unavailable' });
      }

      const input = text.slice(0, 4096);
      const speechSpeed = typeof speed === 'number' ? Math.max(0.25, Math.min(4.0, speed)) : 1.05;
      const selectedVoice = typeof voice === 'string' && (OPENAI_TTS_VOICES as readonly string[]).includes(voice) ? voice : 'ash';

      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          voice: selectedVoice,
          input,
          speed: speechSpeed,
          response_format: 'mp3',
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[tts] OpenAI returned ${response.status}: ${errText.slice(0, 300)}`);
        return res.status(503).json({ error: 'OpenAI TTS unavailable' });
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Length', String(audioBuffer.byteLength));
      res.set('Cache-Control', 'no-cache');
      return res.send(audioBuffer);
    } catch (e: any) {
      console.error('[tts] Error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── Text-to-Speech (Mimo) ──
  app.post('/api/tts/mimo', aiRateLimit, async (req, res) => {
    try {
      const { text, voice, speed } = req.body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text is required' });
      }

      const apiKey = process.env.MIMO_API_KEY;
      const baseUrl = process.env.MIMO_API_BASE_URL || 'https://token-plan-sgp.xiaomimimo.com/v1';
      const model = process.env.MIMO_TTS_MODEL || 'mimo-v2.5-tts';

      if (!apiKey) {
        console.warn('[tts/mimo] MIMO_API_KEY is not configured');
        return res.status(503).json({ error: 'Mimo TTS unavailable — API key not configured' });
      }

      const input = text.slice(0, 4096);
      const speechSpeed = typeof speed === 'number' ? Math.max(0.25, Math.min(4.0, speed)) : 1.0;

      const response = await fetch(`${baseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          voice: voice || 'alloy',
          input,
          speed: speechSpeed,
          response_format: 'mp3',
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[tts/mimo] Mimo returned ${response.status}: ${errText.slice(0, 300)}`);
        return res.status(503).json({ error: `Mimo TTS error: ${response.status}` });
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Length', String(audioBuffer.byteLength));
      res.set('Cache-Control', 'no-cache');
      return res.send(audioBuffer);
    } catch (e: any) {
      console.error('[tts/mimo] Error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── TTS voices available ──
  app.get('/api/tts/voices', (_req, res) => {
    const voices: Array<{ id: string; label: string; provider: string; description: string; tag?: string }> = [
      { id: 'browser', label: 'Browser Native', provider: 'browser', description: 'Built-in browser TTS (free, no API key)' },
    ];
    if (process.env.MIMO_API_KEY) {
      voices.push(
        { id: 'mimo-alloy', label: 'Mimo — Alloy', provider: 'mimo', description: 'Mimo v2.5 TTS — Alloy voice' },
        { id: 'mimo-echo', label: 'Mimo — Echo', provider: 'mimo', description: 'Mimo v2.5 TTS — Echo voice' },
        { id: 'mimo-fable', label: 'Mimo — Fable', provider: 'mimo', description: 'Mimo v2.5 TTS — Fable voice' },
        { id: 'mimo-onyx', label: 'Mimo — Onyx', provider: 'mimo', description: 'Mimo v2.5 TTS — Onyx voice' },
        { id: 'mimo-nova', label: 'Mimo — Nova', provider: 'mimo', description: 'Mimo v2.5 TTS — Nova voice' },
        { id: 'mimo-shimmer', label: 'Mimo — Shimmer', provider: 'mimo', description: 'Mimo v2.5 TTS — Shimmer voice' },
      );
    }
    if (process.env.OPENAI_TTS_KEY || process.env.OPENAI_API_KEY) {
      voices.push(
        { id: 'openai-ash', label: 'OpenAI — Ash', provider: 'openai', description: 'OpenAI TTS-1 — Ash (Casper\'s voice)', tag: 'casper' },
        { id: 'openai-alloy', label: 'OpenAI — Alloy', provider: 'openai', description: 'OpenAI TTS-1 — Alloy voice' },
        { id: 'openai-ballad', label: 'OpenAI — Ballad', provider: 'openai', description: 'OpenAI TTS-1 — Ballad voice' },
        { id: 'openai-coral', label: 'OpenAI — Coral', provider: 'openai', description: 'OpenAI TTS-1 — Coral voice' },
        { id: 'openai-echo', label: 'OpenAI — Echo', provider: 'openai', description: 'OpenAI TTS-1 — Echo voice' },
        { id: 'openai-fable', label: 'OpenAI — Fable', provider: 'openai', description: 'OpenAI TTS-1 — Fable voice' },
        { id: 'openai-nova', label: 'OpenAI — Nova', provider: 'openai', description: 'OpenAI TTS-1 — Nova voice' },
        { id: 'openai-onyx', label: 'OpenAI — Onyx', provider: 'openai', description: 'OpenAI TTS-1 — Onyx voice' },
        { id: 'openai-sage', label: 'OpenAI — Sage', provider: 'openai', description: 'OpenAI TTS-1 — Sage voice' },
        { id: 'openai-shimmer', label: 'OpenAI — Shimmer', provider: 'openai', description: 'OpenAI TTS-1 — Shimmer voice' },
        { id: 'openai-verse', label: 'OpenAI — Verse', provider: 'openai', description: 'OpenAI TTS-1 — Verse voice' },
      );
    }
    res.json({ voices });
  });

  // ── Audio Transcription (Whisper) ──
  app.post('/api/transcribe', aiRateLimit, upload.single('audio'), async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'No audio file provided' });

      const providers: WhisperProvider[] = [];

      const aiBaseUrl = process.env.VITE_AI_BASE_URL;
      const aiApiKey = process.env.VITE_AI_API_KEY;
      if (aiBaseUrl && aiApiKey) {
        providers.push({
          name: 'proxy',
          url: `${aiBaseUrl.replace(/\/v1\/?$/, '')}/v1/audio/transcriptions`,
          key: aiApiKey,
          model: 'whisper-1',
        });
      }

      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        providers.push({
          name: 'openai',
          url: 'https://api.openai.com/v1/audio/transcriptions',
          key: openaiKey,
          model: 'whisper-1',
        });
      }

      const groqKey = process.env.GROQ_API_KEY;
      if (groqKey) {
        providers.push({
          name: 'groq',
          url: 'https://api.groq.com/openai/v1/audio/transcriptions',
          key: groqKey,
          model: 'whisper-large-v3',
        });
      }

      if (providers.length === 0) {
        return res.status(500).json({ error: 'No transcription API configured. Set VITE_AI_API_KEY, OPENAI_API_KEY, or GROQ_API_KEY.' });
      }

      // Convert webm to wav for maximum compatibility
      let audioBuffer = file.buffer;
      let audioMime = file.mimetype || 'audio/webm';
      let audioExt = 'webm';

      try {
        const tmpIn = `${tmpdir()}/casper_in_${Date.now()}.webm`;
        const tmpOut = `${tmpdir()}/casper_out_${Date.now()}.wav`;
        fs.writeFileSync(tmpIn, file.buffer);
        execSync(`ffmpeg -y -i "${tmpIn}" -ar 16000 -ac 1 -f wav "${tmpOut}" 2>/dev/null`);
        audioBuffer = fs.readFileSync(tmpOut);
        audioMime = 'audio/wav';
        audioExt = 'wav';
        fs.unlinkSync(tmpIn);
        fs.unlinkSync(tmpOut);
        console.log(`[transcribe] Converted webm to wav (${audioBuffer.length} bytes)`);
      } catch (convErr) {
        console.warn('[transcribe] ffmpeg conversion failed, using original:', (convErr as Error).message);
      }

      let lastError = '';
      for (const provider of providers) {
        try {
          const formData = new FormData();
          formData.append('file', new Blob([audioBuffer], { type: audioMime }), `audio.${audioExt}`);
          formData.append('model', provider.model);
          formData.append('language', 'en');
          formData.append('response_format', 'json');

          console.log(`[transcribe] Trying ${provider.name} (${audioBuffer.length} bytes) → ${provider.url}`);

          const response = await fetch(provider.url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${provider.key}` },
            body: formData,
          });

          if (!response.ok) {
            const errText = await response.text();
            console.warn(`[transcribe] ${provider.name} returned ${response.status}: ${errText.slice(0, 300)}`);
            lastError = `${provider.name}: ${response.status} - ${errText.slice(0, 100)}`;
            continue;
          }

          const data = await response.json();
          const transcript = (data.text || '').trim();
          console.log(`[transcribe] ${provider.name} success: "${transcript.slice(0, 80)}"`);
          return res.json({ transcript, provider: provider.name });
        } catch (providerErr: any) {
          console.warn(`[transcribe] ${provider.name} threw: ${providerErr.message}`);
          lastError = providerErr.message;
        }
      }

      console.error('[transcribe] All providers failed. Last error:', lastError);
      res.status(502).json({ error: 'All transcription providers failed', detail: lastError });
    } catch (e: any) {
      console.error('[transcribe] Error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });
}
