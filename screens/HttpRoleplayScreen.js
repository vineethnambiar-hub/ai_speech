/**
 * HTTP roleplay POC — Sarvam live STT → mock-interview-be pipecat-sse.
 *
 * Clock (one turn):
 *   user stopped speaking
 *     → silence detection (Sarvam VAD, silence_duration_ms)
 *     → vad.speech_end
 *     → transcript.final
 *     → POST /api/v1/speech/pipecat-sse
 *     → first BE event (line / first_audio / audio)
 *
 * Total after speak = silence + STT settle + BE time-to-first-response.
 */

import { requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import LiveAudioStream from 'react-native-live-audio-stream';

const SARVAM_KEY = process.env.EXPO_PUBLIC_SARVAM_API_KEY ?? '';
const API_BASE = (process.env.EXPO_PUBLIC_ROLEPLAY_API_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');
const API_TOKEN = process.env.EXPO_PUBLIC_ROLEPLAY_TOKEN ?? 'local-dev';
const SILENCE_MS = Number(process.env.EXPO_PUBLIC_STT_SILENCE_MS ?? '700');

function sttSocketUrl() {
  const params = new URLSearchParams({
    language_code: 'en-IN',
    model: 'saaras:v4',
    stream_type: 'fast',
    mode: 'transcribe',
    encoding: 'linear16',
    sample_rate: '16000',
    endpointing: 'vad',
    silence_duration_ms: String(SILENCE_MS),
    min_speech_duration_ms: '250',
  });
  return `wss://api.sarvam.ai/speech-to-text-realtime/ws?${params}`;
}

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${API_TOKEN}`,
    Accept: 'text/event-stream',
    ...extra,
  };
}

function parseSseBlock(raw) {
  let event = 'message';
  const dataLines = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return { event, data: { raw: dataLines.join('\n') } };
  }
}

/** Read one SSE response via XHR onprogress (React Native-friendly). */
function streamPipecatTurn({ sessionId, text, say = '', onEvent, onDone, onError }) {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${API_BASE}/api/v1/speech/pipecat-sse`);
  const headers = authHeaders({ 'Content-Type': 'application/json' });
  Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));

  let cursor = 0;
  let buffer = '';

  const consume = (chunk) => {
    buffer += chunk;
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const block of parts) {
      const parsed = parseSseBlock(block.trim());
      if (parsed) onEvent(parsed);
    }
  };

  xhr.onprogress = () => {
    const next = xhr.responseText.slice(cursor);
    cursor = xhr.responseText.length;
    if (next) consume(next);
  };

  xhr.onload = () => {
    const rest = xhr.responseText.slice(cursor);
    if (rest) consume(rest);
    if (buffer.trim()) {
      const parsed = parseSseBlock(buffer.trim());
      if (parsed) onEvent(parsed);
    }
    if (xhr.status < 200 || xhr.status >= 300) {
      onError(new Error(`pipecat-sse ${xhr.status}: ${xhr.responseText.slice(0, 240)}`));
      return;
    }
    onDone();
  };

  xhr.onerror = () => onError(new Error('Network error talking to roleplay BE.'));
  xhr.send(JSON.stringify({ session_id: sessionId, text, say }));
  return xhr;
}

async function fetchTutorTemplate() {
  const res = await fetch(`${API_BASE}/api/v1/roleplay/templates/tutor`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`templates/tutor ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Start roleplay with sse_audio + pipecat voice; return session_id from ready. */
function startRoleplaySession(roleplay) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/v1/session/start`);
    const headers = authHeaders({ 'Content-Type': 'application/json' });
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));

    let cursor = 0;
    let buffer = '';
    let sessionId = '';
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else if (sessionId) resolve(sessionId);
      else reject(new Error('session start closed without ready'));
    };

    const consume = (chunk) => {
      buffer += chunk;
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const block of parts) {
        const parsed = parseSseBlock(block.trim());
        if (parsed?.event === 'ready') {
          sessionId = parsed.data?.session_id || '';
          xhr.abort();
          finish();
        } else if (parsed?.event === 'error') {
          finish(new Error(parsed.data?.detail || parsed.data?.message || 'session start error'));
        }
      }
    };

    xhr.onprogress = () => {
      const next = xhr.responseText.slice(cursor);
      cursor = xhr.responseText.length;
      if (next) consume(next);
    };
    xhr.onload = () => {
      const rest = xhr.responseText.slice(cursor);
      if (rest) consume(rest);
      if (!settled) {
        if (xhr.status < 200 || xhr.status >= 300) {
          finish(new Error(`session/start ${xhr.status}: ${xhr.responseText.slice(0, 240)}`));
        } else {
          finish();
        }
      }
    };
    xhr.onerror = () => finish(new Error('Network error on session/start'));
    xhr.onabort = () => {
      if (sessionId) finish();
    };

    const body = {
      mode: 'roleplay',
      roleplay: {
        ...roleplay,
        settings: {
          ...(roleplay.settings || {}),
          sse_audio: true,
          sse_stt: 'sarvam',
          voice: {
            provider: 'pipecat',
            model: 'bulbul:v4-flash',
            voice_id: 'simran_en_edtech',
          },
        },
        conversation: {
          ...(roleplay.conversation || {}),
          who_speaks_first: 'ai',
        },
      },
    };
    xhr.send(JSON.stringify(body));
  });
}

function ms(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value / 1000).toFixed(2)}s`;
}

export default function HttpRoleplayScreen({ onBack }) {
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Start a session, then speak a turn.');
  const [partial, setPartial] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [turns, setTurns] = useState([]);
  const [error, setError] = useState(null);
  const [opening, setOpening] = useState('');

  const wsRef = useRef(null);
  const xhrRef = useRef(null);
  const sessionRef = useRef('');
  const turnBusy = useRef(false);
  const marks = useRef({
    lastSpeechAt: null,
    speechEndAt: null,
  });

  useEffect(() => {
    return () => {
      stopListening();
      xhrRef.current?.abort();
    };
  }, []);

  function stopListening() {
    try { LiveAudioStream.stop(); } catch { /* already stopped */ }
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ event: 'end' })); } catch { /* ignore */ }
      ws.close();
    }
    setLive(false);
  }

  async function bootstrap() {
    setError(null);
    setTurns([]);
    setOpening('');
    setPartial('');
    setBusy(true);
    setStatus('Starting roleplay session on BE…');
    try {
      const template = await fetchTutorTemplate();
      const id = await startRoleplaySession(template);
      sessionRef.current = id;
      setSessionId(id);
      setStatus('Session ready. Fetching AI opening…');
      await runBeTurn({ text: '', say: '', label: 'opening' });
      setStatus('Opening done. Start listening and speak.');
    } catch (err) {
      setError(err?.message ?? 'Could not start session.');
      setStatus('Start failed.');
    } finally {
      setBusy(false);
    }
  }

  function runBeTurn({ text, say, label, clock }) {
    return new Promise((resolve) => {
      if (!sessionRef.current) {
        setError('No session. Tap Start session first.');
        resolve(null);
        return;
      }

      const postAt = Date.now();
      let firstBeAt = null;
      let firstKind = '';
      let lineText = '';
      let firstAudioMs = null;
      let doneAt = null;
      const events = [];

      turnBusy.current = true;
      setBusy(true);
      setStatus(label === 'opening' ? 'Waiting for opening…' : 'Waiting for BE…');

      xhrRef.current = streamPipecatTurn({
        sessionId: sessionRef.current,
        text,
        say,
        onEvent: ({ event, data }) => {
          events.push(event);
          if (event === 'line' && data?.role === 'ai' && data?.text) {
            lineText = data.text;
            if (firstBeAt == null) {
              firstBeAt = Date.now();
              firstKind = 'line';
            }
            if (label === 'opening') setOpening(data.text);
          } else if (event === 'first_audio') {
            firstAudioMs = data?.ms ?? null;
            if (firstBeAt == null) {
              firstBeAt = Date.now();
              firstKind = 'first_audio';
            }
          } else if (event === 'audio') {
            if (firstBeAt == null) {
              firstBeAt = Date.now();
              firstKind = 'audio';
            }
          } else if (event === 'done') {
            doneAt = Date.now();
          } else if (event === 'error') {
            setError(data?.message || 'BE turn error');
          }
        },
        onDone: () => {
          const finishAt = doneAt ?? Date.now();
          const silenceMs = clock?.silenceMs ?? null;
          const speechEndAt = clock?.speechEndAt ?? null;
          const finalAt = clock?.finalAt ?? postAt;
          const userSilentAt = clock?.userSilentAt ?? null;

          const row = {
            label,
            you: text || (label === 'opening' ? '(opening)' : ''),
            ai: lineText,
            timings: {
              silenceMs,
              sttAfterSilenceMs: speechEndAt != null ? finalAt - speechEndAt : null,
              bePostMs: firstBeAt != null ? firstBeAt - postAt : null,
              beDoneMs: finishAt - postAt,
              totalAfterSpeakMs: userSilentAt != null && firstBeAt != null
                ? firstBeAt - userSilentAt
                : null,
              firstKind,
              firstAudioMs,
              silenceConfigMs: SILENCE_MS,
            },
            events: events.slice(0, 12),
          };

          if (label !== 'opening') {
            setTurns((prev) => [...prev, row]);
          } else if (lineText) {
            setOpening(lineText);
          }

          turnBusy.current = false;
          setBusy(false);
          setStatus(label === 'opening' ? 'Opening ready.' : 'Connected. Speak again.');
          resolve(row);
        },
        onError: (err) => {
          turnBusy.current = false;
          setBusy(false);
          setError(err.message);
          setStatus('BE turn failed.');
          resolve(null);
        },
      });
    });
  }

  async function startListening() {
    setError(null);
    if (!sessionRef.current) {
      setError('Start a session before listening.');
      return;
    }
    if (!SARVAM_KEY) {
      setError('Add EXPO_PUBLIC_SARVAM_API_KEY and restart Metro.');
      return;
    }

    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      setError('Microphone permission is required.');
      return;
    }

    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

    const ws = new WebSocket(sttSocketUrl(), [`api-subscription-key.${SARVAM_KEY}`]);
    wsRef.current = ws;
    marks.current = { lastSpeechAt: null, speechEndAt: null };
    setPartial('');
    setStatus('Connecting to Sarvam STT…');
    setLive(true);

    ws.onopen = () => {
      setStatus('Listening. Speak a turn.');
      LiveAudioStream.init({
        sampleRate: 16000,
        channels: 1,
        bitsPerSample: 16,
        audioSource: 6,
        wavFile: `${FileSystem.cacheDirectory}http_roleplay.wav`,
        bufferSize: 3200,
      });
      LiveAudioStream.on('data', (chunk) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ event: 'audio_input', audio: chunk }));
      });
      LiveAudioStream.start();
      setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      });
    };

    ws.onmessage = (message) => {
      let event;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }

      if (event.event === 'vad.speech_start') {
        marks.current.lastSpeechAt = Date.now();
        marks.current.speechEndAt = null;
        setStatus('Hearing you…');
      } else if (event.event === 'vad.speech_end') {
        marks.current.speechEndAt = Date.now();
        setStatus('Silence detected — waiting for final STT…');
      } else if (event.event === 'transcript.partial') {
        marks.current.lastSpeechAt = Date.now();
        setPartial(event.text ?? '');
      } else if (event.event === 'transcript.final') {
        const text = (event.text ?? '').trim();
        setPartial('');
        if (!text) {
          setStatus('Empty final — keep speaking.');
          return;
        }
        if (turnBusy.current) {
          setStatus('BE still busy — skipped this final.');
          return;
        }

        const finalAt = Date.now();
        const speechEndAt = marks.current.speechEndAt ?? finalAt;
        const userSilentAt = speechEndAt - SILENCE_MS;
        const silenceMs = SILENCE_MS;

        marks.current = { lastSpeechAt: null, speechEndAt: null };
        setStatus('Final STT ready — posting to BE…');
        runBeTurn({
          text,
          say: '',
          label: 'turn',
          clock: { silenceMs, speechEndAt, finalAt, userSilentAt },
        });
      } else if (event.event === 'error') {
        setError(event.message ?? 'Sarvam returned an error.');
        if (event.is_fatal) stopListening();
      }
    };

    ws.onerror = () => setError('Could not connect to Sarvam STT.');
    ws.onclose = () => {
      try { LiveAudioStream.stop(); } catch { /* ignore */ }
      setLive(false);
    };
  }

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable onPress={() => { stopListening(); onBack(); }}>
          <Text style={s.back}>← Back</Text>
        </Pressable>
        <Text style={s.title}>HTTP roleplay POC</Text>
        <Text style={s.sub}>
          Sarvam STT → POST /speech/pipecat-sse · silence {SILENCE_MS}ms
        </Text>
        <Text style={s.meta}>
          {API_BASE}{sessionId ? ` · ${sessionId.slice(0, 8)}…` : ''}
        </Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        <Text style={s.status}>{status}</Text>

        {!!opening && (
          <View style={s.bubbleAi}>
            <Text style={s.label}>AI OPENING</Text>
            <Text style={s.body}>{opening}</Text>
          </View>
        )}

        <View style={s.box}>
          <Text style={s.label}>HEARING NOW</Text>
          <Text style={s.partial}>{partial || '…'}</Text>
        </View>

        {turns.map((turn, index) => (
          <View key={index} style={s.turn}>
            <Text style={s.label}>TURN {index + 1}</Text>
            <Text style={s.you}>You: {turn.you}</Text>
            <Text style={s.ai}>AI: {turn.ai || '(waiting / no line yet)'}</Text>
            <View style={s.timingBox}>
              <Text style={s.timing}>silence detect  {ms(turn.timings.silenceMs)}  (config)</Text>
              <Text style={s.timing}>STT after silence  {ms(turn.timings.sttAfterSilenceMs)}</Text>
              <Text style={s.timing}>
                BE → first ({turn.timings.firstKind || '—'})  {ms(turn.timings.bePostMs)}
              </Text>
              <Text style={s.timing}>BE → done  {ms(turn.timings.beDoneMs)}</Text>
              <Text style={s.timingTotal}>
                total after you stopped  {ms(turn.timings.totalAfterSpeakMs)}
              </Text>
              {turn.timings.firstAudioMs != null && (
                <Text style={s.timing}>BE first_audio metric  {turn.timings.firstAudioMs} ms</Text>
              )}
            </View>
          </View>
        ))}
      </ScrollView>

      {!!error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      <View style={s.controls}>
        <Pressable
          disabled={busy}
          onPress={bootstrap}
          style={({ pressed }) => [s.btn, s.btnSession, (pressed || busy) && { opacity: 0.7 }]}>
          {busy && !live
            ? <ActivityIndicator color="#FFF" />
            : <Text style={s.btnText}>{sessionId ? 'Restart session' : 'Start session'}</Text>}
        </Pressable>
        <Pressable
          disabled={!sessionId || busy}
          onPress={() => (live ? stopListening() : startListening())}
          style={({ pressed }) => [
            s.btn,
            live ? s.btnStop : s.btnStart,
            (!sessionId || busy || pressed) && { opacity: 0.7 },
          ]}>
          <Text style={s.btnText}>{live ? 'Stop listening' : 'Start listening'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0F0F0F' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
    gap: 4,
  },
  back: { color: '#888', fontSize: 13, marginBottom: 4 },
  title: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  sub: { fontSize: 12, color: '#888' },
  meta: { fontSize: 11, color: '#555' },

  scroll: { flex: 1 },
  content: { padding: 16, gap: 12 },
  status: { color: '#888', fontSize: 13 },

  box: { backgroundColor: '#1A1A1A', borderRadius: 12, padding: 14, gap: 8, minHeight: 72 },
  label: { fontSize: 10, fontWeight: '700', color: '#555', letterSpacing: 1 },
  partial: { color: '#FFF', fontSize: 18, lineHeight: 26 },
  body: { color: '#D6F5EA', fontSize: 15, lineHeight: 22 },

  bubbleAi: { backgroundColor: '#14241F', borderRadius: 12, padding: 14, gap: 8 },

  turn: { backgroundColor: '#1A1A1A', borderRadius: 12, padding: 14, gap: 8 },
  you: { color: '#FFF', fontSize: 14, lineHeight: 20 },
  ai: { color: '#D6F5EA', fontSize: 14, lineHeight: 20 },
  timingBox: { marginTop: 4, gap: 2 },
  timing: { color: '#888', fontSize: 12, fontVariant: ['tabular-nums'] },
  timingTotal: { color: '#F5A623', fontSize: 13, fontWeight: '700', marginTop: 4 },

  errorBox: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    backgroundColor: '#3A1A1A',
    borderRadius: 8,
  },
  errorText: { color: '#FF6B6B', fontSize: 13 },

  controls: { padding: 16, paddingBottom: 28, gap: 10, borderTopWidth: 1, borderTopColor: '#2A2A2A' },
  btn: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  btnSession: { backgroundColor: '#333' },
  btnStart: { backgroundColor: '#0F766E' },
  btnStop: { backgroundColor: '#444' },
  btnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});
