/** The part of localStorage the file logic uses, so tests can pass a fake. */
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; /** enumeration (localStorage has it): lets the autosave find the slots of other tabs */ readonly length?: number; key?(i: number): string | null }
export const browserKV = (): KV | null => { try { return localStorage; } catch { return null; } };
