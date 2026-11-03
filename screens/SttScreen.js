/**
 * Speech-to-text only.
 * Record → POST https://api.sarvam.ai/speech-to-text → transcript and timings.
 * No language model, no voice reply.
 */

import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { useRef, useState } from 'react';
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

function transcribeAudio(fileUri) {
  const form = new FormData();
  form.append('file', { uri: fileUri, name: 'speech.m4a', type: 'audio/m4a' });
  form.append('model', 'saaras:v4');
  form.append('language_code', 'en-IN');

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://api.sarvam.ai/speech-to-text');
    xhr.setRequestHeader('api-subscription-key', SARVAM_KEY);

    const sentAt = Date.now();
    let uploadedAt = null;

    const markUploaded = () => {
      if (uploadedAt == null) uploadedAt = Date.now();
    };
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.loaded > 0 && event.loaded === event.total) markUploaded();
    };
    xhr.upload.onload = markUploaded;

    xhr.onload = () => {
      const doneAt = Date.now();
      const totalMs = doneAt - sentAt;
      // The phone often reports "upload finished" at the same instant as the
      // transcript. A gap under 50ms is not a real split, so the whole wait
      // is the Sarvam reply.
      const gap = uploadedAt == null ? 0 : doneAt - uploadedAt;
      const split = uploadedAt != null && gap >= 50;
      const uploadMs = split ? uploadedAt - sentAt : null;
      const responseMs = split ? gap : totalMs;

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

function secs(ms) {
  if (ms == null) return '—';
  return `${(ms / 1000).toFixed(2)} s`;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export default function SttScreen({ onBack }) {
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [runs, setRuns] = useState([]);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const speakStartedAt = useRef(0);

  async function startRecording() {
    setError(null);
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      setError('Microphone permission is required.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    speakStartedAt.current = Date.now();
    setRecording(true);
  }

  async function stopAndSend() {
    const speakMs = Date.now() - speakStartedAt.current;
    setRecording(false);
    setSending(true);
    setError(null);

    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('No recording found.');

      const { text, uploadMs, responseMs } = await transcribeAudio(uri);
      setRuns((prev) => [
        { id: prev.length + 1, speakMs, uploadMs, responseMs, text },
        ...prev,
      ]);
    } catch (err) {
      setError(err?.message ?? 'Speech to text failed.');
    } finally {
      setSending(false);
    }
  }

  const speak = runs.map((r) => r.speakMs);
  const upload = runs.filter((r) => r.uploadMs != null).map((r) => r.uploadMs);
  const reply = runs.filter((r) => r.responseMs != null).map((r) => r.responseMs);

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable onPress={onBack}><Text style={s.back}>← Back</Text></Pressable>
        <Text style={s.title}>Speech to text</Text>
        <Text style={s.sub}>Record, then one request to Sarvam. Nothing else is called.</Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        {runs.length > 0 && (
          <View style={s.summary}>
            <Text style={s.section}>ACROSS {runs.length} {runs.length === 1 ? 'RUN' : 'RUNS'}</Text>
            <Text style={s.summaryLine}>Speaking p50 {secs(percentile(speak, 50))}   p95 {secs(percentile(speak, 95))}</Text>
            <Text style={s.summaryLine}>Upload p50 {secs(percentile(upload, 50))}   p95 {secs(percentile(upload, 95))}</Text>
            <Text style={s.summaryLine}>Sarvam reply p50 {secs(percentile(reply, 50))}   p95 {secs(percentile(reply, 95))}</Text>
            <Text style={s.hint}>p95 is the 19th value once you have 20 runs.</Text>
          </View>
        )}

        {runs.map((run) => (
          <View key={run.id} style={s.run}>
            <Text style={s.runTitle}>Run {run.id}</Text>
            <Text style={s.times}>
              {`Speaking ${secs(run.speakMs)}\nUpload ${run.uploadMs == null ? 'included in the line below' : secs(run.uploadMs)}\nSarvam reply ${secs(run.responseMs)}`}
            </Text>
            <Text style={s.transcript}>{run.text || '(empty transcript)'}</Text>
          </View>
        ))}
      </ScrollView>

      {!!error && <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>}

      <View style={s.controls}>
        {sending && (
          <View style={s.statusRow}>
            <ActivityIndicator color="#F5A623" size="small" />
            <Text style={s.status}>Sending to Sarvam…</Text>
          </View>
        )}
        <Pressable
          disabled={sending}
          onPress={() => recording ? stopAndSend() : startRecording()}
          style={({ pressed }) => [
            s.btn,
            recording ? s.btnStop : s.btnStart,
            sending && s.btnDisabled,
            pressed && { opacity: 0.8 },
          ]}>
          <Text style={s.btnText}>{recording ? 'Stop and transcribe' : 'Start recording'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0F0F0F' },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#2A2A2A', gap: 4 },
  back: { color: '#888', fontSize: 13, marginBottom: 4 },
  title: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  sub: { fontSize: 12, color: '#888' },

  scroll: { flex: 1 },
  content: { padding: 16, gap: 12 },

  summary: { backgroundColor: '#141414', borderRadius: 12, padding: 14, gap: 6 },
  section: { fontSize: 10, fontWeight: '700', color: '#555', letterSpacing: 1 },
  summaryLine: { color: '#DDD', fontSize: 14 },
  hint: { color: '#666', fontSize: 12, marginTop: 4 },

  run: { backgroundColor: '#1A1A1A', borderRadius: 12, padding: 14, gap: 8 },
  runTitle: { color: '#888', fontSize: 12, fontWeight: '700' },
  times: { color: '#FFF', fontSize: 14, lineHeight: 22 },
  transcript: { color: '#AAA', fontSize: 14, lineHeight: 20 },

  errorBox: { marginHorizontal: 16, marginBottom: 8, padding: 12, backgroundColor: '#3A1A1A', borderRadius: 8 },
  errorText: { color: '#FF6B6B', fontSize: 13 },

  controls: { padding: 20, paddingBottom: 32, gap: 12, borderTopWidth: 1, borderTopColor: '#2A2A2A' },
  statusRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  status: { color: '#F5A623', fontSize: 14, fontWeight: '600' },

  btn: { height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  btnStart: { backgroundColor: '#2563EB' },
  btnStop: { backgroundColor: '#333' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});
