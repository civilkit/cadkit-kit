import { t } from './i18n';

/** The Sketch dialog on the left of the viewport while a sketch is open: its name and plane, two display switches, and OK / Cancel. */
export function SketchDialog(p: {
  name: string; plane: string; showRelations: boolean; showDimensions: boolean;
  onShow(patch: { relations?: boolean; dimensions?: boolean }): void; onOk(): void; onCancel(): void;
}) {
  return (
    <div class="sketch-dialog" role="dialog" aria-label={t('app.sketch.dialog.title')}>
      <div class="sd-head">
        <b>{t('app.sketch.dialog.title')}</b>
        <span class="sd-btns">
          <button class="rb-btn ok" aria-label={t('app.sketch.confirm')} title={t('app.sketch.confirm')} onClick={p.onOk}>✓</button>
          <button class="rb-btn no" aria-label={t('app.sketch.cancel')} title={t('app.sketch.cancel')} onClick={p.onCancel}>✗</button>
        </span>
      </div>
      <div class="sd-row"><span>{t('app.sketch.dialog.name')}</span><span class="sd-val">{p.name}</span></div>
      <div class="sd-row"><span>{t('app.sketch.dialog.plane')}</span><span class="sd-val">{p.plane}</span></div>
      <label class="sd-check"><input type="checkbox" checked={p.showRelations} onChange={(e) => p.onShow({ relations: (e.currentTarget as HTMLInputElement).checked })} />{t('app.sketch.dialog.showConstraints')}</label>
      <label class="sd-check"><input type="checkbox" checked={p.showDimensions} onChange={(e) => p.onShow({ dimensions: (e.currentTarget as HTMLInputElement).checked })} />{t('app.sketch.dialog.showDimensions')}</label>
    </div>
  );
}
