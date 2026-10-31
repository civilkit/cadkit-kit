// One-click fixes the feature editor offers next to a refused edit (pure; main.tsx applies them to the draft).
//   a size too large + the kernel's maxSize      ->  Use the largest size (X mm)   (any feature: shell, move face, draft, thin wall, hole, and fillet / chamfer once the kernel names one)
//   shell too thick + the kernel's maxThickness  ->  Use suggested thickness       (older kernels, no maxSize)
//   cut that misses the body                     ->  Flip direction (with the message `The cut does not touch the body in this direction. Flip?`)
import { t } from './i18n';
import { maxSizeOf, maxSizeText, type MaxSize } from './diagnosticsText';

export type EditorFix = { key: 'thickness'; label: string; path: 'thickness'; value: number } | { key: 'flip'; label: string; path: 'flip'; value: boolean } | { key: 'maxSize'; label: string; path: string; value: unknown };

/** The draft patch that puts the kernel's largest size in its field: a top-level field that holds a number (or is not set), or one level down in an object (`thin.thickness`). Null when the field holds something else (a variable fillet's radii pair) or already has that value. */
export function maxSizeFix(m: MaxSize, eff: Record<string, unknown>): Extract<EditorFix, { key: 'maxSize' }> | null {
  const label = t('diag.fix.maxSize', { size: maxSizeText(m) });
  const [head, ...rest] = m.param.split('.');
  if (rest.length > 1) return null;
  if (rest.length === 1) {
    const parent = eff[head];
    if (!parent || typeof parent !== 'object' || Array.isArray(parent)) return null;
    const cur = (parent as Record<string, unknown>)[rest[0]];
    if ((cur !== undefined && typeof cur !== 'number') || cur === m.value) return null;
    return { key: 'maxSize', label, path: head, value: { ...(parent as Record<string, unknown>), [rest[0]]: m.value } };
  }
  const cur = eff[head];
  if ((cur !== undefined && typeof cur !== 'number') || cur === m.value) return null;
  return { key: 'maxSize', label, path: head, value: m.value };
}
export interface EditorFixes { /** replaces the generic advice line */ message?: string; fixes: EditorFix[] }

/** The largest wall with one decimal that stays under the kernel's maximum (0.05 steps when even 0.1 is too thick). */
export function suggestedThickness(max: unknown): number | null {
  const m = typeof max === 'number' ? max : Number(max);
  if (!Number.isFinite(m) || m <= 0) return null;
  const v = Math.floor((m - 1e-9) * 10) / 10;
  if (v >= 0.1) return Math.round(v * 10) / 10;
  const w = Math.floor((m - 1e-9) * 100) / 100;
  return w >= 0.01 ? Math.round(w * 100) / 100 : null;
}

/** The default Shell wall: 1.0 mm or 2% of the body's smallest bounding-box side, whichever is larger, rounded to 0.1. */
export function defaultShellThickness(box: { min: number[]; max: number[] } | null | undefined): number {
  if (!box) return 1;
  const sides = [0, 1, 2].map((i) => box.max[i] - box.min[i]).filter((x) => Number.isFinite(x) && x > 1e-9);
  const smallest = sides.length ? Math.min(...sides) : 0;
  return Math.round(Math.max(1, 0.02 * smallest) * 10) / 10;
}

export function editorFixes(root: { id?: string; code: string; params?: Record<string, unknown> } | null | undefined, feature: Record<string, unknown> | null | undefined, draft: Record<string, unknown> = {}): EditorFixes {
  if (!root || !feature) return { fixes: [] };
  const eff = { ...feature, ...draft };
  const max = maxSizeOf(root.params);
  // the size is the refused feature's own field: not offered when the edit broke a later feature
  if (max && (root.id === undefined || feature.id === undefined || root.id === feature.id)) {
    const fix = maxSizeFix(max, eff);
    return { fixes: fix ? [fix] : [] };
  }
  if (feature.type === 'shell') {
    const v = suggestedThickness(root.params?.maxThickness);
    if (v !== null && v !== eff.thickness) return { fixes: [{ key: 'thickness', label: t('diag.fix.shellThickness', { value: String(v) }), path: 'thickness', value: v }] };
    return { fixes: [] };
  }
  if ((feature.type === 'extrude' || feature.type === 'revolve') && eff.op === 'cut' && (root.code === 'cutNoEffect' || root.code === 'nothingToCut')) {
    return { message: t('diag.cutFlip'), fixes: [{ key: 'flip', label: t('opt.flip'), path: 'flip', value: eff.flip !== true }] };
  }
  return { fixes: [] };
}

/** Which way a new cut should go: `auto` tries the side the body is on first, then the other, and keeps the one that touches the body. `probe` builds the feature with that flip and says whether it worked and the error codes. */
export async function autoCutFlip(first: boolean, probe: (flip: boolean) => Promise<{ ok: boolean; codes: string[] }>): Promise<{ flip: boolean; ok: boolean }> {
  const a = await probe(first);
  if (a.ok) return { flip: first, ok: true };
  if (!a.codes.some((c) => c === 'cutNoEffect' || c === 'nothingToCut')) return { flip: first, ok: false };
  const b = await probe(!first);
  return b.ok ? { flip: !first, ok: true } : { flip: first, ok: false };
}

/** A cut that removed nothing: `nothing` when there is no body under the sketch at all, `miss` when a body exists but this cut does not reach it. */
export function cutProblem(feature: Record<string, unknown> | null | undefined, roots: Array<{ code: string }> | null | undefined): 'nothing' | 'miss' | null {
  if (!feature || (feature.type !== 'extrude' && feature.type !== 'revolve') || feature.op !== 'cut' || !roots) return null;
  if (roots.some((r) => r.code === 'nothingToCut')) return 'nothing';
  return roots.some((r) => r.code === 'cutNoEffect') ? 'miss' : null;
}
