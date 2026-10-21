/* eslint-disable -- New file */
import type { NodeModel } from '../types';
import { isRtlText } from './text-direction';
import { tokenize, DEFAULT_SYNTAX_COLORS, type SyntaxStyle } from './syntax-tokenize';
import { drawWriteHand, isManagedHandSuppressed } from './write-hand-asset';

/**
 * Break text into lines that fit within maxWidth
 * Supports word wrap, char wrap, ellipsis, and clip modes
 */
export function breakLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  wrap: 'word' | 'char' | 'ellipsis' | 'clip' = 'word'
): string[] {
  if (!text) return [];
  if (maxWidth <= 0) return [text];

  // Convert tabs to spaces (4 spaces per tab) for consistent rendering
  const normalizedText = text.replace(/\t/g, '    ');

  const lines: string[] = [];
  const paragraphs = normalizedText.split('\n');

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }

    if (wrap === 'clip') {
      // Just add the line as-is, no breaking
      lines.push(paragraph);
      continue;
    }

    if (wrap === 'ellipsis') {
      // Single line with ellipsis if too long
      const measured = ctx.measureText(paragraph);
      if (measured.width <= maxWidth) {
        lines.push(paragraph);
      } else {
        // Binary search for the longest prefix that fits with '...'
        let left = 0;
        let right = paragraph.length;
        let bestFit = '';

        while (left <= right) {
          const mid = Math.floor((left + right) / 2);
          const candidate = paragraph.substring(0, mid) + '...';
          const width = ctx.measureText(candidate).width;

          if (width <= maxWidth) {
            bestFit = candidate;
            left = mid + 1;
          } else {
            right = mid - 1;
          }
        }

        lines.push(bestFit || '...');
      }
      continue;
    }

    // Word wrap or char wrap
    if (wrap === 'word') {
      // Preserve leading whitespace (indentation)
      const leadingWhitespaceMatch = paragraph.match(/^(\s+)/);
      const leadingWhitespace = leadingWhitespaceMatch ? leadingWhitespaceMatch[1] : '';
      const contentAfterLeading = leadingWhitespaceMatch 
        ? paragraph.slice(leadingWhitespace.length) 
        : paragraph;
      
      // Split by whitespace but keep track of it
      // Use a regex that captures whitespace between words
      const tokens = contentAfterLeading.split(/(\s+)/);
      let currentLine = leadingWhitespace;

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (!token) continue;
        
        // Check if this token is whitespace
        const isWhitespace = /^\s+$/.test(token);
        
        if (isWhitespace) {
          // Add whitespace to current line
          const testLine = currentLine + token;
          const testWidth = ctx.measureText(testLine).width;
          if (testWidth <= maxWidth) {
            currentLine = testLine;
          }
          // If whitespace doesn't fit, just skip it (line break happened)
        } else {
          // This is a word
          const testLine = currentLine + token;
          const testWidth = ctx.measureText(testLine).width;

          if (testWidth <= maxWidth) {
            currentLine = testLine;
          } else {
            if (currentLine.trim()) {
              lines.push(currentLine);
            }
            // If single word is too long, break it by characters
            if (ctx.measureText(token).width > maxWidth) {
              const charLines = breakLineByChars(ctx, token, maxWidth);
              lines.push(...charLines.slice(0, -1));
              currentLine = charLines[charLines.length - 1];
            } else {
              currentLine = token;
            }
          }
        }
      }

      if (currentLine) {
        lines.push(currentLine);
      }
    } else if (wrap === 'char') {
      // Break by characters
      lines.push(...breakLineByChars(ctx, paragraph, maxWidth));
    }
  }

  return lines;
}

/**
 * Break a string into lines by characters when it doesn't fit
 */
function breakLineByChars(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  let currentLine = '';

  for (const char of text) {
    const testLine = currentLine + char;
    const testWidth = ctx.measureText(testLine).width;

    if (testWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = char;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Calculate the total height of text lines
 * Note: The last line doesn't need trailing "leading" space,
 * so we use: (lineCount - 1) * lineSpacing + fontSize
 */
export function calculateTextHeight(
  lineCount: number,
  fontSize: number,
  lineHeight: number = 1.2
): number {
  if (lineCount === 0) return 0;
  if (lineCount === 1) return fontSize; // Single line = just the glyph height
  // Multiple lines: each line except the last has lineHeight spacing
  return (lineCount - 1) * fontSize * lineHeight + fontSize;
}

/**
 * Draw text node with all formatting
 */
export function drawTextNode(
  ctx: CanvasRenderingContext2D,
  node: NodeModel,
  timeMs?: number,        // SCENE time — drives count-up + deterministic caret in export
  wallClockMs?: number,   // optional wall clock — editor passes this so the caret
                          // blinks live while paused without breaking the scene-timed count
): void {
  if (!node.text || node.kind !== 'text') return;

  // Typewriter reveal: when typeProgress is set (<1), draw only the leading
  // slice of the text, plus a blinking block caret. Sizing/wrapping still use
  // the full text (autofit below) so the box doesn't reflow as it types.
  const fullText = node.text;
  const typeProgress = node.typeProgress;
  const isTyping = typeof typeProgress === 'number' && typeProgress < 1;
  let text = isTyping
    ? fullText.slice(0, Math.max(0, Math.ceil((typeProgress as number) * fullText.length)))
    : fullText;
  // Caret: solid when no time supplied; blinks (~530ms) when a scene/wall clock
  // is available, so it's deterministic in export and lively in preview.
  const caretClock = wallClockMs ?? timeMs; // wall clock in editor, scene time in export
  // `hideCaret` (opt-in) suppresses the block caret — e.g. whiteboard write-on where
  // a hand asset sits at the write point and a caret would read as clutter. Default
  // (undefined/false) keeps the caret exactly as before.
  // A hand writing the line implies it: the nib already marks the write point, so a caret
  // there is the same information twice, in two different metaphors. Every template that
  // turns on `writeHand` already sets `hideCaret` beside it, but the editor's own "Write
  // with hand" toggle does not, and neither do docs saved before it existed.
  const caretHidden = node.hideCaret || (node as { writeHand?: boolean }).writeHand === true;
  if (isTyping && !caretHidden && (caretClock === undefined || Math.floor(caretClock / 530) % 2 === 0)) {
    text = text + '█'; // █ block caret
  }

  // Count-up: a numeric value animates 0 → countTo over countDurationMs starting
  // at countStartMs (scene time). Static props → purely time-based, so it needs
  // no tween and naturally persists (clamps to countTo after). Overrides `text`;
  // node.text holds the final value so autofit sizes for the widest string.
  const countTo = (node as { countTo?: number }).countTo;
  if (typeof countTo === 'number') {
    const n = node as { countStartMs?: number; countDurationMs?: number; countIsInt?: boolean; countSuffix?: string; countFrom?: number; countPrefix?: string };
    const startMs = n.countStartMs ?? 0;
    const durMs = n.countDurationMs ?? 800;
    const from = n.countFrom ?? 0; // count 0→N by default; countFrom enables count-down (e.g. 14→4)
    const prog = timeMs === undefined ? 1 : Math.max(0, Math.min(1, (timeMs - startMs) / durMs));
    const eased = 1 - Math.pow(1 - prog, 3); // easeOut
    const v = from + (countTo - from) * eased;
    const num = n.countIsInt === false ? v.toFixed(1) : Math.round(v).toLocaleString('en-US');
    text = (n.countPrefix ?? '') + num + (n.countSuffix ?? '');
  }

  const {
    x,
    y,
    w,
    h,
    fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial',
    fontWeight = 400,
    fontStyle = 'normal',
    fontSize: baseFontSize = 16,
    lineHeight = 1.2,
    letterSpacing = 0,
    color = '#e6edf3',
    textStroke,
    textStrokeWidth,
    textShadow,
    textAlign = 'center',
    verticalAlign = 'top',
    wrap = 'word',
    autoFit = 'none',
    highlightedLines,
    highlightLineColor = 'rgba(255, 235, 59, 0.25)',
    syntaxStyle = 'none' as SyntaxStyle,
    syntaxColors,
  } = node;
  const effectiveSyntaxColors = { ...DEFAULT_SYNTAX_COLORS, ...(syntaxColors || {}) };
  const useSyntax = syntaxStyle && syntaxStyle !== 'none';

  ctx.save();

  // Determine final font size (with auto-fit)
  let fontSize = baseFontSize;
  if (autoFit === 'shrink') {
    fontSize = calculateShrinkToFitSize(
      ctx,
      fullText, // size to full text so the box doesn't reflow while typing
      w,
      h,
      baseFontSize,
      lineHeight,
      fontFamily,
      fontWeight,
      fontStyle,
      letterSpacing,
      wrap
    );
  }

  // Set font
  const fontStr = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.font = fontStr;
  ctx.textBaseline = 'top';

  if (letterSpacing !== 0) {
    (ctx as any).letterSpacing = `${letterSpacing}px`;
  }

  // Proportional padding that scales with font size
  const padding = fontSize * 0.15; // 15% of font size
  const horizontalPadding = padding * 2; // left + right

  // Break text into lines
  const lines = breakLines(ctx, text, w - horizontalPadding, wrap);
  // While typing, each line is positioned where its FULL line will end up, and the visible
  // slice hangs off that line's START edge: the left edge for a left-to-right script, the RIGHT
  // edge for Arabic/Hebrew. Positioning the partial slice by its own width (the old behaviour)
  // re-centred a centred line every frame and, for a right-to-left script, pushed every letter
  // already on the board to the right as the next one arrived, so the title read as sliding in
  // from the left instead of being written.
  const fullLines = isTyping ? breakLines(ctx, fullText, w - horizontalPadding, wrap) : lines;

  // Calculate total text height
  const totalTextHeight = calculateTextHeight(lines.length, fontSize, lineHeight);

  // Position the text block vertically within the box per verticalAlign (top default).
  // Falls back to top padding when the text is taller than the box.
  let startY = y + padding;
  if (verticalAlign === 'middle') {
    startY = y + Math.max(padding, (h - totalTextHeight) / 2);
  } else if (verticalAlign === 'bottom') {
    startY = y + Math.max(padding, h - totalTextHeight - padding);
  }

  const hasHighlights = Array.isArray(highlightedLines) && highlightedLines.length > 0;
  const highlightSet = hasHighlights ? new Set(highlightedLines) : null;

  // Write-on hand: track the right edge of the last visible (non-empty) line so the
  // marker nib can sit exactly where the text is being written. Only used when the node
  // opts in via `writeHand` and is mid type-on.
  const wantHand = isTyping && (node as { writeHand?: boolean }).writeHand === true;
  let penEdgeX: number | null = null;
  let penEdgeY = 0;

  // Draw each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineY = startY + i * fontSize * lineHeight;

    // Skip if line is outside bounds
    if (lineY > y + h) break;

    // Highlight background for this line (drawn before text)
    if (highlightSet && highlightSet.has(i)) {
      ctx.save();
      ctx.fillStyle = highlightLineColor;
      // Highlight spans the full text width with a small inset
      const hlInset = padding * 0.5;
      const hlH = fontSize * lineHeight;
      ctx.fillRect(x + hlInset, lineY - 1, w - hlInset * 2, hlH);
      ctx.restore();
    }

    // Calculate horizontal position based on textAlign, from the FULL line this slice belongs
    // to (the slice is a prefix of it while typing; identical once settled).
    const bare = line.endsWith('\u2588') ? line.slice(0, -1) : line;
    const full = fullLines[i];
    const anchorLine = isTyping && full && full.startsWith(bare) ? full : line;
    const anchorWidth = ctx.measureText(anchorLine).width;
    const lineWidth = anchorLine === line ? anchorWidth : ctx.measureText(line).width;
    let lineX = x + padding;
    if (textAlign === 'center') {
      lineX = x + (w - anchorWidth) / 2;
    } else if (textAlign === 'right') {
      lineX = x + w - anchorWidth - padding;
    }
    const rtl = isRtlText(anchorLine);
    const drawX = rtl ? lineX + anchorWidth - lineWidth : lineX;

    // Apply shadow
    if (textShadow) {
      ctx.shadowOffsetX = textShadow.x;
      ctx.shadowOffsetY = textShadow.y;
      ctx.shadowBlur = textShadow.blur;
      ctx.shadowColor = textShadow.color;
    }

    // Draw stroke (always full-line — strokes don't get token colors)
    if (textStroke && textStrokeWidth) {
      ctx.strokeStyle = textStroke;
      ctx.lineWidth = textStrokeWidth;
      ctx.strokeText(line, drawX, lineY);
    }

    // Draw fill — token-colored if syntax mode is on, otherwise plain
    if (useSyntax) {
      const tokens = tokenize(line, syntaxStyle as SyntaxStyle);
      let cursor = 0;
      let segX = drawX;
      const flush = (text: string, fillColor: string) => {
        if (!text) return;
        ctx.fillStyle = fillColor;
        ctx.fillText(text, segX, lineY);
        segX += ctx.measureText(text).width;
      };
      for (const token of tokens) {
        // Plain segment before this token
        if (token.start > cursor) {
          flush(line.slice(cursor, token.start), color);
        }
        // The token itself
        const tokenColor =
          (effectiveSyntaxColors as Record<string, string>)[token.kind] || color;
        flush(line.slice(token.start, token.end), tokenColor);
        cursor = token.end;
      }
      // Trailing plain segment
      if (cursor < line.length) {
        flush(line.slice(cursor), color);
      }
    } else {
      ctx.fillStyle = color;
      ctx.fillText(line, drawX, lineY);
    }

    // Reset shadow
    if (textShadow) {
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.shadowBlur = 0;
    }

    // Remember where this line ends — the write-on nib rides the last visible line.
    // (For a right-to-left script the newest letter is the LEFT end of the slice.)
    if (wantHand && line.length > 0) {
      penEdgeX = rtl ? drawX : drawX + lineWidth;
      penEdgeY = lineY;
    }
  }

  // Draw the writing hand at the current leading edge. Nib at ~0.5 of the font box (mid-glyph)
  // so the scribble jitter oscillates ON the text rather than dipping below it.
  if (wantHand && penEdgeX !== null) {
    // Record the exact leading edge so a scene-level continuous hand (handTrack) can sit ON
    // the text as it types, instead of a linear estimate that lags. Draw the per-node hand
    // only when NOT handManaged (the track owns the hand for managed nodes).
    // `fs` is the EFFECTIVE font size (post autoFit), carried along so the scene-level hand can
    // size itself to the type it is writing. Without it that hand assumes a heading every time and
    // a marker fit for 32px type lands on a 17px chapter title, covering half the frame.
    (node as { __penPt?: { x: number; y: number; fs?: number } }).__penPt =
      { x: penEdgeX, y: penEdgeY + fontSize * 0.5, fs: fontSize };
    // Draw the per-node hand UNLESS the scene-level continuous hand is handling this node.
    if (!((node as { handManaged?: boolean }).handManaged && isManagedHandSuppressed())) {
      drawWriteHand(ctx, penEdgeX, penEdgeY + fontSize * 0.5, fontSize, caretClock, 0.5, 5);
    }
  }

  ctx.restore();
}

/**
 * Calculate font size for shrink-to-fit
 * Uses binary search to find the largest size that fits
 */
function calculateShrinkToFitSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxHeight: number,
  baseFontSize: number,
  lineHeight: number,
  fontFamily: string,
  fontWeight: number,
  fontStyle: string,
  letterSpacing: number,
  wrap: 'word' | 'char' | 'ellipsis' | 'clip'
): number {
  let minSize = 4;
  // Allow growing up to 2x the base font size to better utilize space
  let maxSize = Math.max(baseFontSize * 2, 200);
  let bestSize = minSize;

  // Binary search for the largest font size that fits
  while (minSize <= maxSize) {
    const midSize = Math.floor((minSize + maxSize) / 2);

    // Test this font size
    ctx.save();
    ctx.font = `${fontStyle} ${fontWeight} ${midSize}px ${fontFamily}`;
    if (letterSpacing !== 0) {
      (ctx as any).letterSpacing = `${letterSpacing}px`;
    }

    const lines = breakLines(ctx, text, maxWidth - 8, wrap);
    const textHeight = calculateTextHeight(lines.length, midSize, lineHeight);

    // Every LINE the break produced must fit the box. Height alone is not enough,
    // because breakLines only wraps in the wrap modes that CAN wrap: under 'clip'
    // and 'ellipsis' it hands back the whole string as one line however wide that
    // line is, so the height test sees a single line and happily grows the font
    // until one line fills the box's height. That is what blew a table of 15px
    // cells up to ~43px: each cell is 60 tall, one line at 43px is 52 tall and
    // "fits", and the 360-wide cell then clipped "Inert, abundant in atmosphere"
    // at both edges. Measuring the lines themselves makes the width a real
    // constraint in every wrap mode.
    let widestLine = 0;
    for (const ln of lines) {
      const lw = ctx.measureText(ln).width;
      if (lw > widestLine) widestLine = lw;
    }

    // The widest unbreakable WORD must also fit on one line. Without this the
    // search only checks wrapped HEIGHT, so a single token that's too wide gets
    // force-broken mid-word ("2019"->"201"/"9", "Approved"->"Approve"/"d",
    // "Specialist"->"Speci"/"alist"). Requiring the longest word to fit shrinks
    // the font until it sits on one line instead — killing mid-word breaks while
    // still letting genuine multi-word text wrap at the spaces.
    let widestWord = 0;
    for (const wd of text.split(/\s+/)) {
      const ww = ctx.measureText(wd).width;
      if (ww > widestWord) widestWord = ww;
    }

    ctx.restore();

    if (textHeight <= maxHeight - 8 && widestWord <= maxWidth - 8 && widestLine <= maxWidth - 8) {
      // Fits! Try larger
      bestSize = midSize;
      minSize = midSize + 1;
    } else {
      // Too big, try smaller
      maxSize = midSize - 1;
    }
  }

  return bestSize;
}

/**
 * Get text metrics for a node (for hit testing, etc.)
 */
export function getTextMetrics(
  ctx: CanvasRenderingContext2D,
  node: NodeModel
): { lines: string[]; fontSize: number; totalHeight: number } {
  if (!node.text || node.kind !== 'text') {
    return { lines: [], fontSize: 0, totalHeight: 0 };
  }

  const {
    w,
    h,
    text,
    fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial',
    fontWeight = 400,
    fontStyle = 'normal',
    fontSize: baseFontSize = 16,
    lineHeight = 1.2,
    letterSpacing = 0,
    wrap = 'word',
    autoFit = 'none',
  } = node;

  ctx.save();

  let fontSize = baseFontSize;
  if (autoFit === 'shrink') {
    fontSize = calculateShrinkToFitSize(
      ctx,
      text,
      w,
      h,
      baseFontSize,
      lineHeight,
      fontFamily,
      fontWeight,
      fontStyle,
      letterSpacing,
      wrap
    );
  }

  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
  if (letterSpacing !== 0) {
    (ctx as any).letterSpacing = `${letterSpacing}px`;
  }

  const lines = breakLines(ctx, text, w - 8, wrap);
  const totalHeight = calculateTextHeight(lines.length, fontSize, lineHeight);

  ctx.restore();

  return { lines, fontSize, totalHeight };
}

/**
 * Robustly extract text from a contentEditable element
 * Handles browser inconsistencies with newlines (divs, brs, p tags)
 */
export function extractTextFromElement(element: HTMLElement): string {
  let text = '';
  let isBlockStart = true;

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const content = node.textContent || '';
      if (content) {
        text += content;
        isBlockStart = false;
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tagName = el.tagName.toLowerCase();

      if (tagName === 'br') {
        text += '\n';
        isBlockStart = true;
      } else {
        // Block elements that imply a new line
        const isBlock = [
          'div',
          'p',
          'li',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'section',
          'article',
        ].includes(tagName);

        if (isBlock) {
          // If starting a new block and we have previous text that doesn't end in newline, add one
          if (!isBlockStart && text.length > 0 && !text.endsWith('\n')) {
            text += '\n';
          }
          isBlockStart = true;
        }

        for (let i = 0; i < node.childNodes.length; i++) {
          walk(node.childNodes[i]);
        }
      }
    }
  }

  walk(element);
  return text;
}

/**
 * Draw a label for icon/svg/lottie/image nodes with overflow support.
 * When overflow is 'visible' (default): word-wraps at wrapWidth, extends below node.
 * When overflow is 'ellipsis': single-line truncated with ellipsis.
 * ctx.font, ctx.fillStyle, ctx.textAlign, ctx.textBaseline must be set by caller.
 */
export function drawIconLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  centerX: number,
  startY: number,
  wrapWidth: number,
  lineHeight: number,
  overflow: 'visible' | 'ellipsis',
): void {
  if (overflow === 'ellipsis') {
    let truncated = label;
    const maxW = wrapWidth;
    if (ctx.measureText(truncated).width > maxW) {
      while (truncated.length > 1 && ctx.measureText(truncated + '\u2026').width > maxW) {
        truncated = truncated.slice(0, -1);
      }
      truncated = truncated + '\u2026';
    }
    ctx.fillText(truncated, centerX, startY);
    return;
  }

  // Word-wrap: split into lines that fit within wrapWidth
  const words = label.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';
  for (const word of words) {
    const testLine = currentLine ? currentLine + ' ' + word : word;
    if (ctx.measureText(testLine).width > wrapWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], centerX, startY + i * lineHeight);
  }
}

/**
 * Draw a wrapped node label within the node bounds.
 * Supports word wrapping for labels that overflow the node width.
 * Respects textAlign (left/center/right) and verticalAlign (top/middle/bottom).
 */
export function drawWrappedNodeLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  nodeX: number,
  nodeY: number,
  nodeW: number,
  nodeH: number,
  options: {
    labelColor?: string;
    labelSize?: number;
    labelWeight?: string;
    labelStyle?: string;
    labelFont?: string;
    padding?: number;
    textAlign?: 'left' | 'center' | 'right';
    verticalAlign?: 'top' | 'middle' | 'bottom';
    labelTextAlign?: 'left' | 'center' | 'right'; // Text alignment within multi-line labels
    labelRotation?: number; // Rotation in degrees around the node center
    insetScale?: number; // Shrink the layout box toward center (e.g. diamond's inscribed rect)
  } = {}
): void {
  if (!label) return;

  const {
    labelColor = '#e6edf3',
    labelSize = 14,
    labelWeight = '600',
    labelStyle = '',
    labelFont = 'system-ui',
    padding = 10,
    textAlign = 'center',
    verticalAlign = 'middle',
    labelTextAlign, // If not set, falls back to textAlign for backwards compatibility
    labelRotation = 0,
    insetScale = 1,
  } = options;

  // For multi-line labels, use labelTextAlign if provided, otherwise fall back to textAlign
  const effectiveTextAlign = labelTextAlign ?? textAlign;

  ctx.save();

  // Apply rotation around the node's center. For quarter turns (±90, 270)
  // swap the effective layout dims so wrap width tracks the long axis —
  // this is how vertical labels in tall narrow rects read cleanly without
  // mid-word wraps.
  const rot = labelRotation || 0;
  let lx = nodeX;
  let ly = nodeY;
  let lw = nodeW;
  let lh = nodeH;
  if (rot !== 0) {
    const cx = nodeX + nodeW / 2;
    const cy = nodeY + nodeH / 2;
    ctx.translate(cx, cy);
    ctx.rotate((rot * Math.PI) / 180);
    const isQuarter = ((Math.round(rot) % 180) + 180) % 180 === 90;
    lw = isQuarter ? nodeH : nodeW;
    lh = isQuarter ? nodeW : nodeH;
    lx = -lw / 2;
    ly = -lh / 2;
  }

  // Tapered shapes (insetScale < 1, e.g. a diamond) are WIDEST at the vertical
  // center, so a label that fits on ONE line can use most of the full width even
  // though a wrapped multi-line block can't. Try the single-line-at-center path
  // first: it keeps short decision labels at a readable size. Only if the label
  // doesn't fit one line do we fall back to the tight inscribed-rectangle inset
  // (corners on the rhombus edges), where wrap + font-shrink guarantee no spill.
  if (insetScale > 0 && insetScale < 1 && !label.includes('\n')) {
    ctx.save();
    ctx.font = `${labelStyle}${labelWeight} ${labelSize}px ${labelFont}, -apple-system, Segoe UI, Roboto, Arial`;
    const centerAvail = lw * 0.84 - padding * 2;
    const oneLineW = ctx.measureText(label).width;
    ctx.restore();
    if (oneLineW <= centerAvail) {
      ctx.fillStyle = labelColor;
      ctx.font = `${labelStyle}${labelWeight} ${labelSize}px ${labelFont}, -apple-system, Segoe UI, Roboto, Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + lw / 2, ly + lh / 2);
      ctx.restore();
      return;
    }
  }

  // Inset the layout box to the inscribed rectangle (corners on the edges) for
  // the wrapped case, so multi-line text stays inside the tapered shape.
  if (insetScale > 0 && insetScale < 1) {
    const iw = lw * insetScale;
    const ih = lh * insetScale;
    lx += (lw - iw) / 2;
    ly += (lh - ih) / 2;
    lw = iw;
    lh = ih;
  }

  ctx.fillStyle = labelColor;
  ctx.font = `${labelStyle}${labelWeight} ${labelSize}px ${labelFont}, -apple-system, Segoe UI, Roboto, Arial`;
  ctx.textBaseline = 'middle';

  // Calculate available width for text (with padding)
  const availableWidth = lw - padding * 2;

  // Shrink the font so the widest single WORD fits one line. Node labels use a
  // FIXED size and then wrap, so a too-wide single token gets force-broken
  // mid-word ("Approved"->"Approve"/"d"). Shrinking instead keeps it whole.
  let drawSize = labelSize;
  {
    let widest = 0;
    for (const wd of label.split(/\s+/)) {
      const ww = ctx.measureText(wd).width;
      if (ww > widest) widest = ww;
    }
    if (widest > availableWidth && widest > 0) {
      drawSize = Math.max(9, Math.floor(labelSize * (availableWidth / widest)));
      ctx.font = `${labelStyle}${labelWeight} ${drawSize}px ${labelFont}, -apple-system, Segoe UI, Roboto, Arial`;
    }
  }

  // Check if label fits on a single line AND has no newlines
  const hasNewlines = label.includes('\n');
  const singleLineWidth = ctx.measureText(label).width;

  if (!hasNewlines && singleLineWidth <= availableWidth) {
    // Single line - use textAlign for both position and alignment
    ctx.textAlign = textAlign;

    // Calculate X position based on textAlign
    let textX: number;
    switch (textAlign) {
      case 'left':
        textX = lx + padding;
        break;
      case 'right':
        textX = lx + lw - padding;
        break;
      case 'center':
      default:
        textX = lx + lw / 2;
        break;
    }

    // Calculate Y based on verticalAlign
    let textY: number;
    switch (verticalAlign) {
      case 'top':
        textY = ly + padding + drawSize / 2;
        break;
      case 'bottom':
        textY = ly + lh - padding - drawSize / 2;
        break;
      case 'middle':
      default:
        textY = ly + lh / 2;
        break;
    }
    ctx.fillText(label, textX, textY);
  } else {
    // Multi-line rendering:
    // 1. Position the TEXT BLOCK based on textAlign/verticalAlign (Position grid)
    // 2. Align text WITHIN that block based on effectiveTextAlign (Align control)

    let lines = breakLines(ctx, label, availableWidth, 'word');
    let lineHeight = drawSize * 1.2;
    let totalTextHeight = lines.length * lineHeight;
    // Vertical fit: if the wrapped block is taller than the (possibly inset) box,
    // shrink the font so it fits — otherwise lines spill past the top/bottom (a
    // diamond's points, a short rect). Re-wrap at the smaller size; the floor (9px)
    // keeps it legible even when the shape is genuinely too small.
    const availableHeight = lh - padding * 2;
    if (totalTextHeight > availableHeight && availableHeight > 0) {
      const vScale = availableHeight / totalTextHeight;
      drawSize = Math.max(9, Math.floor(drawSize * vScale));
      ctx.font = `${labelStyle}${labelWeight} ${drawSize}px ${labelFont}, -apple-system, Segoe UI, Roboto, Arial`;
      lines = breakLines(ctx, label, availableWidth, 'word');
      lineHeight = drawSize * 1.2;
      totalTextHeight = lines.length * lineHeight;
    }
    const maxLineWidth = Math.max(...lines.map(line => ctx.measureText(line).width), 0);

    // Calculate text block position based on Position grid (textAlign/verticalAlign)
    let blockX: number;
    switch (textAlign) {
      case 'left':
        blockX = lx + padding;
        break;
      case 'right':
        blockX = lx + lw - padding - maxLineWidth;
        break;
      case 'center':
      default:
        blockX = lx + (lw - maxLineWidth) / 2;
        break;
    }

    let blockY: number;
    switch (verticalAlign) {
      case 'top':
        blockY = ly + padding;
        break;
      case 'bottom':
        blockY = ly + lh - padding - totalTextHeight;
        break;
      case 'middle':
      default:
        blockY = ly + (lh - totalTextHeight) / 2;
        break;
    }

    // Set text alignment for drawing within the block
    ctx.textAlign = effectiveTextAlign;

    // Draw each line, aligned within the block based on effectiveTextAlign
    for (let i = 0; i < lines.length; i++) {
      const lineY = blockY + i * lineHeight + lineHeight / 2;

      // Calculate X position within the block based on effectiveTextAlign
      let lineX: number;
      switch (effectiveTextAlign) {
        case 'left':
          lineX = blockX;
          break;
        case 'right':
          lineX = blockX + maxLineWidth;
          break;
        case 'center':
        default:
          lineX = blockX + maxLineWidth / 2;
          break;
      }

      // Only draw if line is within node bounds (with some tolerance)
      if (lineY >= ly - lineHeight && lineY <= ly + lh + lineHeight) {
        ctx.fillText(lines[i], lineX, lineY);
      }
    }
  }

  ctx.restore();
}

