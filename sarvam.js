// Sarvam AI API helpers
// STT : wss://api.sarvam.ai/speech-to-text-realtime/ws
// LLM : POST https://api.sarvam.ai/v1/chat/completions
// TTS : POST https://api.sarvam.ai/text-to-speech

import { SARVAM_API_KEY } from './env';

// ── Realtime STT WebSocket URL ────────────────────────────────────────────────
export function buildSttWsUrl() {
  const params = new URLSearchParams({
    'api-subscription-key': SARVAM_API_KEY,
    language_code: 'auto',
    model: 'saaras:v4',
    stream_type: 'fast',
    mode: 'codemix',
    encoding: 'linear16',
    sample_rate: '16000',
    endpointing: 'vad',
    silence_duration_ms: '700',
    min_speech_duration_ms: '250',
  });
  return `wss://api.sarvam.ai/speech-to-text-realtime/ws?${params}`;
}

// ── LLM chat completion ───────────────────────────────────────────────────────
export async function chatCompletion(messages) {
  const res = await fetch('https://api.sarvam.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'api-subscription-key': SARVAM_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sarvam-105b-conversations',
      messages,
      max_tokens: 150,
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0]?.message?.content?.trim() ?? '';
}

// ── Text-to-speech ────────────────────────────────────────────────────────────
// Returns base64-encoded WAV audio
export async function textToSpeech(text) {
  const res = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: {
      'api-subscription-key': SARVAM_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      language_code: 'en-IN',
      model: 'bulbul:v4-flash',
      speaker: 'ishita_en_edtech',
      speech_sample_rate: 22050,
      output_audio_codec: 'wav',
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.audios[0] ?? '';
}
