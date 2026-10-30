// What the feature tree lists, as plain data (no DOM): the feature rows and the fixed reference rows above them. main.tsx renders these with FeatureTree,
// and tests read them to say what the user sees, without a browser.
import type { FeatureRow, RefRow } from '@kit/ui';
import { t } from './i18n';
import { isPointSketch, featureLabel } from './featureCreators';
import { readCosmeticKnurls } from './knurl';
import { patternedBy, threadParents } from './patternThreads';

/** The ids a feature refers to by name in its fields (sketches, paths, sections ...): the tree tucks the sketches among them under it. */
export const usedSketches = (f: unknown): string[] => {
  const out: string[] = [];
  for (const v of Object.values(f as Record<string, unknown>)) {
    for (const x of Array.isArray(v) ? v : [v]) {
      const id = typeof x === 'string' ? x : x && typeof x === 'object' ? (x as { id?: unknown }).id : undefined;   // a path is {kind:'sketch', id}
      if (typeof id === 'string' && /^[A-Za-z]+\d*$/.test(id)) out.push(id);
    }
  }
  return out;
};

type Doc = { name?: string; material?: string; features: Array<{ id: string; type: string; name?: string }> };

/** One row per feature of the document, in order. */
export function featureRows(doc: Doc): FeatureRow[] {
  const wire = doc.features as unknown as Array<Record<string, unknown>>;
  const threadUnder = threadParents(wire);
  const patterned = patternedBy(wire);
  return doc.features.map((f) => ({
    id: f.id, type: f.type,
    name: f.type === 'plane' || f.type === 'sketch' ? featureLabel(doc as never, f as never) : f.name,
    op: f.type === 'sketch' && isPointSketch(f as never) ? 'point' : (f as { op?: string }).op,
    suppressed: (f as { suppressed?: boolean }).suppressed,
    uses: usedSketches(f), under: threadUnder[f.id], group: (f as { group?: string }).group,
    note: patterned[f.id] ? t('tree.patternedBy', { id: patterned[f.id].join(', ') }) : undefined,
  }));
}

/** The fixed rows above the features: material, the three planes, the origin. `swatch` is the part's colour. */
export function refRows(doc: Doc, swatch?: string): RefRow[] {
  return [
    { id: 'material', label: t('app.ref.material', { name: doc.material ?? t('app.ref.noMaterial') }), icon: 'ref-material', swatch, editable: true, editLabel: t('material.edit') },
    { id: 'front', label: t('app.ref.front'), icon: 'feature-plane', tag: 'XY', choosable: true },
    { id: 'top', label: t('app.ref.top'), icon: 'feature-plane', tag: 'XZ', choosable: true },
    { id: 'right', label: t('app.ref.right'), icon: 'feature-plane', tag: 'ZY', choosable: true },
    { id: 'origin', label: t('app.ref.origin'), icon: 'ref-origin', choosable: true },
  ];
}

/** A cosmetic knurl is a record in the document, not a feature, so the history cannot list it: it gets a row of its own below the reference rows.
 *  The row is editable (click, Enter or the pencil) and opens the Knurl wizard on that record; its id is `knurl:<index into cosmeticKnurls>`. */
export function treeKnurlRows(doc: unknown): RefRow[] {
  return readCosmeticKnurls((doc as Record<string, unknown> | null)?.cosmeticKnurls)
    .map((k, i) => ({ id: 'knurl:' + i, label: t('knurl.cosmeticRow', { n: i + 1, count: k.count }), icon: 'add-knurl', editable: true, editLabel: t('knurl.rowEdit') }));
}
