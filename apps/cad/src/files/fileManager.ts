// The state behind Save, Save As and Recent: the current file name and handle, the part name chosen by Save As, and the
// recent list. No DOM and no kernel; the platform and storage come in through the constructor, so tests use fakes.
import type { HandleStore, SavedDocument } from '@kit/platform';
import { addRecent, dropped, readRecent, readRecentThumbs, setRecentThumb, type RecentEntry } from './recent';
import { createNameCounter, partNameOf, PART_EXT } from './names';
import type { KV } from './storage';
import { thumbnailUrl, type DocThumbnail } from './docThumb';
import { EMBED_FIELD } from './viewCache';
import { packDoc } from './assets';

export interface FilePlatform {
  saveDocument?(name: string, data: string, opts?: { handle?: unknown; pick?: boolean }): Promise<SavedDocument | null>;
  saveFile(name: string, data: string | Uint8Array, mime?: string): Promise<void>;
  canOverwrite?(): boolean;
  readHandle?(handle: unknown): Promise<{ name: string; text: string } | 'denied' | null>;
  handleStore?(): HandleStore | null;
}

export type SaveOutcome = { ok: true; file: string; partName: string } | { ok: false; cancelled: boolean; message?: string };
export type ReopenOutcome = { ok: true; name: string; text: string } | { ok: false; reason: 'noHandle' | 'denied' | 'gone' };

export class FileManager {
  /** File name of the open part, null until it has been saved or opened from a file. */
  fileName: string | null = null;
  private handle: unknown | null = null;
  /** Part name chosen with Save As; replaces the document's own name when saving and in the title. */
  partName: string | null = null;
  readonly names = createNameCounter();
  private store: HandleStore | null;

  constructor(private readonly platform: FilePlatform, private readonly kv: KV | null, private readonly now: () => number = Date.now) {
    this.store = platform.handleStore?.() ?? null;
  }

  /** What belongs to the open document alone (its file, handle and part name), so a document tab can park it and bring it back. */
  snapshot(): { fileName: string | null; handle: unknown | null; partName: string | null } { return { fileName: this.fileName, handle: this.handle, partName: this.partName }; }
  restore(s: { fileName: string | null; handle: unknown | null; partName: string | null }): void { this.fileName = s.fileName; this.handle = s.handle; this.partName = s.partName; }
  recent(): RecentEntry[] { return readRecent(this.kv); }

  /** Pictures of the recent files (data URLs by file name), kept beside the recent list. */
  recentThumbs(): Record<string, string> { return readRecentThumbs(this.kv); }
  /** Remember the picture of a file just saved or opened (only if it is in the recent list). */
  noteThumb(file: string, t: DocThumbnail | null): void {
    if (!t || !this.recent().some((e) => e.kind === 'file' && e.id === file)) return;
    setRecentThumb(this.kv, file, thumbnailUrl(t), this.recent());
  }

  /** A part was loaded: forget the previous file and name. `file` is set when it came from a file the user chose. */
  opened(file: string | null, handle: unknown | null = null): void {
    this.fileName = file; this.handle = handle; this.partName = null;
  }

  noteSample(id: string, name: string, url: string): void {
    this.record({ kind: 'sample', id, name, at: this.now(), url });
  }

  /** A file opened through the picker or a drop: remembered by name (a handle is only known after a save). */
  noteFile(file: string): void {
    this.record({ kind: 'file', id: file, name: file, at: this.now(), handle: this.handle !== null });
  }

  private record(e: RecentEntry): void {
    const before = this.recent();
    const after = addRecent(this.kv, e);
    for (const d of dropped(before, after)) void this.store?.delete(d.id).catch(() => {});
    setRecentThumb(this.kv, null, '', after);   // forget the pictures of entries that left the list
  }

  /**
   * Write the document. `saveAs` asks for a new file (the browser's picker, or the `name` the Save As dialog gave).
   * The document's name inside the file is the part name chosen (or the document's own).
   */
  async save(doc: { name: string }, opts: { saveAs?: boolean; fileName?: string; /** written as the file's `thumbnail` field */ thumbnail?: DocThumbnail | null; /** given the document as it will be written, the value of its `viewCache` field (the part's built view), or null */ embed?: (written: { name: string }) => Promise<unknown | null> } = {}): Promise<SaveOutcome> {
    const part = opts.fileName ? partNameOf(opts.fileName) : this.partName ?? doc.name ?? 'Part1';
    const file = opts.fileName ?? this.fileName ?? `${part || 'part'}${PART_EXT}`;
    const { thumbnail: _old, [EMBED_FIELD]: _oldView, ...body } = doc as { name: string; thumbnail?: unknown; viewCache?: unknown };
    const written = { ...body, name: part };
    const view = opts.embed ? await opts.embed(written).catch(() => null) : null;
    // reference meshes and STEP text travel packed (files/assets.ts); the view above was keyed on the recipe as the kernel has it
    const packed = await packDoc(written);
    const data = JSON.stringify({ ...packed, ...(opts.thumbnail ? { thumbnail: opts.thumbnail } : {}), ...(view ? { [EMBED_FIELD]: view } : {}) }, null, 1);
    try {
      let saved: SavedDocument | null;
      if (this.platform.saveDocument) {
        // a name typed in the Save As dialog is final; without a picker it goes straight to a download
        const pick = !!opts.saveAs && !opts.fileName;
        saved = await this.platform.saveDocument(file, data, { handle: opts.saveAs ? undefined : this.handle, pick });
      } else {
        await this.platform.saveFile(file, data);
        saved = { name: file, handle: null };
      }
      if (!saved) return { ok: false, cancelled: true };
      this.fileName = saved.name;
      this.handle = saved.handle;
      // a picker may have chosen a different name than asked for: it wins
      this.partName = opts.fileName || opts.saveAs ? partNameOf(saved.name) : this.partName;
      this.record({ kind: 'file', id: saved.name, name: saved.name, at: this.now(), handle: saved.handle !== null });
      this.noteThumb(saved.name, opts.thumbnail ?? null);
      if (saved.handle !== null) await this.store?.set(saved.name, saved.handle).catch(() => {});
      return { ok: true, file: saved.name, partName: this.partName ?? part };
    } catch (e) {
      return { ok: false, cancelled: false, message: (e as Error).message };
    }
  }

  /** Whether Save As should show its own name dialog (no browser picker to ask the name). */
  needsNameDialog(): boolean { return !this.platform.canOverwrite?.(); }

  /** Reopen a recent file through its kept handle. */
  async reopen(e: RecentEntry): Promise<ReopenOutcome> {
    const h = e.handle ? await this.store?.get(e.id).catch(() => undefined) : undefined;
    if (!h || !this.platform.readHandle) return { ok: false, reason: 'noHandle' };
    const r = await this.platform.readHandle(h);
    if (r === 'denied') return { ok: false, reason: 'denied' };
    if (!r) return { ok: false, reason: 'gone' };
    this.opened(r.name, h);
    this.noteFile(r.name);
    return { ok: true, name: r.name, text: r.text };
  }
}
