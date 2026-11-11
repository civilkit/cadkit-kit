// The import dialog of an STL: what the file holds (triangles, size, closed or open), the unit its numbers are in (STL has none),
// and whether to put it on the ground at the origin. The reader and the rules are in @kit/io and meshImport.ts.
import { useEffect, useState } from 'preact/hooks';
import { STL_UNITS, UNIT_MM, type StlUnit } from '@kit/io';
import { t } from '../i18n';
import { sizeMm, unitHint, type MeshProbe } from './meshImport';
import './mesh.css';

const fmt = (v: number): string => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));

export function MeshImportDialog(p: { name: string; probe: MeshProbe; unit: StlUnit; onImport(unit: StlUnit, ground: boolean): void; onCancel(): void }) {
  const [unit, setUnit] = useState<StlUnit>(p.unit);
  const [ground, setGround] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); p.onCancel(); } };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, []);
  const size = sizeMm(p.probe, UNIT_MM[unit]);
  const hint = unitHint(size);
  const c = p.probe.check;
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onCancel(); }}>
      <div class="dlg discard-dlg mesh-import" role="dialog" aria-label={t('mesh.import.title', { name: p.name })} data-testid="mesh-import">
        <div class="dlg-head"><b>{t('mesh.import.title', { name: p.name })}</b></div>
        <div class="discard-body mesh-import-body">
          <p class="mesh-import-sum" data-testid="mesh-import-summary">{t('mesh.import.summary', { tris: p.probe.triangles.toLocaleString(), verts: c.vertices.toLocaleString(), format: t('mesh.import.format.' + p.probe.format) })}</p>
          <label class="mesh-import-row">
            <span>{t('mesh.import.unit')}</span>
            <select value={unit} aria-label={t('mesh.import.unit')} data-testid="mesh-import-unit" onChange={(e) => setUnit((e.currentTarget as HTMLSelectElement).value as StlUnit)}>
              {STL_UNITS.map((u) => <option key={u} value={u}>{t('mesh.unit.' + u)}</option>)}
            </select>
          </label>
          <p class="mesh-import-size" data-testid="mesh-import-size">{t('mesh.import.size', { w: fmt(size[0]), d: fmt(size[1]), h: fmt(size[2]) })}</p>
          {hint ? <p class="mesh-import-note warn" data-testid="mesh-import-hint">{t(hint.key, { size: fmt(hint.size) })}</p> : null}
          <ul class="mesh-import-checks">
            <li class={c.watertight ? 'ok' : 'warn'}>{c.watertight ? t('mesh.import.closed') : t('mesh.import.open', { n: c.openEdges })}</li>
            {c.inconsistentEdges ? <li class="warn">{t('mesh.import.flipped', { n: c.inconsistentEdges })}</li> : null}
            {c.nonManifoldEdges ? <li class="warn">{t('mesh.import.nonManifold', { n: c.nonManifoldEdges })}</li> : null}
            {p.probe.degenerate ? <li class="warn">{t('mesh.import.degenerate', { n: p.probe.degenerate })}</li> : null}
            {p.probe.warnings.includes('truncated') ? <li class="warn">{t('mesh.import.truncated')}</li> : null}
            {p.probe.warnings.includes('trailingBytes') ? <li class="warn">{t('mesh.import.trailing')}</li> : null}
            {p.probe.triangles > 300_000 ? <li>{t('mesh.import.big')}</li> : null}
          </ul>
          <label class="mesh-import-check">
            <input type="checkbox" checked={ground} data-testid="mesh-import-ground" onChange={(e) => setGround((e.currentTarget as HTMLInputElement).checked)} />
            <span>{t('mesh.import.place')}</span>
          </label>
        </div>
        <div class="discard-actions">
          <button class="rb-btn" data-testid="mesh-import-cancel" onClick={p.onCancel}>{t('mesh.import.cancel')}</button>
          <button class="rb-btn ok" autofocus data-testid="mesh-import-ok" onClick={() => p.onImport(unit, ground)}>{t('mesh.import.ok')}</button>
        </div>
      </div>
    </div>
  );
}
