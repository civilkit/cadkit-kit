// The panel of one reference mesh: shown or hidden, opacity, colour, triangle edges, position / rotation / scale, quick placement
// (centre, ground, quarter turns), and the two ways to start drawing on it (a sketch plane through a clicked point; 3D Sketch).
// Changes show at once (`onChange` previews) and are one undo step when Done is pressed; Cancel puts everything back.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon, numberAttrs, textAttrs } from '@kit/ui';
import { t } from '../i18n';
import { worldBox, type MeshRec, type V3 } from './meshDoc';
import { centred, onGround, turned } from './meshEdit';
import './mesh.css';

const AXES: Array<[0 | 1 | 2, 'x' | 'y' | 'z']> = [[0, 'x'], [1, 'y'], [2, 'z']];
const r4 = (v: number): number => Math.round(v * 10000) / 10000;

export interface MeshPanelProps {
  rec: MeshRec;
  upAxis: 'y' | 'z';
  /** the preview: the record as it would be */
  onChange(r: MeshRec): void;
  onApply(r: MeshRec): void;
  onCancel(): void;
  onDelete(): void;
  onSketchOn(): void;
  onDraw(): void;
}

export function MeshPanel(p: MeshPanelProps): JSX.Element {
  const [rec, setRec] = useState<MeshRec>(p.rec);
  const live = useRef(rec);
  const set = (r: MeshRec): void => { live.current = r; setRec(r); p.onChange(r); };
  const patch = (o: Partial<MeshRec>): void => set({ ...live.current, ...o });
  const vec = (key: 'pos' | 'rot', i: number, raw: string): void => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) return;
    const v = [...live.current[key]] as V3;
    v[i] = n;
    patch({ [key]: v } as Partial<MeshRec>);
  };
  const box = worldBox(rec);
  const size = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]].map((v) => String(Math.round(v * 10) / 10));
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); p.onCancel(); }
      else if (e.key === 'Enter' && !(el && (el.tagName === 'BUTTON' || el.tagName === 'SELECT'))) { e.preventDefault(); e.stopPropagation(); p.onApply(live.current); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <div class="fedit thread-editor prop-wizard mesh-panel" tabIndex={0} data-testid="mesh-panel">
      <div class="fedit-head">
        <Icon name="add-sketch3d" size={22} class="fedit-icon" />
        <div class="fedit-title">{t('mesh.title')}</div>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('mesh.cancel')} aria-label={t('mesh.cancel')}><Icon name="close" size={20} /></button>
      </div>
      <div class="fedit-sec-fields prop-body">
        <label class="fedit-fld" data-path="name">
          <span class="fedit-fld-label">{t('mesh.name')}</span>
          <input {...textAttrs} type="text" value={rec.name} aria-label={t('mesh.name')} onInput={(e) => patch({ name: (e.currentTarget as HTMLInputElement).value })} />
        </label>
        <div class="thread-hint" data-testid="mesh-info">{t('mesh.info', { tris: rec.tris.toLocaleString(), w: size[0], d: size[1], h: size[2] })}, {t(rec.watertight ? 'mesh.watertight' : 'mesh.notWatertight')}</div>
        <div class="mesh-actions">
          <button type="button" class="fedit-card-btn prop-create" data-testid="mesh-sketch-on" title={t('mesh.sketchOn.tip')} onClick={p.onSketchOn}>{t('mesh.sketchOn')}</button>
          <button type="button" class="fedit-card-btn prop-create" data-testid="mesh-draw" title={t('mesh.draw.tip')} onClick={p.onDraw}>{t('mesh.draw')}</button>
        </div>
        <label class="fedit-fld sk3d-check" data-path="visible">
          <input type="checkbox" checked={rec.visible} aria-label={t('mesh.visible')} onChange={(e) => patch({ visible: (e.currentTarget as HTMLInputElement).checked })} />
          <span>{t('mesh.visible')}</span>
        </label>
        <label class="fedit-fld" data-path="opacity">
          <span class="fedit-fld-label">{t('mesh.opacity')}</span>
          <span class="fedit-num">
            <input type="range" min={5} max={100} step={1} value={Math.round(rec.opacity * 100)} aria-label={t('mesh.opacity')} data-testid="mesh-opacity" onInput={(e) => patch({ opacity: Number((e.currentTarget as HTMLInputElement).value) / 100 })} />
            <span class="fedit-unit">{Math.round(rec.opacity * 100)}%</span>
          </span>
        </label>
        {rec.mats?.length ? <p class="mesh-info" data-testid="mesh-mats">{t('mesh.materials', { n: rec.mats.length })}</p> : null}
        <label class="fedit-fld" data-path="color">
          <span class="fedit-fld-label">{t('mesh.color')}</span>
          <input type="color" value={rec.color} aria-label={t('mesh.color')} onInput={(e) => patch({ color: (e.currentTarget as HTMLInputElement).value })} />
        </label>
        <label class="fedit-fld sk3d-check" data-path="wire">
          <input type="checkbox" checked={rec.wire} aria-label={t('mesh.wire')} onChange={(e) => patch({ wire: (e.currentTarget as HTMLInputElement).checked })} />
          <span>{t('mesh.wire')}</span>
        </label>
        <div class="fedit-fld sk3d-add" data-path="position">
          <span class="fedit-fld-label">{t('mesh.position')}</span>
          <span class="mesh-xyz">
            {AXES.map(([i, k]) => <input {...numberAttrs('signed')} key={k} type="number" step="any" value={String(r4(rec.pos[i]))} aria-label={`${t('mesh.position')} ${k.toUpperCase()}`} data-axis={k} data-field="pos" onChange={(e) => vec('pos', i, (e.currentTarget as HTMLInputElement).value)} />)}
          </span>
        </div>
        <div class="fedit-fld sk3d-add" data-path="rotation">
          <span class="fedit-fld-label">{t('mesh.rotation')}</span>
          <span class="mesh-xyz">
            {AXES.map(([i, k]) => <input {...numberAttrs('signed')} key={k} type="number" step="any" value={String(r4(rec.rot[i]))} aria-label={`${t('mesh.rotation')} ${k.toUpperCase()}`} data-axis={k} data-field="rot" onChange={(e) => vec('rot', i, (e.currentTarget as HTMLInputElement).value)} />)}
          </span>
          <span class="mesh-actions">
            {AXES.map(([i, k]) => <button key={k} type="button" class="fedit-card-btn" data-turn={k} title={t('mesh.turn', { axis: k.toUpperCase() })} aria-label={t('mesh.turn', { axis: k.toUpperCase() })} onClick={() => set(turned(live.current, i))}>{k.toUpperCase()} +90</button>)}
          </span>
        </div>
        <label class="fedit-fld" data-path="scale">
          <span class="fedit-fld-label">{t('mesh.scale')}</span>
          <span class="fedit-num"><input {...numberAttrs('positive')} type="number" step="any" min="0.0001" value={String(r4(rec.scale))} aria-label={t('mesh.scale')} data-testid="mesh-scale" onChange={(e) => { const n = Number((e.currentTarget as HTMLInputElement).value); if (n > 0 && Number.isFinite(n)) patch({ scale: n }); }} /></span>
        </label>
        <div class="mesh-actions">
          <button type="button" class="fedit-card-btn" data-testid="mesh-center" onClick={() => set(centred(live.current))}>{t('mesh.center')}</button>
          <button type="button" class="fedit-card-btn" data-testid="mesh-ground" onClick={() => set(onGround(live.current, p.upAxis))}>{t('mesh.ground')}</button>
          <button type="button" class="fedit-card-btn" data-testid="mesh-reset" onClick={() => patch({ pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 })}>{t('mesh.reset')}</button>
        </div>
      </div>
      <div class="prop-nav">
        <button type="button" class="fedit-card-btn mesh-danger" data-testid="mesh-delete" onClick={p.onDelete}>{t('mesh.delete')}</button>
        <button type="button" class="fedit-card-btn" data-testid="mesh-cancel" onClick={p.onCancel}>{t('mesh.cancel')}</button>
        <button type="button" class="fedit-card-btn prop-create" data-testid="mesh-done" onClick={() => p.onApply(live.current)}>{t('mesh.done')}</button>
      </div>
    </div>
  );
}
