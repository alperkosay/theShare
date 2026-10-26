import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { ink, LASER_TRAIL_MS, useInk } from '../hooks/useInk';
import { containRect, drawLaser, drawStrokes, type Surface } from '../lib/ink';

interface Props {
  surface: Surface;
  /** The video showing that screen: its picture size places the drawings. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Presses draw here (only on the screen in focus, while drawing is on). */
  interactive: boolean;
}

/** Clamp a little outside the picture: a stroke may run off the edge, but not far. */
const clamp = (v: number) => Math.max(-0.2, Math.min(1.2, v));

/**
 * Canvas over a shared screen with its drawings and laser pointers. Works in
 * the pop-out window too, so it uses its own document's window for timing.
 */
export function InkLayer({ surface, videoRef, interactive }: Props) {
  const { strokes, active, mode } = useInk();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pressed = useRef(false);
  const [box, setBox] = useState({ w: 0, h: 0, aspect: 16 / 10 });
  const list = strokes[surface];
  const drawing = interactive && active;

  // Follow the canvas size and the picture's aspect ratio.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const win = canvas.ownerDocument.defaultView ?? window;
    const video = videoRef.current;
    const update = () => {
      const r = canvas.getBoundingClientRect();
      const v = videoRef.current;
      const aspect = v?.videoWidth ? v.videoWidth / v.videoHeight : 16 / 10;
      setBox((b) => (b.w === r.width && b.h === r.height && b.aspect === aspect ? b : { w: r.width, h: r.height, aspect }));
    };
    const observer = new win.ResizeObserver(update);
    observer.observe(canvas);
    video?.addEventListener('resize', update);
    video?.addEventListener('loadedmetadata', update);
    update();
    return () => {
      observer.disconnect();
      video?.removeEventListener('resize', update);
      video?.removeEventListener('loadedmetadata', update);
    };
  }, [videoRef]);

  // Paint the strokes; while a laser trail is fading, keep animating.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !box.w) return;
    const win = canvas.ownerDocument.defaultView ?? window;
    const dpr = win.devicePixelRatio || 1;
    const width = Math.round(box.w * dpr);
    const height = Math.round(box.h * dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = containRect(box.w, box.h, box.aspect);
    let frame = 0;
    const paint = () => {
      frame = 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, box.w, box.h);
      drawStrokes(ctx, list, rect);
      if (drawLaser(ctx, ink.laser[surface], rect, performance.now(), LASER_TRAIL_MS)) frame = win.requestAnimationFrame(paint);
    };
    paint();
    const off = ink.onLaser(() => {
      if (!frame) frame = win.requestAnimationFrame(paint);
    });
    return () => {
      off();
      if (frame) win.cancelAnimationFrame(frame);
    };
  }, [box, list, surface]);

  const toPicture = (e: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    const rect = containRect(r.width, r.height, box.aspect);
    return [clamp((e.clientX - r.left - rect.x) / rect.w), clamp((e.clientY - r.top - rect.y) / rect.h)];
  };

  const end = () => {
    if (!pressed.current) return;
    pressed.current = false;
    ink.end();
  };

  return (
    <canvas
      ref={canvasRef}
      className={`ink-layer${drawing ? ` drawing mode-${mode}` : ''}`}
      data-testid={`ink-${surface}`}
      data-strokes={list.length}
      onPointerDown={(e) => {
        if (!drawing || e.button > 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        pressed.current = true;
        ink.begin(surface, ...toPicture(e));
      }}
      onPointerMove={(e) => {
        if (!drawing) return;
        // With a mouse the laser follows the pointer without a press.
        if (pressed.current || (mode === 'laser' && e.pointerType === 'mouse')) ink.move(surface, ...toPicture(e));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    />
  );
}
