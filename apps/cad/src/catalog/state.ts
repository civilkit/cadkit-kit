// Small shared state of the Catalog: what is armed for click-to-place, the ghost that follows the pointer, and the
// stable hook other panels use to react to a shape having been placed. Signals so only the parts that show them redraw
// (a pointer move must not re-render the whole app).
import { signal } from '@preact/signals';
import type { PlaceStatus } from './placer';

export const armedItem = signal<string | null>(null);
export const ghost = signal<{ x: number; y: number; itemId: string } | null>(null);
export const placeStatus = signal<PlaceStatus>({ state: 'idle' });

type Listener = (id: string) => void;
let selector: Listener | null = null;
const listeners = new Set<Listener>();

/** The app registers how a placed shape becomes the selection (tree row + its end face). Returns an unregister function. */
export function setShapeSelector(fn: Listener | null): () => void {
  selector = fn;
  return () => { if (selector === fn) selector = null; };
}
/** Something that wants to know about a newly placed or selected shape feature (the size box does): called with the feature id. */
export function onShapeSelected(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
/**
 * Select the feature a catalog shape made so its size handles can edit it. STABLE API: `id` is the id of the shape's main
 * feature (the extrude, revolve or hole; its sketch is `featureSketch(id)`). The Catalog calls this after every drop; anything
 * else that adds a shape may call it too.
 */
export function selectShapeFeature(id: string): void {
  selector?.(id);
  for (const l of [...listeners]) l(id);
}
