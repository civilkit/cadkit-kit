// Teardrop hole: the options of the peak cut onto a picked round hole (the direction that is up when printed, the peak angle, a flat top).
// A plain dialog: it works out the plan as you type and says why it cannot be built; the part is only changed by Add.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { t } from './i18n';
import './files/files.css';
import './teardrop/strings';
import { planTeardrop, type TeardropIssue, type TeardropOpts, type TeardropPlan } from './teardrop';
import type { FastenHole } from './fastenHole';

type V3 = [number, number, number];
const AXES: Array<{ id: string; v: V3 }> = [
  { id: 'px', v: [1, 0, 0] }, { id: 'nx', v: [-1, 0, 0] }, { id: 'py', v: [0, 1, 0] }, { id: 'ny', v: [0, -1, 0] }, { id: 'pz', v: [0, 0, 1] }, { id: 'nz', v: [0, 0, -1] },
];
const axisName = (id: string): string => (id === 'px' ? t('teardrop.axis.px') : id === 'nx' ? t('teardrop.axis.nx') : id === 'py' ? t('teardrop.axis.py') : id === 'ny' ? t('teardrop.axis.ny') : id === 'pz' ? t('teardrop.axis.pz') : t('teardrop.axis.nz'));
const num = (s: string, d: number): number => { const v = Number(s); return Number.isFinite(v) && s.trim() !== '' ? v : d; };

/** The option text: the model's up direction says so, since that is the usual print-up direction. */
const axisText = (id: string, up: 'y' | 'z'): string => (id === (up === 'z' ? 'pz' : 'py') ? t('teardrop.axis.up', { axis: axisName(id) }) : axisName(id));

export interface TeardropChoice { opts: TeardropOpts; plan: TeardropPlan; /** every hole to get a peak: the picked one and, when asked, the others of its pattern */ holes: Array<Pick<FastenHole, 'mouth' | 'out' | 'diameter' | 'thickness' | 'through'>> }

/** The axis facing the way the hole does not run, preferring the model's up direction (`up`: 'y' or 'z'). */
export function defaultToward(out: V3, up: 'y' | 'z'): string {
  const prefer = up === 'z' ? ['pz', 'py', 'px'] : ['py', 'pz', 'px'];
  const ok = (id: string) => { const a = AXES.find((x) => x.id === id)!.v; return Math.abs(a[0] * out[0] + a[1] * out[1] + a[2] * out[2]) < 0.99; };
  return prefer.find(ok) ?? 'px';
}

export function TeardropDialog(p: { hole: Pick<FastenHole, 'mouth' | 'out' | 'diameter' | 'thickness' | 'through'>; /** the other holes of the picked hole's pattern */ others?: Array<Pick<FastenHole, 'mouth' | 'out' | 'diameter' | 'thickness' | 'through'>>; up: 'y' | 'z'; onAdd(c: TeardropChoice): void; onClose(): void }) {
  const [toward, setToward] = useState(() => defaultToward(p.hole.out as V3, p.up));
  const [rotate, setRotate] = useState('0');
  const [angle, setAngle] = useState('45');
  const [flat, setFlat] = useState(false);
  const others = p.others ?? [];
  const [all, setAll] = useState(true);
  const r = p.hole.diameter / 2;
  const [flatAt, setFlatAt] = useState(() => String(Math.round(r * 100) / 100));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); p.onClose(); } };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, []);
  const opts: TeardropOpts = useMemo(() => ({
    toward: AXES.find((a) => a.id === toward)!.v, rotate: num(rotate, 0), halfAngle: num(angle, 45), flat, ...(flat ? { flatAt: num(flatAt, r) } : {}),
  }), [toward, rotate, angle, flat, flatAt]);
  const res = useMemo(() => planTeardrop(p.hole, opts), [opts]);
  const a = (opts.halfAngle ?? 45) * Math.PI / 180;
  const issueText = (i: TeardropIssue): string => (i === 'parallel' ? t('teardrop.issue.parallel') : i === 'halfAngle' ? t('teardrop.issue.halfAngle')
    : i === 'flatAt' ? t('teardrop.issue.flatAt', { min: (r * Math.sin(a)).toFixed(2), max: (r / Math.sin(a)).toFixed(2) }) : t('teardrop.issue.diameter'));
  const depth = p.hole.through ? t('teardrop.depth.through') : t('teardrop.depth.blind', { depth: Math.round(p.hole.thickness * 100) / 100 });
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class="dlg discard-dlg teardrop" role="dialog" aria-label={t('teardrop.title')} data-testid="teardrop">
        <div class="dlg-head"><b>{t('teardrop.title')}</b></div>
        <div class="discard-body teardrop-body">
          <p class="teardrop-line" data-testid="teardrop-hole">{t('teardrop.hole', { diameter: Math.round(p.hole.diameter * 100) / 100, depth })}</p>
          <label class="teardrop-row" title={t('teardrop.toward.tip')}>
            <span>{t('teardrop.toward')}</span>
            <select data-testid="teardrop-toward" aria-invalid={!res.ok && res.issue === 'parallel'} value={toward} onChange={(e) => setToward((e.currentTarget as HTMLSelectElement).value)}>
              {AXES.map((x) => <option key={x.id} value={x.id}>{axisText(x.id, p.up)}</option>)}
            </select>
          </label>
          <label class="teardrop-row" title={t('teardrop.rotate.tip')}>
            <span>{t('teardrop.rotate')}</span>
            <input type="number" step="5" value={rotate} data-testid="teardrop-rotate" onInput={(e) => setRotate((e.currentTarget as HTMLInputElement).value)} /> <small>°</small>
          </label>
          <label class="teardrop-row" title={t('teardrop.angle.tip')}>
            <span>{t('teardrop.angle')}</span>
            <input type="number" step="1" min="20" max="60" value={angle} aria-invalid={!res.ok && res.issue === 'halfAngle'} data-testid="teardrop-angle" onInput={(e) => setAngle((e.currentTarget as HTMLInputElement).value)} /> <small>°</small>
          </label>
          <label class="teardrop-row" title={t('teardrop.flat.tip')}>
            <span>{t('teardrop.flat')}</span>
            <input type="checkbox" checked={flat} data-testid="teardrop-flat" onChange={(e) => setFlat((e.currentTarget as HTMLInputElement).checked)} />
          </label>
          {flat ? (
            <label class="teardrop-row">
              <span>{t('teardrop.flatAt')}</span>
              <input type="number" step="0.1" value={flatAt} aria-invalid={!res.ok && res.issue === 'flatAt'} data-testid="teardrop-flatat" onInput={(e) => setFlatAt((e.currentTarget as HTMLInputElement).value)} /> <small>mm</small>
            </label>
          ) : null}
          {res.ok
            ? <p class="teardrop-line" data-testid="teardrop-reach">{t('teardrop.reach', { reach: Math.round(res.plan.reach * 100) / 100, wide: Math.round((opts.halfAngle ?? 45) * 2) })}</p>
            : <p class="teardrop-issue" role="alert" data-testid="teardrop-issue" data-issue={res.issue}>{issueText(res.issue)}</p>}
          {others.length ? (
            <label class="teardrop-row">
              <span>{t('teardrop.all')}</span>
              <input type="checkbox" checked={all} data-testid="teardrop-all" onChange={(e) => setAll((e.currentTarget as HTMLInputElement).checked)} />
              <small>{t('teardrop.all.count', { count: others.length + 1 })}</small>
            </label>
          ) : null}
          <small class="teardrop-note">{t('teardrop.note')}</small>
        </div>
        <div class="discard-actions">
          <button class="rb-btn" data-testid="teardrop-cancel" onClick={p.onClose}>{t('teardrop.cancel')}</button>
          <button class="rb-btn ok" data-testid="teardrop-add" disabled={!res.ok} onClick={() => { if (res.ok) p.onAdd({ opts, plan: res.plan, holes: all ? [p.hole, ...others] : [p.hole] }); }}>{t('teardrop.add')}</button>
        </div>
      </div>
    </div>
  );
}
