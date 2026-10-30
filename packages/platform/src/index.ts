// Platform: one interface for file open/save, sample listing and where the
// wasm comes from. The web implementation is in ./web; desktop and mobile
// (Tauri, Capacitor) will add their own behind this interface.
export interface Platform {
  /** Pick one file and read it as text. `accept` limits the picker to those extensions (like ['.step', '.stp']); without it every file shows. */
  openFile(opts?: { accept?: string[] }): Promise<{ name: string; text: string; bytes?: Uint8Array } | null>;
  /** Download a file. Text goes out as UTF-8; bytes as they are. `mime` defaults from the file extension. */
  saveFile(name: string, data: string | Uint8Array, mime?: string): Promise<void>;
  listSamples(): Promise<Array<{ id: string; title: string; url: string; detail?: string }>>;
  wasmUrl(): string;
  /** True when a save can overwrite a file the user picked (File System Access API). */
  canOverwrite?(): boolean;
  /**
   * Save a document under `name`. With a `handle` from an earlier call the same file is overwritten without asking;
   * with `pick` (or no handle) the browser's save dialog is used where it exists, else the file is downloaded.
   * Resolves null when the user cancelled the dialog. `handle` in the result is opaque and null after a download.
   */
  saveDocument?(name: string, data: string, opts?: { handle?: unknown; pick?: boolean }): Promise<SavedDocument | null>;
  /** Read a file from a handle kept earlier. `denied` when the permission is not granted any more. */
  readHandle?(handle: unknown): Promise<{ name: string; text: string } | 'denied' | null>;
  /** Small persistent store for file handles (IndexedDB on the web). Null when unavailable. */
  handleStore?(): HandleStore | null;
}

export interface SavedDocument { name: string; handle: unknown | null }
export interface HandleStore {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, handle: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export { createWebPlatform } from './web';
export { saveDocumentWith, readHandleWith, idbHandleStore, type FsEnv } from './fsaccess';
export { gzipText, bytesText, fileText, isGzip, wantsGzip } from './gzip';
