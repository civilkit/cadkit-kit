// Forgiving option parsing for callers that are not TypeScript (the MCP snapshot tool, scripts): the wrong spelling of a value
// gets coerced or answered with the list of valid ones instead of a crash.
import type { Dimension, SheetName, SnapshotInput, SnapshotOpts } from './types.js';

export const SHEET_NAMES: readonly SheetName[] = ['single', 'orthos', 'drawing-third-angle', 'drawing-first-angle', 'ab', 'section'];
export const SHEET_HELP = "single (one view, default) | orthos (front, top, right and iso panels) | drawing-third-angle | drawing-first-angle (projected views with overall dimensions and a title block) | ab (before / after, two views side by side) | section (needs `section`)";

/** true -> 'drawing-third-angle', false / undefined -> 'single', a valid name stays; anything else throws with the valid names listed. */
export function coerceSheet(v: unknown): SheetName {
  if (v === undefined || v === null || v === false) return 'single';
  if (v === true) return 'drawing-third-angle';
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if ((SHEET_NAMES as readonly string[]).includes(s)) return s as SheetName;
    const alias: Record<string, SheetName> = { drawing: 'drawing-third-angle', third: 'drawing-third-angle', 'third-angle': 'drawing-third-angle', first: 'drawing-first-angle', 'first-angle': 'drawing-first-angle', ortho: 'orthos', views: 'orthos' };
    if (alias[s]) return alias[s];
  }
  throw new Error(`snapshot: unknown sheet ${JSON.stringify(v)}; valid sheets: ${SHEET_NAMES.join(', ')} (true means drawing-third-angle)`);
}

/** 'ortho' | 'orthographic' | 'parallel' -> 'ortho'; 'persp' | 'perspective' -> 'persp'. */
export function coerceProjection(v: unknown): 'ortho' | 'persp' | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (['ortho', 'orthographic', 'orthogonal', 'parallel'].includes(s)) return 'ortho';
  if (['persp', 'perspective'].includes(s)) return 'persp';
  throw new Error(`snapshot: unknown projection ${JSON.stringify(v)}; use 'ortho' (alias 'orthographic') or 'persp' (alias 'perspective')`);
}

/** The three overall extents of the bounding box as dimension lines (for `annotate: true`). */
export function boxDimensions(box: { min: number[]; max: number[] } | undefined): Dimension[] {
  if (!box) return [];
  const { min, max } = box;
  const dims: Dimension[] = [];
  for (let a = 0; a < 3; a++) {
    if (max[a] - min[a] < 1e-6) continue;
    // run each extent along the front-bottom edge of its axis, away from the other two minima
    const from = [min[0], min[1], min[2]] as [number, number, number];
    const to = [min[0], min[1], min[2]] as [number, number, number];
    to[a] = max[a];
    dims.push({ from, to });
  }
  return dims;
}

/** Options as the renderer wants them: sheet, projection and annotate normalised. */
export function normalizeOpts<T extends Omit<SnapshotOpts, 'annotate' | 'projection' | 'sheet'> & { annotate?: unknown; projection?: unknown; sheet?: unknown }>(opts: T, input?: Pick<SnapshotInput, 'box'>): Omit<T, 'annotate' | 'projection' | 'sheet'> & { annotate?: Dimension[]; projection?: 'ortho' | 'persp'; sheet: SheetName } {
  const { annotate, projection, sheet, ...rest } = opts;
  const out: Record<string, unknown> = { ...rest, sheet: coerceSheet(sheet) };
  const p = coerceProjection(projection);
  if (p) out.projection = p;
  if (annotate === true) { const d = boxDimensions(input?.box); if (d.length) out.annotate = d; }
  else if (Array.isArray(annotate)) out.annotate = annotate;
  return out as never;
}
