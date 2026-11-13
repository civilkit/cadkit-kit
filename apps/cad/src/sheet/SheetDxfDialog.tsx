import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { t } from '../i18n';
import { DXF_UNITS, DXF_VERSIONS, type DxfOptions } from './exportSheet';
import { numberAttrs } from '@kit/ui';

/** The options of the flat pattern DXF: version, units, which lines and notes, layer scheme and names. */
export function SheetDxfDialog(p: { initial: DxfOptions; bends: number; onWrite(o: DxfOptions): void; onCancel(): void }): JSX.Element {
  const [o, setO] = useState<DxfOptions>(p.initial);
  const set = (patch: Partial<DxfOptions>) => setO((x) => ({ ...x, ...patch }));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onCancel(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const row = (label: string, el: JSX.Element) => <label class="set-row"><span>{label}</span>{el}</label>;
  const check = (key: 'bendLines' | 'tangentLines' | 'bendNotes', label: string, disabled = false) => (
    <label class="set-row"><input type="checkbox" data-opt={key} disabled={disabled} checked={o[key]} onChange={(e) => set({ [key]: (e.currentTarget as HTMLInputElement).checked })} /><span>{label}</span></label>
  );
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onCancel(); }}>
      <div class="dlg set-dlg sheet-dxf-dlg" role="dialog" aria-label={t('sheet.dxf.title')}>
        <div class="dlg-head"><b>{t('sheet.dxf.title')}</b></div>
        <div class="sheet-dxf-body">
          {row(t('sheet.dxf.version'), <select data-opt="version" value={o.version} onChange={(e) => set({ version: (e.currentTarget as HTMLSelectElement).value as DxfOptions['version'] })}>{DXF_VERSIONS.map((v) => <option key={v} value={v}>{v}</option>)}</select>)}
          {row(t('sheet.dxf.units'), <select data-opt="units" value={o.units} onChange={(e) => set({ units: (e.currentTarget as HTMLSelectElement).value as DxfOptions['units'] })}>{DXF_UNITS.map((v) => <option key={v} value={v}>{v}</option>)}</select>)}
          {row(t('sheet.dxf.layers'), <select data-opt="layers" value={o.layers} onChange={(e) => set({ layers: (e.currentTarget as HTMLSelectElement).value as DxfOptions['layers'] })}><option value="roles">{t('sheet.dxf.layers.roles')}</option><option value="single">{t('sheet.dxf.layers.single')}</option></select>)}
          {row(t('sheet.dxf.names'), <select data-opt="layerNames" value={o.layerNames} disabled={o.layers === 'single'} onChange={(e) => set({ layerNames: (e.currentTarget as HTMLSelectElement).value as DxfOptions['layerNames'] })}><option value="cadkit">{t('sheet.dxf.names.cadkit')}</option><option value="reference">{t('sheet.dxf.names.reference')}</option></select>)}
          {check('bendLines', t('sheet.dxf.bendLines'), p.bends === 0)}
          {check('tangentLines', t('sheet.dxf.tangentLines'), p.bends === 0 || !o.bendLines)}
          {check('bendNotes', t('sheet.dxf.bendNotes'), p.bends === 0)}
          {o.bendNotes ? row(t('sheet.dxf.noteHeight'), <input {...numberAttrs('positive')} type="number" data-opt="noteHeight" min="0.1" step="0.5" value={o.noteHeight} onChange={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); if (v > 0) set({ noteHeight: v }); }} />) : null}
        </div>
        <div class="discard-actions">
          <button type="button" class="rb-btn" data-act="cancel" onClick={p.onCancel}>{t('sheet.dxf.cancel')}</button>
          <button type="button" class="rb-btn ok" data-act="write" autofocus onClick={() => p.onWrite(o)}>{t('sheet.dxf.write')}</button>
        </div>
      </div>
    </div>
  );
}
