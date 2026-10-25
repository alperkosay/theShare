/**
 * In-app previews for images and videos.
 *
 * The type comes from the file's first bytes, never from its name or the
 * sender's declared type, and only raster images and plain video containers
 * qualify. SVG and HTML are never previewed: they can carry script. The
 * preview Blob gets the sniffed type so the browser decodes it as exactly
 * that (img-src/media-src blob: are already allowed by the CSP).
 */

export type PreviewKind = 'image' | 'video';

export interface PreviewInfo {
  kind: PreviewKind;
  type: string;
}

/** Thumbnails decode the whole image; skip them for huge files (the viewer still opens). */
export const THUMBNAIL_MAX_BYTES = 40 * 1024 * 1024;

const ascii = (bytes: Uint8Array, start: number, text: string) => [...text].every((c, i) => bytes[start + i] === c.charCodeAt(0));

/** Identifies a previewable format from the first 16+ bytes. */
export function sniffMedia(bytes: Uint8Array): PreviewInfo | null {
  const b = bytes;
  if (b[0] === 0x89 && ascii(b, 1, 'PNG')) return { kind: 'image', type: 'image/png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', type: 'image/jpeg' };
  if (ascii(b, 0, 'GIF8')) return { kind: 'image', type: 'image/gif' };
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return { kind: 'image', type: 'image/webp' };
  if (ascii(b, 0, 'BM')) return { kind: 'image', type: 'image/bmp' };
  if (ascii(b, 4, 'ftyp')) {
    const brand = String.fromCharCode(...b.subarray(8, 12));
    if (brand === 'avif' || brand === 'avis') return { kind: 'image', type: 'image/avif' };
    if (/^(heic|heix|mif1|msf1)$/.test(brand)) return null; // HEIC: most browsers can't show it
    if (brand.startsWith('qt')) return { kind: 'video', type: 'video/quicktime' };
    return { kind: 'video', type: 'video/mp4' };
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'video', type: 'video/webm' };
  return null;
}

const cache = new WeakMap<Blob, Promise<PreviewInfo | null>>();

export function detectPreview(file: Blob): Promise<PreviewInfo | null> {
  let found = cache.get(file);
  if (!found) {
    found = file
      .slice(0, 32)
      .arrayBuffer()
      .then((buf) => sniffMedia(new Uint8Array(buf)))
      .catch(() => null);
    cache.set(file, found);
  }
  return found;
}

/** A blob: URL for showing `file` as `info.type`. The caller revokes it. */
export function previewUrl(file: Blob, info: PreviewInfo): string {
  return URL.createObjectURL(file.slice(0, file.size, info.type));
}
