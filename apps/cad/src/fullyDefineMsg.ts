import { t } from './i18n';

/** What Fully define added, in words: "3 relations and 1 dimension", "2 relations", "1 dimension" (a kind that added none is left out). */
export function addedSummary(relations: number, dimensions: number): string {
  const rel = relations > 0 ? (relations === 1 ? t('app.sketch.fullyDefined.relations.one', { count: relations }) : t('app.sketch.fullyDefined.relations.other', { count: relations })) : '';
  const dim = dimensions > 0 ? (dimensions === 1 ? t('app.sketch.fullyDefined.dimensions.one', { count: dimensions }) : t('app.sketch.fullyDefined.dimensions.other', { count: dimensions })) : '';
  return rel && dim ? t('app.sketch.fullyDefined.and', { a: rel, b: dim }) : rel || dim;
}
