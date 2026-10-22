// The Corner holes control: Inset, Match corner fillet, holes along X and Y, and a Place button. Used twice: floating over the
// canvas while the Hole-on-face sketch is open (Place writes the points into the sketch), and above the Hole editor when a hole
// made this way is reopened (the button then says Update and moves the holes). The rules are in cornerHoles.ts.
import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { ExprInput } from '@kit/ui';
import { t } from './i18n';
import { effectiveInset, placeCornerHoles, type CornerRecord, type Outline, type Pt, type Rect } from './cornerHoles';

export interface PlateInfo { rect: Rect; radius: number | null; /** the outline is a rectangle (or the bounding box stands in, with a warning in `notes`) */ notes: Array<{ code: string; params: Record<string, string | number> }> }

export interface CornerHolesPanelProps {
  value: CornerRecord;
  plate: PlateInfo;
  /** Diameter of the hole as the hole editor has it now (null: unknown), for the wall warning. */
  holeDiameter: number | null;
  /** Reopened hole: the button says Update. */
  update?: boolean;
  floating?: boolean;
  onPlace(rec: CornerRecord, points: Pt[], plate: PlateInfo): void;
}

/** The plate the control works on, from a face outline. */
export const plateFromOutline = (o: Outline): PlateInfo => ({ rect: o.rect, radius: o.radius, notes: o.issues.map((i) => ({ code: i.code, params: i.params })) });

const r1 = (v: number) => Math.round(v * 100) / 100;

export function CornerHolesPanel(p: CornerHolesPanelProps): JSX.Element {
  const [inset, setInset] = useState(p.value.inset);
  const [match, setMatch] = useState(p.value.matchFillet);
  const [nx, setNx] = useState(p.value.nx);
  const [ny, setNy] = useState(p.value.ny);
  const rec: CornerRecord = { inset, matchFillet: match && !!p.plate.radius, nx, ny };
  const used = effectiveInset(rec, p.plate.radius);
  const placed = placeCornerHoles(p.plate.rect, { inset: used, nx, ny, radius: p.plate.radius ?? 0, holeDiameter: p.holeDiameter });
  const blocked = placed.issues.some((i) => i.level === 'error');
  const w = p.plate.rect.maxX - p.plate.rect.minX, h = p.plate.rect.maxY - p.plate.rect.minY;
  const place = () => { if (!blocked) p.onPlace(rec, placed.points, p.plate); };
  const issues = [...p.plate.notes.map((n) => ({ level: 'warn' as const, code: n.code, params: n.params })), ...placed.issues];
  const count = (name: string, label: string, value: number, set: (n: number) => void) => (
    <label class="fedit-fld" data-path={name}>
      <span class="fedit-fld-label">{label}</span>
      <input type="number" min={2} step={1} value={value} title={t('cornerHoles.countTip')}
        onInput={(e) => set(Number((e.currentTarget as HTMLInputElement).value))}
        onKeyDown={(e) => { if ((e as KeyboardEvent).key === 'Enter') place(); }} />
    </label>
  );
  return (
    <section class={'chole' + (p.floating ? ' chole-float' : '')} data-testid="corner-holes" aria-label={t('cornerHoles.title')}>
      <h4 class="chole-title">{t('cornerHoles.title')}</h4>
      <label class="fedit-fld" data-path="inset" title={t('cornerHoles.insetTip')}>
        <span class="fedit-fld-label">{t('cornerHoles.inset')}</span>
        <span class="fedit-num">
          <ExprInput plain value={match && p.plate.radius ? p.plate.radius : inset} unit="mm" label={t('cornerHoles.inset')} disabled={match && !!p.plate.radius}
            onValue={(v) => { if (typeof v === 'number') setInset(v); }} />
        </span>
      </label>
      {p.plate.radius ? (
        <label class="fedit-fld bool" data-path="matchFillet" title={t('cornerHoles.matchTip')}>
          <input type="checkbox" checked={match} onChange={(e) => setMatch((e.currentTarget as HTMLInputElement).checked)} />
          <span>{t('cornerHoles.matchR', { r: r1(p.plate.radius) })}</span>
        </label>
      ) : null}
      {count('nx', t('cornerHoles.nx'), nx, setNx)}
      {count('ny', t('cornerHoles.ny'), ny, setNy)}
      {!blocked ? <div class="chole-count" data-testid="corner-count">{t('cornerHoles.count', { n: placed.points.length, w: r1(w), h: r1(h) })}</div> : null}
      {issues.map((i, k) => <div key={k} class={'chole-issue ' + i.level} role={i.level === 'error' ? 'alert' : 'note'} data-code={i.code}>{t('cornerHoles.issue.' + i.code, i.params)}</div>)}
      <button class="chole-place" type="button" disabled={blocked} onClick={place}>{p.update ? t('cornerHoles.update') : t('cornerHoles.place')}</button>
    </section>
  );
}
