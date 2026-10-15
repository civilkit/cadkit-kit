// The typed move: "X offset" / "Y offset" along the sketch plane's axes (numbers or expressions, millimetres, from where the
// shape is now) and the "Distance from edge" helper (pick an edge of the face the shape sits on, type the clear distance).
// Enter moves, Esc closes. The maths is in move.ts; this only parses the fields and hands (du, dv) to the caller.
import { useEffect, useRef, useState } from 'preact/hooks';
import { evalExpr } from '@kit/ui';
import { t } from '../i18n';
import type { MoveInfo } from './session';
import { EDGE_SIDES, edgeDistance, moveToEdgeDistance, type EdgeSide } from './move';

type Values = Parameters<typeof evalExpr>[1];

/** A field's number: blank is `blank`, an expression is evaluated against the document variables, anything else is null. */
export function fieldValue(src: string, values: Values, blank: number | null): number | null {
  if (src.trim() === '') return blank;
  const r = evalExpr(src, values);
  return r.ok ? r.value : null;
}

/** The move (du, dv) the fields stand for, or null when a field does not parse. An edge distance sets that axis; the offsets set the other. */
export function movesFromFields(info: MoveInfo, f: { x: string; y: string; edge: EdgeSide | ''; dist: string }, values: Values): { du: number; dv: number } | null {
  let du = fieldValue(f.x, values, 0), dv = fieldValue(f.y, values, 0);
  if (du === null || dv === null) return null;
  if (f.edge && f.dist.trim() !== '') {
    const d = fieldValue(f.dist, values, null);
    if (d === null || !info.host) return null;
    const m = moveToEdgeDistance(info.box, info.host, f.edge, d);
    if (f.edge === 'left' || f.edge === 'right') du = m.du; else dv = m.dv;
  }
  return { du, dv };
}

export function MoveFields(p: { info: MoveInfo; values: Values; onApply(du: number, dv: number): void; onClose(): void }) {
  const [x, setX] = useState(''), [y, setY] = useState('');
  const [edge, setEdge] = useState<EdgeSide | ''>(''), [dist, setDist] = useState('');
  const [bad, setBad] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const apply = () => {
    const m = movesFromFields(p.info, { x, y, edge, dist }, p.values);
    if (!m) { setBad(true); return; }
    setBad(false);
    p.onApply(m.du, m.dv);
  };
  const key = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); apply(); } else if (e.key === 'Escape') { e.preventDefault(); p.onClose(); }
  };
  const cur = edge ? edgeDistance(p.info.box, p.info.host, edge) : null;
  return (
    <div class="sizebox-moveto" role="dialog" aria-label={t('sizebox.moveto.title')} onKeyDown={key}>
      <div class="sizebox-moveto-title">{t('sizebox.moveto.title')}</div>
      <label>{t('sizebox.moveto.x')}<input ref={first} type="text" inputMode="decimal" value={x} placeholder="0" onInput={(e) => setX(e.currentTarget.value)} /></label>
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
      {bad ? <div class="sizebox-moveto-bad" role="alert">{t('sizebox.moveto.bad')}</div> : <div class="sizebox-moveto-hint">{t('sizebox.moveto.hint')}</div>}
      <div class="sizebox-moveto-btns"><button type="button" onClick={apply}>{t('sizebox.moveto.apply')}</button><button type="button" onClick={p.onClose}>{t('sizebox.shared.cancel')}</button></div>
    </div>
  );
}
