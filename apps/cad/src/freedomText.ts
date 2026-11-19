/** Words for the freedom findings and their suggestions (pure over the sketch package's freedom.ts). */
import type { FreeItem, Suggestion, TooltipItem } from '@kit/sketch';
import { t } from './i18n';

const typeName = (type: string): string => {
  switch (type) {
    case 'line': return t('app.sketch.free.type.line');
    case 'circle': return t('app.sketch.free.type.circle');
    case 'arc': return t('app.sketch.free.type.arc');
    case 'point': return t('app.sketch.free.type.point');
    case 'ellipse': return t('app.sketch.free.type.ellipse');
    default: return t('app.sketch.free.type.shape');
  }
};

/** "Circle 3 centre can move in x and y", "Line 1 end can move in x", "Circle 2 radius can change". */
export function freeText(it: FreeItem): string {
  const role = it.role === 'centre' ? t('app.sketch.free.role.centre') : it.role === 'start' ? t('app.sketch.free.role.start') : it.role === 'end' ? t('app.sketch.free.role.end') : '';
  const what = `${typeName(it.entityType)} ${it.ordinal}${role ? ' ' + role : ''}`;
  if (it.role === 'radius') return t('app.sketch.free.radius', { what });
  const axes = it.axes === 'x' ? t('app.sketch.free.axes.x') : it.axes === 'y' ? t('app.sketch.free.axes.y') : t('app.sketch.free.axes.xy');
  return t('app.sketch.free.move', { what, axes });
}

const num = (s: Suggestion): string => (typeof s.value === 'number' ? String(Math.round(s.value * 100) / 100) : '');

/** The chip text of a suggestion: "Radius 5", "Horizontal", "X from origin 50". */
export function suggestionText(s: Suggestion): string {
  switch (s.label) {
    case 'radius': return t('app.sketch.free.sug.radius', { value: num(s) });
    case 'length': return t('app.sketch.free.sug.length', { value: num(s) });
    case 'hdist': return t('app.sketch.free.sug.hdist', { value: num(s) });
    case 'vdist': return t('app.sketch.free.sug.vdist', { value: num(s) });
    case 'fix': return t('app.sketch.free.sug.fix');
    case 'origin': return t('app.sketch.free.sug.origin');
    case 'horizontal': return t('app.sketch.constraint.horizontal');
    case 'vertical': return t('app.sketch.constraint.vertical');
    case 'perpendicular': return t('app.sketch.constraint.perpendicular');
    case 'parallel': return t('app.sketch.constraint.parallel');
    case 'tangent': return t('app.sketch.constraint.tangent');
    case 'equal': return t('app.sketch.constraint.equal');
    default: return t('app.sketch.constraint.concentric');
  }
}

/** One line of the hover tooltip: "Horizontal distance 10", "Vertical", "(Distance) 5" for a reference dimension. */
export function tooltipText(it: TooltipItem): string {
  const name = t('app.sketch.constraint.' + it.type, undefined, it.type);
  const val = typeof it.value === 'number' ? ' ' + Math.round(it.value * 100) / 100 : '';
  return it.driving ? name + val : `(${name})`;
}
