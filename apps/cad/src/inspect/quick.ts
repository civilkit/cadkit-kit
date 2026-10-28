// Quick measurement: the size of what is selected, as a few lines of text for a corner of the view. Pure: the picks and the
// Measure tool's outcome for them go in, the lines come out, so the corner and the Measure tool always read the same numbers.
//   one straight edge   length                        one round edge   diameter, radius, circumference (length for an arc)
//   one face            area (and radius, diameter of a round face)
//   two items           distance, angle (when they have one)
//   more                the selection summary (count and total)
import { t } from '../i18n';
import { dist } from './geometry';
import { rowText, type Outcome, type Pick, type Row } from './measure';

const line = (label: string, r: Row | undefined): string[] => (r ? [`${label}: ${rowText(r)}`] : []);

/** A round edge that closes on itself has a circumference; an arc only a length. */
const closedCircle = (p: Pick): boolean => {
  if (p.kind !== 'edge' || !p.edge.circle) return false;
  const pts = p.edge.pts ?? [];
  return pts.length < 2 || dist(pts[0], pts[pts.length - 1]) < 1e-6 * Math.max(1, p.edge.circle.r);
};

/**
 * `outcome` is what `measure()` answered for the picks (null while it is pending); `summary` is the selection's count and
 * total text, used for more than two items and when the picks have no size of their own (a whole body).
 */
export function quickLines(picks: Pick[], outcome: Outcome | null, summary = ''): string[] {
  if (!picks.length) return [];
  const fallback = summary ? [summary] : [];
  if (picks.length > 2) return fallback.length ? fallback : [t('quick.count', { n: picks.length })];
  if (!outcome || outcome.error) return picks.length === 1 && picks[0].kind !== 'vertex' ? fallback : [];
  const get = (id: string) => outcome.rows.find((r) => r.id === id);
  let out: string[];
  if (picks.length === 2) out = [...line(t('measure.distance'), get('distance')), ...line(t('measure.angle'), get('angle'))];
  else if (picks[0].kind === 'edge' && picks[0].edge.circle) {
    out = [...line(t('measure.diameter'), get('diameter')), ...line(t('measure.radius'), get('radius')),
      ...line(t(closedCircle(picks[0]) ? 'quick.circumference' : 'measure.length'), get('length'))];
  } else if (picks[0].kind === 'edge') out = line(t('measure.length'), get('length'));
  else if (picks[0].kind === 'face') out = [...line(t('measure.area'), get('area')), ...line(t('measure.diameter'), get('diameter')), ...line(t('measure.radius'), get('radius'))];
  else return [];   // a lone corner has a position, not a size
  return out.length ? out : fallback;
}
