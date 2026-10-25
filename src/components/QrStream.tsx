import { useEffect, useRef } from 'react';
import type { FountainEncoder } from '../lib/qr/fountain';
import { encodeQr } from '../lib/qr/generate';

interface Props {
  encoder: FountainEncoder;
  fps: number;
  paused: boolean;
  /** Called with the number of the frame now on screen. */
  onFrame: (n: number) => void;
}

/** Pixels per module on the canvas; CSS scales it, `image-rendering: pixelated` keeps the edges hard. */
const SCALE = 6;

/**
 * Plays the encoder's frames as QR codes on a canvas. A canvas, not SVG: at
 * 12 codes a second, one fillRect per dark run is much cheaper than a new
 * path string for React to diff. Black on white whatever the theme.
 */
export function QrStream({ encoder, fps, paused, onFrame }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const nextRef = useRef(0);

  // A new stream starts from its first (plain) block.
  useEffect(() => {
    nextRef.current = 0;
  }, [encoder]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const draw = (n: number) => {
      const text = encoder.frame(n);
      const qr = encodeQr(text, 'L');
      if (!qr) return;
      const px = qr.size * SCALE;
      if (canvas.width !== px) canvas.width = canvas.height = px;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, px, px);
      ctx.fillStyle = '#000';
      qr.data.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          if (!row[x]) continue;
          let end = x + 1;
          while (row[end]) end++;
          ctx.fillRect(x * SCALE, y * SCALE, (end - x) * SCALE, SCALE);
          x = end;
        }
      });
      canvas.dataset.frame = String(n);
      onFrameRef.current(n);
    };

    if (paused) {
      draw(Math.max(0, nextRef.current - 1));
      return;
    }
    // Paced by requestAnimationFrame so a code always stays up for whole display frames.
    let raf = 0;
    let last = -Infinity;
    const tick = (now: number) => {
      if (now - last >= 1000 / fps - 2) {
        last = now;
        draw(nextRef.current++);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [encoder, fps, paused]);

  return <canvas ref={canvasRef} className="qr-stream" role="img" aria-label="Değişen QR kodları" data-testid="qr-stream" />;
}
