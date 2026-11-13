// Split body and Lip joint: the defaults of the two commands and the small rules of their option forms (pure; the forms are in FeatureOptions.tsx).
import type { PartDoc } from '@ck/part-model';
import { t } from './i18n';

type Wire = Record<string, unknown>;
export interface Box { min: number[]; max: number[] }

/** The standard plane that cuts a box across its smallest side, at the middle: a case is cut across its height. */
export function defaultSplitPlane(box: Box | null): { plane: { kind: 'std'; id: 'front' | 'top' | 'right' }; offset: number } {
  if (!box) return { plane: { kind: 'std', id: 'front' }, offset: 0 };
  const d = [0, 1, 2].map((i) => box.max[i] - box.min[i]);
  // front moves along +Z, top along +Y, right along +X (the kit's plane convention)
  const i = d.indexOf(Math.min(...d));
  const id = (['right', 'top', 'front'] as const)[i === 0 ? 0 : i === 1 ? 1 : 2];
  const mid = (box.min[i] + box.max[i]) / 2;
  return { plane: { kind: 'std', id }, offset: +mid.toPrecision(8) };
}

/** The names `[below, above]` after one of them is typed: both stay strings, a blank pair removes the field. */
export function newNames(current: unknown, index: 0 | 1, value: string): [string, string] | null {
  const cur = Array.isArray(current) ? current.map(String) : ['', ''];
  const next: [string, string] = [cur[0] ?? '', cur[1] ?? ''];
  next[index] = value.trim();
  return next[0] === '' && next[1] === '' ? null : next;
}

/** The bodies a split can name as its target: `[name, name]`, headed by the one-body default. The names are those of the features before `selfId`
 *  (a `newBody` name, or the halves of an earlier split). Empty when there are none: then the part holds one body. */
export function targetChoices(doc: PartDoc | null, selfId: string, current: unknown): Array<[string, string]> {
  const names = new Set<string>();
  for (const f of (doc?.features ?? []) as unknown as Wire[]) {
    if (f.id === selfId) break;
    if (typeof f.body === 'string' && f.body) names.add(f.body);
    if (f.type === 'split' || f.type === 'lipJoint') for (const n of Array.isArray(f.names) ? (f.names as unknown[]) : []) if (typeof n === 'string') names.add(n);
  }
  const cur = typeof current === 'string' ? current : typeof (current as { body?: unknown } | null)?.body === 'string' ? (current as { body: string }).body : '';
  if (cur) names.add(cur);
  return names.size < 1 ? [] : [['', t('opt.split.target.only')], ...[...names].map((n): [string, string] => [n, n])];
}
