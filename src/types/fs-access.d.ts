// File System Access API pickers (Chromium desktop only; not in lib.dom yet).
interface SaveFilePickerOptions {
  suggestedName?: string;
  id?: string;
  startIn?: 'downloads' | 'desktop' | 'documents';
}

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: 'downloads' | 'desktop' | 'documents';
}

interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
}
