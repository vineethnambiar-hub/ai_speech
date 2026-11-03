/**
 * Live speech-to-text.
 * Mic PCM → wss://api.sarvam.ai/speech-to-text-realtime/ws
 * Partials arrive while you are still speaking. No 30-second clip limit.
 * No language model and no voice reply.
 */

import { requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import LiveAudioStream from 'react-native-live-audio-stream';

const SARVAM_KEY = process.env.EXPO_PUBLIC_SARVAM_API_KEY ?? '';

function socketUrl() {
  const params = new URLSearchParams({
    language_code: 'en-IN',
    model: 'saaras:v4',
    stream_type: 'fast',
    mode: 'transcribe',
    encoding: 'linear16',
    sample_rate: '16000',
    endpointing: 'vad',
  });
  return `wss://api.sarvam.ai/speech-to-text-realtime/ws?${params}`;
}

export default function LiveSttScreen({ onBack }) {
  const [live, setLive] = useState(false);
  const [status, setStatus] = useState('Tap start and speak. Text appears as you talk.');
  const [partial, setPartial] = useState('');
  const [finals, setFinals] = useState([]);
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const speechStart = useRef(null);
  const speechEnd = useRef(null);

  useEffect(() => {
    return () => { stopSession(); };
  }, []);

  function stopSession() {
    try { LiveAudioStream.stop(); } catch { /* already stopped */ }
    setStatus('Stopped.');
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'end' }));
      ws.close();
    }
    setLive(false);
  }

  async function startSession() {
    setError(null);
    setPartial('');
    setFinals([]);

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

    const ws = new WebSocket(socketUrl(), [`api-subscription-key.${SARVAM_KEY}`]);
    wsRef.current = ws;
    speechStart.current = null;
    speechEnd.current = null;
    setStatus('Connecting…');
    setLive(true);

    ws.onopen = () => {
      setStatus('Connected. Speak.');
      LiveAudioStream.init({
        sampleRate: 16000,
        channels: 1,
        bitsPerSample: 16,
        audioSource: 6,
        wavFile: `${FileSystem.cacheDirectory}live_stt.wav`,
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
        speechStart.current = Date.now();
        speechEnd.current = null;
        setStatus('Listening…');
      } else if (event.event === 'vad.speech_end') {
        speechEnd.current = Date.now();
        setStatus('Finishing this line…');
      } else if (event.event === 'transcript.partial') {
        setPartial(event.text ?? '');
      } else if (event.event === 'transcript.final') {
        const spoke = speechStart.current != null && speechEnd.current != null
          ? speechEnd.current - speechStart.current
          : null;
        const reply = speechEnd.current != null ? Date.now() - speechEnd.current : null;
        setFinals((prev) => [...prev, { text: event.text ?? '', spoke, reply }]);
        setPartial('');
        setStatus('Connected. Speak.');
        speechStart.current = null;
        speechEnd.current = null;
      } else if (event.event === 'error') {
        setError(event.message ?? 'Sarvam returned an error.');
        if (event.is_fatal) stopSession();
      } else if (event.event === 'session.end') {
        setStatus('Session ended.');
        setLive(false);
      }
    };

    ws.onerror = () => {
      setError('Could not connect to Sarvam.');
    };

    ws.onclose = (close) => {
      try { LiveAudioStream.stop(); } catch { /* already stopped */ }
      setLive(false);
      if (close.code && close.code !== 1000) {
        setStatus(`Connection closed (${close.code}${close.reason ? `: ${close.reason}` : ''}).`);
      }
    };
  }

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable onPress={() => { stopSession(); onBack(); }}>
          <Text style={s.back}>← Back</Text>
        </Pressable>
        <Text style={s.title}>Live speech to text</Text>
        <Text style={s.sub}>Sarvam socket. Words show up while you are still speaking.</Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        <Text style={s.status}>{status}</Text>

        <View style={s.box}>
          <Text style={s.label}>HEARING NOW</Text>
          <Text style={s.partial}>{partial || '…'}</Text>
        </View>

        {finals.map((line, index) => (
          <View key={index} style={s.final}>
            <Text style={s.label}>
              UTTERANCE {index + 1}
              {line.spoke != null ? ` · SPOKE ${(line.spoke / 1000).toFixed(2)} s` : ''}
              {line.reply != null ? ` · TEXT IN ${(line.reply / 1000).toFixed(2)} s` : ''}
            </Text>
            <Text style={s.finalText}>{line.text || '(empty)'}</Text>
          </View>
        ))}
      </ScrollView>

      {!!error && <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>}

      <View style={s.controls}>
        <Pressable
          onPress={() => live ? stopSession() : startSession()}
          style={({ pressed }) => [s.btn, live ? s.btnStop : s.btnStart, pressed && { opacity: 0.8 }]}>
          <Text style={s.btnText}>{live ? 'Stop' : 'Start listening'}</Text>
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
  status: { color: '#888', fontSize: 13 },

  box: { backgroundColor: '#1A1A1A', borderRadius: 12, padding: 14, gap: 8, minHeight: 88 },
  label: { fontSize: 10, fontWeight: '700', color: '#555', letterSpacing: 1 },
  partial: { color: '#FFF', fontSize: 18, lineHeight: 26 },

  final: { backgroundColor: '#14241F', borderRadius: 12, padding: 14, gap: 8 },
  finalText: { color: '#D6F5EA', fontSize: 16, lineHeight: 24 },

  errorBox: { marginHorizontal: 16, marginBottom: 8, padding: 12, backgroundColor: '#3A1A1A', borderRadius: 8 },
  errorText: { color: '#FF6B6B', fontSize: 13 },

  controls: { padding: 20, paddingBottom: 32, borderTopWidth: 1, borderTopColor: '#2A2A2A' },
  btn: { height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  btnStart: { backgroundColor: '#7C3AED' },
  btnStop: { backgroundColor: '#333' },
  btnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});
