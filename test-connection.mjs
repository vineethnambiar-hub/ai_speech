/**
 * Tests the exact request ConversationAgent makes to get a signed WebSocket URL.
 * Run: node test-connection.mjs
 */
import { config } from 'dotenv';
config();

const apiKey      = process.env.EXPO_PUBLIC_SARVAM_VOICE_API_KEY;
const orgId       = process.env.EXPO_PUBLIC_SARVAM_ORG_ID;
const workspaceId = process.env.EXPO_PUBLIC_SARVAM_WORKSPACE_ID;
const appId       = process.env.EXPO_PUBLIC_SARVAM_APP_ID;

const url = `https://apps.sarvam.ai/api/app-runtime/orgs/${orgId}/workspaces/${workspaceId}/apps/${appId}/url`;

console.log('Testing:', url);
console.log('Key prefix:', apiKey?.slice(0, 10) + '...');

const res = await fetch(url, {
  method: 'GET',
  headers: { 'X-API-Key': apiKey },
});

const body = await res.text();
console.log('\nStatus:', res.status);
console.log('Body:  ', body);
