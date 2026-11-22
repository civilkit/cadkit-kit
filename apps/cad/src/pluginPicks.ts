// How a plugin's selection field picks, and when its picks go stale. Pure functions: no DOM, no kernel.
// A field declares the kinds it takes (`accept`); each kind is opt-in, so a plugin that asks for bodies and faces sees exactly what it saw before.
// Bodies, faces and edges are picked in the view; sketches in the Features list; a profile (a closed region of a sketch) by clicking the region
// of the sketch chosen in the Features list. Any change to the design (an edit, undo, redo, the rollback marker, another document) empties every
// selection field: a pick names a body, face, edge or region of the design as it was, and must never reach the plugin after it changed.
import type { ParamDef, SelItem, Values } from '@kit/plugin';
import type { PickMode } from '@kit/viewport';

export interface PickPlan {
  /** the view's pick mode while the field picks (null: leave it as the user set it) */
  mode: PickMode | null;
  /** bodies, faces or edges come from the view's selection */
  view: boolean;
  /** a sketch chosen in the Features list is taken (for a profile field: it is the sketch whose regions are clicked) */
  tree: boolean;
  /** a click on a closed region of that sketch picks it */
  regions: boolean;
}
const VIEW = ['body', 'face', 'edge'] as const;

export function pickPlan(accept: readonly string[] | undefined): PickPlan {
  const a = accept ?? [];
  const view = VIEW.filter((k) => a.includes(k));
  return { mode: view.length === 1 ? view[0] : null, view: view.length > 0, tree: a.includes('sketch') || a.includes('profile'), regions: a.includes('profile') };
}

export interface DocSketch { id: string; name: string; /** the closed regions a profile may be (the ids an Extrude's `regions` takes) */ regions: string[] }
/** The document's sketches, with their closed regions (projected outlines of the body are not this sketch's regions). */
export function docSketches(features: ReadonlyArray<{ id: string; type?: string; name?: string }>, shapesOf: (f: never) => ReadonlyArray<{ id: string; reference?: boolean }>): DocSketch[] {
  return features.filter((f) => f.type === 'sketch').map((f) => ({ id: f.id, name: f.name ?? f.id, regions: shapesOf(f as never).filter((s) => !s.reference).map((s) => s.id) }));
}
export const sketchItem = (s: { id: string; name: string }): SelItem => ({ type: 'sketch', id: s.id, name: s.name });
/** A closed region: its sketch, the region's id in it, and the sketch's name and the region's place (for the list). */
export const profileItem = (s: { id: string; name: string }, region: string, index: number): SelItem => ({ type: 'profile', sketch: s.id, region, name: s.name, index });

const same = (a: SelItem, b: SelItem): boolean => JSON.stringify(a) === JSON.stringify(b);
/** A pick added to a field: picked again it is taken out; with a maximum, the last picks win. */
export function addPick(d: Pick<ParamDef, 'maxItems'>, cur: readonly SelItem[], item: SelItem): SelItem[] {
  if (cur.some((x) => same(x, item))) return cur.filter((x) => !same(x, item));
  const out = [...cur, item];
  return d.maxItems !== undefined && out.length > d.maxItems ? out.slice(out.length - d.maxItems) : out;
}
const fromView = (x: SelItem): boolean => typeof x === 'string' || (VIEW as readonly string[]).includes(String(x.type));
/** A field's value after the view's selection changed: the view's picks replace the ones it made before; sketches and regions stay. */
export function mergeViewPicks(cur: readonly SelItem[] | undefined, viewItems: readonly SelItem[]): SelItem[] {
  return [...(cur ?? []).filter((x) => !fromView(x)), ...viewItems];
}

/** Direct 3D viewport click/box pick into an active selection field: clicking toggles an item without needing Shift (empty space changes nothing);
 *  box-select (`addOnly: true`) only adds. Respects `maxItems` by keeping the most recent picks. */
export function toggleViewPicks(d: Pick<ParamDef, 'maxItems'>, cur: readonly SelItem[] | undefined, picked: readonly SelItem[], addOnly = false): SelItem[] {
  const base = [...(cur ?? [])];
  if (!picked.length) return base;
  let out = base;
  for (const item of picked) {
    if (out.some((x) => same(x, item))) {
      if (!addOnly) out = out.filter((x) => !same(x, item));
    } else {
      out = [...out, item];
    }
  }
  return d.maxItems !== undefined && out.length > d.maxItems ? out.slice(out.length - d.maxItems) : out;
}

/** Remove one picked item at `index` from a selection field's list. */
export function removePickAt(cur: readonly SelItem[], index: number): SelItem[] {
  return cur.filter((_, i) => i !== index);
}

/** Viewport highlight keys (body keys, face ids, edge ids) for the items currently held in a selection field. */
export function pickHighlightKeys(
  picks: readonly SelItem[] | undefined,
  rows: ReadonlyArray<{ key: string; name: string; docName?: string; faces: readonly string[]; edges?: readonly string[] }>,
): string[] {
  if (!picks?.length) return [];
  const byName = new Map(rows.map((r) => [r.docName ?? r.name, r]));
  const out: string[] = [];
  for (const it of picks) {
    if (typeof it === 'string') {
      const r = byName.get(it);
      if (r) out.push(r.key);
      continue;
    }
    if (it.type === 'body' && typeof it.name === 'string') {
      const r = byName.get(it.name);
      if (r) out.push(r.key);
    } else if (it.type === 'face' && typeof it.body === 'string' && typeof it.index === 'number') {
      const f = byName.get(it.body)?.faces[it.index];
      if (f) out.push(f);
    } else if (it.type === 'edge' && typeof it.body === 'string' && typeof it.index === 'number') {
      const e = byName.get(it.body)?.edges?.[it.index];
      if (e) out.push(e);
    }
  }
  return out;
}

/** What a pick depends on: the feature list (a new array after every edit, undo, redo and document switch) and the rollback marker. */
export interface DesignRev { features: unknown; rollback: number | null }
export const designChanged = (a: DesignRev | null, b: DesignRev | null): boolean => !a || !b ? a !== b : a.features !== b.features || a.rollback !== b.rollback;
/** The values with every selection field emptied, or null when none holds a pick. */
export function clearPicks(params: readonly ParamDef[], values: Values): Values | null {
  const held = params.filter((d) => d.type === 'selection' && Array.isArray(values[d.name]) && (values[d.name] as SelItem[]).length > 0);
  if (!held.length) return null;
  const out: Values = { ...values };
  for (const d of held) out[d.name] = [];
  return out;
}
