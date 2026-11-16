import { useEffect, useState } from 'preact/hooks';
import { numberAttrs } from '@kit/ui';
import { t } from './i18n';

/** "Move this folder": X, Y and Z in mm, every body the folder made moves together. Each change previews; Move commits one undo step. */
export function MoveGroupDialog(p: { name: string; count: number; onChange(delta: [number, number, number]): void; onMove(delta: [number, number, number]): void; onCancel(): void }) {
  const [v, setV] = useState<[number, number, number]>([0, 0, 0]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onCancel(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const set = (i: number, raw: string): void => {
    const n = raw.trim() === '' ? 0 : Number(raw);
    if (!Number.isFinite(n)) return;
    const next = [...v] as [number, number, number];
    next[i] = n;
    setV(next);
    p.onChange(next);
  };
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onCancel(); }}>
      <div class="dlg" role="dialog" aria-label={t('moveGroup.title')} data-testid="move-group-dialog">
        <div class="dlg-head"><b>{t('moveGroup.title', { name: p.name })}</b></div>
        <div class="discard-body">{t('moveGroup.text', { count: String(p.count) })}</div>
        <div style="display:grid;grid-template-columns:auto 1fr auto;gap:6px 8px;align-items:center;padding:0 12px 8px">
          {(['X', 'Y', 'Z'] as const).map((a, i) => (
            <label key={a} style="display:contents">
              <span>{a}</span>
              <input {...numberAttrs('signed')} type="number" step="any" value={String(v[i])} aria-label={t('moveGroup.axis', { axis: a })} data-testid={`move-group-${a.toLowerCase()}`} autofocus={i === 0} onInput={(e) => set(i, (e.currentTarget as HTMLInputElement).value)} />
              <span class="fedit-unit">mm</span>
            </label>
          ))}
        </div>
        <div class="discard-actions">
          <button class="rb-btn" data-testid="move-group-cancel" onClick={p.onCancel}>{t('ui.cancel')}</button>
          <button class="rb-btn ok" data-testid="move-group-ok" disabled={v.every((x) => x === 0)} onClick={() => p.onMove(v)}>{t('moveGroup.move')}</button>
        </div>
      </div>
    </div>
  );
}
