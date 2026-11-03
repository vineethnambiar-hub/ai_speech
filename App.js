/**
 * ai_speech — root navigator (state-based, no router needed)
 *
 * Screens:
 *   home         → HomeScreen
 *   roleplay     → RoleplayScreen (Sarvam Voice Agent WebSocket)
 *   http-roleplay→ HttpRoleplayScreen (Sarvam STT → BE pipecat-sse)
 *   pitch        → PitchScreen
 *   stt          → SttScreen
 *   live-stt     → LiveSttScreen
 */

import { useState } from 'react';
import HomeScreen         from './screens/HomeScreen';
import RoleplayScreen     from './screens/RoleplayScreen';
import HttpRoleplayScreen from './screens/HttpRoleplayScreen';
import PitchScreen        from './screens/PitchScreen';
import SttScreen          from './screens/SttScreen';
import LiveSttScreen      from './screens/LiveSttScreen';

export default function App() {
  const [screen, setScreen] = useState('home');

  if (screen === 'roleplay')      return <RoleplayScreen     onBack={() => setScreen('home')} />;
  if (screen === 'http-roleplay') return <HttpRoleplayScreen onBack={() => setScreen('home')} />;
  if (screen === 'pitch')         return <PitchScreen        onBack={() => setScreen('home')} />;
  if (screen === 'stt')           return <SttScreen          onBack={() => setScreen('home')} />;
  if (screen === 'live-stt')      return <LiveSttScreen      onBack={() => setScreen('home')} />;
  return <HomeScreen onSelect={setScreen} />;
}
