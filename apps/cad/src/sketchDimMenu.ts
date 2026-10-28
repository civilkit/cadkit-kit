import type { MenuItem } from './menuModel';
import { t } from './i18n';

/** The right-click menu of a dimension on the sketch: radius <-> diameter (circles and arcs), driving <-> reference, delete. */
export function dimensionMenu(type: string, driven: boolean): MenuItem[] {
  const out: MenuItem[] = [];
  if (type === 'radius') out.push({ id: 'flip', label: t('app.sketch.dim.toDiameter'), enabled: true });
  else if (type === 'diameter') out.push({ id: 'flip', label: t('app.sketch.dim.toRadius'), enabled: true });
  out.push({ id: 'driven', label: t(driven ? 'app.sketch.dim.makeDriving' : 'app.sketch.dim.makeReference'), enabled: true });
  out.push({ id: 'delete', label: t('app.sketch.dim.delete'), enabled: true });
  return out;
}
