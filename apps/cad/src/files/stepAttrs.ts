// Pure helpers for STEP AP214/AP242 body colors and names on import and export.
// No kernel, no DOM.
import type { BodyLookSpec, ViewBodyDef } from '@kit/viewport';
import type { BodyFields, BodyRow } from '../bodies';
import { NAME_PREFIX } from '../bodies';
import type { ImportPart } from './importReport';

export type StepRgb = [number, number, number];

export interface StepViewLook {
  bodies: ViewBodyDef[];
  looks: Record<string, BodyLookSpec>;
  faces: Record<string, BodyLookSpec>;
}

const SYNTHETIC_SOLID = /^solid #\d+$/;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Convert a STEP RGB triple (0..1 floats) to lowercase `#rrggbb`, or null when invalid. */
export function rgbToHex(rgb: readonly number[] | null | undefined): string | null {
  if (!Array.isArray(rgb) || rgb.length < 3) return null;
  const [r, g, b] = rgb;
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return null;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  const ch = (c: number) => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0');
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}

/** Convert `#rrggbb` (or `#rgb`) hex color to a STEP RGB triple in 0..1, or null when invalid. */
export function hexToRgb(hex: string | null | undefined): StepRgb | null {
  if (typeof hex !== 'string') return null;
  const s = hex.trim();
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
  if (m6) return [parseInt(m6[1], 16) / 255, parseInt(m6[2], 16) / 255, parseInt(m6[3], 16) / 255];
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m3) return [parseInt(m3[1] + m3[1], 16) / 255, parseInt(m3[2] + m3[2], 16) / 255, parseInt(m3[3] + m3[3], 16) / 255];
  return null;
}

/**
 * Resolve the kernel's deduplicated lump names for imported STEP parts, mirroring `sort_step`:
 * empty labels and synthetic `solid #<entity>` fallbacks map to null; duplicate solid names get ` 2`, ` 3`, ...
 */
export function stepPartBodyNames(parts: readonly ImportPart[]): Array<string | null> {
  const used = new Set<string>();
  return parts.map((p) => {
    if (p.outcome !== 'solid') return null;
    const base = p.label.trim();
    if (!base || SYNTHETIC_SOLID.test(base)) return null;
    let cand = base;
    let n = 2;
    while (used.has(cand)) {
      cand = `${base} ${n}`;
      n++;
    }
    used.add(cand);
    return cand;
  });
}

/**
 * Build document `appearance` entries from imported STEP parts:
 * - Named solids use `@name:<bodyName>` so colors survive rebuilds and edits.
 * - An unnamed solid with a color falls back to `featureId` (when given); `@name:` entries always override it.
 */
export function stepImportAppearance(parts: readonly ImportPart[], featureId?: string): Record<string, BodyLookSpec> {
  const names = stepPartBodyNames(parts);
  const out: Record<string, BodyLookSpec> = {};
  parts.forEach((p, i) => {
    if (p.outcome !== 'solid') return;
    const hex = rgbToHex(p.color);
    if (!hex) return;
    const name = names[i];
    if (name) out[NAME_PREFIX + name] = { color: hex };
    else if (featureId && !out[featureId]) out[featureId] = { color: hex };
  });
  return out;
}

/**
 * Build a viewport look spec for a view-only STEP import so AP214/AP242 colors render immediately
 * without modifying the active document. Returns null when no part carries a color.
 */
export function stepViewLook(
  body: { faceBody?: unknown; bodyNames?: unknown } | null | undefined,
  faceIds: readonly string[],
  parts: readonly ImportPart[],
): StepViewLook | null {
  if (!faceIds.length || !parts.length) return null;
  const names = stepPartBodyNames(parts);
  const byName = new Map<string, string>();
  const bySolid = new Map<number, string>();
  parts.forEach((p, i) => {
    if (p.outcome !== 'solid') return;
    const hex = rgbToHex(p.color);
    if (!hex) return;
    if (names[i]) byName.set(names[i]!, hex);
    bySolid.set(i + 1, hex);
  });
  if (!byName.size && !bySolid.size) return null;

  const fb = Array.isArray(body?.faceBody) ? (body!.faceBody as number[]) : null;
  const bnames = Array.isArray(body?.bodyNames) ? (body!.bodyNames as Array<string | null>) : null;
  const groups = new Map<number, string[]>();
  if (fb && fb.length) {
    for (let i = 0; i < fb.length && i < faceIds.length; i++) {
      const g = groups.get(fb[i]);
      if (g) g.push(faceIds[i]); else groups.set(fb[i], [faceIds[i]]);
    }
  } else {
    groups.set(0, [...faceIds]);
  }

  const bodies: ViewBodyDef[] = [];
  const looks: Record<string, BodyLookSpec> = {};
  for (const [idx, faces] of groups) {
    const kname = typeof bnames?.[idx] === 'string' && bnames[idx] ? bnames[idx]! : null;
    let hex = kname ? byName.get(kname) : undefined;
    if (!hex) {
      const m = /^I(\d+)\./.exec(faces[0] ?? '');
      if (m) hex = bySolid.get(Number(m[1]));
      else if (groups.size === 1 && bySolid.size === 1) hex = bySolid.values().next().value;
    }
    if (!hex) continue;
    const key = `step:${idx}`;
    bodies.push({ key, faces, edges: [] });
    looks[key] = { color: hex };
  }
  return bodies.length ? { bodies, looks, faces: {} } : null;
}

/**
 * Build the `colors` map (`Record<string, [r, g, b]>` in 0..1) for the kernel's `step` export request:
 * - Keys by body name (`docName` / `@name:<name>`) to match `body.lump(l).name` in the kernel.
 * - For unnamed lumps, also keys by lump index (`"0"`, `"1"`, ...) so single-body and unnamed multi-body
 *   exports carry their document colors.
 */
export function stepExportColors(
  rows: ReadonlyArray<Pick<BodyRow, 'key' | 'name' | 'docName' | 'look'>>,
  fields?: Pick<BodyFields, 'appearance'>,
  lumpIndexByKey?: ReadonlyMap<string, number>,
): Record<string, StepRgb> {
  const out: Record<string, StepRgb> = {};
  const app = fields?.appearance;
  if (app) {
    for (const [k, look] of Object.entries(app)) {
      if (!k.startsWith(NAME_PREFIX)) continue;
      const bodyName = k.slice(NAME_PREFIX.length);
      if (!bodyName) continue;
      const rgb = hexToRgb(look?.color);
      if (rgb) out[bodyName] = rgb;
    }
  }
  rows.forEach((row, i) => {
    const rgb = hexToRgb(row.look.color);
    if (!rgb) return;
    if (row.docName) {
      out[row.docName] = rgb;
    } else {
      if (row.name) out[row.name] = rgb;
      const idx = lumpIndexByKey?.get(row.key) ?? i;
      out[String(idx)] = rgb;
    }
  });
  return out;
}
