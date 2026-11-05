// The typed move: "X offset" / "Y offset" along the sketch plane's axes (numbers or expressions, millimetres, from where the
// shape is now) and the "Distance from edge" helper (pick an edge of the face the shape sits on, type the clear distance).
// Enter moves, Esc closes. The maths is in move.ts; this only parses the fields and hands (du, dv) to the caller.
import { useEffect, useRef, useState } from 'preact/hooks';
import { evalExpr } from '@kit/ui';
import { t } from '../i18n';
import type { MoveInfo } from './session';
import { EDGE_SIDES, edgeDistance, moveToEdgeDistance, type EdgeSide } from './move';

const round = (v: number): string => String(Math.round(v * 100) / 100);
type Values = Parameters<typeof evalExpr>[1];

/** A field's number: blank is `blank`, an expression is evaluated against the document variables, anything else is null. */
export function fieldValue(src: string, values: Values, blank: number | null): number | null {
  if (src.trim() === '') return blank;
  const r = evalExpr(src, values);
  return r.ok ? r.value : null;
}

/** The move (du, dv) the fields stand for, or null when a field does not parse. An edge distance sets that axis; the offsets set the other. */
export function movesFromFields(info: MoveInfo, f: { x: string; y: string; edge: EdgeSide | ''; dist: string; px?: string; py?: string }, values: Values): { du: number; dv: number } | null {
  let du = fieldValue(f.x, values, 0), dv = fieldValue(f.y, values, 0);
  if (du === null || dv === null) return null;
  // a typed position is absolute (the shape's centre in the sketch's own coordinates); an offset typed beside it adds to it
  const px = fieldValue(f.px ?? '', values, null), py = fieldValue(f.py ?? '', values, null);
  if ((f.px ?? '').trim() !== '' && px === null) return null;
  if ((f.py ?? '').trim() !== '' && py === null) return null;
  if (px !== null) du += px - info.centre.u;
  if (py !== null) dv += py - info.centre.v;
  if (f.edge && f.dist.trim() !== '') {
    const d = fieldValue(f.dist, values, null);
    if (d === null || !info.host) return null;
    const m = moveToEdgeDistance(info.box, info.host, f.edge, d);
    if (f.edge === 'left' || f.edge === 'right') du = m.du; else dv = m.dv;
  }
  return { du, dv };
}

export function MoveFields(p: { info: MoveInfo; values: Values; onApply(du: number, dv: number): void; onLock?(p: { u: number; v: number }): void; onClose(): void }) {
  const [x, setX] = useState(''), [y, setY] = useState('');
  const [px, setPx] = useState(''), [py, setPy] = useState('');
  const [edge, setEdge] = useState<EdgeSide | ''>(''), [dist, setDist] = useState('');
  const [bad, setBad] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const apply = () => {
    const m = movesFromFields(p.info, { x, y, edge, dist, px, py }, p.values);
    if (!m) { setBad(true); return; }
    setBad(false);
    p.onApply(m.du, m.dv);
  };
  const key = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); apply(); } else if (e.key === 'Escape' || e.keyCode === 27) { e.preventDefault(); p.onClose(); }
  };
  const cur = edge ? edgeDistance(p.info.box, p.info.host, edge) : null;
  return (
    <div class="sizebox-moveto" role="dialog" aria-label={t('sizebox.moveto.title')} onKeyDown={key}>
      <div class="sizebox-moveto-title">{t('sizebox.moveto.title')}</div>
      <label>{t('sizebox.moveto.px')}<input ref={first} type="text" inputMode="decimal" value={px} placeholder={round(p.info.centre.u)} onInput={(e) => setPx(e.currentTarget.value)} /></label>
      <label>{t('sizebox.moveto.py')}<input type="text" inputMode="decimal" value={py} placeholder={round(p.info.centre.v)} onInput={(e) => setPy(e.currentTarget.value)} /></label>
      <div class="sizebox-moveto-hint">{t('sizebox.moveto.world', { x: round(p.info.world[0]), y: round(p.info.world[1]), z: round(p.info.world[2]) })}</div>
      <label>{t('sizebox.moveto.x')}<input type="text" inputMode="decimal" value={x} placeholder="0" onInput={(e) => setX(e.currentTarget.value)} /></label>
      <label>{t('sizebox.moveto.y')}<input type="text" inputMode="decimal" value={y} placeholder="0" onInput={(e) => setY(e.currentTarget.value)} /></label>
      <label>{t('sizebox.moveto.edge')}
        <span class="sizebox-moveto-edge">
          <select value={edge} onChange={(e) => setEdge(e.currentTarget.value as EdgeSide | '')} disabled={!p.info.host}>
            <option value="">{t('sizebox.moveto.edge.none')}</option>
            {EDGE_SIDES.map((s) => <option key={s} value={s}>{t('sizebox.moveto.' + s)}</option>)}
          </select>
          <input type="text" inputMode="decimal" value={dist} disabled={!edge} placeholder={cur === null ? '' : String(Math.round(cur * 100) / 100)} onInput={(e) => setDist(e.currentTarget.value)} />
        </span>
      </label>
      {p.info.near.length ? (
        <label>{t('sizebox.lock')}
          <span class="sizebox-moveto-edge">
            <select aria-label={t('sizebox.lock')} onChange={(e) => { const i = Number(e.currentTarget.value); e.currentTarget.value = ''; if (i >= 0) p.onLock?.(p.info.near[i]); }}>
              <option value="">{t('sizebox.lock.pick')}</option>
              {p.info.near.map((c, i) => <option key={i} value={i}>{t('catalog.snap.' + c.kind)} ({round(c.u)}, {round(c.v)})</option>)}
            </select>
          </span>
        </label>
      ) : null}
      {bad ? <div class="sizebox-moveto-bad" role="alert">{t('sizebox.moveto.bad')}</div> : <div class="sizebox-moveto-hint">{t('sizebox.moveto.hint')}</div>}
      <div class="sizebox-moveto-btns"><button type="button" onClick={apply}>{t('sizebox.moveto.apply')}</button><button type="button" onClick={p.onClose}>{t('sizebox.shared.cancel')}</button></div>
    </div>
  );
}
