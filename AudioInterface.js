/**
 * Custom AsyncAudioInterface for sarvam-conv-ai-sdk
 *
 * Input  (mic → SDK):  react-native-live-audio-stream → PCM16 base64 chunks
 *                      → decoded Uint8Array → inputCallback
 *
 * Output (SDK → speaker): PCM16 Uint8Array chunks from the SDK's AudioQueue.
 *
 *   The SDK's AudioQueue paces chunks at near-real-time speed:
 *     sleep = chunkDuration - 30ms headroom
 *   For a 200ms chunk, the gap between output() calls is 170ms.
 *
 *   BUG if we just debounce and play: the debounce (e.g. 120ms) fires BEFORE
 *   the next chunk arrives, so we play a partial clip; then the next chunk calls
 *   `player.remove()` killing the in-flight audio. Each chunk cancels the last.
 *
 *   FIX: sequential playback queue.
 *     1. Accumulate chunks with a 300ms debounce → a "segment".
 *     2. Enqueue the segment as a WAV in _playQueue.
 *     3. A single drain loop plays segments back-to-back, waiting for each one
 *        to finish (duration-based, since expo-audio status events default to
 *        500ms intervals which is too slow for short clips).
 *     4. interrupt() clears _playQueue and removes the current player
 *        immediately (barge-in / SDK cancel).
 */

import * as FileSystem from 'expo-file-system/legacy';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import LiveAudioStream from 'react-native-live-audio-stream';

const SAMPLE_RATE    = 16000;
const FLUSH_DELAY_MS = 300; // must exceed max paceMs = chunkDurationMs - 30

export class AudioInterface {
  _inputCallback  = null;

  // ── Accumulator ──────────────────────────────────────────────────────────
  _chunks         = [];      // Uint8Array[] — current window of PCM chunks
  _flushTimer     = null;
  _outputRate     = SAMPLE_RATE;

  // ── Playback queue ────────────────────────────────────────────────────────
  _playQueue      = [];      // { pcm: Uint8Array, rate: number }[]
  _draining       = false;   // whether _drainQueue() is running
  _currentPlayer  = null;    // live expo-audio player
  _currentResolve = null;    // resolves the "wait for clip to finish" promise
  _generation     = 0;       // incremented on interrupt(); guards stale timers
  _speakerOn      = false;
  _playbackListener = null;  // (on: boolean) => void — mic must be muted while true

  // ── Input: mic → SDK ───────────────────────────────────────────────────────
  async start(inputCallback) {
    this._inputCallback = inputCallback;

    // iOS: .playAndRecord supports simultaneous mic + speaker.
    // Do NOT add interruptionMode:'doNotMix' — incompatible with allowsRecording.
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });

    LiveAudioStream.init({
      sampleRate:    SAMPLE_RATE,
      channels:      1,
      bitsPerSample: 16,
      audioSource:   6,        // VOICE_COMMUNICATION — noise reduction on Android
      wavFile:       `${FileSystem.cacheDirectory}sarvam_rec.wav`,
      bufferSize:    3200,     // ~100 ms per chunk at 16 kHz
    });

    LiveAudioStream.on('data', async (base64Chunk) => {
      if (!this._inputCallback) return;
      const bytes      = _base64ToUint8Array(base64Chunk);
      const frameCount = bytes.byteLength / 2; // 16-bit = 2 bytes/sample
      await this._inputCallback(bytes, frameCount);
    });

    LiveAudioStream.start();
    // The recorder sets voice-chat mode, which plays into the earpiece.
    // Put playback back on the loudspeaker after it starts.
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
    });
    console.log('[AudioInterface] mic started');
  }

  // Called with true while speaker audio is queued or playing.
  // The screen mutes the mic for that time so the speaker is not sent back as the user.
  setPlaybackListener(listener) {
    this._playbackListener = listener;
  }

  _setSpeaker(on) {
    if (this._speakerOn === on) return;
    this._speakerOn = on;
    this._playbackListener?.(on);
  }

  // ── Output: SDK → speaker ──────────────────────────────────────────────────
  async output(audio, sampleRate) {
    if (sampleRate) this._outputRate = sampleRate;
    this._chunks.push(audio instanceof Uint8Array ? audio : new Uint8Array(audio));

    // Debounce: accumulate chunks; flush 300ms after the last one
    if (this._flushTimer) clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this._enqueueSegment(), FLUSH_DELAY_MS);
  }

  _enqueueSegment() {
    this._flushTimer = null;
    if (this._chunks.length === 0) return;

    const pcm  = _concat(this._chunks);
    const rate  = this._outputRate;
    this._chunks = [];

    const durationMs = Math.round((pcm.length / 2 / rate) * 1000);
    console.log(`[AudioInterface] segment enqueued: ${durationMs}ms @ ${rate}Hz (${pcm.length} bytes)`);

    this._playQueue.push({ pcm, rate });
    if (!this._draining) this._drainQueue();
  }

  async _drainQueue() {
    this._draining = true;
    this._setSpeaker(true);
    const gen = this._generation;

    try {
      while (this._playQueue.length > 0 && this._generation === gen) {
        const segment = this._playQueue.shift();
        await this._playSegment(segment, gen);
      }
    } finally {
      if (this._generation === gen) {
        this._draining = false;
        this._setSpeaker(false);
      }
    }
  }

  async _playSegment({ pcm, rate }, gen) {
    try {
      const durationMs = Math.round((pcm.length / 2 / rate) * 1000);
      const wav = _buildWav(pcm, rate);
      const b64 = _arrayBufferToBase64(wav);
      const uri = `${FileSystem.cacheDirectory}sarvam_tts_${Date.now()}.wav`;

      await FileSystem.writeAsStringAsync(uri, b64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (this._generation !== gen) {
        console.log('[AudioInterface] segment cancelled before play (interrupted)');
        return;
      }

      console.log(`[AudioInterface] playing ${durationMs}ms segment → ${uri}`);
      // Keep the session in play-and-record. A playback-only switch drops the mic,
      // and the server then closes the call.
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      });
      if (this._generation !== gen) return;

      const player = createAudioPlayer({ uri });
      player.volume = 1;
      this._currentPlayer = player;
      player.play();
      console.log('[AudioInterface] play() called, playing=', player.playing);

      // Wait for the clip to finish (duration + 80ms buffer).
      // We use a time-based wait rather than the 500ms-interval status event
      // which would miss short clips entirely.
      await new Promise((resolve) => {
        this._currentResolve = resolve;
        setTimeout(() => {
          if (this._currentResolve === resolve) {
            this._currentResolve = null;
            resolve();
          }
        }, durationMs + 80);
      });

      if (this._currentPlayer === player) {
        player.remove();
        this._currentPlayer = null;
      }
    } catch (err) {
      console.error('[AudioInterface._playSegment]', err);
    }
  }

  // ── Barge-in: SDK calls this when the user interrupts the agent ────────────
  interrupt() {
    console.log('[AudioInterface] interrupt()');
    if (this._flushTimer) { clearTimeout(this._flushTimer); this._flushTimer = null; }
    this._chunks    = [];
    this._playQueue = [];
    this._generation++;                   // cancels in-flight drain loop
    this._draining = false;

    // Resolve any waiting promise immediately so _playSegment unblocks
    if (this._currentResolve) {
      this._currentResolve();
      this._currentResolve = null;
    }
    this._currentPlayer?.remove();
    this._currentPlayer = null;
    this._setSpeaker(false);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  async stop() {
    this.interrupt();
    try { await LiveAudioStream.stop(); } catch { /* ignore */ }
    this._inputCallback = null;
    console.log('[AudioInterface] stopped');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _base64ToUint8Array(b64) {
  const bin   = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function _arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function _concat(chunks) {
  const total  = chunks.reduce((n, c) => n + c.byteLength, 0);
  const result = new Uint8Array(total);
  let offset   = 0;
  for (const c of chunks) { result.set(c, offset); offset += c.byteLength; }
  return result;
}

function _buildWav(pcm, sampleRate) {
  const numChannels   = 1;
  const bitsPerSample = 16;
  const byteRate      = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign    = numChannels * (bitsPerSample / 8);
  const dataSize      = pcm.byteLength;
  const buf           = new ArrayBuffer(44 + dataSize);
  const v             = new DataView(buf);

  _str(v, 0,  'RIFF');
  v.setUint32(4,  36 + dataSize, true);
  _str(v, 8,  'WAVE');
  _str(v, 12, 'fmt ');
  v.setUint32(16, 16,            true);
  v.setUint16(20, 1,             true); // PCM
  v.setUint16(22, numChannels,   true);
  v.setUint32(24, sampleRate,    true);
  v.setUint32(28, byteRate,      true);
  v.setUint16(32, blockAlign,    true);
  v.setUint16(34, bitsPerSample, true);
  _str(v, 36, 'data');
  v.setUint32(40, dataSize,      true);

  new Uint8Array(buf).set(pcm, 44);
  return buf;
}

function _str(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
