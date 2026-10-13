import { sketchTools, type ToolEntry, type ToolGroup } from '@kit/sketch';
import { t } from './i18n';

const GROUPS: ToolGroup[] = ['draw', 'dimension', 'constrain', 'edit'];

/** The sketch tools as a strip under the sketch banner: Select (drag points), then the tools by group. */
export function SketchToolStrip(p: { active: string | null; onPick(id: string | null): void; tools?: ToolEntry[] }) {
  const tools = p.tools ?? sketchTools();
  return (
    <div class="sketch-tools" role="toolbar" aria-label={t('app.sketch.tools')}>
      <button class="stool" aria-pressed={p.active === null} onClick={() => p.onPick(null)}>{t('app.sketch.select')}</button>
      {GROUPS.map((g) => {
        const inGroup = tools.filter((x) => x.group === g);
        if (!inGroup.length) return null;
        return (
          <div class="sgroup" key={g} role="group" aria-label={t('app.sketch.group.' + g)}>
            <span class="sgroup-name">{t('app.sketch.group.' + g)}</span>
            {inGroup.map((x) => (
              <button
                key={x.id}
                class="stool"
                aria-pressed={p.active === x.id}
                title={x.key ? `${t('app.sketch.tool.' + x.id)} (${x.key.toUpperCase()})` : t('app.sketch.tool.' + x.id)}
                onClick={() => p.onPick(x.id)}
              >
                {t('app.sketch.tool.' + x.id)}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
