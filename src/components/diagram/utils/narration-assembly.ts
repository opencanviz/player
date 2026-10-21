/**
 * Narration audio assembly for export.
 *
 * Takes step-anchored NarrationClips, computes absolute start times using
 * stretch-to-fit durations, and mixes them into a single audio buffer
 * via OfflineAudioContext.
 */

import type { NarrationClip, Step, EdgeModel } from '../types';
import { calculateTotalDuration } from './editor-utils';

/**
 * Compute effective step durations with stretch-to-fit.
 * Each step's effective duration = max(step.durationMs, matchingClip.audioDurationMs).
 */
export function computeEffectiveDurations(
  steps: readonly Step[],
  clips: NarrationClip[],
): number[] {
  // Build a map of stepIndex → clip for O(1) lookup.
  //
  // Deliberately keyed on `audioDurationMs` alone, NOT on the audio bytes being present in this
  // copy of the project. A measured duration only ever exists because a real clip was baked, and
  // the same project travels through paths that carry the bytes and paths that don't: the server
  // render strips `audioData` before timing the picture (it's megabytes it doesn't need), and a
  // freshly-opened document holds `audioUrl` until the fetch lands. Gating on the bytes made those
  // paths compute an UNSTRETCHED timeline while the audio track was still assembled stretched, so
  // every scene's speech ran longer than the picture allowed for it, drifting further out of sync
  // scene after scene and losing the tail of the last lines. Duration is the timing truth; where
  // the bytes happen to live is not.
  const clipByStep = new Map<number, NarrationClip>();
  for (const clip of clips) {
    if (clip.audioDurationMs && clip.voice.provider !== 'browser') {
      clipByStep.set(clip.stepIndex, clip);
    }
  }

  return steps.map((step, i) => {
    const clip = clipByStep.get(i);
    const clipDur = clip?.audioDurationMs ?? 0;
    return Math.max(step.durationMs || 0, clipDur);
  });
}

/**
 * Compute the total narrated duration for a scene.
 * Takes the max of stretch-to-fit step sums and calculateTotalDuration
 * (which accounts for node-flow overhangs).
 */
export function calculateNarratedDuration(
  steps: readonly Step[],
  edges: readonly EdgeModel[],
  clips: NarrationClip[],
): number {
  const effectiveDurations = computeEffectiveDurations(steps, clips);
  const stretchedTotal = effectiveDurations.reduce((sum, d) => sum + d, 0);
  const baseTotal = calculateTotalDuration(steps, edges);
  return Math.max(stretchedTotal, baseTotal);
}

/** Decode a base64 data URL into an ArrayBuffer. */
function decodeBase64Audio(dataUrl: string): ArrayBuffer {
  // Tolerate codec params, e.g. `data:audio/webm;codecs=opus;base64,...`.
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !dataUrl.startsWith('data:') || !dataUrl.slice(0, comma).includes(';base64')) {
    throw new Error('Invalid audio data URL');
  }

  const binaryString = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Encode an AudioBuffer to a WAV data URL (mono, 44.1kHz). */
export function encodeWav(buffer: AudioBuffer): string {
  const numChannels = 1;
  const sampleRate = buffer.sampleRate;
  const samples = buffer.getChannelData(0);
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * (bitsPerSample / 8);
  const headerSize = 44;

  const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(arrayBuffer);

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, headerSize + dataSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true);  // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM samples (float32 → int16)
  let offset = headerSize;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF, true);
    offset += 2;
  }

  // Convert to base64 data URL
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

export type AssembledAudio = {
  audioData: string;   // base64 WAV data URL
  durationMs: number;  // total track duration
};

/**
 * Assemble all narration clips for a single scene into one audio track.
 *
 * - Filters out browser-only and ungenerated clips
 * - Computes absolute start times using stretch-to-fit durations
 * - Mixes via OfflineAudioContext
 * - Returns a single WAV data URL for the export service
 *
 * Returns null if there are no exportable clips.
 */
export async function assembleNarrationTrack(
  clips: NarrationClip[],
  steps: readonly Step[],
  edges: readonly EdgeModel[],
): Promise<AssembledAudio | null> {
  // Filter to exportable clips (have audio, not browser provider)
  const exportable = clips.filter(
    (c) => c.audioData && c.audioDurationMs && c.voice.provider !== 'browser',
  );
  if (exportable.length === 0) return null;

  // Use effective (stretch-to-fit) durations — matches calculateNarratedDuration().
  // Raw step.durationMs may not reflect narration stretch for imported/programmatic clips.
  const effectiveDurations = computeEffectiveDurations(steps, clips);
  const stepStartMs: number[] = [];
  let cursor = 0;
  for (const dur of effectiveDurations) {
    stepStartMs.push(cursor);
    cursor += dur;
  }

  // Total track duration (respect node-flow overhangs too)
  const baseTotal = calculateTotalDuration(steps, edges);
  const totalDurationMs = Math.max(cursor, baseTotal);
  const totalDurationSec = totalDurationMs / 1000;

  if (totalDurationSec <= 0) return null;

  // Decode all clips in parallel
  const sampleRate = 44100;
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(sampleRate * totalDurationSec), sampleRate);

  const decodePromises = exportable.map(async (clip) => {
    const arrayBuffer = decodeBase64Audio(clip.audioData!);
    const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
    return { clip, audioBuffer };
  });

  const decoded = await Promise.all(decodePromises);

  // Schedule each clip at its absolute start time
  for (const { clip, audioBuffer } of decoded) {
    const startMs = stepStartMs[clip.stepIndex] ?? 0;
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    if (clip.speed && clip.speed !== 1) {
      source.playbackRate.value = clip.speed;
    }
    source.connect(offlineCtx.destination);
    source.start(startMs / 1000);
  }

  // Render mixed audio
  const renderedBuffer = await offlineCtx.startRendering();

  // Encode to WAV
  const audioData = encodeWav(renderedBuffer);

  return { audioData, durationMs: totalDurationMs };
}

/**
 * Mix multiple per-scene audio buffers (with scene offsets) into one track.
 * Used for multi-scene project export.
 */
export async function mixSceneAudioBuffers(
  sceneAudios: Array<{ audioData: string; offsetMs: number; durationMs: number }>,
  totalDurationMs: number,
): Promise<AssembledAudio | null> {
  if (sceneAudios.length === 0) return null;

  const totalDurationSec = totalDurationMs / 1000;
  if (totalDurationSec <= 0) return null;

  const sampleRate = 44100;
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(sampleRate * totalDurationSec), sampleRate);

  // Decode each scene's assembled audio
  const decodePromises = sceneAudios.map(async (scene) => {
    const arrayBuffer = decodeBase64Audio(scene.audioData);
    const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
    return { audioBuffer, offsetMs: scene.offsetMs };
  });

  const decoded = await Promise.all(decodePromises);

  // Schedule each scene's audio at its offset
  for (const { audioBuffer, offsetMs } of decoded) {
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(offsetMs / 1000);
  }

  const renderedBuffer = await offlineCtx.startRendering();
  const audioData = encodeWav(renderedBuffer);

  return { audioData, durationMs: totalDurationMs };
}
