/**
 * Pitch & Feedback — HTTP Streaming mode
 *
 * Flow:
 *  1. User records a full pitch (expo-audio AudioRecorder → .m4a file)
 *  2. On stop → POST audio to Sarvam batch STT → get transcript
 *  3. POST transcript to Sarvam LLM with stream:true → stream feedback tokens
 *  4. Display transcript + streamed feedback in real-time
 *
 * Uses XHR onprogress to read SSE chunks as they arrive.
 */

import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { useState, useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const SARVAM_KEY = process.env.EXPO_PUBLIC_SARVAM_API_KEY ?? '';

// ── Sarvam speech to text ─────────────────────────────────────────────────────
// Speaking time is measured by the caller (mic open → stop pressed).
// This splits the request: upload finishes, then Sarvam's reply arrives.
function transcribeAudio(fileUri) {
  const form = new FormData();
  form.append('file', { uri: fileUri, name: 'pitch.m4a', type: 'audio/m4a' });
  form.append('model', 'saaras:v4');
  form.append('language_code', 'en-IN');

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://api.sarvam.ai/speech-to-text');
    xhr.setRequestHeader('api-subscription-key', SARVAM_KEY);

    const sentAt = Date.now();
    let uploadedAt = null;

    xhr.upload.onload = () => {
      uploadedAt = Date.now();
    };

    xhr.onload = () => {
      const doneAt = Date.now();
      const uploadMs = (uploadedAt ?? doneAt) - sentAt;
      const responseMs = uploadedAt == null ? null : doneAt - uploadedAt;

      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`STT failed: ${xhr.status} ${xhr.responseText}`));
        return;
      }

      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (err) {
        reject(err);
        return;
      }

      console.log(`[stt] upload ${uploadMs}ms, sarvam ${responseMs ?? 'not split'}ms`);
      resolve({
        text: data.transcript ?? '',
        uploadMs,
        responseMs,
      });
    };

    xhr.onerror = () => reject(new Error('Network error during speech to text.'));
    xhr.send(form);
  });
}

// ── Sarvam LLM — streaming via XHR ───────────────────────────────────────────
const FEEDBACK_PROMPT = `You are an expert sales coach. The learner has just delivered a pitch.
Analyse their transcript and give structured feedback in this format:

**Overall:** one sentence summary.

**What worked:**
- bullet points

**What to improve:**
- bullet points

**Score:** X/10 with brief reason.

Be concise, direct, and encouraging. Keep total response under 200 words.`;

function streamFeedback(transcript, onToken, onDone, onError) {
  const body = JSON.stringify({
    model: 'sarvam-105b-conversations',
    stream: true,
    max_tokens: 400,
    messages: [
      { role: 'system', content: FEEDBACK_PROMPT },
      { role: 'user',   content: `Transcript:\n"${transcript}"` },
    ],
  });

  const xhr = new XMLHttpRequest();
  xhr.open('POST', 'https://api.sarvam.ai/v1/chat/completions');
  xhr.setRequestHeader('api-subscription-key', SARVAM_KEY);
  xhr.setRequestHeader('Content-Type', 'application/json');

  let cursor = 0; // how many chars of responseText we've already parsed

  xhr.onprogress = () => {
    const newText = xhr.responseText.slice(cursor);
    cursor = xhr.responseText.length;

    newText.split('\n').forEach((line) => {
      if (!line.startsWith('data: ')) return;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return;
      try {
        const json  = JSON.parse(payload);
        const token = json.choices?.[0]?.delta?.content ?? '';
        if (token) onToken(token);
      } catch { /* incomplete chunk — will arrive with next progress event */ }
    });
  };

  xhr.onload  = () => onDone();
  xhr.onerror = () => onError(new Error('Network error during feedback stream.'));
  xhr.send(body);
  return xhr; // caller can abort() if needed
}

// ── Phases ────────────────────────────────────────────────────────────────────
const PHASE = {
  idle:         { label: 'Tap to start recording', color: '#6B6B6B' },
  recording:    { label: '🔴 Recording…',           color: '#EE2C3C' },
  transcribing: { label: '📝 Transcribing…',        color: '#F5A623' },
  streaming:    { label: '💬 Generating feedback…', color: '#2563EB' },
  done:         { label: '✅ Done',                  color: '#4CAF50' },
};

export default function PitchScreen({ onBack }) {
  const [phase,      setPhase]      = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [timings, setTimings] = useState(null);
  const [feedback,   setFeedback]   = useState('');
  const [error,      setError]      = useState(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const xhrRef   = useRef(null);
  const speakStartedAt = useRef(0);

  // ── Record ──────────────────────────────────────────────────────────────────
  async function startRecording() {
    setError(null);
    setTranscript('');
    setTimings(null);
    setFeedback('');

    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) { setError('Microphone permission required.'); return; }

    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    speakStartedAt.current = Date.now();
    setPhase('recording');
  }

  async function stopRecording() {
    const speakMs = Date.now() - speakStartedAt.current;
    setPhase('transcribing');
    await recorder.stop();
    const uri = recorder.uri;

    if (!uri) { setError('No recording found.'); setPhase('idle'); return; }

    try {
      // Step 1: STT
      const { text, uploadMs, responseMs } = await transcribeAudio(uri);
      setTranscript(text);
      setTimings({ speakMs, uploadMs, responseMs });

      if (!text.trim()) {
        setError('No speech detected — try again with a clearer recording.');
        setPhase('idle');
        return;
      }

      // Step 2: stream feedback
      setPhase('streaming');
      setFeedback('');

      xhrRef.current = streamFeedback(
        text,
        (token) => setFeedback((f) => f + token),
        ()      => setPhase('done'),
        (err)   => { setError(err.message); setPhase('idle'); },
      );
    } catch (err) {
      setError(err.message ?? 'Something went wrong.');
      setPhase('idle');
    }
  }

  function reset() {
    xhrRef.current?.abort();
    setPhase('idle');
    setTranscript('');
    setTimings(null);
    setFeedback('');
    setError(null);
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const p = PHASE[phase];
  const isRecording = phase === 'recording';
  const isBusy      = phase === 'transcribing' || phase === 'streaming';

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable onPress={onBack} style={s.back}><Text style={s.backText}>← Back</Text></Pressable>
        <Text style={s.title}>Pitch &amp; Feedback</Text>
        <Text style={s.sub}>Record your pitch — get streamed AI coaching</Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {/* Transcript */}
        {!!transcript && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>YOUR TRANSCRIPT</Text>
            {timings && (
              <Text style={s.transcriptText}>
                {`Speaking: ${(timings.speakMs / 1000).toFixed(2)} s\n`}
                {`Upload: ${(timings.uploadMs / 1000).toFixed(2)} s\n`}
                {timings.responseMs == null
                  ? 'Sarvam reply: included in the upload time'
                  : `Sarvam reply: ${(timings.responseMs / 1000).toFixed(2)} s`}
              </Text>
            )}
            <Text style={s.transcriptText}>{transcript}</Text>
          </View>
        )}

        {/* Feedback */}
        {!!feedback && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>
              FEEDBACK {phase === 'streaming' ? '(streaming…)' : ''}
            </Text>
            <Text style={s.feedbackText}>{feedback}</Text>
          </View>
        )}

        {/* Placeholder when idle */}
        {phase === 'idle' && !transcript && (
          <View style={s.placeholder}>
            <Text style={s.placeholderIcon}>🎤</Text>
            <Text style={s.placeholderText}>
              Tap the button below to start recording your pitch.{'\n'}
              Speak naturally — stop when you're done, and feedback will stream back.
            </Text>
          </View>
        )}
      </ScrollView>

      {!!error && <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>}

      {/* Controls */}
      <View style={s.controls}>
        <View style={s.statusRow}>
          {isBusy
            ? <ActivityIndicator color={p.color} size="small" />
            : <View style={[s.dot, { backgroundColor: p.color }]} />}
          <Text style={[s.statusText, { color: p.color }]}>{p.label}</Text>
        </View>

        {phase === 'done' ? (
          <Pressable onPress={reset} style={({ pressed }) => [s.btn, s.btnBlue, pressed && { opacity: 0.8 }]}>
            <Text style={s.btnText}>Try again</Text>
          </Pressable>
        ) : (
          <Pressable
            disabled={isBusy}
            onPress={() => isRecording ? stopRecording() : startRecording()}
            style={({ pressed }) => [
              s.btn,
              isRecording ? s.btnStop : s.btnRed,
              isBusy && s.btnDisabled,
              pressed && { opacity: 0.8 },
            ]}>
            <Text style={s.btnText}>
              {isRecording ? 'Stop & get feedback' : 'Start recording'}
            </Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0F0F0F' },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#2A2A2A', gap: 4 },
  back:   { marginBottom: 4 },
  backText: { color: '#888', fontSize: 13 },
  title:  { fontSize: 20, fontWeight: '700', color: '#FFF' },
  sub:    { fontSize: 12, color: '#888' },

  scroll:        { flex: 1 },
  scrollContent: { padding: 16, gap: 16 },

  section:      { gap: 8 },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: '#555', letterSpacing: 1 },
  transcriptText:{ fontSize: 14, color: '#AAA', lineHeight: 22, backgroundColor: '#1A1A1A', padding: 14, borderRadius: 12 },
  feedbackText:  { fontSize: 15, color: '#FFF', lineHeight: 24, backgroundColor: '#0D1F3C', padding: 14, borderRadius: 12 },

  placeholder:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  placeholderIcon: { fontSize: 48 },
  placeholderText: { fontSize: 14, color: '#555', textAlign: 'center', lineHeight: 22 },

  errorBox:  { margin: 16, padding: 12, backgroundColor: '#3A1A1A', borderRadius: 8 },
  errorText: { color: '#FF6B6B', fontSize: 13 },

  controls:  { padding: 20, paddingBottom: 32, gap: 14, borderTopWidth: 1, borderTopColor: '#2A2A2A' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  dot:       { width: 8, height: 8, borderRadius: 4 },
  statusText:{ fontSize: 14, fontWeight: '600' },

  btn:         { height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  btnRed:      { backgroundColor: '#EE2C3C' },
  btnStop:     { backgroundColor: '#333' },
  btnBlue:     { backgroundColor: '#2563EB' },
  btnDisabled: { opacity: 0.4 },
  btnText:     { color: '#FFF', fontSize: 16, fontWeight: '700' },
});
