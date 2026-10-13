// Platform: one interface for file open/save, sample listing and where the
// wasm comes from. The web implementation is in ./web; desktop and mobile
// (Tauri, Capacitor) will add their own behind this interface.
export interface Platform {
  openFile(): Promise<{ name: string; text: string } | null>;
  saveFile(name: string, text: string): Promise<void>;
  listSamples(): Promise<Array<{ id: string; title: string; url: string }>>;
  wasmUrl(): string;
}

export { createWebPlatform } from './web';
