/* eslint-disable -- Migrated file */
import type { Vec2, NodeModel, EdgeModel, Path, Easing } from '../types';

// Cache for warned missing parent nodes to avoid spamming console every frame
const warnedMissingParents = new Set<string>();

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  // A corner radius larger than half the smaller side makes arcTo overshoot the
  // box and draw pointed "< >" brackets at the ends (seen on short pills whose
  // cornerRadius came from a theme's radius token). Clamp to a valid radius.
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draw a triangle (equilateral, pointing up)
 */
export function drawTriangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
) {
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y); // top center
  ctx.lineTo(x + w, y + h); // bottom right
  ctx.lineTo(x, y + h); // bottom left
  ctx.closePath();
}

/**
 * Draw a regular polygon
 */
export function drawPolygon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  sides: number = 6
) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const radiusX = w / 2;
  const radiusY = h / 2;

  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2; // Start from top
    const px = cx + Math.cos(angle) * radiusX;
    const py = cy + Math.sin(angle) * radiusY;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
}

/**
 * Draw a star
 */
export function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  points: number = 5,
  innerRadiusRatio: number = 0.5
) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const outerRadiusX = w / 2;
  const outerRadiusY = h / 2;
  const innerRadiusX = outerRadiusX * innerRadiusRatio;
  const innerRadiusY = outerRadiusY * innerRadiusRatio;

  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const isOuter = i % 2 === 0;
    const radiusX = isOuter ? outerRadiusX : innerRadiusX;
    const radiusY = isOuter ? outerRadiusY : innerRadiusY;
    const px = cx + Math.cos(angle) * radiusX;
    const py = cy + Math.sin(angle) * radiusY;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
}

/**
 * Draw an arrow pointing right
 */
export function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cornerRadius: number = 0
) {
  // Arrow: rectangle with triangular head on the right
  const headWidth = Math.min(w * 0.3, h * 0.5); // Arrow head width
  const bodyWidth = w - headWidth;

  if (cornerRadius <= 0) {
    // Sharp corners
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.25); // top left of body
    ctx.lineTo(x + bodyWidth, y + h * 0.25); // top of body
    ctx.lineTo(x + bodyWidth, y); // top of head
    ctx.lineTo(x + w, y + h / 2); // tip of arrow
    ctx.lineTo(x + bodyWidth, y + h); // bottom of head
    ctx.lineTo(x + bodyWidth, y + h * 0.75); // bottom of body
    ctx.lineTo(x, y + h * 0.75); // bottom left of body
    ctx.closePath();
  } else {
    // Rounded corners
    const r = Math.min(cornerRadius, h * 0.125); // limit radius
    ctx.beginPath();

    // Start at top-left, move clockwise
    ctx.moveTo(x + r, y + h * 0.25);

    // Top edge of body
    ctx.lineTo(x + bodyWidth - r, y + h * 0.25);
    ctx.arcTo(x + bodyWidth, y + h * 0.25, x + bodyWidth, y + h * 0.25 - r, r);

    // Right edge of body to head top
    ctx.lineTo(x + bodyWidth, y + r);
    ctx.arcTo(x + bodyWidth, y, x + bodyWidth + r, y, r);

    // Head top to tip
    ctx.lineTo(x + w - r, y + h / 2 - r);
    ctx.lineTo(x + w, y + h / 2); // tip
    ctx.lineTo(x + w - r, y + h / 2 + r);

    // Head bottom
    ctx.lineTo(x + bodyWidth + r, y + h);
    ctx.arcTo(x + bodyWidth, y + h, x + bodyWidth, y + h - r, r);

    // Right edge of body from head
    ctx.lineTo(x + bodyWidth, y + h * 0.75 + r);
    ctx.arcTo(x + bodyWidth, y + h * 0.75, x + bodyWidth - r, y + h * 0.75, r);

    // Bottom edge of body
    ctx.lineTo(x + r, y + h * 0.75);
    ctx.arcTo(x, y + h * 0.75, x, y + h * 0.75 - r, r);

    // Left edge of body
    ctx.lineTo(x, y + h * 0.25 + r);
    ctx.arcTo(x, y + h * 0.25, x + r, y + h * 0.25, r);

    ctx.closePath();
  }
}

/**
 * Draw a wedge (pie/donut slice)
 * startAngle/endAngle in degrees, 0 = right (3 o'clock), clockwise
 * innerRadius 0-1 (0 = full pie, >0 = donut)
 */
export function drawWedge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  startAngle: number = 0,
  endAngle: number = 270,
  innerRadius: number = 0
) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const outerRx = w / 2;
  const outerRy = h / 2;
  const innerRx = outerRx * innerRadius;
  const innerRy = outerRy * innerRadius;
  const startRad = (startAngle * Math.PI) / 180;
  const endRad = (endAngle * Math.PI) / 180;

  ctx.beginPath();
  // Outer arc
  ctx.ellipse(cx, cy, outerRx, outerRy, 0, startRad, endRad);

  if (innerRadius > 0) {
    // Line to inner arc end
    ctx.lineTo(
      cx + Math.cos(endRad) * innerRx,
      cy + Math.sin(endRad) * innerRy
    );
    // Inner arc (counter-clockwise)
    ctx.ellipse(cx, cy, innerRx, innerRy, 0, endRad, startRad, true);
    ctx.closePath();
  } else {
    // Line to center for full pie slice
    ctx.lineTo(cx, cy);
    ctx.closePath();
  }
}

/**
 * Draw a chevron (process pipeline arrow shape)
 * pointDepth: 0-1, how deep the arrow notch is relative to width
 */
export function drawChevron(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  pointDepth: number = 0.2
) {
  const notch = w * pointDepth;

  ctx.beginPath();
  ctx.moveTo(x + notch, y);             // top-left (indented)
  ctx.lineTo(x + w, y);                 // top-right
  ctx.lineTo(x + w - notch, y + h / 2); // right point
  ctx.lineTo(x + w, y + h);             // bottom-right
  ctx.lineTo(x + notch, y + h);         // bottom-left (indented)
  ctx.lineTo(x, y + h / 2);             // left point
  ctx.closePath();
}

/**
 * Draw a diamond (decision/branch) shape
 */
export function drawDiamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
) {
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);       // top
  ctx.lineTo(x + w, y + h / 2);   // right
  ctx.lineTo(x + w / 2, y + h);   // bottom
  ctx.lineTo(x, y + h / 2);       // left
  ctx.closePath();
}

/**
 * Draw a funnel/trapezoid shape
 * topWidth/bottomWidth: 0-1 ratio of node width
 */
export function drawFunnel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  topWidth: number = 1,
  bottomWidth: number = 0.3
) {
  const topOffset = w * (1 - topWidth) / 2;
  const bottomOffset = w * (1 - bottomWidth) / 2;

  ctx.beginPath();
  ctx.moveTo(x + topOffset, y);                // top-left
  ctx.lineTo(x + w - topOffset, y);            // top-right
  ctx.lineTo(x + w - bottomOffset, y + h);     // bottom-right
  ctx.lineTo(x + bottomOffset, y + h);         // bottom-left
  ctx.closePath();
}

/**
 * Draw a progress bar shape
 * value: 0-1 fill percentage
 * orientation: 'horizontal' or 'vertical'
 * Returns the clip rect for the filled portion (used by renderer for two-tone fill)
 */
export function drawProgressTrack(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cornerRadius: number = 0
) {
  const r = Math.min(cornerRadius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draw a callout / speech bubble
 * pointerSide: 'N'|'E'|'S'|'W' — which side the pointer extends from
 * pointerPosition: 0-1, position along side
 * pointerSize: 0-1, size of pointer base relative to side length
 */
export function drawCallout(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  pointerSide: 'N' | 'E' | 'S' | 'W' = 'S',
  pointerPosition: number = 0.3,
  pointerSize: number = 0.12,
  cornerRadius: number = 12
) {
  const r = Math.min(cornerRadius, w / 4, h / 4);
  // Reserve space for pointer
  const pLen = pointerSide === 'N' || pointerSide === 'S' ? h * 0.18 : w * 0.18;

  // Adjust body rect to make room for pointer
  let bx = x, by = y, bw = w, bh = h;
  if (pointerSide === 'S') { bh = h - pLen; }
  else if (pointerSide === 'N') { by = y + pLen; bh = h - pLen; }
  else if (pointerSide === 'E') { bw = w - pLen; }
  else if (pointerSide === 'W') { bx = x + pLen; bw = w - pLen; }

  ctx.beginPath();

  // Top side
  ctx.moveTo(bx + r, by);
  if (pointerSide === 'N') {
    const sideLen = bw;
    const pBase = sideLen * pointerSize;
    const pStart = bx + sideLen * pointerPosition;
    ctx.lineTo(pStart, by);
    ctx.lineTo(pStart + pBase / 2, y);       // tip at original y (up)
    ctx.lineTo(pStart + pBase, by);
  }
  ctx.lineTo(bx + bw - r, by);

  // Top-right corner
  ctx.arcTo(bx + bw, by, bx + bw, by + r, r);

  // Right side
  if (pointerSide === 'E') {
    const sideLen = bh;
    const pBase = sideLen * pointerSize;
    const pStart = by + sideLen * pointerPosition;
    ctx.lineTo(bx + bw, pStart);
    ctx.lineTo(x + w, pStart + pBase / 2);   // tip at original right edge
    ctx.lineTo(bx + bw, pStart + pBase);
  }
  ctx.lineTo(bx + bw, by + bh - r);

  // Bottom-right corner
  ctx.arcTo(bx + bw, by + bh, bx + bw - r, by + bh, r);

  // Bottom side
  if (pointerSide === 'S') {
    const sideLen = bw;
    const pBase = sideLen * pointerSize;
    const pStart = bx + sideLen * (1 - pointerPosition) - pBase;
    ctx.lineTo(pStart + pBase, by + bh);
    ctx.lineTo(pStart + pBase / 2, y + h);   // tip at original bottom
    ctx.lineTo(pStart, by + bh);
  }
  ctx.lineTo(bx + r, by + bh);

  // Bottom-left corner
  ctx.arcTo(bx, by + bh, bx, by + bh - r, r);

  // Left side
  if (pointerSide === 'W') {
    const sideLen = bh;
    const pBase = sideLen * pointerSize;
    const pStart = by + sideLen * (1 - pointerPosition) - pBase;
    ctx.lineTo(bx, pStart + pBase);
    ctx.lineTo(x, pStart + pBase / 2);       // tip at original left edge
    ctx.lineTo(bx, pStart);
  }
  ctx.lineTo(bx, by + r);

  // Top-left corner
  ctx.arcTo(bx, by, bx + r, by, r);

  ctx.closePath();
}

/**
 * Draw a cylinder (3D database shape) — closed path for fill + stroke.
 * Back arc of top ellipse (upper half) → right side → front arc of bottom
 * ellipse (lower half) → left side (close).
 * The fill covers the entire visible cylinder including the top face.
 */
/**
 * Resolve cylinder orientation from an optional explicit value plus current dimensions.
 * When no explicit value is set, infer from aspect ratio: wide shapes (w > h * 1.4)
 * render as horizontal cylinders so pre-existing cylinders that have been resized
 * wide still read as a 3D cylinder rather than a stretched stadium.
 */
export function resolveCylinderOrientation(
  explicit: 'vertical' | 'horizontal' | undefined,
  w: number,
  h: number
): 'vertical' | 'horizontal' {
  if (explicit) return explicit;
  return w > h * 1.4 ? 'horizontal' : 'vertical';
}

export function drawCylinder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  orientation: 'vertical' | 'horizontal' = 'vertical'
) {
  if (orientation === 'horizontal') {
    // Cap depth scales with the shorter dimension so the front cap stays a clearly
    // readable oval at any aspect ratio. Clamped so caps never collide for narrow shapes.
    const rx = Math.min(h * 0.32, w * 0.22);
    const cy = y + h / 2;
    ctx.beginPath();
    // Back arc of left ellipse (left half): top → left → bottom
    ctx.ellipse(x + rx, cy, rx, h / 2, 0, -Math.PI / 2, Math.PI / 2, true);
    // Bottom side rightward
    ctx.lineTo(x + w - rx, y + h);
    // Front arc of right ellipse (right half): bottom → right → top
    ctx.ellipse(x + w - rx, cy, rx, h / 2, 0, Math.PI / 2, -Math.PI / 2, true);
    // closePath returns to start (top side leftward)
    ctx.closePath();
    return;
  }
  const ry = h * 0.12; // ellipse cap half-height
  const cx = x + w / 2;

  ctx.beginPath();
  // Back arc of top ellipse (upper half): left → up → right
  // Clockwise from PI to 0 goes through 3PI/2 (up) = upper half
  ctx.ellipse(cx, y + ry, w / 2, ry, 0, Math.PI, 0, false);
  // Right side down
  ctx.lineTo(x + w, y + h - ry);
  // Front arc of bottom ellipse (lower half): right → down → left
  // Clockwise from 0 to PI goes through PI/2 (down) = lower half
  ctx.ellipse(cx, y + h - ry, w / 2, ry, 0, 0, Math.PI, false);
  // Left side up (closePath draws line from (x, y+h-ry) back to (x, y+ry))
  ctx.closePath();
}

/**
 * Draw the front arc of the top ellipse (lower half) — the 3D depth line
 * that separates the top face from the body. Stroked separately after fill.
 */
export function drawCylinderTopArc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  orientation: 'vertical' | 'horizontal' = 'vertical'
) {
  if (orientation === 'horizontal') {
    // For horizontal: depth line separates left ellipse "cap" from body.
    // Front (visible) arc of left ellipse is its right half: top → right → bottom
    const rx = Math.min(h * 0.32, w * 0.22);
    const cy = y + h / 2;
    ctx.beginPath();
    ctx.ellipse(x + rx, cy, rx, h / 2, 0, -Math.PI / 2, Math.PI / 2, false);
    return;
  }
  const ry = h * 0.12;
  const cx = x + w / 2;

  ctx.beginPath();
  // Front arc of top ellipse (lower half): left → down → right
  // Counterclockwise from PI to 0 goes through PI/2 (down) = lower half
  ctx.ellipse(cx, y + ry, w / 2, ry, 0, Math.PI, 0, true);
}

/**
 * Draw N-1 segment divider arcs across the cylinder body. Each divider is a
 * front-facing ellipse arc with the same curvature as the cap, evenly spaced
 * within the body. The caller is responsible for calling stroke() afterward.
 * For vertical: dividers are horizontal arcs spaced down the body.
 * For horizontal: dividers are vertical arcs spaced across the body.
 */
export function drawCylinderSegmentDividers(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  segments: number,
  orientation: 'vertical' | 'horizontal' = 'vertical'
) {
  if (segments <= 1) return;
  ctx.beginPath();
  if (orientation === 'horizontal') {
    const rx = Math.min(h * 0.32, w * 0.22);
    const cy = y + h / 2;
    const cx_left = x + rx;
    const cx_right = x + w - rx;
    const bodyLen = cx_right - cx_left;
    for (let i = 1; i < segments; i++) {
      const dividerCx = cx_left + (bodyLen * i) / segments;
      // moveTo starts a new sub-path so ellipse() doesn't connect to the
      // previous divider's endpoint with a straight line (which would look like a slash).
      ctx.moveTo(dividerCx, y);
      // Front arc of vertical ellipse = right half: top → right → bottom (matches right cap)
      ctx.ellipse(dividerCx, cy, rx, h / 2, 0, -Math.PI / 2, Math.PI / 2, false);
    }
  } else {
    const ry = h * 0.12;
    const cx = x + w / 2;
    const top_cy = y + ry;
    const bot_cy = y + h - ry;
    const bodyLen = bot_cy - top_cy;
    for (let i = 1; i < segments; i++) {
      const dividerCy = top_cy + (bodyLen * i) / segments;
      ctx.moveTo(cx + w / 2, dividerCy);
      // Front arc of horizontal ellipse = lower half: left → down → right (matches bottom cap)
      ctx.ellipse(cx, dividerCy, w / 2, ry, 0, 0, Math.PI);
    }
  }
}

/**
 * Draw a UML stick-figure actor.
 * Stroke-only (no closed fill path). Caller should only stroke, not fill.
 */
export function drawUmlActor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const cx = x + w / 2;
  const headR = Math.min(w, h) * 0.15;
  const headCy = y + headR;
  const bodyTop = headCy + headR;
  const bodyBottom = bodyTop + h * 0.3;
  const armY = bodyTop + h * 0.1;
  const legBottom = y + h;
  const armSpan = w * 0.4;
  const legSpan = w * 0.35;

  // Head circle
  ctx.beginPath();
  ctx.arc(cx, headCy, headR, 0, Math.PI * 2);
  ctx.stroke();

  // Body line
  ctx.beginPath();
  ctx.moveTo(cx, bodyTop);
  ctx.lineTo(cx, bodyBottom);
  ctx.stroke();

  // Arms
  ctx.beginPath();
  ctx.moveTo(cx - armSpan, armY);
  ctx.lineTo(cx + armSpan, armY);
  ctx.stroke();

  // Left leg
  ctx.beginPath();
  ctx.moveTo(cx, bodyBottom);
  ctx.lineTo(cx - legSpan, legBottom);
  ctx.stroke();

  // Right leg
  ctx.beginPath();
  ctx.moveTo(cx, bodyBottom);
  ctx.lineTo(cx + legSpan, legBottom);
  ctx.stroke();
}

/**
 * Draw a UML lifeline: header rectangle (closed path for fill) + dashed vertical line.
 * The header rect is left as a beginPath for the caller to fill/stroke.
 * The dashed line is drawn separately via stroke.
 */
export function drawUmlLifeline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  lifelineLength?: number,
  activations?: Array<{startY: number, endY: number}>,
  // Header style: a box (default), a stick-figure actor, or an icon glyph. Actor/icon
  // heads draw no box and start the dashed line lower (room for the glyph + label).
  head: 'box' | 'actor' | 'icon' = 'box',
  svgPaths?: Array<{ d: string; fill?: string; stroke?: string; strokeWidth?: number; opacity?: number }>,
  svgViewBox?: { x: number; y: number; w: number; h: number },
  glyphColor?: string,
) {
  const headerH = 50;
  const cx = x + w / 2;
  const lineLen = lifelineLength ?? (h - headerH);
  const isGlyph = head === 'actor' || head === 'icon';

  if (!isGlyph) {
    // Header rectangle (closed path — caller will fill + stroke)
    ctx.beginPath();
    ctx.rect(x, y, w, headerH);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    // Glyph head, centered at the top; no box. Drawn in the header's glyph color.
    ctx.save();
    if (glyphColor) { ctx.strokeStyle = glyphColor; ctx.fillStyle = glyphColor; }
    if (head === 'actor') {
      drawUmlActor(ctx, cx - 19, y + 2, 38, 44);
    } else if (head === 'icon' && svgPaths && svgPaths.length) {
      drawSvgPaths(ctx, cx - 18, y + 4, 36, 36, svgPaths, svgViewBox, glyphColor, glyphColor);
    }
    ctx.restore();
  }

  // Dashed lifeline (starts below the glyph + its label for actor/icon heads).
  const lineStart = isGlyph ? y + 72 : y + headerH;
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, lineStart);
  ctx.lineTo(cx, y + headerH + lineLen);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Activation bars (thin filled rects centered on lifeline)
  if (activations && activations.length > 0) {
    const barW = 10;
    const barX = cx - barW / 2;
    const headerBottom = y + headerH;
    ctx.save();
    for (const act of activations) {
      const ay = headerBottom + act.startY;
      const ah = act.endY - act.startY;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(barX, ay, barW, ah);
      ctx.strokeRect(barX, ay, barW, ah);
    }
    ctx.restore();
  }
}

/**
 * Draw a UML class box with 3 compartments: name, attributes, methods.
 * Outer rect is left as a closed path for fill/stroke.
 * Divider lines and text are drawn directly.
 */
export function drawUmlClassBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  attributes?: string[],
  methods?: string[],
  textColor?: string,
  stereotype?: string
) {
  const attrCount = attributes?.length ?? 0;
  const lineH = 18; // line height for attribute/method text
  const padding = 6;

  // Calculate compartment heights
  const nameH = Math.max(36, h * 0.25);
  const attrH = attrCount > 0 ? Math.max(attrCount * lineH + padding * 2, h * 0.25) : h * 0.25;

  // Outer rectangle — uses current fillStyle (node fill) for background
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Divider line below name compartment
  const divider1Y = y + nameH;
  ctx.beginPath();
  ctx.moveTo(x, divider1Y);
  ctx.lineTo(x + w, divider1Y);
  ctx.stroke();

  // Divider line below attributes compartment
  const divider2Y = divider1Y + attrH;
  ctx.beginPath();
  ctx.moveTo(x, divider2Y);
  ctx.lineTo(x + w, divider2Y);
  ctx.stroke();

  // Switch to text color for all text rendering
  const savedFill = ctx.fillStyle;
  if (textColor) ctx.fillStyle = textColor;

  // Draw stereotype text above class name (in name compartment)
  if (stereotype) {
    ctx.save();
    ctx.font = 'italic 10px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`\u00AB${stereotype}\u00BB`, x + w / 2, y + nameH * 0.3);
    ctx.restore();
  }

  // Draw attribute text
  if (attributes && attributes.length > 0) {
    ctx.save();
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let i = 0; i < attributes.length; i++) {
      const ty = divider1Y + padding + i * lineH;
      if (ty + lineH > divider2Y) break; // don't overflow
      ctx.fillText(attributes[i], x + padding, ty);
    }
    ctx.restore();
  }

  // Draw method text
  if (methods && methods.length > 0) {
    ctx.save();
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let i = 0; i < methods.length; i++) {
      const ty = divider2Y + padding + i * lineH;
      if (ty + lineH > y + h) break; // don't overflow
      ctx.fillText(methods[i], x + padding, ty);
    }
    ctx.restore();
  }

  // Restore original fill
  ctx.fillStyle = savedFill;
}

/**
 * Draw a UML note shape (rectangle with folded top-right corner).
 * Creates a closed path for fill/stroke.
 */
export function drawUmlNote(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  foldSize: number = 16
) {
  const f = Math.min(foldSize, w * 0.25, h * 0.25);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w - f, y);       // top edge to fold start
  ctx.lineTo(x + w, y + f);       // diagonal fold
  ctx.lineTo(x + w, y + h);       // right edge
  ctx.lineTo(x, y + h);           // bottom edge
  ctx.closePath();                 // left edge back to top-left
}

/**
 * Draw the fold overlay (triangle lines) on a UML note.
 * Call after fill/stroke of the main note shape.
 */
export function drawUmlNoteFold(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number = 120,
  foldSize: number = 16
) {
  const f = Math.min(foldSize, w * 0.25, h * 0.25);
  ctx.beginPath();
  ctx.moveTo(x + w - f, y);
  ctx.lineTo(x + w - f, y + f);
  ctx.lineTo(x + w, y + f);
  ctx.stroke();
}

/**
 * Draw SVG paths
 */
export function drawSvgPaths(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  paths: Array<{
    d: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    opacity?: number;
  }>,
  viewBox?: { x: number; y: number; w: number; h: number },
  overrideFill?: string,
  overrideStroke?: string,
  overrideStrokeWidth?: number,
  iconStyle?: 'outline' | 'solid', // 'outline' = stroke only, 'solid' = fill+stroke, undefined = preserve originals
  drawProgress: number = 1 // 0..1 progressive stroke reveal ("draw-on") via lineDash
) {
  ctx.save();

  // Clip to node bounds
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // Calculate scale and offset to fit viewBox into node bounds
  let scaleX = 1, scaleY = 1, offsetX = 0, offsetY = 0;

  if (viewBox) {
    scaleX = w / viewBox.w;
    scaleY = h / viewBox.h;
    offsetX = -viewBox.x * scaleX;
    offsetY = -viewBox.y * scaleY;
  }

  // Apply transform
  ctx.translate(x, y);
  ctx.scale(scaleX, scaleY);
  ctx.translate(offsetX / scaleX, offsetY / scaleY);

  // Capture the parent context's globalAlpha (node-level opacity)
  const parentAlpha = ctx.globalAlpha;

  // Draw each path (wrapped in save/restore for bulletproof isolation)
  for (const pathData of paths) {
    ctx.save(); // Isolate each path's state changes

    const path2d = new Path2D(pathData.d);

    // Multiply path-level opacity with node-level opacity
    // This ensures node.opacity=0 makes the whole icon invisible
    const pathOpacity = pathData.opacity ?? 1;
    ctx.globalAlpha = parentAlpha * pathOpacity;

    // Ensure clean state for this path
    ctx.setLineDash([]);
    ctx.globalCompositeOperation = 'source-over';

    // FILL LOGIC:
    // Behavior depends on iconStyle:
    // - 'outline': No fill (stroke only)
    // - 'solid': Apply overrideFill to all paths
    // - undefined: Preserve original path fills
    let fillColor: string | undefined;

    if (iconStyle === 'outline') {
      // OUTLINE MODE: No fill, stroke only (for icon glyphs)
      fillColor = undefined;
    } else if (iconStyle === 'solid') {
      // SOLID MODE: Apply fill to all paths (user wants filled icon)
      if (overrideFill && overrideFill !== 'none' && overrideFill !== 'transparent') {
        fillColor = overrideFill;
      } else if (pathData.fill && pathData.fill !== 'none') {
        fillColor = pathData.fill;
      }
    } else {
      // PRESERVE MODE (undefined): Use original colors (for uploaded SVGs)
      if (pathData.fill && pathData.fill !== 'none') {
        fillColor = pathData.fill;
      }
    }

    // Canvas can't paint an SVG gradient/pattern reference; assigning a
    // "url(#…)" string to fillStyle is a no-op that leaks the inherited fill
    // (the black-vs-white inconsistency). Gradient icons render via the
    // rasterized-image path instead; this is the safety net for any path that
    // still reaches here with a url() fill (e.g. before the image finishes
    // loading) — a deterministic color so it's never black-vs-white.
    if (fillColor && /^url\(/i.test(fillColor)) {
      fillColor = (overrideFill && overrideFill !== 'none' && overrideFill !== 'transparent')
        ? overrideFill : '#888888';
    }

    if (fillColor) {
      ctx.fillStyle = fillColor;
      ctx.fill(path2d);
    }

    // STROKE LOGIC:
    // Same behavior as fill
    let strokeColor: string | undefined;

    if (iconStyle === 'outline') {
      // OUTLINE MODE: Always use override stroke (or path's stroke)
      // For fill-based icons (e.g. mdi:*), fall back to using fill color as stroke
      // so the icon outline is still visible
      if (overrideStroke && overrideStroke !== 'none' && overrideStroke !== 'transparent') {
        strokeColor = overrideStroke;
      } else if (pathData.stroke && pathData.stroke !== 'none') {
        strokeColor = pathData.stroke;
      } else if (pathData.fill && pathData.fill !== 'none' && !pathData.stroke) {
        // Fill-only path in outline mode: use fill color as stroke so icon is visible
        strokeColor = pathData.fill;
      }
    } else if (iconStyle === 'solid') {
      // SOLID MODE: Apply stroke to all paths
      if (overrideStroke && overrideStroke !== 'none' && overrideStroke !== 'transparent') {
        strokeColor = overrideStroke;
      } else if (pathData.stroke && pathData.stroke !== 'none') {
        strokeColor = pathData.stroke;
      }
    } else {
      // PRESERVE MODE (undefined): Use original strokes
      if (pathData.stroke && pathData.stroke !== 'none') {
        strokeColor = pathData.stroke;
      }
    }

    if (strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = (overrideStrokeWidth || pathData.strokeWidth || 1) / Math.min(scaleX, scaleY);
      // Progressive "draw-on": reveal only the first `drawProgress` of the path.
      const subs = drawProgress < 1
        ? pathData.d.split(/(?=[Mm])/).map((s) => s.trim()).filter(Boolean)
        : [];
      if (drawProgress < 1 && subs.length > 1) {
        // Multi-subpath: reveal subpaths SEQUENTIALLY. Canvas restarts the dash at every
        // moveTo, so a single [shown, total] dash draws ALL subpaths at once (and races ahead
        // of a hand tracing the continuous path). Advance a single front across them instead.
        const lens = subs.map((d) => _svgPathLength(d));
        const total = lens.reduce((a, b) => a + b, 0) || 1;
        const shownTotal = Math.max(0, Math.min(1, drawProgress)) * total;
        // Stroke ABSOLUTE-start subpaths: a standalone Path2D treats a leading relative `m` as
        // absolute, so without this a relative-m subpath traces displaced (then snaps correct
        // only at drawProgress=1 when the full path is stroked).
        const absSubs = _absoluteSubpaths(pathData.d, subs);
        let cum = 0;
        for (let si = 0; si < subs.length; si++) {
          const shown = Math.max(0, Math.min(lens[si], shownTotal - cum));
          cum += lens[si];
          if (shown <= 0.01) continue;
          ctx.setLineDash([shown, lens[si] + 1]);
          ctx.lineDashOffset = 0;
          ctx.stroke(new Path2D(absSubs[si]));
        }
      } else {
        if (drawProgress < 1) {
          const len = _svgPathLength(pathData.d);
          if (len > 0) {
            ctx.setLineDash([Math.max(0, Math.min(1, drawProgress)) * len, len]);
            ctx.lineDashOffset = 0;
          }
        }
        ctx.stroke(path2d);
      }
    }

    ctx.restore(); // Restore to clean state after each path
  }

  ctx.restore();
}

// Subpaths of `d` with their leading moveto made ABSOLUTE. The sequential draw-on strokes each
// subpath as a standalone Path2D, but a subpath starting with a RELATIVE `m` loses its reference
// point when stroked alone (a standalone leading `m` is treated as absolute), so its stroke draws
// displaced during the trace and only snaps correct at drawProgress=1 (observed: a map icon's fold
// line tracing outside the icon). Rewriting just the leading moveto to the subpath's true absolute
// start (from the FULL path via getPointAtLength at the cumulative offset) fixes every case: after
// the moveto the current point matches the full-path rendering, so all following commands —
// relative or absolute — land identically. Cached per `d`.
const _absSubsCache = new Map<string, string[]>();
const _SVG_NUM = '[-+]?(?:\\d*\\.\\d+|\\d+\\.?\\d*)(?:[eE][-+]?\\d+)?';
const _REL_M_RE = new RegExp('^m\\s*(' + _SVG_NUM + ')[\\s,]*(' + _SVG_NUM + ')');
function _absoluteSubpaths(d: string, subs: string[]): string[] {
  let v = _absSubsCache.get(d);
  if (v !== undefined) return v;
  v = subs;
  try {
    if (typeof document !== 'undefined' && subs.some((s, i) => i > 0 && s.startsWith('m'))) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      const total = p.getTotalLength();
      const out: string[] = [];
      let cum = 0;
      for (let i = 0; i < subs.length; i++) {
        const s = subs[i];
        const mm = i > 0 ? s.match(_REL_M_RE) : null;
        if (mm) {
          // Point just INSIDE this subpath on the full path = its true absolute start.
          const pt = p.getPointAtLength(Math.min(cum + 0.01, total));
          const rest = s.slice(mm[0].length).trim();
          // Implicit pairs after a moveto are linetos — keep them relative with an explicit `l`.
          const restFixed = rest && /^[-+.0-9]/.test(rest) ? `l ${rest}` : rest;
          out.push(`M ${pt.x.toFixed(3)} ${pt.y.toFixed(3)} ${restFixed}`);
        } else {
          out.push(s);
        }
        cum += _svgPathLength(s);
      }
      v = out;
    }
  } catch {
    v = subs;
  }
  _absSubsCache.set(d, v);
  return v;
}

// Cached total length of an SVG path `d` (for progressive draw-on). Uses an
// offscreen SVGPathElement.getTotalLength() — handles lines, curves, arcs.
const _svgPathLenCache = new Map<string, number>();
function _svgPathLength(d: string): number {
  let v = _svgPathLenCache.get(d);
  if (v === undefined) {
    try {
      if (typeof document !== 'undefined') {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', d);
        v = p.getTotalLength();
      } else {
        v = 0;
      }
    } catch {
      v = 0;
    }
    _svgPathLenCache.set(d, v);
  }
  return v;
}

// Point at `progress` (0..1) along an SVG path `d`, in the path's own viewBox coords.
// Used by the write-on hand to ride a stroke ICON's real outline as it draws on.
// Caches the offscreen SVGPathElement per `d`.
const _svgPathElCache = new Map<string, SVGPathElement | null>();
export function svgPointAtProgress(d: string, progress: number): { x: number; y: number } | null {
  let el = _svgPathElCache.get(d);
  if (el === undefined) {
    try {
      el = typeof document !== 'undefined'
        ? (document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement)
        : null;
      if (el) el.setAttribute('d', d);
    } catch {
      el = null;
    }
    _svgPathElCache.set(d, el);
  }
  if (!el) return null;
  try {
    const len = el.getTotalLength();
    const pt = el.getPointAtLength(Math.max(0, Math.min(1, progress)) * len);
    return { x: pt.x, y: pt.y };
  } catch {
    return null;
  }
}

export function straightPath(a: Vec2, b: Vec2) {
  return [a, b];
}

export function curvedPath(a: Vec2, b: Vec2, customControlPoint?: Vec2): Vec2[] {
  // Create a smooth quadratic Bezier curve from a to b
  let controlPoint: Vec2;

  if (customControlPoint) {
    // Use custom control point if provided
    controlPoint = customControlPoint;
  } else {
    // Calculate default control point offset perpendicular to the direct line
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);

    // Control point offset (creates the curve bulge)
    // Offset is 25% of distance, perpendicular to the line
    const offsetAmount = dist * 0.25;

    // Perpendicular direction (rotate 90 degrees)
    const perpX = -dy / dist;
    const perpY = dx / dist;

    // Control point in the middle, offset perpendicular
    controlPoint = {
      x: (a.x + b.x) / 2 + perpX * offsetAmount,
      y: (a.y + b.y) / 2 + perpY * offsetAmount,
    };
  }

  // Generate smooth curve with multiple points
  const steps = 24;
  const points: Vec2[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Quadratic Bezier formula: (1-t)²P₀ + 2(1-t)tP₁ + t²P₂
    const t1 = 1 - t;
    const t1Sq = t1 * t1;
    const tSq = t * t;
    const t1t2 = 2 * t1 * t;

    points.push({
      x: t1Sq * a.x + t1t2 * controlPoint.x + tSq * b.x,
      y: t1Sq * a.y + t1t2 * controlPoint.y + tSq * b.y,
    });
  }

  return points;
}

// Helper to calculate default control point for a curved path
export function getDefaultCurveControlPoint(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);

  const offsetAmount = dist * 0.25;
  const perpX = -dy / dist;
  const perpY = dx / dist;

  return {
    x: (a.x + b.x) / 2 + perpX * offsetAmount,
    y: (a.y + b.y) / 2 + perpY * offsetAmount,
  };
}

// Helper to snap outer waypoints to start/end points to maintain orthogonality
function snapWaypoints(start: Vec2, end: Vec2, waypoints: Vec2[]): Vec2[] {
  if (waypoints.length < 2) return waypoints;
  const wp = [...waypoints];
  const last = wp.length - 1;

  // Snap First Waypoint (attached to Start)
  // Look at segment wp[0] -> wp[1] to determine orientation
  const dx0 = Math.abs(wp[1].x - wp[0].x);
  const dy0 = Math.abs(wp[1].y - wp[0].y);
  if (dx0 > dy0) {
    // wp0->wp1 is Horizontal. So Start->wp0 must be Vertical. Snap wp0.x to Start.x
    wp[0] = { x: start.x, y: wp[0].y };
  } else {
    // wp0->wp1 is Vertical. So Start->wp0 must be Horizontal. Snap wp0.y to Start.y
    wp[0] = { x: wp[0].x, y: start.y };
  }

  // Snap Last Waypoint (attached to End)
  // Look at segment wp[last-1] -> wp[last] to determine orientation
  const dxN = Math.abs(wp[last].x - wp[last - 1].x);
  const dyN = Math.abs(wp[last].y - wp[last - 1].y);
  if (dxN > dyN) {
    // wp[last-1]->wp[last] is Horizontal. So wp[last]->End must be Vertical. Snap wp[last].x to End.x
    wp[last] = { x: end.x, y: wp[last].y };
  } else {
    // wp[last-1]->wp[last] is Vertical. So wp[last]->End must be Horizontal. Snap wp[last].y to End.y
    wp[last] = { x: wp[last].x, y: end.y };
  }

  return wp;
}

export function orthoPathVHV(a: Vec2, b: Vec2, customWaypoints?: Vec2[]) {
  if (customWaypoints && customWaypoints.length >= 2) {
    const snapped = snapWaypoints(a, b, customWaypoints);
    return [a, ...snapped, b];
  }

  // DEFAULT: simple midpoint VHV
  const midY = (a.y + b.y) / 2;
  return [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b];
}

export function orthoPathHVH(a: Vec2, b: Vec2, customWaypoints?: Vec2[]) {
  if (customWaypoints && customWaypoints.length >= 2) {
    const snapped = snapWaypoints(a, b, customWaypoints);
    return [a, ...snapped, b];
  }

  // DEFAULT: simple midpoint HVH
  const midX = (a.x + b.x) / 2;
  return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
}

function quadraticBezier(p0: Vec2, p1: Vec2, p2: Vec2, t: number): Vec2 {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  };
}

// Helper function to apply rounding to all corners in a path
function applyRoundingToPath(points: Vec2[], radius: number): Vec2[] {
  if (points.length < 3) return points;

  const result: Vec2[] = [];
  const steps = 12;

  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      // First point - no rounding, just add it
      result.push(points[i]);
    } else if (i === points.length - 1) {
      // Last point - no rounding, just add it
      result.push(points[i]);
    } else {
      // Middle point - apply rounding
      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];

      // Calculate distances to adjacent points
      const distToPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
      const distToNext = Math.hypot(next.x - curr.x, next.y - curr.y);

      // Use the smaller of: radius, half distance to prev, half distance to next
      const r = Math.min(radius, distToPrev / 2, distToNext / 2);

      if (r < 1) {
        // Too small to round, just add the corner
        result.push(curr);
      } else {
        // Calculate the start and end points of the curve
        const dirToPrev = { x: prev.x - curr.x, y: prev.y - curr.y };
        const lenToPrev = Math.hypot(dirToPrev.x, dirToPrev.y);
        const normToPrev = { x: dirToPrev.x / lenToPrev, y: dirToPrev.y / lenToPrev };

        const dirToNext = { x: next.x - curr.x, y: next.y - curr.y };
        const lenToNext = Math.hypot(dirToNext.x, dirToNext.y);
        const normToNext = { x: dirToNext.x / lenToNext, y: dirToNext.y / lenToNext };

        const curveStart = { x: curr.x + normToPrev.x * r, y: curr.y + normToPrev.y * r };
        const curveEnd = { x: curr.x + normToNext.x * r, y: curr.y + normToNext.y * r };

        // Add straight line to curve start
        if (result.length === 0 || Math.hypot(curveStart.x - result[result.length - 1].x, curveStart.y - result[result.length - 1].y) > 0.5) {
          result.push(curveStart);
        }

        // Add bezier curve points
        for (let t = 1; t <= steps; t++) {
          result.push(quadraticBezier(curveStart, curr, curveEnd, t / steps));
        }
      }
    }
  }

  return result;
}

export function roundedPathVHV(a: Vec2, b: Vec2, radius: number = 20, customWaypoints?: Vec2[]): Vec2[] {
  // Get the orthogonal path (which may include smart rerouting)
  const orthoPath = orthoPathVHV(a, b, customWaypoints);

  // If the path has more than 4 points (smart rerouting added waypoints), apply rounding to all
  if (orthoPath.length > 4) {
    return applyRoundingToPath(orthoPath, radius);
  }

  // Simple path with 2 corners - use original optimized rounding
  const corner1 = orthoPath[1];
  const corner2 = orthoPath[2];

  const dy1 = Math.abs(corner1.y - a.y);
  const dx = Math.abs(corner2.x - corner1.x);
  const dy2 = Math.abs(b.y - corner2.y);
  const r = Math.min(radius, dy1 / 2, dx / 2, dy2 / 2);

  if (r < 1) return [a, corner1, corner2, b];

  const path: Vec2[] = [a];
  const signY1 = Math.sign(corner1.y - a.y);
  const signX = Math.sign(corner2.x - corner1.x);
  const signY2 = Math.sign(b.y - corner2.y);

  const curve1StartY = corner1.y - signY1 * r;
  if (Math.abs(curve1StartY - a.y) > 0.5) {
    path.push({ x: a.x, y: curve1StartY });
  }

  const p0 = { x: a.x, y: curve1StartY };
  const p1 = { x: corner1.x, y: corner1.y };
  const p2 = { x: corner1.x + signX * r, y: corner1.y };
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    path.push(quadraticBezier(p0, p1, p2, i / steps));
  }

  const curve2StartX = corner2.x - signX * r;
  if (Math.abs(curve2StartX - (corner1.x + signX * r)) > 0.5) {
    path.push({ x: curve2StartX, y: corner1.y });
  }

  const p3 = { x: curve2StartX, y: corner2.y };
  const p4 = { x: corner2.x, y: corner2.y };
  const p5 = { x: corner2.x, y: corner2.y + signY2 * r };
  for (let i = 1; i <= steps; i++) {
    path.push(quadraticBezier(p3, p4, p5, i / steps));
  }

  if (Math.abs(b.y - (corner2.y + signY2 * r)) > 0.5) {
    path.push({ x: b.x, y: b.y - signY2 * 0.1 });
  }

  path.push(b);
  return path;
}

export function roundedPathHVH(a: Vec2, b: Vec2, radius: number = 20, customWaypoints?: Vec2[]): Vec2[] {
  // Get the orthogonal path (which may include smart rerouting)
  const orthoPath = orthoPathHVH(a, b, customWaypoints);

  // If the path has more than 4 points (smart rerouting added waypoints), apply rounding to all
  if (orthoPath.length > 4) {
    return applyRoundingToPath(orthoPath, radius);
  }

  // Simple path with 2 corners - use original optimized rounding
  const corner1 = orthoPath[1];
  const corner2 = orthoPath[2];

  const dx1 = Math.abs(corner1.x - a.x);
  const dy = Math.abs(corner2.y - corner1.y);
  const dx2 = Math.abs(b.x - corner2.x);
  const r = Math.min(radius, dx1 / 2, dy / 2, dx2 / 2);

  if (r < 1) return [a, corner1, corner2, b];

  const path: Vec2[] = [a];
  const signX1 = Math.sign(corner1.x - a.x);
  const signY = Math.sign(corner2.y - corner1.y);
  const signX2 = Math.sign(b.x - corner2.x);

  const curve1StartX = corner1.x - signX1 * r;
  if (Math.abs(curve1StartX - a.x) > 0.5) {
    path.push({ x: curve1StartX, y: a.y });
  }

  const p0 = { x: curve1StartX, y: a.y };
  const p1 = { x: corner1.x, y: corner1.y };
  const p2 = { x: corner1.x, y: corner1.y + signY * r };
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    path.push(quadraticBezier(p0, p1, p2, i / steps));
  }

  const curve2StartY = corner2.y - signY * r;
  if (Math.abs(curve2StartY - (corner1.y + signY * r)) > 0.5) {
    path.push({ x: corner1.x, y: curve2StartY });
  }

  const p3 = { x: corner2.x, y: curve2StartY };
  const p4 = { x: corner2.x, y: corner2.y };
  const p5 = { x: corner2.x + signX2 * r, y: corner2.y };
  for (let i = 1; i <= steps; i++) {
    path.push(quadraticBezier(p3, p4, p5, i / steps));
  }

  if (Math.abs(b.x - (corner2.x + signX2 * r)) > 0.5) {
    path.push({ x: b.x - signX2 * 0.1, y: b.y });
  }

  path.push(b);
  return path;
}

export function offsetPoint(from: Vec2, towards: Vec2, distance: number): Vec2 {
  const dx = towards.x - from.x;
  const dy = towards.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.01) return from;
  const ux = dx / len;
  const uy = dy / len;
  return { x: from.x + ux * distance, y: from.y + uy * distance };
}

export function pathLen(pts: Vec2[]) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return L;
}

/**
 * Clip the canvas to the sub-polyline of `pts` between arc-lengths
 * [start, end], expanded perpendicular by `margin`. Used to reveal a rough
 * (sketch) edge's *fixed* full drawing progressively for the trim/draw-on
 * animation — feeding a growing polyline to Rough.js would re-jitter the whole
 * line every frame, so we draw the complete deterministic path and mask it.
 * Returns false (no clip applied) if there's nothing to reveal.
 */
export function clipToTrimmedRibbon(
  ctx: CanvasRenderingContext2D,
  pts: Vec2[],
  start: number,
  end: number,
  margin: number,
): boolean {
  const sub: Vec2[] = [];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const pa = pts[i - 1], pb = pts[i];
    const seg = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const segStart = acc, segEnd = acc + seg;
    const clipA = Math.max(start, segStart);
    const clipB = Math.min(end, segEnd);
    if (clipB > clipA && seg > 0) {
      const k1 = (clipA - segStart) / seg;
      const k2 = (clipB - segStart) / seg;
      if (sub.length === 0) sub.push({ x: pa.x + (pb.x - pa.x) * k1, y: pa.y + (pb.y - pa.y) * k1 });
      sub.push({ x: pa.x + (pb.x - pa.x) * k2, y: pa.y + (pb.y - pa.y) * k2 });
    }
    acc += seg;
  }
  if (sub.length < 2) return false;
  // Extend the START back a touch so the line origin isn't clipped; the END
  // stays a clean cut — that's the moving reveal edge.
  {
    const a = sub[0], b = sub[1];
    let tx = a.x - b.x, ty = a.y - b.y; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    sub[0] = { x: a.x + tx * margin, y: a.y + ty * margin };
  }
  const left: Vec2[] = [], right: Vec2[] = [];
  for (let i = 0; i < sub.length; i++) {
    const prev = sub[Math.max(0, i - 1)], next = sub[Math.min(sub.length - 1, i + 1)];
    let tx = next.x - prev.x, ty = next.y - prev.y; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const nx = -ty, ny = tx;
    left.push({ x: sub[i].x + nx * margin, y: sub[i].y + ny * margin });
    right.push({ x: sub[i].x - nx * margin, y: sub[i].y - ny * margin });
  }
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.clip();
  return true;
}

export function normalizeBox(b: { x: number; y: number; w: number; h: number }) {
  const x = Math.min(b.x, b.x + b.w),
    y = Math.min(b.y, b.y + b.h),
    w = Math.abs(b.w),
    h = Math.abs(b.h);
  return { x, y, w, h };
}

export function intersects(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
) {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

export function distPtSeg(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const L2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx,
    cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

export function reorder<T>(arr: T[], i: number, j: number) {
  if (j < 0 || j >= arr.length) return arr;
  const copy = [...arr];
  const t = copy[i];
  copy[i] = copy[j];
  copy[j] = t;
  return copy;
}

export function calculateSnapGuides(
  draggedNode: NodeModel,
  allNodes: NodeModel[],
  threshold: number = 3
): { x?: number; y?: number } {
  const guides: { x?: number; y?: number } = {};
  const draggedLeft = draggedNode.x;
  const draggedRight = draggedNode.x + draggedNode.w;
  const draggedCenterX = draggedNode.x + draggedNode.w / 2;
  const draggedTop = draggedNode.y;
  const draggedBottom = draggedNode.y + draggedNode.h;
  const draggedCenterY = draggedNode.y + draggedNode.h / 2;

  for (const node of allNodes) {
    if (node.id === draggedNode.id) continue;

    const nodeLeft = node.x;
    const nodeRight = node.x + node.w;
    const nodeCenterX = node.x + node.w / 2;
    const nodeTop = node.y;
    const nodeBottom = node.y + node.h;
    const nodeCenterY = node.y + node.h / 2;

    if (Math.abs(draggedLeft - nodeLeft) < threshold) guides.x = nodeLeft;
    else if (Math.abs(draggedLeft - nodeRight) < threshold)
      guides.x = nodeRight;
    else if (Math.abs(draggedLeft - nodeCenterX) < threshold)
      guides.x = nodeCenterX;
    else if (Math.abs(draggedRight - nodeLeft) < threshold) guides.x = nodeLeft;
    else if (Math.abs(draggedRight - nodeRight) < threshold)
      guides.x = nodeRight;
    else if (Math.abs(draggedRight - nodeCenterX) < threshold)
      guides.x = nodeCenterX;
    else if (Math.abs(draggedCenterX - nodeLeft) < threshold)
      guides.x = nodeLeft;
    else if (Math.abs(draggedCenterX - nodeRight) < threshold)
      guides.x = nodeRight;
    else if (Math.abs(draggedCenterX - nodeCenterX) < threshold)
      guides.x = nodeCenterX;

    if (Math.abs(draggedTop - nodeTop) < threshold) guides.y = nodeTop;
    else if (Math.abs(draggedTop - nodeBottom) < threshold)
      guides.y = nodeBottom;
    else if (Math.abs(draggedTop - nodeCenterY) < threshold)
      guides.y = nodeCenterY;
    else if (Math.abs(draggedBottom - nodeTop) < threshold) guides.y = nodeTop;
    else if (Math.abs(draggedBottom - nodeBottom) < threshold)
      guides.y = nodeBottom;
    else if (Math.abs(draggedBottom - nodeCenterY) < threshold)
      guides.y = nodeCenterY;
    else if (Math.abs(draggedCenterY - nodeTop) < threshold) guides.y = nodeTop;
    else if (Math.abs(draggedCenterY - nodeBottom) < threshold)
      guides.y = nodeBottom;
    else if (Math.abs(draggedCenterY - nodeCenterY) < threshold)
      guides.y = nodeCenterY;

    if (guides.x !== undefined && guides.y !== undefined) break;
  }

  return guides;
}

/**
 * Calculate snap guides for a point (e.g., edge endpoint or edge center)
 * Checks alignment with node centers, edges, and other edge endpoints
 */
export function calculatePointSnapGuides(
  pointX: number,
  pointY: number,
  allNodes: NodeModel[],
  allEdges: EdgeModel[],
  excludeEdgeId?: string,
  threshold: number = 5
): { x?: number; y?: number } {
  const guides: { x?: number; y?: number } = {};

  // Check alignment with nodes
  for (const node of allNodes) {
    const nodeLeft = node.x;
    const nodeRight = node.x + node.w;
    const nodeCenterX = node.x + node.w / 2;
    const nodeTop = node.y;
    const nodeBottom = node.y + node.h;
    const nodeCenterY = node.y + node.h / 2;

    // Check X alignment
    if (guides.x === undefined) {
      if (Math.abs(pointX - nodeLeft) < threshold) guides.x = nodeLeft;
      else if (Math.abs(pointX - nodeRight) < threshold) guides.x = nodeRight;
      else if (Math.abs(pointX - nodeCenterX) < threshold) guides.x = nodeCenterX;
    }

    // Check Y alignment
    if (guides.y === undefined) {
      if (Math.abs(pointY - nodeTop) < threshold) guides.y = nodeTop;
      else if (Math.abs(pointY - nodeBottom) < threshold) guides.y = nodeBottom;
      else if (Math.abs(pointY - nodeCenterY) < threshold) guides.y = nodeCenterY;
    }

    if (guides.x !== undefined && guides.y !== undefined) break;
  }

  // Check alignment with other edge endpoints
  for (const edge of allEdges) {
    if (edge.id === excludeEdgeId) continue;

    // Check fromXY if it exists
    if (edge.fromXY) {
      if (guides.x === undefined && Math.abs(pointX - edge.fromXY.x) < threshold) {
        guides.x = edge.fromXY.x;
      }
      if (guides.y === undefined && Math.abs(pointY - edge.fromXY.y) < threshold) {
        guides.y = edge.fromXY.y;
      }
    }

    // Check toXY if it exists
    if (edge.toXY) {
      if (guides.x === undefined && Math.abs(pointX - edge.toXY.x) < threshold) {
        guides.x = edge.toXY.x;
      }
      if (guides.y === undefined && Math.abs(pointY - edge.toXY.y) < threshold) {
        guides.y = edge.toXY.y;
      }
    }

    if (guides.x !== undefined && guides.y !== undefined) break;
  }

  return guides;
}

// ============================================================================
// Path Animation Utilities
// ============================================================================

/**
 * Build arc-length cache for constant-speed path traversal
 */
export function buildPathCache(path: Path): Path {
  const points = path.points;
  if (points.length < 2) {
    return { ...path, length: 0, cum: [0] };
  }

  const cum: number[] = [0];
  let totalLength = 0;

  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const segLength = Math.hypot(dx, dy);
    totalLength += segLength;
    cum.push(totalLength);
  }

  return { ...path, length: totalLength, cum };
}

/**
 * Get position and tangent at normalized position (0..1) along path
 */
export function pointAndTangentAt(
  path: Path,
  t: number
): { pos: Vec2; tan: Vec2 } {
  const points = path.points;
  const length = path.length || 0;
  const cum = path.cum || [];

  if (length <= 0 || points.length < 2) {
    return {
      pos: points[0] || { x: 0, y: 0 },
      tan: { x: 1, y: 0 },
    };
  }

  // Clamp t to [0, 1]
  const tClamped = Math.max(0, Math.min(1, t));
  const targetDist = tClamped * length;

  // Find segment containing targetDist
  let segmentIndex = 1;
  while (segmentIndex < cum.length && cum[segmentIndex] < targetDist) {
    segmentIndex++;
  }

  // Clamp to valid range
  segmentIndex = Math.max(1, Math.min(points.length - 1, segmentIndex));

  const a = points[segmentIndex - 1];
  const b = points[segmentIndex];
  const segStart = cum[segmentIndex - 1];
  const segEnd = cum[segmentIndex];
  const segLength = segEnd - segStart;

  if (segLength < 1e-6) {
    // Degenerate segment
    return {
      pos: a,
      tan: { x: 1, y: 0 },
    };
  }

  // Interpolate within segment
  const localT = (targetDist - segStart) / segLength;
  const pos = {
    x: a.x + (b.x - a.x) * localT,
    y: a.y + (b.y - a.y) * localT,
  };

  // Tangent is normalized direction of segment
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const tan = {
    x: dx / segLength,
    y: dy / segLength,
  };

  return { pos, tan };
}

/**
 * Apply complete node transform (pivot, rotation, scale) to canvas context
 * @param ctx Canvas rendering context
 * @param node Node with transform properties
 */
export function applyNodeTransform(
  ctx: CanvasRenderingContext2D,
  node: {
    x: number;
    y: number;
    w: number;
    h: number;
    pivotX?: number;
    pivotY?: number;
    rotationX?: number;
    rotationY?: number;
    rotationZ?: number;
    scaleX?: number;
    scaleY?: number;
    m11?: number;
    m12?: number;
    m21?: number;
    m22?: number;
    mPivotX?: number;
    mPivotY?: number;
  }
): void {
  // Calculate pivot point in world space
  const pivotX = node.pivotX ?? 0.5; // Default to center
  const pivotY = node.pivotY ?? 0.5;
  const pivotWorldX = node.x + node.w * pivotX;
  const pivotWorldY = node.y + node.h * pivotY;

  // Apply a general 2x2 linear map [[m11,m12],[m21,m22]] FIRST, about a SHARED
  // world pivot (mPivotX/Y, default = this node's pivot) — the basis of "transform
  // the whole plane" visuals. Sharing one world pivot across the grid, the basis
  // vectors and the determinant square makes them all deform as one space (a basis
  // arrow MOVES to A·î rather than rotating in place). Identity is [1,0,0,1].
  // Canvas transform(a,b,c,d,e,f) maps (x,y) -> (a*x + c*y + e, b*x + d*y + f);
  // our row-major matrix maps (x,y) -> (m11*x + m12*y, m21*x + m22*y), so
  // (a,b,c,d) = (m11,m21,m12,m22).
  const m11 = node.m11 ?? 1;
  const m12 = node.m12 ?? 0;
  const m21 = node.m21 ?? 0;
  const m22 = node.m22 ?? 1;
  if (m11 !== 1 || m12 !== 0 || m21 !== 0 || m22 !== 1) {
    const mpx = node.mPivotX ?? pivotWorldX;
    const mpy = node.mPivotY ?? pivotWorldY;
    ctx.translate(mpx, mpy);
    ctx.transform(m11, m21, m12, m22, 0, 0);
    ctx.translate(-mpx, -mpy);
  }

  // Move to pivot point
  ctx.translate(pivotWorldX, pivotWorldY);

  // Apply Z rotation (normal 2D rotation) first
  const rotZ = node.rotationZ ?? 0;
  if (rotZ !== 0) {
    const radZ = (rotZ * Math.PI) / 180;
    ctx.rotate(radZ);
  }

  // Apply 3D-style rotations via scale (Y rotation = horizontal flip)
  const rotY = node.rotationY ?? 0;
  if (rotY !== 0) {
    const radY = (rotY * Math.PI) / 180;
    const scaleXFrom3D = Math.abs(Math.cos(radY));
    ctx.scale(scaleXFrom3D, 1);
  }

  // Apply 3D-style rotations via scale (X rotation = vertical flip)
  const rotX = node.rotationX ?? 0;
  if (rotX !== 0) {
    const radX = (rotX * Math.PI) / 180;
    const scaleYFrom3D = Math.abs(Math.cos(radX));
    ctx.scale(1, scaleYFrom3D);
  }

  // Apply independent scale factors (for icon motion, grow/shrink effects)
  const scaleX = node.scaleX ?? 1;
  const scaleY = node.scaleY ?? 1;
  if (scaleX !== 1 || scaleY !== 1) {
    ctx.scale(scaleX, scaleY);
  }

  // Move back from pivot
  ctx.translate(-pivotWorldX, -pivotWorldY);
}

/**
 * Apply 3D rotation transforms to canvas context (legacy, kept for compatibility)
 * @deprecated Use applyNodeTransform instead for full pivot/scale support
 */
export function apply3DRotation(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  rotationX: number = 0,
  rotationY: number = 0,
  rotationZ: number = 0
): void {
  // Move to center point
  ctx.translate(centerX, centerY);

  // Apply Z rotation (normal 2D rotation) first
  if (rotationZ !== 0) {
    const radZ = (rotationZ * Math.PI) / 180;
    ctx.rotate(radZ);
  }

  // Apply Y rotation (horizontal flip / door opening effect)
  if (rotationY !== 0) {
    const radY = (rotationY * Math.PI) / 180;
    const scaleX = Math.cos(radY);
    // Use absolute value for scale to avoid negative scale issues
    // Negative scale can cause rendering problems in some browsers
    ctx.scale(Math.abs(scaleX), 1);
  }

  // Apply X rotation (vertical flip / card flipping effect)
  if (rotationX !== 0) {
    const radX = (rotationX * Math.PI) / 180;
    const scaleY = Math.cos(radX);
    // Use absolute value for scale to avoid negative scale issues
    ctx.scale(1, Math.abs(scaleY));
  }

  // Move back from center
  ctx.translate(-centerX, -centerY);
}

/**
 * Apply easing function to t with optional intensity
 * @param t - Progress value (0 to 1)
 * @param easing - Easing function name
 * @param intensity - Easing strength multiplier (0.1-3.0, default 1.0)
 *   - 1.0 = normal easing
 *   - > 1.0 = stronger/more dramatic easing
 *   - < 1.0 = softer/closer to linear
 */
export function applyEasing(
  t: number,
  easing: Easing = 'ease',
  intensity: number = 1.0
): number {
  const tClamped = Math.max(0, Math.min(1, t));

  // Calculate the base eased value
  let eased: number;

  switch (easing) {
    case 'linear':
      return tClamped; // Linear ignores intensity
    case 'step':
      // Cut: hold the FROM value across the transition, then snap to TO at the
      // very end. Gives a hard cut between steps instead of interpolation.
      return tClamped >= 1 ? 1 : 0;
    case 'ease':
      // Smooth step (cubic hermite)
      eased = tClamped * tClamped * (3 - 2 * tClamped);
      break;
    case 'ease-in':
      eased = tClamped * tClamped;
      break;
    case 'ease-out':
      eased = tClamped * (2 - tClamped);
      break;
    case 'spring': {
      // Elastic ease-out with bounce effect
      if (tClamped === 0 || tClamped === 1) {
        return tClamped;
      }
      const amplitude = 1;
      // Intensity affects the period (bounciness)
      const period = 0.3 / Math.max(0.5, intensity);
      const s = (period / (2 * Math.PI)) * Math.asin(1 / amplitude);
      eased =
        amplitude *
        Math.pow(2, -10 * tClamped) *
        Math.sin(((tClamped - s) * (2 * Math.PI)) / period) +
        1;
      break;
    }
    case 'bounce': {
      // Bounce easing (like a ball bouncing)
      // Intensity affects bounce height
      const n1 = 7.5625 * Math.max(0.5, intensity);
      const d1 = 2.75;
      let t2 = tClamped;
      if (t2 < 1 / d1) {
        eased = n1 * t2 * t2;
      } else if (t2 < 2 / d1) {
        t2 -= 1.5 / d1;
        eased = n1 * t2 * t2 + 0.75;
      } else if (t2 < 2.5 / d1) {
        t2 -= 2.25 / d1;
        eased = n1 * t2 * t2 + 0.9375;
      } else {
        t2 -= 2.625 / d1;
        eased = n1 * t2 * t2 + 0.984375;
      }
      // Clamp to prevent over-extension
      eased = Math.min(1, eased);
      break;
    }
    case 'elastic': {
      // Elastic overshoot (springs past target then settles)
      if (tClamped === 0 || tClamped === 1) return tClamped;
      // Intensity affects the oscillation frequency
      const c4 = (2 * Math.PI) / 3 * Math.max(0.5, intensity);
      eased = Math.pow(2, -10 * tClamped) * Math.sin((tClamped * 10 - 0.75) * c4) + 1;
      break;
    }
    case 'back': {
      // Back ease-out (overshoots then settles)
      // Intensity affects overshoot amount
      const c1 = 1.70158 * Math.max(0.3, intensity);
      const c3 = c1 + 1;
      const t2 = tClamped - 1;
      eased = 1 + c3 * Math.pow(t2, 3) + c1 * Math.pow(t2, 2);
      break;
    }
    case 'back-in': {
      // Back ease-in (pulls back before moving forward)
      // Intensity affects pullback amount
      const c1 = 1.70158 * Math.max(0.3, intensity);
      const c3 = c1 + 1;
      eased = c3 * tClamped * tClamped * tClamped - c1 * tClamped * tClamped;
      break;
    }
    default:
      eased = tClamped;
      break;
  }

  // For non-spring/bounce/elastic easings, blend between linear and eased based on intensity
  // intensity < 1 = more linear, intensity > 1 = exaggerated easing
  if (easing !== 'spring' && easing !== 'bounce' && easing !== 'elastic' && easing !== 'back' && easing !== 'back-in') {
    if (intensity !== 1.0) {
      // Blend: when intensity=0, result is linear; when intensity=1, result is normal; when intensity>1, exaggerate
      const blendFactor = Math.max(0, Math.min(2, intensity));
      if (blendFactor < 1) {
        // Blend toward linear
        eased = tClamped + (eased - tClamped) * blendFactor;
      } else {
        // Exaggerate the easing effect
        const exaggeration = blendFactor - 1; // 0-1 range
        const diff = eased - tClamped;
        eased = tClamped + diff * (1 + exaggeration);
      }
    }
  }

  return eased;
}

/**
 * Find the nearest progress (0..1) on a path to a given world position.
 * Used for auto-snapping when switching between paths.
 */
export function nearestProgressOnPath(path: Path, position: Vec2): number {
  const points = path.points;
  const cum = path.cum || [];
  const length = path.length || 0;

  if (points.length === 0 || length === 0) {
    return 0;
  }

  if (points.length === 1) {
    return 0;
  }

  let minDist = Infinity;
  let nearestDist = 0;

  // For each segment, find the closest point on that segment
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];

    // Vector from a to b
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const abLen = Math.hypot(ab.x, ab.y);

    if (abLen < 1e-6) {
      // Degenerate segment, just check distance to point a
      const dist = Math.hypot(position.x - a.x, position.y - a.y);
      if (dist < minDist) {
        minDist = dist;
        nearestDist = cum[i - 1];
      }
      continue;
    }

    // Vector from a to position
    const ap = { x: position.x - a.x, y: position.y - a.y };

    // Project ap onto ab: t = (ap · ab) / |ab|²
    const t = (ap.x * ab.x + ap.y * ab.y) / (abLen * abLen);
    const tClamped = Math.max(0, Math.min(1, t));

    // Closest point on segment
    const closest = {
      x: a.x + ab.x * tClamped,
      y: a.y + ab.y * tClamped,
    };

    // Distance to closest point
    const dist = Math.hypot(position.x - closest.x, position.y - closest.y);

    if (dist < minDist) {
      minDist = dist;
      // Interpolate cumulative distance
      nearestDist = cum[i - 1] + tClamped * (cum[i] - cum[i - 1]);
    }
  }

  // Return progress (0..1)
  return nearestDist / length;
}

// ============================================================================
// Group Hierarchy Utilities
// ============================================================================

/**
 * World transform for a node (position + rotation + scale).
 */
export interface WorldTransform {
  x: number;
  y: number;
  rotationX: number;  // Combined 3D X rotation (vertical flip)
  rotationY: number;  // Combined 3D Y rotation (horizontal flip)
  rotationZ: number;  // Combined 2D rotation in degrees
  scaleX: number;     // Combined scale
  scaleY: number;
}

/**
 * Rotate a point around the origin by a given angle (in degrees).
 */
export function rotatePointAroundOrigin(
  x: number,
  y: number,
  angleDegrees: number
): { x: number; y: number } {
  if (angleDegrees === 0) return { x, y };

  const rad = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
}

/**
 * Get the world transform for a node, including inherited rotation and scale from parents.
 * 
 * For children, their local position is transformed by parent's rotation and scale,
 * then added to parent's world position. Rotations and scales accumulate.
 * 
 * @param node - The node to get world transform for
 * @param allNodes - All nodes (needed to find parent)
 * @returns World transform { x, y, rotationZ, scaleX, scaleY }
 */
export function getWorldTransform(
  node: NodeModel,
  allNodes: NodeModel[]
): WorldTransform {
  const nodeRotationX = node.rotationX ?? 0;
  const nodeRotationY = node.rotationY ?? 0;
  const nodeRotationZ = node.rotationZ ?? 0;
  const nodeScaleX = node.scaleX ?? 1;
  const nodeScaleY = node.scaleY ?? 1;

  // If no parent, return node's own transform as world transform
  if (!node.parentId) {
    return {
      x: node.x,
      y: node.y,
      rotationX: nodeRotationX,
      rotationY: nodeRotationY,
      rotationZ: nodeRotationZ,
      scaleX: nodeScaleX,
      scaleY: nodeScaleY,
    };
  }

  const parent = allNodes.find((n) => n.id === node.parentId);
  if (!parent) {
    // Only warn once per unique parent-child combination to avoid spamming every frame
    const warnKey = `${node.parentId}:${node.id}`;
    if (!warnedMissingParents.has(warnKey)) {
      warnedMissingParents.add(warnKey);
      console.warn(`Parent node "${node.parentId}" not found for node "${node.id}"`);
    }
    return {
      x: node.x,
      y: node.y,
      rotationX: nodeRotationX,
      rotationY: nodeRotationY,
      rotationZ: nodeRotationZ,
      scaleX: nodeScaleX,
      scaleY: nodeScaleY,
    };
  }

  // Recursively get parent's world transform
  const parentWorld = getWorldTransform(parent, allNodes);

  // Get parent's rotation pivot point (respects custom pivotX/pivotY)
  // pivotX/pivotY are 0-1 values: 0=left/top, 0.5=center, 1=right/bottom
  const parentPivotX = parent.pivotX ?? 0.5; // Default to center
  const parentPivotY = parent.pivotY ?? 0.5;
  const parentPivotOffsetX = parent.w * parentPivotX;
  const parentPivotOffsetY = parent.h * parentPivotY;

  // Convert child's local position to be relative to parent's pivot point
  const relToPivot = {
    x: node.x - parentPivotOffsetX,
    y: node.y - parentPivotOffsetY,
  };

  // Apply parent's scale to the offset
  const scaled = {
    x: relToPivot.x * parentWorld.scaleX,
    y: relToPivot.y * parentWorld.scaleY,
  };

  // Rotate the offset around parent's pivot (which is at origin in this local system)
  const rotated = rotatePointAroundOrigin(
    scaled.x,
    scaled.y,
    parentWorld.rotationZ
  );

  // Parent's pivot in world coordinates
  // This matches what applyNodeTransform uses: (x + w * pivotX, y + h * pivotY)
  const parentPivotWorld = {
    x: parentWorld.x + parentPivotOffsetX,
    y: parentWorld.y + parentPivotOffsetY,
  };

  // World position = parent pivot world + rotated offset from pivot
  return {
    x: parentPivotWorld.x + rotated.x,
    y: parentPivotWorld.y + rotated.y,
    // Rotations accumulate (additive for all axes)
    rotationX: parentWorld.rotationX + nodeRotationX,
    rotationY: parentWorld.rotationY + nodeRotationY,
    rotationZ: parentWorld.rotationZ + nodeRotationZ,
    // Scales multiply
    scaleX: parentWorld.scaleX * nodeScaleX,
    scaleY: parentWorld.scaleY * nodeScaleY,
  };
}

/**
 * Convert a node's local coordinates to world coordinates.
 * 
 * If the node has a parentId, its x,y are local (relative to parent).
 * This function traverses up the parent chain to compute world position.
 * Now includes parent's rotation and scale in the transformation.
 * 
 * @param node - The node to get world position for
 * @param allNodes - All nodes (needed to find parent)
 * @returns World coordinates { x, y }
 */
export function localToWorld(
  node: NodeModel,
  allNodes: NodeModel[]
): { x: number; y: number } {
  const world = getWorldTransform(node, allNodes);
  return { x: world.x, y: world.y };
}

/**
 * Convert world coordinates to local coordinates relative to a parent.
 * Handles parent's rotation and scale (inverse transformation).
 * Uses center-based rotation to match getWorldTransform.
 * 
 * @param worldX - World X coordinate
 * @param worldY - World Y coordinate
 * @param parent - The parent node
 * @param allNodes - All nodes (needed for nested groups)
 * @returns Local coordinates { x, y } relative to parent
 */
export function worldToLocal(
  worldX: number,
  worldY: number,
  parent: NodeModel,
  allNodes: NodeModel[]
): { x: number; y: number } {
  // Get parent's world transform
  const parentWorld = getWorldTransform(parent, allNodes);

  // Get parent's center point (rotation pivot)
  const parentCenterX = parent.w / 2;
  const parentCenterY = parent.h / 2;

  // Parent's center in world coordinates
  const parentCenterWorld = {
    x: parentWorld.x + parentCenterX,
    y: parentWorld.y + parentCenterY,
  };

  // Get offset from parent's center in world space
  const offsetFromCenter = {
    x: worldX - parentCenterWorld.x,
    y: worldY - parentCenterWorld.y,
  };

  // Inverse rotation (rotate by negative angle)
  const unrotated = rotatePointAroundOrigin(
    offsetFromCenter.x,
    offsetFromCenter.y,
    -parentWorld.rotationZ
  );

  // Inverse scale (divide by parent's scale)
  const scaleX = parentWorld.scaleX || 1;
  const scaleY = parentWorld.scaleY || 1;

  const unscaled = {
    x: unrotated.x / scaleX,
    y: unrotated.y / scaleY,
  };

  // Convert back from center-relative to top-left-relative (local coords)
  return {
    x: unscaled.x + parentCenterX,
    y: unscaled.y + parentCenterY,
  };
}

/**
 * Get all direct children of a group node.
 * 
 * @param groupId - The group node ID
 * @param nodes - All nodes
 * @returns Array of child nodes
 */
export function getGroupChildren(
  groupId: string,
  nodes: NodeModel[]
): NodeModel[] {
  return nodes.filter((n) => n.parentId === groupId);
}

/**
 * Get all descendants of a group (recursive, includes nested groups' children).
 * 
 * @param groupId - The group node ID
 * @param nodes - All nodes
 * @returns Array of all descendant nodes
 */
export function getGroupDescendants(
  groupId: string,
  nodes: NodeModel[]
): NodeModel[] {
  const directChildren = getGroupChildren(groupId, nodes);
  const descendants: NodeModel[] = [];

  for (const child of directChildren) {
    descendants.push(child);
    if (child.kind === 'group') {
      descendants.push(...getGroupDescendants(child.id, nodes));
    }
  }

  return descendants;
}

/**
 * Get the world-space bounding box of a node, accounting for parent transforms.
 * 
 * @param node - The node
 * @param allNodes - All nodes
 * @returns Bounding box { x, y, w, h } in world coordinates
 */
export function getWorldBounds(
  node: NodeModel,
  allNodes: NodeModel[]
): { x: number; y: number; w: number; h: number } {
  const worldPos = localToWorld(node, allNodes);
  return {
    x: worldPos.x,
    y: worldPos.y,
    w: node.w,
    h: node.h,
  };
}
