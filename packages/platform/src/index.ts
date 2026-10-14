// Platform: one interface for file open/save, sample listing and where the
// wasm comes from. The web implementation is in ./web; desktop and mobile
// (Tauri, Capacitor) will add their own behind this interface.
export interface Platform {
  openFile(): Promise<{ name: string; text: string } | null>;
  /** Download a file. Text goes out as UTF-8; bytes as they are. `mime` defaults from the file extension. */
  saveFile(name: string, data: string | Uint8Array, mime?: string): Promise<void>;
  listSamples(): Promise<Array<{ id: string; title: string; url: string }>>;
  wasmUrl(): string;
}

export { createWebPlatform } from './web';
