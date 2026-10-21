/**
 * Pure camera-interpolation for project playback / export. Extracted from the export
 * handler so the SAME logic runs in the editor, the client export, AND the headless
 * server renderer (no React/DOM/hook state — only plain data in, a Camera out).
 *
 * Part of the shared renderer surface (see docs/server-side-render-architecture.md,
 * Phase 0): the server's render worker calls these to place the camera for each frame
 * exactly as the editor does, guaranteeing WYSIWYG output.
 */
import type { Camera, CameraCut, Step } from '../types';
import type { Project } from '../types';
import type { ProjectTimeline } from './project-playback';
import { applyEasing } from './geometry-utils';

/** The artboard rectangle a default camera frames. */
export interface CameraArtboard {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Default camera: the artboard fills the frame exactly (zoom=1, centered). Step cameras override. */
export function computeDefaultCamera(artboard: CameraArtboard): Camera {
  return {
    x: artboard.x + artboard.width / 2,
    y: artboard.y + artboard.height / 2,
    zoom: 1,
  };
}

/** The cut (Step.cameraCuts) showing msIntoStep into a step, if one is. */
export function cameraCutAt(cuts: readonly CameraCut[] | undefined, msIntoStep: number): Camera | null {
  if (!cuts) return null;
  for (const c of cuts) {
    if (c?.camera && msIntoStep >= c.atMs && msIntoStep < c.endMs) return c.camera;
  }
  return null;
}

/** Camera interpolation for a specific scene's steps at a scene-local time. */
export function getCameraForScene(
  sceneSteps: readonly Step[],
  localT: number,
  defaultCamera: Camera,
): Camera {
  // Find which step we're in.
  let cumTime = 0;
  let stepIdx = 0;
  for (stepIdx = 0; stepIdx < sceneSteps.length; stepIdx++) {
    const dur = sceneSteps[stepIdx].durationMs || 900;
    if (localT < cumTime + dur) break;
    cumTime += dur;
  }
  stepIdx = Math.min(stepIdx, sceneSteps.length - 1);

  const curCam = sceneSteps[stepIdx].camera;
  if (!curCam) {
    for (let pi = stepIdx - 1; pi >= 0; pi--) {
      const rest = sceneSteps[pi].cameraEnd ?? sceneSteps[pi].camera;
      if (rest) return { ...rest };
    }
    return defaultCamera;
  }

  const curStepObj = sceneSteps[stepIdx];
  const cut = cameraCutAt(curStepObj.cameraCuts, localT - cumTime);
  if (cut) return { ...cut };
  const stepDur = curStepObj.durationMs || 900;
  const cameraDur = curStepObj.cameraDurationMs ?? (stepDur * 0.6);
  const cameraOffset = curStepObj.cameraOffsetMs ?? 0;
  const localInStep = localT - cumTime - cameraOffset;
  // cameraDur === 0 means an instant camera (cam_dur=0, e.g. title_card). localInStep / 0
  // is NaN at the step boundary frame (localInStep===0), which propagates to a NaN camera
  // y → every node teleports for one exported frame. Guard: snap instantly.
  const tNorm = cameraDur > 0 ? Math.max(0, Math.min(localInStep / cameraDur, 1)) : 1;
  const eased = applyEasing(tNorm, curStepObj.cameraEasing ?? curStepObj.easing ?? 'ease');

  let prevCam: Camera = defaultCamera;
  for (let pi = stepIdx - 1; pi >= 0; pi--) {
    // A step that DRIFTED (cameraEnd) rests at its end keyframe.
    const rest = sceneSteps[pi].cameraEnd ?? sceneSteps[pi].camera;
    if (rest) {
      prevCam = rest;
      break;
    }
  }

  let cx = prevCam.x + (curCam.x - prevCam.x) * eased;
  let cy = prevCam.y + (curCam.y - prevCam.y) * eased;
  let cz = prevCam.zoom + (curCam.zoom - prevCam.zoom) * eased;
  // Second keyframe: once the tween settles, drift LINEARLY to cameraEnd over the rest
  // of the step (slow push-ins / Ken Burns).
  const camEnd = curStepObj.cameraEnd;
  if (camEnd && tNorm >= 1) {
    // Bounded drift (cameraEndDurationMs) is a MOVE the viewer should read as one, so it eases
    // and then holds; an unbounded drift is Ken Burns and stays linear across the whole step.
    const bounded = curStepObj.cameraEndDurationMs;
    const driftDur = Math.max(1, bounded ?? stepDur - cameraOffset - cameraDur);
    const raw = Math.max(0, Math.min((localInStep - cameraDur) / driftDur, 1));
    const t2 = bounded ? applyEasing(raw, curStepObj.cameraEndEasing ?? 'ease-out') : raw;
    cx = curCam.x + (camEnd.x - curCam.x) * t2;
    cy = curCam.y + (camEnd.y - curCam.y) * t2;
    cz = curCam.zoom + (camEnd.zoom - curCam.zoom) * t2;
  }
  return { x: cx, y: cy, zoom: cz };
}

/**
 * Interpolated camera at a global time. Multi-scene aware: routes to the active scene's
 * steps via the timeline; falls back to single-diagram `steps` when no project/timeline.
 */
export function getCameraAtTime(
  tMs: number,
  opts: {
    project?: Project | null;
    timeline?: ProjectTimeline | null;
    steps: readonly Step[];
    defaultCamera: Camera;
  },
): Camera {
  const { project, timeline, steps, defaultCamera } = opts;
  if (timeline && project) {
    const clamped = Math.max(0, Math.min(tMs, timeline.totalDurationMs));
    let activeSlice = timeline.slices[0];
    for (const s of timeline.slices) {
      if (clamped >= s.startMs && clamped < s.startMs + s.durationMs) {
        activeSlice = s;
        break;
      }
      if (clamped >= s.startMs + s.durationMs) {
        activeSlice = s;
      }
    }
    return getCameraForScene(
      project.diagrams[activeSlice.sceneIndex].steps,
      clamped - activeSlice.startMs,
      defaultCamera,
    );
  }
  return getCameraForScene(steps, tMs, defaultCamera);
}
