import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { THUMBNAIL_MAX_BYTES, detectPreview, previewUrl, type PreviewInfo } from '../lib/preview';
import { Icon } from './Icon';

/** Sniffs `file` and, if it's an image or video, gives a blob: URL for it (revoked on unmount). */
function usePreview(file: File | null, thumbnail: boolean): { info: PreviewInfo | null; url: string | null } {
  const [state, setState] = useState<{ info: PreviewInfo | null; url: string | null }>({ info: null, url: null });
  useEffect(() => {
    setState({ info: null, url: null });
    if (!file) return;
    let url: string | null = null;
    let live = true;
    void detectPreview(file).then((info) => {
      if (!live || !info) return;
      if (!thumbnail || (info.kind === 'image' && file.size <= THUMBNAIL_MAX_BYTES) || info.kind === 'video') url = previewUrl(file, info);
      setState({ info, url });
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, thumbnail]);
  return state;
}

/** Small tappable preview of an image/video; renders nothing for other files. */
export function Thumb({ file, onOpen, size = 'md' }: { file: File | null; onOpen: () => void; size?: 'sm' | 'md' }) {
  const { info, url } = usePreview(file, true);
  if (!info || !file) return null;
  return (
    <button type="button" className={`thumb ${size}`} onClick={onOpen} aria-label={`${file.name} önizle`} data-testid="thumb">
      {url && info.kind === 'image' && <img src={url} alt="" loading="lazy" decoding="async" />}
      {url && info.kind === 'video' && <video src={url} muted playsInline preload="metadata" />}
      {(info.kind === 'video' || !url) && (
        <span className="thumb-badge">
          <Icon name={info.kind === 'video' ? 'play' : 'files'} />
        </span>
      )}
    </button>
  );
}

interface ViewerProps {
  files: File[];
  start: File;
  onClose: () => void;
  /** e.g. a "Save" button for received files. */
  action?: (file: File, index: number) => ReactNode;
}

/** Full-screen viewer for the images/videos among `files`; arrows, swipe and Escape. */
export function Viewer({ files, start, onClose, action }: ViewerProps) {
  const [media, setMedia] = useState<File[]>([start]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let live = true;
    void Promise.all(files.map(detectPreview)).then((infos) => {
      if (!live) return;
      const list = files.filter((_, i) => infos[i]);
      setMedia(list.length ? list : [start]);
      setIndex(Math.max(0, list.indexOf(start)));
    });
    return () => {
      live = false;
    };
  }, [files, start]);

  const count = media.length;
  const go = (step: number) => setIndex((i) => (i + step + count) % count);

  useEffect(() => {
    // Capture phase: Escape closes only the viewer, not a sheet underneath it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onClose();
      } else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const touchX = useRef<number | null>(null);
  const file = media[index] ?? start;

  return createPortal(
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Önizleme: ${file.name}`}
      data-testid="viewer"
      onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const dx = (e.changedTouches[0]?.clientX ?? 0) - (touchX.current ?? 0);
        if (touchX.current !== null && count > 1 && Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        touchX.current = null;
      }}
    >
      <header className="viewer-bar">
        <div className="grow">
          <div className="filename">{file.name}</div>
          {count > 1 && (
            <span className="small muted">
              {index + 1} / {count}
            </span>
          )}
        </div>
        {action?.(file, files.indexOf(file))}
        <button type="button" className="btn small" onClick={onClose} aria-label="Kapat" data-testid="viewer-close">
          <Icon name="close" />
        </button>
      </header>
      <div className="viewer-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <ViewerMedia key={index} file={file} />
        {count > 1 && (
          <>
            <button type="button" className="viewer-nav prev" onClick={() => go(-1)} aria-label="Önceki">
              <Icon name="back" />
            </button>
            <button type="button" className="viewer-nav next" onClick={() => go(1)} aria-label="Sonraki">
              <Icon name="chevron" />
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function ViewerMedia({ file }: { file: File }) {
  const { info, url } = usePreview(file, false);
  const [broken, setBroken] = useState(false);
  if (!info || !url) return <p className="muted">Bu dosya önizlenemiyor.</p>;
  if (broken) return <p className="muted">Bu tarayıcı bu dosyayı gösteremiyor.</p>;
  return info.kind === 'image' ? (
    <img src={url} alt={file.name} onError={() => setBroken(true)} />
  ) : (
    <video src={url} controls autoPlay playsInline onError={() => setBroken(true)} />
  );
}
