/**
 * Drawing on a shared screen. Both sides can annotate either screen; strokes
 * travel as control messages (lib/transfer/protocol) and every coordinate is
 * normalised to the shared picture (0–1 across its width and height), so a
 * stroke lands on the same spot whatever size each side shows it at.
 */

export type InkTool = 'pen' | 'marker' | 'line' | 'arrow' | 'rect' | 'ellipse';
export const INK_TOOLS: readonly InkTool[] = ['pen', 'marker', 'line', 'arrow', 'rect', 'ellipse'];
/** Tools that make a shape from two points (start, end) rather than a path. */
export const SHAPE_TOOLS: readonly InkTool[] = ['line', 'arrow', 'rect', 'ellipse'];

export type InkSize = 1 | 2 | 3;
export const INK_SIZES: readonly InkSize[] = [1, 2, 3];

export const INK_COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#0a84ff', '#af52de', '#ffffff', '#1d1d1f'] as const;

export interface Stroke {
  id: string;
  tool: InkTool;
  color: string;
  size: InkSize;
  /** Flat x, y pairs, normalised to the picture. Shapes have exactly two points. */
  pts: number[];
}

/** Which screen a stroke is on, as seen by this device. */
export type Surface = 'local' | 'remote';

export const MAX_POINTS = 1500;
export const MAX_STROKES = 400;
/** Line width per size step, as a fraction of the picture's height. */
const WIDTH = { 1: 0.0028, 2: 0.0055, 3: 0.011 } as const;

const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
/** A little outside the picture is fine (a stroke that ran off the edge). */
const isCoord = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= -0.5 && v <= 1.5;

/** Validates a stroke from the other side; returns null if it's malformed. */
export function parseStroke(v: unknown): Stroke | null {
  if (typeof v !== 'object' || v === null) return null;
  const { id, tool, color, size, pts } = v as Record<string, unknown>;
  if (!isId(id) || !INK_TOOLS.includes(tool as InkTool) || !INK_SIZES.includes(size as InkSize)) return null;
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return null;
  if (!Array.isArray(pts) || pts.length < 2 || pts.length % 2 !== 0 || pts.length > MAX_POINTS * 2) return null;
  if (SHAPE_TOOLS.includes(tool as InkTool) && pts.length !== 4) return null;
  if (!pts.every(isCoord)) return null;
  return { id, tool: tool as InkTool, color, size: size as InkSize, pts: pts as number[] };
}

/** Four decimals: well under a pixel even on a 4K picture, and short on the wire. */
export const roundCoord = (v: number) => Math.round(v * 10_000) / 10_000;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a picture of `aspect` (width / height) sits inside a box when shown with object-fit: contain. */
export function containRect(boxW: number, boxH: number, aspect: number): Rect {
  if (!boxW || !boxH || !aspect) return { x: 0, y: 0, w: boxW, h: boxH };
  if (boxW / boxH > aspect) {
    const w = boxH * aspect;
    return { x: (boxW - w) / 2, y: 0, w, h: boxH };
  }
  const h = boxW / aspect;
  return { x: 0, y: (boxH - h) / 2, w: boxW, h };
}

export function strokeWidth(stroke: Pick<Stroke, 'tool' | 'size'>, rect: Rect): number {
  const base = Math.max(1.5, WIDTH[stroke.size] * rect.h);
  return stroke.tool === 'marker' ? base * 4 : base;
}

/** Draws strokes onto a 2D context; `rect` is where the picture is in that context. */
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[], rect: Rect): void {
  for (const s of strokes) drawStroke(ctx, s, rect);
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, rect: Rect): void {
  const px = (i: number) => rect.x + s.pts[i]! * rect.w;
  const py = (i: number) => rect.y + s.pts[i + 1]! * rect.h;
  const width = strokeWidth(s, rect);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  if (s.tool === 'marker') ctx.globalAlpha = 0.38;
  // A soft dark halo keeps light colours readable on light screens and vice versa.
  if (s.tool !== 'marker') {
    ctx.shadowColor = 'rgb(0 0 0 / 35%)';
    ctx.shadowBlur = Math.min(6, width);
  }
  ctx.beginPath();
  if (s.tool === 'pen' || s.tool === 'marker') {
    const n = s.pts.length / 2;
    ctx.moveTo(px(0), py(0));
    if (n === 1) {
      ctx.lineTo(px(0) + 0.01, py(0));
    } else {
      // Quadratic curves through the midpoints: smooth without overshooting.
      for (let i = 1; i < n - 1; i++) {
        const mx = (px(i * 2) + px(i * 2 + 2)) / 2;
        const my = (py(i * 2) + py(i * 2 + 2)) / 2;
        ctx.quadraticCurveTo(px(i * 2), py(i * 2), mx, my);
      }
      ctx.lineTo(px((n - 1) * 2), py((n - 1) * 2));
    }
    ctx.stroke();
  } else {
    const [x0, y0, x1, y1] = [px(0), py(0), px(2), py(2)];
    if (s.tool === 'line' || s.tool === 'arrow') {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      if (s.tool === 'arrow') {
        const angle = Math.atan2(y1 - y0, x1 - x0);
        const head = Math.max(10, width * 4);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - head * Math.cos(angle - Math.PI / 7), y1 - head * Math.sin(angle - Math.PI / 7));
        ctx.lineTo(x1 - head * Math.cos(angle + Math.PI / 7), y1 - head * Math.sin(angle + Math.PI / 7));
        ctx.closePath();
        ctx.fill();
      }
    } else if (s.tool === 'rect') {
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    } else {
      ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** The topmost stroke within `tolerance` (normalised) of a point, for the eraser. */
export function hitStroke(strokes: readonly Stroke[], x: number, y: number, tolerance: number): Stroke | null {
  for (let k = strokes.length - 1; k >= 0; k--) {
    const s = strokes[k]!;
    const p = s.pts;
    if (s.tool === 'rect') {
      const [x0, y0, x1, y1] = [Math.min(p[0]!, p[2]!), Math.min(p[1]!, p[3]!), Math.max(p[0]!, p[2]!), Math.max(p[1]!, p[3]!)];
      const edges = [x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0];
      for (let i = 0; i < edges.length; i += 4) {
        if (segmentDistance(x, y, edges[i]!, edges[i + 1]!, edges[i + 2]!, edges[i + 3]!) <= tolerance) return s;
      }
    } else if (s.tool === 'ellipse') {
      const cx = (p[0]! + p[2]!) / 2;
      const cy = (p[1]! + p[3]!) / 2;
      const rx = Math.abs(p[2]! - p[0]!) / 2 || 1e-6;
      const ry = Math.abs(p[3]! - p[1]!) / 2 || 1e-6;
      // Distance to the outline, roughly: how far the point's normalised radius is from 1.
      const r = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (Math.abs(r - 1) * Math.min(rx, ry) <= tolerance) return s;
    } else if (p.length === 2) {
      if (Math.hypot(x - p[0]!, y - p[1]!) <= tolerance) return s;
    } else {
      for (let i = 0; i + 3 < p.length; i += 2) {
        if (segmentDistance(x, y, p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!) <= tolerance) return s;
      }
    }
  }
  return null;
}

function segmentDistance(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len)) : 0;
  return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
}

/**
 * Draws a laser pointer: a glowing dot at the newest point and a trail that
 * fades out over `trailMs`. Returns whether anything is still visible (the
 * caller keeps animating until it isn't).
 */
export function drawLaser(ctx: CanvasRenderingContext2D, trail: readonly { x: number; y: number; at: number }[], rect: Rect, now: number, trailMs: number): boolean {
  const live = trail.filter((p) => now - p.at < trailMs);
  if (!live.length) return false;
  const px = (p: { x: number }) => rect.x + p.x * rect.w;
  const py = (p: { y: number }) => rect.y + p.y * rect.h;
  const r = Math.max(5, rect.h * 0.009);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 1; i < live.length; i++) {
    const a = live[i - 1]!;
    const b = live[i]!;
    const fade = 1 - (now - b.at) / trailMs;
    ctx.strokeStyle = `rgb(255 59 48 / ${(fade * 0.7).toFixed(3)})`;
    ctx.lineWidth = r * 1.2 * fade;
    ctx.beginPath();
    ctx.moveTo(px(a), py(a));
    ctx.lineTo(px(b), py(b));
    ctx.stroke();
  }
  const head = live[live.length - 1]!;
  const fade = Math.min(1, 1.6 * (1 - (now - head.at) / trailMs));
  ctx.globalAlpha = fade;
  ctx.shadowColor = 'rgb(255 59 48 / 90%)';
  ctx.shadowBlur = r * 3;
  ctx.fillStyle = '#ff3b30';
  ctx.beginPath();
  ctx.arc(px(head), py(head), r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(px(head), py(head), r * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return true;
}
