// Hole data and the pure rules of the Hole editor: the ISO size table the kernel uses, the diameter a (kind, size, fit)
// gives, the defaults for a new hole, and the draft patches each control makes. No DOM here, so all of it is tested
// without a browser (holeData.test.ts; holeData.kernel.test.ts compares the table against the kernel).

export type HoleKind = 'simple' | 'cbore' | 'csink';
export type HoleFit = 'tap' | 'close' | 'normal' | 'loose';
export type HoleEnd = 'blind' | 'through' | 'upToNext';
export const HOLE_KINDS: HoleKind[] = ['simple', 'cbore', 'csink'];
export const HOLE_FITS: HoleFit[] = ['tap', 'close', 'normal', 'loose'];
export const HOLE_ENDS: HoleEnd[] = ['blind', 'through', 'upToNext'];
/** The value of the Size dropdown that means "no ISO size, type the diameter" (a plain hole only). */
export const CUSTOM = 'custom';
/** Included angle of the drill point (the kernel's `tip`). */
export const DRILL_TIP_ANGLE = 118;
export const CSK_ANGLE = 90;
/**
 * The kernel parses cboreDiameter / cboreDepth / cskDiameter / cskAngle, but today a counterbore is cut with the ISO
 * table values for the size and a countersink is cut as a plain hole (hole.rs, exec_hole). The editor still writes the
 * fields (so the wire is ready) and says so. holeData.kernel.test.ts fails when the kernel starts using them: then set
 * this to true.
 */
export const KERNEL_CUTS_CUSTOM_DIMS = true;

/**
 * ISO metric rows, mirrored from the `ISO` table in rebuild/crates/ck-model/src/features/hole.rs (holeData.test.ts
 * parses that file and fails when a number differs). Columns: tap drill, close, normal and loose clearance diameter,
 * counterbore diameter, counterbore depth, countersink diameter. Counterbore values are the ISO 4762 socket head
 * counterbore (ISO 4762 / DIN 974 series), countersink diameters the ISO 10642 head; plain numbers in mm.
 */
export interface IsoRow { tap: number; close: number; normal: number; loose: number; cboreD: number; cboreDepth: number; cskD: number }
const ROWS: Array<[string, number[]]> = [
  ['M2', [1.6, 2.2, 2.4, 2.6, 4.3, 2.3, 4.4]],
  ['M2.5', [2.05, 2.7, 2.9, 3.1, 5.0, 2.8, 5.5]],
  ['M3', [2.5, 3.2, 3.4, 3.6, 6.5, 3.4, 6.5]],
  ['M4', [3.3, 4.3, 4.5, 4.8, 8.0, 4.4, 8.6]],
  ['M5', [4.2, 5.3, 5.5, 5.8, 10.0, 5.4, 10.4]],
  ['M6', [5.0, 6.4, 6.6, 7.0, 11.0, 6.4, 12.4]],
  ['M8', [6.8, 8.4, 9.0, 10.0, 15.0, 8.6, 16.4]],
  ['M10', [8.5, 10.5, 11.0, 12.0, 18.0, 10.6, 20.4]],
  ['M12', [10.2, 13.0, 13.5, 14.5, 20.0, 12.6, 24.4]],
  ['M16', [14.0, 17.0, 17.5, 18.5, 26.0, 16.6, 32.4]],
  ['M20', [17.5, 21.0, 22.0, 24.0, 33.0, 20.6, 40.4]],
  ['M24', [21.0, 25.0, 26.0, 28.0, 40.0, 24.8, 48.4]],
];
export const ISO_TABLE: Record<string, IsoRow> = Object.fromEntries(ROWS.map(([n, r]) => [n, { tap: r[0], close: r[1], normal: r[2], loose: r[3], cboreD: r[4], cboreDepth: r[5], cskD: r[6] }]));
export const ISO_SIZES: string[] = ROWS.map(([n]) => n);

type Wire = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
export const kindOf = (f: Wire): HoleKind => (f.kind === 'cbore' || f.kind === 'csink' ? f.kind : 'simple');

/** The fit the kernel really uses: `tap` exists for a plain hole only, anything unknown is normal. */
export function effectiveFit(kind: HoleKind, fit: unknown): HoleFit {
  if (fit === 'close' || fit === 'loose') return fit;
  if (fit === 'tap' && kind === 'simple') return 'tap';
  return 'normal';
}

/**
 * The diameter of the hole shaft, as the kernel computes it: a plain `diameter` wins on a simple hole, otherwise the
 * ISO row by fit. null when it is invalid (unknown size).
 */
export function holeDiameter(f: Wire): number | null {
  const kind = kindOf(f);
  if (kind === 'simple' && f.diameter !== undefined && f.diameter !== null) return num(f.diameter);
  const row = ISO_TABLE[str(f.size) ?? ''];
  return row ? row[effectiveFit(kind, f.fit)] : null;
}

/** The size dropdown's current value: the ISO size, or `custom` when the hole has a plain diameter. */
export function sizeChoice(f: Wire): string {
  const kind = kindOf(f);
  if (kind === 'simple' && f.diameter !== undefined && f.diameter !== null) return CUSTOM;
  return str(f.size) ?? CUSTOM;
}

const round = (v: number) => Math.round(v * 100) / 100;
export function defaultDepth(d: number | null): number { return Math.max(10, round((d ?? 5) * 2)); }

export interface HolePrefs { kind: HoleKind; size: string; fit: HoleFit }
export const DEFAULT_PREFS: HolePrefs = { kind: 'simple', size: 'M6', fit: 'normal' };
const PREFS_KEY = 'kit.hole.prefs';

export function loadHolePrefs(): HolePrefs {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(PREFS_KEY) ?? 'null') as Partial<HolePrefs> | null;
    if (!raw) return DEFAULT_PREFS;
    const kind = HOLE_KINDS.includes(raw.kind as HoleKind) ? raw.kind as HoleKind : DEFAULT_PREFS.kind;
    const size = typeof raw.size === 'string' && ISO_TABLE[raw.size] ? raw.size : DEFAULT_PREFS.size;
    const fit = effectiveFit(kind, HOLE_FITS.includes(raw.fit as HoleFit) ? raw.fit : 'normal');
    return { kind, size, fit };
  } catch { return DEFAULT_PREFS; }
}
/** Remember the type, size and fit of a confirmed hole as the next default. A custom diameter is not remembered. */
export function saveHolePrefs(f: Wire): void {
  const size = str(f.size);
  if (!size || !ISO_TABLE[size] || sizeChoice(f) === CUSTOM) return;
  const kind = kindOf(f);
  try { globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify({ kind, size, fit: effectiveFit(kind, f.fit) } satisfies HolePrefs)); } catch { /* storage may be blocked */ }
}

/** Counterbore / countersink fields for a kind and ISO size (null values mean "remove the field"). */
function dimsFor(kind: HoleKind, size: string | null): Wire {
  const row = ISO_TABLE[size ?? ''];
  const none = { cboreDiameter: null, cboreDepth: null, cskDiameter: null, cskAngle: null };
  if (!row) return none;
  if (kind === 'cbore') return { ...none, cboreDiameter: row.cboreD, cboreDepth: row.cboreDepth };
  if (kind === 'csink') return { ...none, cskDiameter: row.cskD, cskAngle: CSK_ANGLE };
  return none;
}

/** The feature a new hole starts as (Shift+H): the remembered type / size / fit, a through hole. */
export function newHole(sketchId: string, flip: boolean, prefs: HolePrefs = loadHolePrefs()): Wire {
  const dims = Object.fromEntries(Object.entries(dimsFor(prefs.kind, prefs.size)).filter(([, v]) => v !== null));
  return { type: 'hole', sketch: sketchId, kind: prefs.kind, size: prefs.size, fit: effectiveFit(prefs.kind, prefs.fit), end: 'through', ...dims, ...(flip ? { flip: true } : {}) };
}

/**
 * What each control changes. A patch is `{field: value}`; `null` means the field is removed from the feature (a plain
 * `diameter` left next to a `size` would win in the kernel, so it must really go). `f` is the feature with the draft
 * applied.
 */
export function patchKind(f: Wire, kind: HoleKind): Wire {
  const keepSize = ISO_TABLE[str(f.size) ?? ''] ? str(f.size)! : null;
  if (kind === 'simple') return { kind, ...dimsFor('simple', null) };
  // a counterbore / countersink hole is always an ISO size (the kernel has no plain-diameter form for them)
  const size = keepSize ?? DEFAULT_PREFS.size;
  return { kind, size, diameter: null, fit: effectiveFit(kind, f.fit), ...dimsFor(kind, size) };
}
export function patchSize(f: Wire, choice: string): Wire {
  const kind = kindOf(f);
  if (choice === CUSTOM) {
    if (kind !== 'simple') return {};
    return { size: null, fit: null, diameter: holeDiameter(f) ?? 6.6 };
  }
  return { size: choice, diameter: null, fit: effectiveFit(kind, f.fit ?? 'normal'), ...dimsFor(kind, choice) };
}
export function patchFit(f: Wire, fit: HoleFit): Wire { return { fit: effectiveFit(kindOf(f), fit) }; }
export function patchEnd(f: Wire, end: HoleEnd): Wire {
  if (end !== 'blind') return { end };
  const d = num(f.depth);
  return { end, ...(d && d > 0 ? {} : { depth: defaultDepth(holeDiameter(f)) }) };
}
