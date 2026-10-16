// A library part as a catalog drop: the edit that puts it where the pointer is. `linked: false` is the live preview while dragging
// (the part's variables worked out to numbers, nothing is written); `linked: true` is the drop itself (the part's variables go
// into the document under a prefix, and the features are appended as ONE document patch, so one undo step). The part is moved
// by `placeFeatures` (place.ts); when it cannot be moved safely it stays at its own origin and `notice` says why.
import type { PartDoc } from '@ck/part-model';
import type { EditOp } from '@ck/session';
import type { BuiltShape, PlaceTarget } from '../catalog/shapes';
import { t } from '../i18n';
import { buildInsert, inlineVariables, type SourceEntry } from './insert';
import { metaOf } from './actions';
import { placeFeatures, type Placed } from './place';
import type { LibraryRecord, PartData } from './registry';

const SHAPE_TYPES = new Set(['extrude', 'revolve', 'loft', 'sweep']);

export function buildPlaced(doc: PartDoc, data: PartData, lib: LibraryRecord, target: PlaceTarget, o: { linked: boolean; flip?: boolean; commitSource?(entry: SourceEntry): void }): BuiltShape {
  let placed: Placed | null = null;
  const ins = buildInsert(doc, o.linked ? data.doc : inlineVariables(data.doc), metaOf(lib, data), (features) => { placed = placeFeatures(features, target, o.flip); return placed.features; });
  const made = ins.patch.append ?? [];
  const main = [...made].reverse().find((f) => SHAPE_TYPES.has(String(f.type))) ?? made[made.length - 1];
  const ops: EditOp[] = made.map((feature) => ({ op: 'add', feature }) as unknown as EditOp);
  const p = placed as Placed | null;
  const notice = p && !p.moved ? t('library.place.fallback.' + p.why, { title: data.part.title }) : undefined;
  return {
    ops, mainId: String(main?.id ?? ''), sketchId: '', helpers: [], size: 0,
    ...(o.linked ? { patch: ins.patch } : {}),
    ...(notice ? { notice } : {}),
    ...(o.linked && o.commitSource ? { onCommitted: () => o.commitSource!(ins.entry) } : {}),
  };
}
