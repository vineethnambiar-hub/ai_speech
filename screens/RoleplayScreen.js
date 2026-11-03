/**
 * Live Roleplay — WebSocket mode
 * Moved from App.js. Uses ConversationAgent from sarvam-conv-ai-sdk.
 */

import {
  ConversationAgent,
  InteractionType,
  AgentState,
} from 'sarvam-conv-ai-sdk/react-native';
import { requestRecordingPermissionsAsync } from 'expo-audio';
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
import { AudioInterface } from '../AudioInterface';

const CONFIG = {
  apiKey:      process.env.EXPO_PUBLIC_SARVAM_VOICE_API_KEY ?? '',
  orgId:       process.env.EXPO_PUBLIC_SARVAM_ORG_ID        ?? '',
  workspaceId: process.env.EXPO_PUBLIC_SARVAM_WORKSPACE_ID  ?? '',
  appId:       process.env.EXPO_PUBLIC_SARVAM_APP_ID        ?? '',
};

const STATE_UI = {
  [AgentState.IDLE]:       { label: 'Tap to start',           color: '#6B6B6B' },
  [AgentState.CONNECTING]: { label: 'Connecting…',            color: '#F5A623' },
  [AgentState.CONNECTED]:  { label: 'Connected',              color: '#4CAF50' },
  [AgentState.LISTENING]:  { label: '🎙 Listening…',          color: '#EE2C3C' },
  [AgentState.SPEAKING]:   { label: '🔊 Arjun is speaking…',  color: '#4CAF50' },
  [AgentState.ERROR]:      { label: 'Error',                  color: '#FF6B6B' },
};

export default function RoleplayScreen({ onBack }) {
  const [agentState, setAgentState] = useState(AgentState.IDLE);
  const [messages,   setMessages]   = useState([]);
  const [error,      setError]      = useState(null);

  const agentRef      = useRef(null);
  const endedByUser   = useRef(false);

  useEffect(() => {
    return () => { agentRef.current?.stop().catch(() => {}); };
  }, []);

  async function startSession() {
    setError(null);
    setMessages([]);
    endedByUser.current = false;

    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) { setError('Microphone permission is required.'); return; }

    const audio = new AudioInterface();
    const agent = new ConversationAgent({
      apiKey: CONFIG.apiKey,
      platform: 'react-native',
      audioInterface: audio,
      config: {
        org_id:               CONFIG.orgId,
        workspace_id:         CONFIG.workspaceId,
        app_id:               CONFIG.appId,
        user_identifier:      'test-user',
        user_identifier_type: 'custom',
        interaction_type:     InteractionType.CALL,
        input_sample_rate:    16000,
        output_sample_rate:   16000,
      },
      stateCallback: (s) => {
        console.log('[roleplay] state', s);
        setAgentState(s);
      },
      transcriptCallback: async (msg) => setMessages((p) => [...p, { role: msg.role, content: msg.content }]),
      eventCallback: async (event) => {
        console.log('[roleplay] event', event?.type ?? event);
      },
      endCallback: () => {
        if (!endedByUser.current) {
          setError('The session closed. Stay on this screen and try again. If it keeps closing as Arjun starts, check the Metro log for [roleplay] event.');
        }
        setAgentState(AgentState.IDLE);
      },
    });

    // While the speaker is playing, send silence instead of the mic.
    // Otherwise Sarvam hears Arjun through the phone speaker and ends the call.
    audio.setPlaybackListener((playing) => {
      if (playing) agent.mute();
      else agent.unmute();
    });

    agentRef.current = agent;
    try {
      await agent.start();
      const ok = await agent.waitForConnect(10);
      if (!ok) {
        setError('Connection timed out — check agent config and committed version.');
        await agent.stop();
        agentRef.current = null;
      }
    } catch (err) {
      setError(err?.message ?? 'Failed to start session.');
      agentRef.current = null;
      setAgentState(AgentState.IDLE);
    }
  }

  async function stopSession() {
    endedByUser.current = true;
    await agentRef.current?.stop().catch(() => {});
    agentRef.current = null;
    setAgentState(AgentState.IDLE);
  }

  const active = agentState !== AgentState.IDLE && agentState !== AgentState.ERROR;
  const ui     = STATE_UI[agentState] ?? STATE_UI[AgentState.IDLE];

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable onPress={onBack} style={s.back}><Text style={s.backText}>← Back</Text></Pressable>
        <Text style={s.title}>Live Roleplay</Text>
        <Text style={s.sub}>Pitch your LMS to Arjun — Sceptical VP of Eng</Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {messages.map((m, i) => (
          <View key={i} style={[s.bubble, m.role === 'user' ? s.bubbleUser : s.bubbleBot]}>
            <Text style={s.bubbleRole}>{m.role === 'user' ? 'You' : 'Arjun'}</Text>
            <Text style={s.bubbleText}>{m.content}</Text>
          </View>
        ))}
      </ScrollView>

      {!!error && <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>}

      <View style={s.controls}>
        <View style={s.statusRow}>
          {agentState === AgentState.CONNECTING
            ? <ActivityIndicator color={ui.color} size="small" />
            : <View style={[s.dot, { backgroundColor: ui.color }]} />}
          <Text style={[s.statusText, { color: ui.color }]}>{ui.label}</Text>
        </View>
        <Pressable
          onPress={() => active ? stopSession() : startSession()}
          style={({ pressed }) => [s.btn, active ? s.btnStop : s.btnStart, pressed && { opacity: 0.8 }]}>
          <Text style={s.btnText}>{active ? 'End session' : 'Start session'}</Text>
        </Pressable>
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
  scrollContent: { padding: 16, gap: 12 },

  bubble:    { maxWidth: '82%', borderRadius: 16, padding: 12, gap: 4 },
  bubbleUser:{ alignSelf: 'flex-end',   backgroundColor: '#1E3A5F' },
  bubbleBot: { alignSelf: 'flex-start', backgroundColor: '#2A2A2A' },
  bubbleRole:{ fontSize: 11, fontWeight: '600', color: '#888' },
  bubbleText:{ fontSize: 15, color: '#FFF', lineHeight: 22 },

  errorBox:  { margin: 16, padding: 12, backgroundColor: '#3A1A1A', borderRadius: 8 },
  errorText: { color: '#FF6B6B', fontSize: 13 },

  controls:  { padding: 20, paddingBottom: 32, gap: 14, borderTopWidth: 1, borderTopColor: '#2A2A2A' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  dot:       { width: 8, height: 8, borderRadius: 4 },
  statusText:{ fontSize: 14, fontWeight: '600' },

  btn:      { height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  btnStart: { backgroundColor: '#EE2C3C' },
  btnStop:  { backgroundColor: '#333' },
  btnText:  { color: '#FFF', fontSize: 16, fontWeight: '700' },
});
