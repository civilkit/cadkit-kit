/** The part of localStorage the file logic uses, so tests can pass a fake. */
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export const browserKV = (): KV | null => { try { return localStorage; } catch { return null; } };
