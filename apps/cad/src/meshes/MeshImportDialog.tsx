// The import dialog of a reference mesh (STL, OBJ, GLB, 3MF): what the file holds (triangles, size, closed or open), the unit its numbers are in
// (STL and OBJ have none; GLB and 3MF state it), what the file held that is not kept, and whether to put it on the ground at the origin. The reader and the rules are in @kit/io and meshImport.ts.
import { useEffect, useState } from 'preact/hooks';
import { STL_UNITS, UNIT_MM, type StlUnit } from '@kit/io';
import { t } from '../i18n';
import type { V3 } from './meshDoc';
import { meshNoteLines, scaleToLength, sizeMm, unitHint, type ScaleAxis, type MeshKind, type MeshProbe } from './meshImport';
import './mesh.css';

const fmt = (v: number): string => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));

export function MeshImportDialog(p: { name: string; kind?: MeshKind; probe: MeshProbe; unit: StlUnit; onImport(unit: StlUnit, ground: boolean, scale: number): void; onCancel(): void; /** OBJ whose .mtl was not opened: ask for it (the file picker), so the colours can be read */ onPickMtl?(): void }) {
  const [unit, setUnit] = useState<StlUnit>(p.unit);
  const [ground, setGround] = useState(false);
  const [axis, setAxis] = useState<ScaleAxis>('long');
  const [known, setKnown] = useState('');   // a length the user knows, in mm; empty = keep the file's size
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); p.onCancel(); } };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, []);
  const size = p.probe.unitFixed ? p.probe.size : sizeMm(p.probe, UNIT_MM[unit]);   // a GLB or 3MF was read in its own unit: the size is already millimetres
  const hint = unitHint(size);
  const factor = known.trim() === '' ? 1 : scaleToLength(size, axis, Number(known));
  const shown: V3 = [size[0] * factor, size[1] * factor, size[2] * factor];
  const c = p.probe.check;
  const kind = (p.kind ?? 'stl').toUpperCase();
  const notes = meshNoteLines(p.probe.notes ?? []);
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onCancel(); }}>
      <div class="dlg discard-dlg mesh-import" role="dialog" aria-label={t('mesh.import.title', { name: p.name, kind })} data-testid="mesh-import">
        <div class="dlg-head"><b>{t('mesh.import.title', { name: p.name, kind })}</b></div>
        <div class="discard-body mesh-import-body">
          <p class="mesh-import-sum" data-testid="mesh-import-summary">{t('mesh.import.summary', { tris: p.probe.triangles.toLocaleString(), verts: c.vertices.toLocaleString(), format: t('mesh.import.format.' + p.probe.format) })}</p>
          {p.probe.unitFixed ? <p class="mesh-import-row" data-testid="mesh-import-unit-fixed">{t('mesh.import.unitFixed', { unit: t('mesh.unit.' + p.probe.unitFixed) })}</p> : <label class="mesh-import-row">
            <span>{t('mesh.import.unit')}</span>
            <select value={unit} aria-label={t('mesh.import.unit')} data-testid="mesh-import-unit" onChange={(e) => setUnit((e.currentTarget as HTMLSelectElement).value as StlUnit)}>
              {STL_UNITS.map((u) => <option key={u} value={u}>{t('mesh.unit.' + u)}</option>)}
            </select>
          </label>}
          <p class="mesh-import-size" data-testid="mesh-import-size">{t('mesh.import.size', { w: fmt(shown[0]), d: fmt(shown[1]), h: fmt(shown[2]) })}</p>
          <label class="mesh-import-row" data-testid="mesh-import-known">
            <span>{t('mesh.import.known')}</span>
            <select value={String(axis)} aria-label={t('mesh.import.knownAxis')} data-testid="mesh-import-known-axis" onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; setAxis(v === 'long' ? 'long' : (Number(v) as 0 | 1 | 2)); }}>
              <option value="long">{t('mesh.import.axis.long')}</option><option value="0">X</option><option value="1">Y</option><option value="2">Z</option>
            </select>
            <input type="number" min="0" step="any" value={known} placeholder="mm" aria-label={t('mesh.import.known')} data-testid="mesh-import-known-value" onInput={(e) => setKnown((e.currentTarget as HTMLInputElement).value)} />
          </label>
          {hint && factor === 1 ? <p class="mesh-import-note warn" data-testid="mesh-import-hint">{t(hint.key, { size: fmt(hint.size) })}</p> : null}
          <ul class="mesh-import-checks">
            <li class={c.watertight ? 'ok' : 'warn'}>{c.watertight ? t('mesh.import.closed') : t('mesh.import.open', { n: c.openEdges })}</li>
            {c.inconsistentEdges ? <li class="warn">{t('mesh.import.flipped', { n: c.inconsistentEdges })}</li> : null}
            {c.nonManifoldEdges ? <li class="warn">{t('mesh.import.nonManifold', { n: c.nonManifoldEdges })}</li> : null}
            {p.probe.degenerate ? <li class="warn">{t('mesh.import.degenerate', { n: p.probe.degenerate })}</li> : null}
            {p.probe.warnings.includes('truncated') ? <li class="warn">{t('mesh.import.truncated')}</li> : null}
            {p.probe.warnings.includes('trailingBytes') ? <li class="warn">{t('mesh.import.trailing')}</li> : null}
            {p.probe.colours ? <li class="ok">{t('mesh.import.colours', { n: p.probe.colours })}</li> : null}
            {notes.map((n) => <li key={n} class="warn" data-testid="mesh-import-note">{n}</li>)}
            {p.onPickMtl && (p.probe.notes ?? []).some((n) => n.code === 'mtlMissing') ? <li><button class="rb-btn" data-testid="mesh-import-pick-mtl" onClick={p.onPickMtl}>{t('mesh.import.pickMtl')}</button></li> : null}
            {p.probe.triangles > 300_000 ? <li>{t('mesh.import.big')}</li> : null}
          </ul>
          <label class="mesh-import-check">
            <input type="checkbox" checked={ground} data-testid="mesh-import-ground" onChange={(e) => setGround((e.currentTarget as HTMLInputElement).checked)} />
            <span>{t('mesh.import.place')}</span>
          </label>
        </div>
        <div class="discard-actions">
          <button class="rb-btn" data-testid="mesh-import-cancel" onClick={p.onCancel}>{t('mesh.import.cancel')}</button>
          <button class="rb-btn ok" autofocus data-testid="mesh-import-ok" onClick={() => p.onImport(unit, ground, factor)}>{t('mesh.import.ok')}</button>
        </div>
      </div>
    </div>
  );
}
