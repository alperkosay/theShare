import { useEffect, useRef, useState } from 'react';
import { CameraError, getQrDetector, openCamera } from '../lib/qr/scan';

interface Props {
  onResult: (text: string) => void;
}

const SCAN_INTERVAL_MS = 200;

export function QrScanner({ onResult }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      try {
        stream = await openCamera();
        if (stopped) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const detector = await getQrDetector();
        if (stopped) return;
        setReady(true);

        const scan = async () => {
          if (stopped) return;
          try {
            if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              const hit = (await detector.detect(video)).find((c) => c.rawValue);
              if (hit && !stopped) {
                stopped = true;
                navigator.vibrate?.(50);
                onResultRef.current(hit.rawValue);
                return;
              }
            }
          } catch {
            // A single failed frame is fine; keep scanning.
          }
          timer = setTimeout(scan, SCAN_INTERVAL_MS);
        };
        void scan();
      } catch (e) {
        if (!stopped) {
          setError(e instanceof CameraError ? e.message : 'QR okuyucu başlatılamadı.');
        }
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <>
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : (
        <div className="scanner-view">
          <video ref={videoRef} playsInline muted autoPlay aria-label="Kamera görüntüsü" />
          <div className="scanner-frame" aria-hidden="true" />
          {!ready && <p className="scanner-hint">Kamera açılıyor…</p>}
        </div>
      )}
    </>
  );
}
