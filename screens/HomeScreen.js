import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function HomeScreen({ onSelect }) {
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Text style={s.title}>AI Speech</Text>
        <Text style={s.sub}>Choose a mode to get started</Text>
      </View>

      <ScrollView contentContainerStyle={s.cards}>
        {/* Card 1 — Live Roleplay */}
        <Pressable
          style={({ pressed }) => [s.card, pressed && s.cardPressed]}
          onPress={() => onSelect('roleplay')}>
          <View style={[s.badge, { backgroundColor: '#EE2C3C' }]}>
            <Text style={s.badgeText}>WebSocket</Text>
          </View>
          <Text style={s.cardTitle}>Live Roleplay</Text>
          <Text style={s.cardDesc}>
            Real-time voice conversation with an AI persona. Speak naturally —
            the AI responds instantly turn by turn.
          </Text>
          <View style={s.cardMeta}>
            <Text style={s.metaItem}>🎙 Live mic</Text>
            <Text style={s.metaItem}>⚡ ~300ms latency</Text>
            <Text style={s.metaItem}>🔄 Barge-in supported</Text>
          </View>
          <View style={[s.startBtn, { backgroundColor: '#EE2C3C' }]}>
            <Text style={s.startBtnText}>Start session →</Text>
          </View>
        </Pressable>

        <Pressable
          style={({ pressed }) => [s.card, pressed && s.cardPressed]}
          onPress={() => onSelect('http-roleplay')}>
          <View style={[s.badge, { backgroundColor: '#0F766E' }]}>
            <Text style={s.badgeText}>Latency POC</Text>
          </View>
          <Text style={s.cardTitle}>HTTP roleplay</Text>
          <Text style={s.cardDesc}>
            Sarvam live STT on the phone, then text to mock-interview-be
            pipecat-sse. Times silence → STT final → first BE reply.
          </Text>
          <View style={s.cardMeta}>
            <Text style={s.metaItem}>🎙 Sarvam STT</Text>
            <Text style={s.metaItem}>📡 SSE turn</Text>
            <Text style={s.metaItem}>⏱ Turn clock</Text>
          </View>
          <View style={[s.startBtn, { backgroundColor: '#0F766E' }]}>
            <Text style={s.startBtnText}>Measure a turn →</Text>
          </View>
        </Pressable>

        {/* Card 2 — Pitch & Feedback */}
        <Pressable
          style={({ pressed }) => [s.card, pressed && s.cardPressed]}
          onPress={() => onSelect('pitch')}>
          <View style={[s.badge, { backgroundColor: '#2563EB' }]}>
            <Text style={s.badgeText}>HTTP Streaming</Text>
          </View>
          <Text style={s.cardTitle}>Pitch &amp; Feedback</Text>
          <Text style={s.cardDesc}>
            Record your full pitch uninterrupted. Get detailed AI feedback
            streamed back token by token.
          </Text>
          <View style={s.cardMeta}>
            <Text style={s.metaItem}>🎤 Full recording</Text>
            <Text style={s.metaItem}>📝 Deep analysis</Text>
            <Text style={s.metaItem}>💬 Streamed feedback</Text>
          </View>
          <View style={[s.startBtn, { backgroundColor: '#2563EB' }]}>
            <Text style={s.startBtnText}>Start recording →</Text>
          </View>
        </Pressable>

        <Pressable
          style={({ pressed }) => [s.card, pressed && s.cardPressed]}
          onPress={() => onSelect('stt')}>
          <View style={[s.badge, { backgroundColor: '#0F766E' }]}>
            <Text style={s.badgeText}>Speech to text</Text>
          </View>
          <Text style={s.cardTitle}>Sarvam STT</Text>
          <Text style={s.cardDesc}>
            Record a line and send it to Sarvam speech-to-text. Shows speaking,
            upload, and reply time for the p95 doc.
          </Text>
          <View style={[s.startBtn, { backgroundColor: '#0F766E' }]}>
            <Text style={s.startBtnText}>Record and transcribe →</Text>
          </View>
        </Pressable>

        <Pressable
          style={({ pressed }) => [s.card, pressed && s.cardPressed]}
          onPress={() => onSelect('live-stt')}>
          <View style={[s.badge, { backgroundColor: '#7C3AED' }]}>
            <Text style={s.badgeText}>Speech socket</Text>
          </View>
          <Text style={s.cardTitle}>Live STT</Text>
          <Text style={s.cardDesc}>
            Speak for as long as you want. Sarvam transcribes while you talk.
            No 30-second clip limit.
          </Text>
          <View style={[s.startBtn, { backgroundColor: '#7C3AED' }]}>
            <Text style={s.startBtnText}>Start listening →</Text>
          </View>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: '#0F0F0F' },
  header:  { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#2A2A2A' },
  title:   { fontSize: 24, fontWeight: '700', color: '#FFF' },
  sub:     { fontSize: 13, color: '#888', marginTop: 4 },

  cards:       { padding: 16, gap: 16, paddingBottom: 32 },
  card:        { backgroundColor: '#1A1A1A', borderRadius: 16, padding: 20, gap: 12, borderWidth: 1, borderColor: '#2A2A2A' },
  cardPressed: { opacity: 0.85 },

  badge:     { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#FFF', letterSpacing: 0.5 },

  cardTitle: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  cardDesc:  { fontSize: 13, color: '#999', lineHeight: 20 },

  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metaItem: { fontSize: 12, color: '#666' },

  startBtn:     { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  startBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
});
