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

interface OpenFilePickerOptions {
  multiple?: boolean;
  id?: string;
  startIn?: 'downloads' | 'desktop' | 'documents';
}

interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
}

// Re-granting access to a stored handle, and handles from drag-and-drop.
interface FileSystemHandle {
  queryPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface DataTransferItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}
