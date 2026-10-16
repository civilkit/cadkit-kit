// The app's thumbnail renderer for library parts that came without a picture: the part is built on a scratch kernel state of its own
// (the open document is untouched) and drawn by @kit/snapshot, an iso view like the other thumbnails.
import type { Controller } from '../controller';
import type { ThumbRenderer } from './thumbs';

export function makeThumbRenderer(c: Pick<Controller, 'canScratchBuild' | 'scratchBuild' | 'scratchRelease'>): ThumbRenderer {
  const tag = `thumb-${Math.random().toString(36).slice(2, 8)}`;
  return async (doc) => {
    if (!c.canScratchBuild()) return null;
    try {
      const r = await c.scratchBuild(doc, true, tag);
      const g = r.geometry;
      if (!g?.mesh || !g.box) return null;
      const { renderSnapshot } = await import('@kit/snapshot');
      const snap = await renderSnapshot({ mesh: g.mesh as never, edges: g.edges as never, box: g.box }, { view: 'iso', size: { width: 192, height: 144 } });
      return snap.png;
    } catch { return null; }
    finally { await c.scratchRelease(tag); }
  };
}
