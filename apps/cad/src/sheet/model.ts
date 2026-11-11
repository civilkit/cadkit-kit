// Sheet metal: the wire shapes the kernel returns and the pure helpers the commands, editors and flat-pattern view share.
// The kernel's feature and result shapes are documented in its docs/sheet-metal.md; nothing here talks to the kernel.
import type { PartDoc } from '@ck/part-model';

type Feat = { id: string; type: string; suppressed?: boolean; [k: string]: unknown };

/** Feature types the sheet metal tab makes. The flanges, hem, fold and `sheetConvert` build the sheet, `unfold` and `refold` change its state, `sheetCut` and `sheetCorner` shape it. */
export const SHEET_FEATURES = ['sheetRules', 'baseFlange', 'edgeFlange', 'hem', 'fold', 'contourFlange', 'unfold', 'refold', 'sheetConvert', 'sheetCut', 'sheetCorner'] as const;
export type SheetFeatureType = (typeof SHEET_FEATURES)[number];
export const isSheetFeature = (type: string | undefined): boolean => (SHEET_FEATURES as readonly string[]).includes(type ?? '');

export interface SheetBend {
  bend: number; feature?: string; role?: string;
  direction: 'up' | 'down'; angleDeg: number; includedAngleDeg: number; radius: number; allowance: number; length: number;
  start: [number, number]; end: [number, number];
}
/** The flat pattern of a sheet feature: `outline[0]` is the outer loop, the rest are holes; lengths in mm. */
export interface FlatPattern {
  rule: string; thickness: number; kFactor: number; flatSize: [number, number, number];
  outline: number[][][]; bends: SheetBend[]; bendZones: number[][]; unfolded: boolean;
}
/** One entry of the regen result's `sheetMetal[]`: the state of the sheet after the feature `id`. */
export interface SheetEntry { id: string; type: string; rule?: Record<string, unknown>; flatPattern: FlatPattern; roles?: unknown }

const feats = (doc: PartDoc | null | undefined): Feat[] => ((doc?.features ?? []) as unknown as Feat[]).filter((f) => !f.suppressed);

/** The sheet features of a document, in order. */
export const sheetFeatures = (doc: PartDoc | null | undefined): Feat[] => feats(doc).filter((f) => isSheetFeature(f.type));
/** The rule features (`sheetRules`) of a document. */
export const rulesOf = (doc: PartDoc | null | undefined): Feat[] => feats(doc).filter((f) => f.type === 'sheetRules');
/** Whether the document has a first plate (a base flange, a contour flange, or a solid converted to a sheet): the flange, hem, fold, cut, corner and unfold tools need one. */
export const hasSheetBase = (doc: PartDoc | null | undefined): boolean => feats(doc).some((f) => f.type === 'baseFlange' || f.type === 'contourFlange' || f.type === 'sheetConvert');
/** Whether the sheet is flat right now: the last `unfold` / `refold` is an unfold. While it is, flanges, hems and folds are refused by the kernel. */
export function isUnfolded(doc: PartDoc | null | undefined): boolean {
  const last = [...feats(doc)].reverse().find((f) => f.type === 'unfold' || f.type === 'refold');
  return last?.type === 'unfold';
}
/** The rule a new base flange would use: the last `active` rule, else none (the kernel then uses its defaults). */
export function activeRule(doc: PartDoc | null | undefined): Feat | null {
  const all = rulesOf(doc);
  return [...all].reverse().find((r) => r.active !== false) ?? null;
}
/** The thickness of the sheet a new flange would be made on, for default sizes: the active rule's, else 2 mm (the kernel's default is 2.5 for a rule with none). */
export const sheetThickness = (doc: PartDoc | null | undefined): number => {
  const conv = feats(doc).find((f) => f.type === 'sheetConvert')?.thickness;   // a converted sheet is as thick as it was told (else the rule's; the kernel reads it from the body)
  if (typeof conv === 'number' && conv > 0) return conv;
  const t = activeRule(doc)?.thickness;
  return typeof t === 'number' && t > 0 ? t : 2.5;
};
/** The default rule a first base flange adds when the part has none: 2 mm steel-like stock (the kernel fills in the other fields from the thickness). */
export const defaultRule = (name = 'Sheet 2 mm'): Record<string, unknown> => ({ type: 'sheetRules', name, thickness: 2, kFactor: 0.44, active: true });

/** Whether this feature id is a sheet feature in the document (the tree shows its icon and the flat pattern follows it). */
export function sheetFeatureIds(doc: PartDoc | null | undefined): string[] { return sheetFeatures(doc).map((f) => f.id); }

/** The flat pattern after the last sheet feature, or null when the sheet has no first plate yet. */
export const lastFlat = (entries: SheetEntry[] | null | undefined): SheetEntry | null => {
  const list = (entries ?? []).filter((e) => e.flatPattern);
  return list.length ? list[list.length - 1] : null;
};

/** The bounding box of the outer loop [xmin, ymin, xmax, ymax] (empty outline: zeros). */
export function outlineBounds(fp: FlatPattern): [number, number, number, number] {
  const pts = fp.outline[0] ?? [];
  if (!pts.length) return [0, 0, 0, 0];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** The tab to select when the document becomes (or stops being) a sheet metal part: it opens on the Sheet tab; leaving sheet work drops that tab back to Home. Else unchanged. */
export function tabForSheetChange(prev: boolean | null, next: boolean, userTab: string): string {
  if (prev === next) return userTab;
  if (next) return 'Sheet';
  if (prev === null) return userTab;
  return userTab === 'Sheet' ? 'Home' : userTab;
}

/** The panels of a sheet entry and their walls, read from the roles of its faces: `P<n>.front`, `P<n>.tip`, `P<n>.side.<name>` ... (P0 is the base plate).
 *  `walls[k]` lists the wall names of panel k as the role grammar spells them after `P<k>.` (`tip`, `side.start`, `side.e2`, `side.w6`). */
export interface PanelInfo { count: number; walls: string[][] }
export function panelInfo(entry: SheetEntry | null | undefined): PanelInfo {
  const faces = (entry?.roles as { faces?: Array<{ role?: string }> } | undefined)?.faces ?? [];
  const walls: string[][] = [];
  for (const f of faces) {
    const m = /^P(\d+)\.(.+)$/.exec(f.role ?? '');
    if (!m) continue;
    const k = +m[1];
    while (walls.length <= k) walls.push([]);
    if (m[2] !== 'front' && m[2] !== 'back' && !walls[k].includes(m[2])) walls[k].push(m[2]);
  }
  return { count: walls.length, walls };
}
/** The number of panels a sheet entry has (0 when it names none). */
export const panelCount = (entry: SheetEntry | null | undefined): number => panelInfo(entry).count;
