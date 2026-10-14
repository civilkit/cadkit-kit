// The one-line selection summary for the status bar: '3 faces, 12.4 cm²'.
import { t } from '../i18n';
import { areaText, lengthText, type Summary } from './actions';

export function summaryText(s: Summary): string {
  const n = (one: string, many: string, c: number) => (c ? [t(c === 1 ? one : many, { n: c })] : []);
  const parts = [
    ...n('select.sum.body', 'select.sum.bodies', s.bodies),
    ...n('select.sum.face', 'select.sum.faces', s.faces),
    ...n('select.sum.edge', 'select.sum.edges', s.edges),
    ...n('select.sum.corner', 'select.sum.corners', s.corners),
  ];
  if (!parts.length) return '';
  const size: string[] = [];
  if (s.area > 0) size.push(areaText(s.area));
  if (s.length > 0) size.push(lengthText(s.length));
  return [parts.join(', '), ...size].join(', ');
}
