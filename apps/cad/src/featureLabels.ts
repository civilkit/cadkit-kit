// Leaf helpers: the live display name of a feature (generated Plane / Sketch names follow their offset, base and plane).
import { fmtNum } from '@kit/ui';
import { t } from './i18n';
import { planeName } from './planeNames';
import type { Feat } from './sketchKinds';

export type RefIn = { kind?: string; id?: string } | null | undefined;
export type DocIn = { features?: unknown[] } | null | undefined;
const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A regex for a default-name template such as `Plane {offset} from {base}`: the old documents carry no autoName flag, so their names are recognised by shape. */
const templateRe = (key: string) => new RegExp('^' + t(key).split(/\{\w+\}/).map(escRe).join('.+') + '$');
/** True when a Plane or Sketch still carries a generated name (autoName true, or an old document whose name has the generated shape and was not renamed by the user). */
export function hasAutoName(f: { type?: string; name?: unknown; autoName?: unknown } | null | undefined): boolean {
  if (!f) return false;
  if (f.autoName === true) return true;
  if (f.autoName === false) return false;
  const n = typeof f.name === 'string' ? f.name : '';
  if (f.type === 'plane') return !n || templateRe('app.plane.defaultName').test(n) || templateRe('app.plane.midName').test(n) || templateRe('app.plane.angleName').test(n) || templateRe('app.plane.angleOffsetName').test(n);
  if (f.type === 'sketch') return templateRe('app.sketch.defaultName').test(n);
  return false;
}
/** The name a feature is shown under: a generated Plane / Sketch name is derived live from its current offset, base and plane (so `Plane -60 from Right` stays true when the offset is edited); a user's name is kept. */
export function featureLabel(doc: DocIn, f: Feat | undefined | null): string {
  if (!f) return '';
  const name = typeof f.name === 'string' ? f.name : '';
  try {
    if (f.type === 'plane' && hasAutoName(f as never) && (f.mode === 'offset' || f.mode === 'mid' || f.mode === 'angle' || f.mode === undefined)) return planeDefaultName(doc, f as never);
    if (f.type === 'sketch' && hasAutoName(f as never) && f.plane && (f.plane as { kind?: string }).kind !== 'face') return t('app.sketch.defaultName', { plane: refLabel(doc, f.plane as never) });
  } catch { /* a field of an unexpected shape never takes the tree down: show the stored name */ }
  return name || String(f.id ?? '');
}
/** What a reference counts as in a default name: Front / Top / Right, a plane feature's displayed label (never a stale stored one), or the face id. */
export function refLabel(doc: DocIn, ref: RefIn): string {
  if (!ref?.id) return planeName('front');
  if (ref.kind === 'std') return planeName(ref.id).replace(/ Plane$/, '');
  const f = ((doc?.features ?? []) as Feat[]).find((x) => x.id === ref.id);
  return f ? featureLabel(doc, f) : ref.id;
}
/** The default name of a new Plane feature: `Plane -60 from Front` (offset) or `Plane between A and B`. */
export function planeDefaultName(doc: DocIn, f: { mode?: string; base?: RefIn; base2?: RefIn; offset?: number | string; angle?: number | string }): string {
  if (f.mode === 'angle') {
    const off = Number(f.offset);
    return off ? t('app.plane.angleOffsetName', { angle: fmtNum(f.angle), offset: fmtNum(f.offset), base: refLabel(doc, f.base) }) : t('app.plane.angleName', { angle: fmtNum(f.angle), base: refLabel(doc, f.base) });
  }
  if (f.mode === 'mid') return t('app.plane.midName', { a: refLabel(doc, f.base), b: refLabel(doc, f.base2) });
  return t('app.plane.defaultName', { offset: fmtNum(f.offset), base: refLabel(doc, f.base) });
}
