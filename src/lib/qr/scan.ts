/**
 * QR scanning: the native BarcodeDetector where it exists (Android Chrome,
 * macOS Chrome/Edge), otherwise the zxing-wasm based ponyfill. The wasm is
 * bundled and served from our own origin (not jsDelivr, the library default),
 * so scanning keeps working offline and no request leaves for a CDN.
 */

interface Detector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}

interface NativeBarcodeDetector {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

let detectorPromise: Promise<Detector> | null = null;

export function getQrDetector(): Promise<Detector> {
  detectorPromise ??= (async () => {
    const Native = (globalThis as { BarcodeDetector?: NativeBarcodeDetector }).BarcodeDetector;
    if (Native) {
      try {
        if ((await Native.getSupportedFormats()).includes('qr_code')) return new Native({ formats: ['qr_code'] });
      } catch {
        // fall through to the ponyfill
      }
    }
    const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
      import('barcode-detector/ponyfill'),
      import('zxing-wasm/reader/zxing_reader.wasm?url'),
    ]);
    prepareZXingModule({
      overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
    });
    return new BarcodeDetector({ formats: ['qr_code'] });
  })();
  detectorPromise.catch(() => {
    detectorPromise = null;
  });
  return detectorPromise;
}

export class CameraError extends Error {
  override name = 'CameraError';
}

/** Opens the rear camera, translating getUserMedia failures into user-facing messages. */
export async function openCamera(): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new CameraError('Kamera yalnızca HTTPS bağlantısında çalışır.');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('Bu tarayıcı kamerayı desteklemiyor.');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (e) {
    const name = (e as DOMException).name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new CameraError('Kamera izni verilmedi.');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new CameraError('Kamera bulunamadı.');
    }
    if (name === 'NotReadableError') {
      throw new CameraError('Kamera başka bir uygulama tarafından kullanılıyor.');
    }
    throw new CameraError('Kamera açılamadı.');
  }
}
