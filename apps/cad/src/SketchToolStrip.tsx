import { sketchTools, type ToolEntry, type ToolGroup } from '@kit/sketch';
import { Icon, Tip } from '@kit/ui';
import { t } from './i18n';

const GROUPS: ToolGroup[] = ['draw', 'dimension', 'constrain', 'edit'];

/** The sketch tools as a strip under the sketch banner: Select (drag points), then the tools by group. With
 *  `labels="icons"` each tool is a square icon button whose name shows at once on hover or focus, and the group
 *  headings shrink to thin separators; otherwise each button shows its icon and its name. */
export function SketchToolStrip(p: { active: string | null; onPick(id: string | null): void; tools?: ToolEntry[]; labels?: 'icons' | 'icons-and-text'; layout?: 'strip' | 'palette' }) {
  const tools = p.tools ?? sketchTools();
  const iconsOnly = p.labels === 'icons';
  const button = (id: string, name: string, pressed: boolean, onClick: () => void, keys?: string) => (
    <Tip label={name} keys={keys}>
      <button class={'stool' + (iconsOnly ? ' icon-only' : '')} aria-pressed={pressed} aria-label={iconsOnly ? name : undefined} onClick={onClick}>
        <Icon name={id} size={iconsOnly ? 20 : 16} />
        {iconsOnly ? null : <span>{name}</span>}
      </button>
    </Tip>
  );
  if (p.layout === 'palette') {
    // a vertical palette at the screen edge: groups of icons in two columns, names on hover
    const pal = (id: string, name: string, pressed: boolean, onClick: () => void, keys?: string) => (
      <Tip label={name} keys={keys} side="left">
        <button class="stool icon-only" aria-pressed={pressed} aria-label={name} onClick={onClick}><Icon name={id} size={20} /></button>
      </Tip>
    );
    return (
      <div class="sketch-palette" role="toolbar" aria-label={t('app.sketch.tools')}>
        <div class="spal-group">{pal('select', t('app.sketch.select'), p.active === null, () => p.onPick(null))}</div>
        {GROUPS.map((g) => {
          const inGroup = tools.filter((x) => x.group === g);
          if (!inGroup.length) return null;
          return (
            <div class="spal-group" key={g} role="group" aria-label={t('app.sketch.group.' + g)}>
              <span class="spal-name">{t('app.sketch.group.' + g)}</span>
              <div class="spal-grid">{inGroup.map((x) => pal(x.id, t('app.sketch.tool.' + x.id), p.active === x.id, () => p.onPick(x.id), x.key?.toUpperCase()))}</div>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div class={'sketch-tools' + (iconsOnly ? ' icons-only' : '')} role="toolbar" aria-label={t('app.sketch.tools')}>
      {button('select', t('app.sketch.select'), p.active === null, () => p.onPick(null))}
      {GROUPS.map((g) => {
        const inGroup = tools.filter((x) => x.group === g);
        if (!inGroup.length) return null;
        return (
          <div class="sgroup" key={g} role="group" aria-label={t('app.sketch.group.' + g)}>
            {iconsOnly ? null : <span class="sgroup-name">{t('app.sketch.group.' + g)}</span>}
            {inGroup.map((x) => button(x.id, t('app.sketch.tool.' + x.id), p.active === x.id, () => p.onPick(x.id), x.key?.toUpperCase()))}
          </div>
        );
      })}
    </div>
  );
}
