/**
 * Render ONE frame of a project at a global time — single scene, morph match-cut, or
 * crossfade/slide transition — into a canvas context. This is the heart of the shared
 * render surface: the editor client export AND the headless server renderer both call it,
 * so a server-rendered video is pixel-identical to the editor.
 *
 * Pure: no React/DOM/hook state. Inputs are plain data + a 2D context + work canvases.
 * Presenter overlay (video chrome) is intentionally NOT here — the caller draws that after.
 * See docs/server-side-render-architecture.md (Phase 0).
 */
import type { Camera, Step, Path, NodeModel, EdgeModel, Project } from '../types';
import type { ProjectTimeline } from './project-playback';
import { evaluateProjectComposition, morphFrames } from './project-playback';
import { compositeBoundary, drawBoundarySides } from './project-frame';
import { drawScene, drawCaptionLowerThird } from './rendering-utils';
import { captionAvoidRects } from './caption-text';
import { setWriteHandStyle } from './write-hand-asset';
import { setCarryHand } from './carry-hand-asset';
import { DEFAULT_CARRY_HAND } from './hand-registry';
import { DEFAULT_WRITE_HAND_STYLE, type WriteHandStyle } from './write-hand-styles';
import { evaluateAt } from './animation-utils';
import { getCameraForScene, getCameraAtTime } from './project-camera';

/** drawScene's option bag, minus the fields renderProjectFrame sets per scene. */
// NonNullable because drawScene's option bag is optional (`= {}`), and Omit over a union with
// undefined collapses to an empty type — which silently switched off checking on every caller.
type DrawOpts = Omit<NonNullable<Parameters<typeof drawScene>[4]>, 'camera' | 'floatEnabled'>;

export interface RenderProjectFrameArgs {
  /** Target context (the output frame). */
  ctx: CanvasRenderingContext2D;
  /** Global time within the project, milliseconds. */
  tMs: number;
  /** drawScene renders artboard-logical coords; this scales to the output pixel density. */
  renderScale: number;
  /** Output pixel dimensions (for compositing transition boundaries in pixel space). */
  pxW: number;
  pxH: number;
  /** Artboard logical size. */
  artboard: { width: number; height: number };
  /** Static draw options (grid, captions, sprite/image cache, background, baseNodes, currentTimeMs). */
  drawOpts: DrawOpts;
  /** Default (artboard-fit) camera, used where no step camera applies. */
  defaultCamera: Camera;
  /** Whether a given scene index floats (per-element floatInclude is handled inside drawScene). */
  sceneFloat: (sceneIndex: number) => boolean;
  /** Multi-scene project + timeline. When absent, `fallback` is used. */
  project?: Project | null;
  timeline?: ProjectTimeline | null;
  /** Work canvases for crossfade/slide transitions (omit for morph/single-only exports). */
  workA?: HTMLCanvasElement | null;
  workB?: HTMLCanvasElement | null;
  /** Single-diagram fallback, evaluated lazily only when there is no project/timeline. */
  fallback?: () => { steps: Step[]; paths: Record<string, Path>; nodes: NodeModel[]; edges: EdgeModel[] };
}

/** The surface a given scene sits on.
 *
 * A video's ground is normally the artboard's: one sheet under the whole thing, which is most of
 * what makes a run of scenes read as one video. A scene may name its own instead, and then it is
 * that scene's alone — the field notes, the blueprint, the terminal. Applied per drawScene call
 * rather than once per frame because a crossfade draws two scenes at the same instant, and on a
 * boundary between two grounds the sheets have to cross-fade with the pictures on them.
 */
function onGround(project: Project | null | undefined, sceneIndex: number, opts: DrawOpts): DrawOpts {
  const d = project?.diagrams?.[sceneIndex];
  if (!d?.bg) return opts;
  return { ...opts, background: d.bg, backgroundColor: d.background ?? opts.backgroundColor };
}

export function renderProjectFrame(args: RenderProjectFrameArgs): void {
  const {
    ctx, tMs, renderScale, pxW, pxH, artboard, drawOpts, defaultCamera, sceneFloat,
    project, timeline, workA, workB, fallback,
  } = args;
  const W = artboard.width;
  const H = artboard.height;
  const rs = renderScale;
  // Draw the whiteboard write-on with the doc's chosen marker hand (default photoreal). Cheap no-op
  // when unchanged; kicks the new image's decode so the bundled export renderer picks up the style.
  setWriteHandStyle((project?.artboard as { handStyle?: WriteHandStyle } | undefined)?.handStyle ?? DEFAULT_WRITE_HAND_STYLE);
  // Same for the hand that CARRIES finished pictures in. Separate setting because it is a separate
  // gesture: a doc can be written by the photoreal marker hand and still want the corner grip, and
  // the poses differ in which side of the picture the arm hangs from, not just in looks.
  setCarryHand((project?.artboard as { carryHand?: string } | undefined)?.carryHand ?? DEFAULT_CARRY_HAND);

  if (timeline && project) {
    const composition = evaluateProjectComposition(tMs, project, timeline);
    if (composition.kind === 'single') {
      const cam = getCameraForScene(
        project.diagrams[composition.sceneIndex].steps, composition.localT, defaultCamera,
      );
      ctx.setTransform(rs, 0, 0, rs, 0, 0);
      // Draw at SCENE-LOCAL time so scene-anchored time effects (count-up, float, sprites)
      // match the live preview instead of seeing the whole-video global time.
      drawScene(ctx, composition.frame, W, H,
        { ...onGround(project, composition.sceneIndex, drawOpts), camera: cam, floatEnabled: sceneFloat(composition.sceneIndex), currentTimeMs: composition.localT,
          handTrack: project.diagrams[composition.sceneIndex].handTrack });
    } else if (composition.transitionKind === 'morph') {
      // Shared-element match cut: one blended frame + a camera lerp.
      const camFrom = getCameraForScene(
        project.diagrams[composition.fromSceneIndex].steps, composition.fromLocalT, defaultCamera,
      );
      const camTo = getCameraForScene(
        project.diagrams[composition.toSceneIndex].steps, composition.toLocalT, defaultCamera,
      );
      const a = composition.alpha;
      const ea = a < 0.5 ? 2 * a * a : 1 - Math.pow(-2 * a + 2, 2) / 2;
      const cam: Camera = {
        x: camFrom.x + (camTo.x - camFrom.x) * ea,
        y: camFrom.y + (camTo.y - camFrom.y) * ea,
        zoom: camFrom.zoom + (camTo.zoom - camFrom.zoom) * ea,
      };
      const morphed = morphFrames(composition.from, composition.to, a);
      const leadScene = a < 0.5 ? composition.fromSceneIndex : composition.toSceneIndex;
      const leadLocalT = a < 0.5 ? composition.fromLocalT : composition.toLocalT;
      ctx.setTransform(rs, 0, 0, rs, 0, 0);
      drawScene(ctx, morphed, W, H, { ...onGround(project, leadScene, drawOpts), camera: cam, floatEnabled: sceneFloat(leadScene), currentTimeMs: leadLocalT,
        handTrack: project.diagrams[leadScene].handTrack });
    } else if (workA && workB) {
      // Crossfade / slide: render both scenes to work canvases, composite in pixel space.
      const camFrom = getCameraForScene(
        project.diagrams[composition.fromSceneIndex].steps, composition.fromLocalT, defaultCamera,
      );
      const camTo = getCameraForScene(
        project.diagrams[composition.toSceneIndex].steps, composition.toLocalT, defaultCamera,
      );
      const ctxA = workA.getContext('2d')!;
      const ctxB = workB.getContext('2d')!;
      ctxA.setTransform(rs, 0, 0, rs, 0, 0);
      ctxB.setTransform(rs, 0, 0, rs, 0, 0);
      // Each side carries ITS scene's handTrack: without it the continuous hand deactivates
      // at every boundary and the per-node FALLBACK hands render inside the z-order — a hand
      // writing a title ends up UNDER higher-z scene content (observed: the marker hand
      // ghosting behind the payment card during the crossfade into that scene).
      // Captions are held back from BOTH sides here and drawn once over the finished
      // composite. compositeBoundary moves whole canvases in pixel space, so a caption burned
      // into a scene rides that scene: at a travel-off boundary the outgoing line slides away
      // while the incoming one slides in, two half-sentences on screen at once, each clipped
      // mid-word. (The vertical shorts worked around exactly this by dropping captions
      // altogether.) The words belong to the frame, not to the picture, so they stay put.
      const captionsOff = { ...drawOpts, showCaptions: false };
      drawBoundarySides(composition.transitionKind, () => {
        drawScene(ctxA, composition.from, W, H,
          { ...onGround(project, composition.fromSceneIndex, captionsOff), camera: camFrom, floatEnabled: sceneFloat(composition.fromSceneIndex), currentTimeMs: composition.fromLocalT,
            handTrack: project.diagrams[composition.fromSceneIndex].handTrack });
        drawScene(ctxB, composition.to, W, H,
          { ...onGround(project, composition.toSceneIndex, captionsOff), camera: camTo, floatEnabled: sceneFloat(composition.toSceneIndex), currentTimeMs: composition.toLocalT,
            handTrack: project.diagrams[composition.toSceneIndex].handTrack });
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      compositeBoundary(ctx, workA, workB, composition.alpha, composition.transitionKind, pxW, pxH,
        project.artboard?.background, composition.transitionColor);
      // One line, from the scene the cut is handing over TO once it has one — the viewer is
      // already reading ahead — falling back to the outgoing scene while the incoming one is
      // still silent.
      if (drawOpts.showCaptions) {
        const leadIsTo = !!composition.to.caption;
        const lead = leadIsTo ? composition.to : composition.from;
        if (lead.caption) {
          ctx.setTransform(rs, 0, 0, rs, 0, 0);
          drawCaptionLowerThird(ctx, W, H, lead.caption,
            lead.captionElapsedMs ?? 0, lead.captionDurationMs || 1,
            drawOpts.captionStyle, undefined, lead.captionWords,
            // Same band the lead scene uses on its own, so the line does not hop at the cut.
            captionAvoidRects(lead.nodes, leadIsTo ? camTo : camFrom, W, H));
        }
      }
    } else {
      // No work canvases — degrade to a hard switch at the boundary midpoint so
      // playback still advances (mirrors the old preview compositor's fallback).
      const useTo = composition.alpha >= 0.5;
      const si = useTo ? composition.toSceneIndex : composition.fromSceneIndex;
      const localT = useTo ? composition.toLocalT : composition.fromLocalT;
      const cam = getCameraForScene(project.diagrams[si].steps, localT, defaultCamera);
      ctx.setTransform(rs, 0, 0, rs, 0, 0);
      drawScene(ctx, useTo ? composition.to : composition.from, W, H,
        { ...onGround(project, si, drawOpts), camera: cam, floatEnabled: sceneFloat(si), currentTimeMs: localT });
    }
    return;
  }

  // Legacy single-diagram path.
  if (fallback) {
    const fb = fallback();
    const state = evaluateAt(tMs, fb.steps, fb.paths, fb.nodes, fb.edges);
    ctx.setTransform(rs, 0, 0, rs, 0, 0);
    drawScene(ctx, state, W, H, {
      ...drawOpts,
      camera: getCameraAtTime(tMs, { project, timeline, steps: fb.steps, defaultCamera }),
      floatEnabled: sceneFloat(0),
    });
  }
}
