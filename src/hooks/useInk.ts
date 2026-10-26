import { useSyncExternalStore } from 'react';
import { MAX_POINTS, MAX_STROKES, hitStroke, roundCoord, SHAPE_TOOLS, type InkSize, type InkTool, type Stroke, type Surface } from '../lib/ink';
import { newTransferId, type InkMessage, type InkTarget } from '../lib/transfer/protocol';

/** What a press on the picture does: draw with a tool, point with the laser, or erase. */
export type InkMode = InkTool | 'laser' | 'eraser';

export interface InkSnapshot {
  strokes: Record<Surface, Stroke[]>;
  /** Drawing mode: presses on the picture draw instead of passing through to the player. */
  active: boolean;
  mode: InkMode;
  color: string;
  size: InkSize;
}

export interface LaserPoint {
  x: number;
  y: number;
  at: number;
}

/** A trail this long (ms) fades behind the laser dot. */
export const LASER_TRAIL_MS = 700;
const LIVE_SEND_MS = 40;
const POINT_SEND_MS = 30;
/** Skip freehand points closer than this to the previous one (normalised). */
const MIN_STEP = 0.0015;

const surfaceOf = (on: InkTarget): Surface => (on === 'mine' ? 'remote' : 'local');
const targetOf = (surface: Surface): InkTarget => (surface === 'local' ? 'mine' : 'yours');

/**
 * Drawings on the shared screens: the strokes on each (ours and theirs), the
 * tool picked here, and the laser pointers. Strokes are synced with the other
 * side as they're drawn; the laser is sent but never kept.
 */
class InkStore {
  private state: InkSnapshot = {
    strokes: { local: [], remote: [] },
    active: false,
    mode: 'pen',
    color: '#ff3b30',
    size: 2,
  };
  private listeners = new Set<() => void>();
  private laserListeners = new Set<() => void>();
  /** Recent laser positions per screen. Not React state: they change ~30 times a second. */
  readonly laser: Record<Surface, LaserPoint[]> = { local: [], remote: [] };
  /** Ids of strokes drawn on this device, newest last (for undo). */
  private own: string[] = [];
  private drawing: { surface: Surface; stroke: Stroke; sentAt: number; timer: ReturnType<typeof setTimeout> | undefined } | null = null;
  private pointSentAt = 0;
  send: (msg: InkMessage) => void = () => {};

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  /** Called whenever a laser trail changes. */
  onLaser(listener: () => void): () => void {
    this.laserListeners.add(listener);
    return () => this.laserListeners.delete(listener);
  }

  private set(patch: Partial<InkSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private setStrokes(surface: Surface, list: Stroke[]) {
    this.set({ strokes: { ...this.state.strokes, [surface]: list } });
  }

  // ---------------------------------------------------------------------------
  // Toolbar
  // ---------------------------------------------------------------------------

  setActive(active: boolean): void {
    if (!active) this.end();
    this.set({ active });
  }

  setMode(mode: InkMode): void {
    this.set({ mode, active: true });
  }

  setColor(color: string): void {
    this.set({ color, active: true, ...(this.state.mode === 'eraser' || this.state.mode === 'laser' ? { mode: 'pen' as const } : {}) });
  }

  setSize(size: InkSize): void {
    this.set({ size });
  }

  /** Takes back the last stroke drawn here (on whichever screen). */
  undo(): void {
    while (this.own.length) {
      const id = this.own.pop()!;
      for (const surface of ['local', 'remote'] as const) {
        if (this.state.strokes[surface].some((s) => s.id === id)) {
          this.setStrokes(surface, this.state.strokes[surface].filter((s) => s.id !== id));
          this.send({ t: 'ink', on: targetOf(surface), op: 'del', id });
          return;
        }
      }
    }
  }

  get canUndo(): boolean {
    return this.own.some((id) => this.state.strokes.local.some((s) => s.id === id) || this.state.strokes.remote.some((s) => s.id === id));
  }

  /** Wipes every drawing on a screen, for both sides. */
  clear(surface: Surface): void {
    this.setStrokes(surface, []);
    this.send({ t: 'ink', on: targetOf(surface), op: 'clear' });
  }

  // ---------------------------------------------------------------------------
  // Pointer input (components/InkLayer), coordinates normalised to the picture
  // ---------------------------------------------------------------------------

  begin(surface: Surface, x: number, y: number): void {
    const { mode, color, size } = this.state;
    if (mode === 'laser') return this.point(surface, x, y);
    if (mode === 'eraser') return this.erase(surface, x, y);
    this.end();
    const rx = roundCoord(x);
    const ry = roundCoord(y);
    const stroke: Stroke = { id: newTransferId(), tool: mode, color, size, pts: SHAPE_TOOLS.includes(mode) ? [rx, ry, rx, ry] : [rx, ry] };
    this.drawing = { surface, stroke, sentAt: 0, timer: undefined };
    this.put(surface, stroke);
    this.sendLive(true);
  }

  move(surface: Surface, x: number, y: number): void {
    const { mode } = this.state;
    if (mode === 'laser') return this.point(surface, x, y);
    if (mode === 'eraser') return this.erase(surface, x, y);
    const d = this.drawing;
    if (!d || d.surface !== surface) return;
    const pts = d.stroke.pts;
    const rx = roundCoord(x);
    const ry = roundCoord(y);
    let next: number[];
    if (SHAPE_TOOLS.includes(d.stroke.tool)) {
      next = [pts[0]!, pts[1]!, rx, ry];
    } else {
      const lx = pts[pts.length - 2]!;
      const ly = pts[pts.length - 1]!;
      if (Math.hypot(rx - lx, ry - ly) < MIN_STEP || pts.length >= MAX_POINTS * 2) return;
      next = [...pts, rx, ry];
    }
    d.stroke = { ...d.stroke, pts: next };
    this.put(surface, d.stroke);
    this.sendLive(false);
  }

  /** The press is over: send the finished stroke. */
  end(): void {
    const d = this.drawing;
    if (!d) return;
    clearTimeout(d.timer);
    this.drawing = null;
    this.send({ t: 'ink', on: targetOf(d.surface), op: 'put', stroke: d.stroke });
    this.own.push(d.stroke.id);
    this.set({});
  }

  /** While drawing, the other side sees the stroke grow (throttled). */
  private sendLive(now: boolean): void {
    const d = this.drawing;
    if (!d) return;
    const wait = d.sentAt + LIVE_SEND_MS - performance.now();
    if (now || wait <= 0) {
      clearTimeout(d.timer);
      d.timer = undefined;
      d.sentAt = performance.now();
      this.send({ t: 'ink', on: targetOf(d.surface), op: 'put', stroke: d.stroke });
    } else if (d.timer === undefined) {
      d.timer = setTimeout(() => {
        d.timer = undefined;
        if (this.drawing === d) this.sendLive(true);
      }, wait);
    }
  }

  private point(surface: Surface, x: number, y: number): void {
    this.pushLaser(surface, x, y);
    const now = performance.now();
    if (now - this.pointSentAt < POINT_SEND_MS) return;
    this.pointSentAt = now;
    this.send({ t: 'point', on: targetOf(surface), x: roundCoord(x), y: roundCoord(y) });
  }

  private erase(surface: Surface, x: number, y: number): void {
    const hit = hitStroke(this.state.strokes[surface], x, y, 0.015);
    if (!hit) return;
    this.setStrokes(surface, this.state.strokes[surface].filter((s) => s.id !== hit.id));
    this.send({ t: 'ink', on: targetOf(surface), op: 'del', id: hit.id });
  }

  private put(surface: Surface, stroke: Stroke): void {
    const list = this.state.strokes[surface];
    const i = list.findIndex((s) => s.id === stroke.id);
    this.setStrokes(surface, i >= 0 ? list.map((s, k) => (k === i ? stroke : s)) : [...list, stroke].slice(-MAX_STROKES));
  }

  private pushLaser(surface: Surface, x: number, y: number): void {
    const now = performance.now();
    const trail = this.laser[surface].filter((p) => now - p.at < LASER_TRAIL_MS);
    trail.push({ x, y, at: now });
    this.laser[surface] = trail.slice(-60);
    for (const l of this.laserListeners) l();
  }

  // ---------------------------------------------------------------------------
  // The other side
  // ---------------------------------------------------------------------------

  receive(msg: InkMessage): void {
    const surface = surfaceOf(msg.on);
    if (msg.t === 'point') return this.pushLaser(surface, msg.x, msg.y);
    if (msg.op === 'put') {
      // Never let their copy overwrite the stroke we're drawing right now.
      if (this.drawing?.stroke.id !== msg.stroke.id) this.put(surface, msg.stroke);
    } else if (msg.op === 'del') {
      this.setStrokes(surface, this.state.strokes[surface].filter((s) => s.id !== msg.id));
    } else {
      if (this.drawing?.surface === surface) this.drawing = null;
      this.setStrokes(surface, []);
    }
  }

  /** A screen stopped (or started) being shared: its drawings go with it. Sends nothing. */
  reset(surface: Surface): void {
    if (this.drawing?.surface === surface) {
      clearTimeout(this.drawing.timer);
      this.drawing = null;
    }
    this.laser[surface] = [];
    if (this.state.strokes[surface].length) this.setStrokes(surface, []);
  }
}

export const ink = new InkStore();

export function useInk(): InkSnapshot {
  return useSyncExternalStore(ink.subscribe, ink.getSnapshot);
}
