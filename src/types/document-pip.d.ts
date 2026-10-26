// Document Picture-in-Picture (Chromium desktop 116+; not in lib.dom yet).
interface DocumentPictureInPicture extends EventTarget {
  requestWindow(options?: { width?: number; height?: number; disallowReturnToOpener?: boolean }): Promise<Window>;
  readonly window: Window | null;
}

interface Window {
  documentPictureInPicture?: DocumentPictureInPicture;
}
