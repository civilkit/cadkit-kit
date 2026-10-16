// Thumbnails for parts that came without one. When a part is installed (its file is saved on this device) a picture is rendered
// locally from its kernel geometry, saved with the part (keyed by its sha256) and reused. It runs in the background, one part at a
// time, when the browser is idle and not while a part is being dragged: it must never get in the way of the UI.
import type { PartDoc } from '@ck/part-model';
import { catalogActive } from '../catalog/state';
import type { LibraryRegistry } from './registry';

/** Renders a part to PNG bytes (the app builds it with the kernel and @kit/snapshot); null when it has no solid to show. */
export type ThumbRenderer = (doc: PartDoc) => Promise<Uint8Array | null>;

const idle = (): Promise<void> => new Promise((res) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => res(), { timeout: 2000 }) : setTimeout(res, 30)));
let chain: Promise<unknown> = Promise.resolve();
const flight = new Map<string, Promise<Uint8Array | null>>();
const failed = new Set<string>();

/** Make (or find) the generated thumbnail of an installed part. Resolves with the PNG bytes, or null when it cannot be made. */
export function generateThumb(registry: LibraryRegistry, libId: string, partId: string, render: ThumbRenderer): Promise<Uint8Array | null> {
  const key = `${libId}::${partId}`;
  if (failed.has(key)) return Promise.resolve(null);
  const have = flight.get(key);
  if (have) return have;
  const job = chain.then(async () => {
    await idle();
    while (catalogActive.value) await new Promise((r) => setTimeout(r, 250));
    const cached = await registry.generatedThumb(libId, partId);
    if (cached) return cached;
    const data = await registry.part(libId, partId);
    const png = await render(data.doc);
    if (!png) { failed.add(key); return null; }
    await registry.putGeneratedThumb(libId, partId, png);
    return png;
  }).catch(() => { failed.add(key); return null; }).finally(() => { flight.delete(key); });
  flight.set(key, job);
  chain = job;
  return job;
}
