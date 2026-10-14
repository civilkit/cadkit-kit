// The thread of a tapped hole, as the Hole editor edits it: a `thread` feature on the hole's wall face, kept in step with
// the hole. Pure rules only (no DOM): which thread is linked to a hole, the thread a hole starts with, the hole diameter a
// thread needs (its tap drill), the length cap of a blind hole, and the edit ops that bring the document to the draft.
import type { EditOp } from '@ck/session';
import { ISO_TABLE, kindOf, holeDiameter } from './holeData';
import { defaultClass, holeWallFace, isWallOfHole, loadThreadPrefs, nearestSizes, type ThreadRow } from './threadData';

type Wire = Record<string, unknown>;

/** The editable part of a thread feature linked to a hole (face, id and anything else, such as `start`, are kept as they are). */
export interface HoleThread {
  standard: string;
  size: string;
  class?: string;
  length: 'full' | number;
  hand: 'right' | 'left';
  modeled: boolean;
}

/** The thread features on a hole's walls (one per position of a hole with several points), in history order. */
export function linkedThreads(features: Wire[], holeId: string): Wire[] {
  return features.filter((f) => f.type === 'thread' && isWallOfHole(f.face, holeId));
}

export function threadCfgOf(f: Wire): HoleThread {
  return {
    standard: typeof f.standard === 'string' ? f.standard : 'metric',
    size: typeof f.size === 'string' ? f.size : '',
    ...(typeof f.class === 'string' && f.class ? { class: f.class } : {}),
    length: typeof f.length === 'number' && f.length > 0 ? f.length : 'full',
    hand: f.hand === 'left' ? 'left' : 'right',
    modeled: f.modeled === true,
  };
}

/** Only a plain hole takes a thread: the kernel's counterbore / countersink wall is not a single cylinder to tap. */
export const canThreadHole = (hole: Wire): boolean => kindOf(hole) === 'simple';

/**
 * The hole fields that make the hole the tap drill of a thread size. A metric size the hole table knows with the same tap
 * drill keeps the ISO `size` and `fit: "tap"` (the tidy form); anything else (inch, BSP, a table that differs) becomes a plain
 * `diameter`. `null` removes a field (the editor sends a replace for those).
 */
export function tapHolePatch(row: ThreadRow): Wire {
  const iso = row.standard === 'metric' ? ISO_TABLE[row.size] : undefined;
  if (iso && Math.abs(iso.tap - row.tapDrill) < 1e-9) return { size: row.size, fit: 'tap', diameter: null };
  return { diameter: row.tapDrill, size: null, fit: null };
}

/** The thread a hole starts with: the hole's own ISO size when it is a metric one, else the size whose tap drill is nearest to the hole diameter. */
export function defaultHoleThread(hole: Wire, rows: ThreadRow[]): { cfg: HoleThread; row: ThreadRow } | null {
  const own = typeof hole.size === 'string' && hole.diameter === undefined ? rows.find((r) => r.size === hole.size) : undefined;
  const dia = holeDiameter(hole);
  const row = own ?? (dia !== null ? nearestSizes(rows, dia, true)[0] : rows[0]);
  if (!row) return null;
  const cls = defaultClass(row, true);
  return { row, cfg: { standard: row.standard, size: row.size, ...(cls ? { class: cls } : {}), length: 'full', hand: 'right', modeled: loadThreadPrefs().modeled === true } };
}

/** The longest thread the hole can take: the depth of a blind hole, else the length of the wall when the view knows it, else unknown. */
export function threadMaxLength(hole: Wire, wallLength: number | null): number | null {
  if (hole.end === 'blind' && typeof hole.depth === 'number' && hole.depth > 0) return hole.depth;
  return wallLength;
}

/** A custom length held to the cap (a blind hole's depth); "full" is already the whole wall. */
export function capLength(cfg: HoleThread, max: number | null): HoleThread {
  return typeof cfg.length === 'number' && max !== null && cfg.length > max ? { ...cfg, length: max } : cfg;
}

/** The thread feature a draft stands for on one wall: the linked feature's other fields kept, the editable ones written, `class` dropped when empty. */
export function threadFeature(face: string, cfg: HoleThread, base?: Wire | null): Wire {
  const { class: cls, ...rest } = { ...(base ?? {}), type: 'thread', face, ...cfg } as Wire;
  return { ...rest, ...(cls ? { class: cls } : {}) };
}

/**
 * The ops that bring the threads on a hole's walls to `cfg` (null: none). `walls` are the hole's wall faces, one per position;
 * each gets the thread (added, or replaced when its settings differ), all with the same settings. Nothing when the document
 * already is that. Together with the hole's own ops they go in one batch, so Apply is one undo step.
 */
export function holeThreadEditOps(holeId: string, linked: Wire[], cfg: HoleThread | null, walls: string[] = []): EditOp[] {
  if (!cfg) return linked.filter((l) => typeof l.id === 'string').map((l) => ({ op: 'remove', id: l.id as string } as EditOp));
  const faces = walls.length ? walls : [holeWallFace(holeId)];
  const ops: EditOp[] = [];
  for (const face of faces) {
    const have = linked.find((l) => l.face === face);
    const feature = threadFeature(face, cfg, have);
    if (!have) ops.push({ op: 'add', feature: feature as never });
    else if (JSON.stringify(sorted(feature)) !== JSON.stringify(sorted(have))) ops.push({ op: 'replace', id: String(have.id), feature: feature as never } as EditOp);
  }
  return ops;
}
const sorted = (o: Wire): Wire => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
