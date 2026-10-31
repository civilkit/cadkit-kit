import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { t } from '../i18n';
import { copyText, fmt, rowText, type Outcome, type Pick, type Row } from './measure';
import { massText, matrixText, type MassView } from './mass';
import type { Interference } from './kernel';

export interface Box { min: number[]; max: number[] }
export type SectionPlane = 'front' | 'top' | 'right' | 'face';
export interface SectionState { on: boolean; plane: SectionPlane; faceId: string | null; offset: number; flip: boolean }

export interface InspectProps {
  material: string;
  density: number; densityKnown: boolean; onDensity(d: number): void;
  mass: MassView | null; massBusy: boolean; massStale: boolean; box: Box | null; hasSolid: boolean;
  /** surface bodies on screen: they have no volume, so mass covers the solid only */
  surfaces?: number;
  onMass(): void;
  measuring: boolean; onMeasure(): void; picks: Pick[]; outcome: Outcome | null; onClearPicks(): void; onCopy(text: string): void;
  interference: Interference | null; interferenceStale: boolean; interferenceBusy: boolean; onInterference(): void; onPair(a: string, b: string): void;
  section: SectionState; sectionRange: [number, number] | null; onSectionPlane(p: SectionPlane): void; onSection(patch: Partial<SectionState>): void; onSectionOff(): void;
  /** the tab was opened: compute what is cheap to compute */
  onVisible(): void;
}

const v3 = (v: number[]) => `${v.map((x) => fmt(x, 3)).join(', ')}`;
const pickLabel = (p: Pick): string => (p.kind === 'vertex' ? t('inspect.pick.vertex', { at: v3(p.p) }) : p.kind === 'edge' ? t('inspect.pick.edge', { name: p.name.split('#')[0] }) : t('inspect.pick.face', { name: p.name }));
const feature = (face: string): string => face.split('.')[0];

/** The Inspect tab of the drawer: four cards, each a tool. All state comes in as props (see useInspect). */
export function InspectPanel(p: InspectProps): JSX.Element {
  useEffect(() => { p.onVisible(); }, []);
  return (
    <div class="inspect">
      <MassCard {...p} />
      <MeasureCard {...p} />
      <SectionCard {...p} />
      <InterferenceCard {...p} />
    </div>
  );
}

function MassCard(p: InspectProps): JSX.Element {
  const m = p.mass;
  const size = p.box ? [0, 1, 2].map((i) => p.box!.max[i] - p.box!.min[i]) : null;
  const lines: Array<[string, string]> = m ? [
    [t('mass.volume'), `${fmt(m.volume, 3)} mm³`],
    [t('mass.area'), `${fmt(m.area, 3)} mm²`],
    [t('mass.mass'), massText(m.mass)],
    [t('mass.com'), `(${v3(m.com)}) mm`],
    ...(p.box && size ? [[t('mass.box'), `(${v3(p.box.min)}) – (${v3(p.box.max)})`] as [string, string], [t('mass.size'), `${size.map((x) => fmt(x, 3)).join(' × ')} mm`] as [string, string]] : []),
    ...(m.principal.length ? [[t('mass.moments'), `${m.principal.map((x) => fmt(x, 2)).join(', ')} g·mm²`] as [string, string]] : []),
    ...(m.principal.length ? m.axes.slice(0, 3).map((a, i) => [t('mass.axis', { n: i + 1 }), `(${a.map((x) => fmt(x, 4)).join(', ')})`] as [string, string]) : []),
    ...(m.firstMoment ? [[t('mass.firstMoment'), `(${m.firstMoment.map((x) => fmt(x, 2)).join(', ')}) g·mm`] as [string, string]] : []),
    ...(m.inertia ? [[t('mass.inertia'), `${matrixText(m.inertia)}\n${t('mass.inertiaUnit')}`] as [string, string]] : []),
    ...(m.inertiaOrigin ? [[t('mass.inertiaOrigin'), `${matrixText(m.inertiaOrigin)}\n${t('mass.inertiaUnit')}`] as [string, string]] : []),
  ] : [];
  return (
    <section class="insp-card" aria-label={t('inspect.mass')}>
      <h4>{t('inspect.mass')}</h4>
      <div class="insp-bar">
        <label class="insp-field"><span>{t('inspect.density')}</span>
          <input type="number" inputMode="decimal" enterKeyHint="done" step="any" min="0" value={p.density} aria-label={t('inspect.density')} onChange={(e) => p.onDensity(parseFloat((e.currentTarget as HTMLInputElement).value))} />
          <span class="insp-unit">g/cm³</span></label>
        <button class="btn" disabled={!p.hasSolid || p.massBusy} onClick={p.onMass}>{t('inspect.mass.compute')}</button>
        <button class="btn" disabled={!m} onClick={() => p.onCopy(lines.map(([a, b]) => `${a}\t${b}`).join('\n'))}>{t('inspect.copy')}</button>
      </div>
      <div class="insp-note">{p.material ? (p.densityKnown ? t('inspect.material', { name: p.material }) : t('inspect.density.unknown', { name: p.material })) : t('inspect.density.noMaterial')}</div>
      {!p.hasSolid ? <div class="empty">{t(p.surfaces ? 'inspect.mass.sheets' : 'inspect.mass.none')}</div> : null}
      {p.hasSolid && p.surfaces ? <div class="insp-note">{t('inspect.mass.sheetsAlso')}</div> : null}
      {p.massStale ? <div class="insp-note warn">{t('inspect.stale')}</div> : null}
      {lines.length ? <dl class="insp-rows">{lines.map(([k, v]) => <><dt>{k}</dt><dd class={v.includes('\n') ? 'insp-mat' : undefined}>{v}</dd></>)}</dl> : null}
      {m && m.bodies.length > 1 ? (
        <table class="insp-table"><thead><tr><th>{t('mass.bodies')}</th><th>{t('mass.volume')}</th><th>{t('mass.mass')}</th></tr></thead>
          <tbody>{m.bodies.map((b, i) => <tr key={i}><td>{i + 1}</td><td>{fmt(b.volume, 2)}</td><td>{massText(b.mass)}</td></tr>)}</tbody></table>
      ) : null}
    </section>
  );
}

function MeasureCard(p: InspectProps): JSX.Element {
  const rows: Row[] = p.outcome?.rows ?? [];
  return (
    <section class="insp-card" aria-label={t('inspect.measure')}>
      <h4>{t('inspect.measure')}</h4>
      <div class="insp-bar">
        <button class="btn" aria-pressed={p.measuring} onClick={p.onMeasure}>{p.measuring ? t('measure.stop') : t('measure.start')}</button>
        <button class="btn" disabled={!p.picks.length} onClick={p.onClearPicks}>{t('measure.clear')}</button>
        <button class="btn" disabled={!rows.length} onClick={() => p.onCopy(copyText(rows, (id) => t('measure.' + id)))}>{t('inspect.copy')}</button>
      </div>
      {!p.measuring ? <div class="insp-note">{t('measure.off')}</div> : null}
      {p.measuring && !p.picks.length ? <div class="insp-note">{t('measure.hint')}</div> : null}
      {p.picks.length ? <ul class="insp-picks" aria-label={t('measure.items')}>{p.picks.map((k) => <li key={k.name}>{pickLabel(k)}</li>)}</ul> : null}
      {p.outcome?.surface ? <div class="insp-note">{t('measure.surf.' + p.outcome.surface, undefined, p.outcome.surface)}</div> : null}
      {p.outcome?.error ? <div class="insp-note warn">{t('measure.unavailable')}</div> : null}
      {rows.length ? (
        <dl class="insp-rows" aria-label={t('measure.results')}>
          {rows.map((r) => <><dt>{t('measure.' + r.id, undefined, r.id)}</dt><dd>{rowText(r)}</dd></>)}
        </dl>
      ) : null}
    </section>
  );
}

function SectionCard(p: InspectProps): JSX.Element {
  const s = p.section;
  const r = p.sectionRange;
  const planes: SectionPlane[] = ['front', 'top', 'right', 'face'];
  const step = r ? Math.max((r[1] - r[0]) / 200, 1e-3) : 1;
  return (
    <section class="insp-card" aria-label={t('inspect.section')}>
      <h4>{t('inspect.section')}</h4>
      <div class="insp-bar" role="group" aria-label={t('inspect.section.plane')}>
        {planes.map((k) => (
          <button key={k} class="btn" aria-pressed={s.on && s.plane === k} onClick={() => p.onSectionPlane(k)}>{t('inspect.section.' + k)}</button>
        ))}
        <button class="btn" disabled={!s.on} onClick={p.onSectionOff}>{t('inspect.section.off')}</button>
      </div>
      {s.on && r ? (
        <>
          <label class="insp-field wide"><span>{t('inspect.section.offset')}</span>
            <input type="range" min={r[0]} max={r[1]} step={step} value={Math.min(r[1], Math.max(r[0], s.offset))} aria-label={t('inspect.section.offset')} onInput={(e) => p.onSection({ offset: parseFloat((e.currentTarget as HTMLInputElement).value) })} />
            <input type="number" inputMode="decimal" enterKeyHint="done" step="any" value={+s.offset.toFixed(4)} aria-label={t('inspect.section.offsetValue')} onChange={(e) => { const v = parseFloat((e.currentTarget as HTMLInputElement).value); if (Number.isFinite(v)) p.onSection({ offset: v }); }} />
            <span class="insp-unit">mm</span></label>
          <label class="insp-flag"><input type="checkbox" checked={s.flip} onChange={(e) => p.onSection({ flip: (e.currentTarget as HTMLInputElement).checked })} />{t('inspect.section.flip')}</label>
        </>
      ) : <div class="insp-note">{t('inspect.section.hint')}</div>}
    </section>
  );
}

function InterferenceCard(p: InspectProps): JSX.Element {
  const r = p.interference;
  return (
    <section class="insp-card" aria-label={t('inspect.interference')}>
      <h4>{t('inspect.interference')}</h4>
      <div class="insp-bar"><button class="btn" disabled={!p.hasSolid || p.interferenceBusy} onClick={p.onInterference}>{p.interferenceBusy ? t('inspect.interference.running') : t('inspect.interference.run')}</button></div>
      {p.interferenceStale && r ? <div class="insp-note warn">{t('inspect.stale')}</div> : null}
      {!r ? <div class="insp-note">{t('inspect.interference.none')}</div> : null}
      {r && r.bodies < 2 ? <div class="insp-note">{t('inspect.interference.single')}</div> : null}
      {r && r.bodies >= 2 && r.pairs.length === 0 ? <div class="insp-ok">{t('inspect.interference.clean', { n: r.bodies })}</div> : null}
      {r && r.pairs.length ? (
        <div class="insp-pairs" aria-label={t('inspect.interference.pairs')}>
          {r.pairs.map((q, i) => (
            <button key={i} class="insp-pair" disabled={!!q.error} onClick={() => p.onPair(q.a, q.b)}>
              <span>{feature(q.a)} ∩ {feature(q.b)}</span>
              <span class="val">{q.error ? q.error : `${fmt(Math.abs(q.volume ?? 0), 3)} mm³`}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
