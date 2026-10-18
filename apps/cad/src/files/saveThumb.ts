// The thumbnail that goes into a file on Save. It is taken from the last one made for the same document (same hash), else drawn
// now on a scratch kernel state through the same idle gate as the library thumbnails (never while a part is being dragged), with
// a time limit so a slow render cannot hold a save back: the file is then written without a picture and the next save tries again.
import type { PartDoc } from '@ck/part-model';
import { docHash, makeDocThumbnail, type DocRenderer, type DocThumbnail } from './docThumb';

export interface SaveThumbs {
  /** The thumbnail to write with `doc`; null when it has no solid, nothing can render, or it took too long. */
  forSave(doc: PartDoc): Promise<DocThumbnail | null>;
  /** The thumbnail that came with an opened file (reused while the document still matches it). */
  remember(t: DocThumbnail | null): void;
  /** The last thumbnail kept (fresh or not). */
  current(): DocThumbnail | null;
}

export function createSaveThumbs(o: { render: DocRenderer; hasSolid(): boolean; idle?(): Promise<void>; timeoutMs?: number }): SaveThumbs {
  let kept: DocThumbnail | null = null;
  return {
    remember(t) { kept = t; },
    current: () => kept,
    async forSave(doc) {
      if (kept && kept.hash === docHash(doc)) return kept;
      if (!o.hasSolid()) return null;
      const work = (async () => { await o.idle?.(); return makeDocThumbnail(doc, o.render); })().catch(() => null);
      const limit = new Promise<null>((res) => setTimeout(() => res(null), o.timeoutMs ?? 8000));
      const t = await Promise.race([work, limit]);
      if (t) kept = t;
      return t;
    },
  };
}
