// Little pictures of the catalog shapes (hand-drawn SVG on a 40x40 grid). Shapes that add material are solid; shapes that
// remove it are drawn as a hollow in a slab, so the two columns read at a glance without text.
import type { ShapeKind, ShapeOp } from './shapes';

const SLAB = 'M4 22l10-5h22l-10 5z';
const SLAB_FRONT = 'M4 22h22v7H4zM26 22l10-5v7l-10 5z';

const addPaths: Record<ShapeKind, string[]> = {
  block: ['M9 17l8-4h14l-8 4z', 'M9 17h14v14H9z', 'M23 17l8-4v14l-8 4z'],
  cylinder: ['M13 13a8 3 0 1 0 16 0a8 3 0 1 0-16 0', 'M13 13v16a8 3 0 0 0 16 0V13'],
  sphere: ['M20 8a11 11 0 1 0 0.01 0z', 'M9 20a11 4 0 0 0 22 0'],
  cone: ['M20 7l9 22a9 3 0 0 1-18 0z', 'M11 29a9 3 0 0 0 18 0'],
  boss: ['M14 20a6 2.4 0 1 0 12 0a6 2.4 0 1 0-12 0', 'M14 20v7a6 2.4 0 0 0 12 0v-7', 'M6 29h28'],
  slot: ['M10 14h20a5 5 0 0 1 0 10H10a5 5 0 0 1 0-10z', 'M10 24v4h20v-4'],
  hole: [], cbore: [], csink: [],
};
const cutPaths: Record<ShapeKind, string> = {
  block: 'M13 20l6-3h8l-6 3z',
  cylinder: 'M14 20a6 2.4 0 1 0 12 0a6 2.4 0 1 0-12 0',
  sphere: 'M14 20a6 2.4 0 1 0 12 0a6 2.4 0 1 0-12 0M14 20a6 6 0 0 0 12 0',
  cone: 'M14 20a6 2.4 0 1 0 12 0a6 2.4 0 1 0-12 0M14 20l6 8 6-8',
  boss: 'M16 20a4 1.6 0 1 0 8 0a4 1.6 0 1 0-8 0',
  slot: 'M13 18h12a3 2.4 0 0 1 0 4.8H13a3 2.4 0 0 1 0-4.8z',
  hole: 'M16 20a4 1.6 0 1 0 8 0a4 1.6 0 1 0-8 0M16 20v8M24 20v8',
  cbore: 'M13 19a7 2.6 0 1 0 14 0a7 2.6 0 1 0-14 0M16 22a4 1.6 0 1 0 8 0M16 22v6M24 22v6',
  csink: 'M13 19a7 2.6 0 1 0 14 0a7 2.6 0 1 0-14 0M16 22l2 6M24 22l-2 6',
};

export function CatalogIcon({ kind, op }: { kind: ShapeKind; op: ShapeOp }) {
  return (
    <svg viewBox="0 0 40 40" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
      {op === 'add' ? addPaths[kind].map((d, i) => <path key={i} d={d} style={i === 0 ? 'fill:var(--accent-soft, rgba(110,150,255,.22))' : undefined} />) : (
        <>
          <path d={SLAB} />
          <path d={SLAB_FRONT} />
          <path d={cutPaths[kind]} style="stroke:var(--accent,currentColor);stroke-dasharray:3 2" />
        </>
      )}
    </svg>
  );
}
