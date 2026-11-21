// The Convert mesh to solid panel. Top to bottom: which mesh; the outcome (before the first run one sentence of what will happen, then a
// green result card or a red refusal card, the Show control, and the Details); the options (close gaps off by default, an Advanced
// section). Convert, Close and Add to part sit in the sticky footer, so the primary action never moves. A refusal leads with our own
// advice; the kernel's message and hint are kept under Technical detail. Rows that have a place point the viewport at it. Phase 1 is a
// preview: Add to part is disabled (see meshSolidAccept.ts). Pure UI: the owner (useMeshSolid.ts) runs the kernel and draws the viewport.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon, numberAttrs } from '@kit/ui';
import { t } from '../i18n';
import { HelpButton } from '../HelpButton';
import {
  DEFAULT_MESH_SOLID_OPTIONS, MAX_DECIMATE_INPUT, MAX_TRIANGLES, fmtArea, fmtLength, suggestDecimateTol, fmtDeviation, fmtMs, fmtPercent, fmtVolume, parseTol, triangleLimit,
  type LengthUnit, type MeshSolidOptions, type MeshSolidOutcome, type MeshSolidRefusal, type MeshSolidReport,
} from './meshSolid';
import { MESH_SOLID_ACCEPT_READY } from './meshSolidAccept';
import './mesh.css';

export type MeshSolidShow = 'both' | 'solid' | 'mesh';
export interface MeshSolidSource { id: string; name: string; tris: number; /** the diagonal of its box, mm (a starting tolerance for Decimate comes from it) */ diagonal?: number; /** read from a file for this panel (not in the part); the unit it was read in */ fileUnit?: string }

export interface MeshSolidPanelProps {
  sources: MeshSolidSource[];
  sourceId: string;
  onSource(id: string): void;
  busy: boolean;
  /** the last answer (null before the first run); `cancelled` when the user stopped waiting */
  outcome: MeshSolidOutcome | null;
  cancelled?: boolean;
  show: MeshSolidShow;
  onShow(s: MeshSolidShow): void;
  /** the place pointed at (an index into marksOf(outcome)), or null */
  focus: number | null;
  onFocus(i: number | null): void;
  unit: LengthUnit;
  onRun(o: MeshSolidOptions): void;
  onCancelRun(): void;
  onClose(): void;
  onAccept(): void;
}

/** The text of the numeric fields; an empty field is the kernel's default. */
interface Fields { closeTolerance: string; maxHoleEdges: string; planeTol: string; angleTolDeg: string; fitTol: string; decimateTol?: string; decimateTarget?: string; decimateKeepAngle?: string }
const EMPTY: Fields = { closeTolerance: '', maxHoleEdges: '', planeTol: '', angleTolDeg: '', fitTol: '', decimateTol: '', decimateTarget: '', decimateKeepAngle: '' };

/** How much work the analytic fit may do: the kernel's default, more, or no limit. */
export type Effort = 'default' | 'more' | 'most' | 'unlimited';
export const EFFORTS: readonly Effort[] = ['default', 'more', 'most', 'unlimited'];
const EFFORT_UNITS: Record<Effort, number | null> = { default: null, more: 10, most: 30, unlimited: 0 };

/** The options the fields and toggles say, and whether a field holds something that is not a number above 0. */
export function optionsOf(f: Fields, close: boolean, fill: boolean, analytic: boolean, effort: Effort = 'default', decimate = false, diagonal?: number): { options: MeshSolidOptions; invalid: Array<keyof Fields> } {
  const invalid: Array<keyof Fields> = [];
  const get = (k: keyof Fields, integer = false): number | null => { const r = parseTol(f[k] ?? '', integer); if (r.invalid) invalid.push(k); return r.value; };
  const options: MeshSolidOptions = {
    ...DEFAULT_MESH_SOLID_OPTIONS, close, fill, analytic, maxSeconds: EFFORT_UNITS[effort],
    closeTolerance: get('closeTolerance'), maxHoleEdges: get('maxHoleEdges', true), planeTol: get('planeTol'), angleTolDeg: get('angleTolDeg'), fitTol: get('fitTol'),
    decimate, decimateTol: get('decimateTol'), decimateTarget: get('decimateTarget', true), decimateKeepAngle: get('decimateKeepAngle'),
  };
  // an empty Decimate tolerance is the suggestion from the size of the mesh (the kernel has no default for it)
  if (decimate && options.decimateTol === null) options.decimateTol = suggestDecimateTol(diagonal);
  const off = (k: keyof Fields): boolean => (k === 'closeTolerance' || k === 'maxHoleEdges') ? !close : (k === 'decimateTol' || k === 'decimateTarget' || k === 'decimateKeepAngle') ? !decimate : false;
  // fields that are switched off do not count against Convert; Decimate with no tolerance and no size to suggest one from needs one typed
  const bad = invalid.filter((k) => !off(k)).filter((k) => fill || k !== 'maxHoleEdges');
  if (decimate && options.decimateTol === null && !bad.includes('decimateTol')) bad.push('decimateTol');
  return { options, invalid: bad };
}

// ---- the words of the report (pure apart from t) ----

/** The title of a refusal code (our advice follows it; the kernel's own text is under Technical detail). */
export const refusalTitle = (code: string): string => t('m2s.code.' + code, undefined, t('m2s.code.other'));
/** What to do about a refusal, in our words. `closing`: the user had Close gaps and holes on (the gaps advice then differs). */
export function refusalAdvice(code: string, closing: boolean): string {
  if (code === 'meshNotWatertight' && closing) return t('m2s.advice.meshNotWatertight.closing');
  return t('m2s.advice.' + code, undefined, t('m2s.advice.other'));
}

/** The kinds of face as short chips ('6 planar', '1 cylinder'), in a fixed order, the empty ones left out. */
export function faceChips(r: MeshSolidReport): Array<{ kind: string; text: string }> {
  const n = r.kinds;
  const out: Array<{ kind: string; text: string }> = [];
  if (n.planar) out.push({ kind: 'planar', text: t('m2s.chip.planar', { count: n.planar }) });
  if (n.cylinder) out.push({ kind: 'cylinder', text: t('m2s.chip.cylinder', { count: n.cylinder }) });
  if (n.cone) out.push({ kind: 'cone', text: t('m2s.chip.cone', { count: n.cone }) });
  if (n.sphere) out.push({ kind: 'sphere', text: t('m2s.chip.sphere', { count: n.sphere }) });
  if (n.faceted) out.push({ kind: 'faceted', text: t('m2s.chip.faceted', { count: n.faceted }) });
  if (n.other) out.push({ kind: 'other', text: t('m2s.chip.other', { count: n.other }) });
  return out;
}

/** One sentence on the analytic fit: switched off, nothing curved, everything fitted, or how many facets stayed on curved areas. */
export function fitLine(r: MeshSolidReport, analyticOn: boolean): string {
  if (!analyticOn) return t('m2s.fit.off');
  if (r.kinds.faceted > 0) return t('m2s.fit.faceted', { count: r.kinds.faceted });
  if (r.kinds.cylinder + r.kinds.cone + r.kinds.sphere > 0) return t('m2s.fit.all');
  return t('m2s.fit.none');
}

/** What Decimate did: 'Decimated from 120 000 to 14 800 triangles (deviation at most 0.043 mm of 0.1 mm allowed)'. */
export function decimationLine(d: NonNullable<MeshSolidReport['decimation']>, unit: LengthUnit): string {
  const n = (v: number): string => v.toLocaleString('en-US').replace(/,/g, '\u00a0');
  if (d.triangles >= d.inputTriangles) return t('m2s.decimated.none', { n: n(d.inputTriangles), tol: fmtLength(d.tol, unit) });
  return t('m2s.decimated', { from: n(d.inputTriangles), to: n(d.triangles), dev: fmtLength(d.deviation, unit, 2), tol: fmtLength(d.tol, unit, 2) });
}

/** What closing did, in one line with only the things that happened: 'Filled 1 hole (200 mm²); 3 open edges found'. */
export function inventedLine(c: NonNullable<MeshSolidReport['closing']>, unit: LengthUnit): string {
  const parts: string[] = [];
  if (c.filledHoles) parts.push(t('m2s.inv.filled', { count: c.filledHoles, area: fmtArea(c.filledArea, unit) }));
  if (c.mergedVertices) parts.push(t('m2s.inv.welded', { count: c.mergedVertices }));
  if (c.stitched) parts.push(t('m2s.inv.stitched', { count: c.stitched }));
  if (c.openEdges) parts.push(t('m2s.inv.open', { count: c.openEdges }));
  if (!parts.length) return t('m2s.inv.nothing');
  const line = parts.join('; ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** Closing changed anything (the Details then open by themselves). */
const invented = (r: MeshSolidReport): boolean => !!r.closing && (r.closing.filledHoles + r.closing.mergedVertices + r.closing.stitched) > 0;

export function MeshSolidPanel(p: MeshSolidPanelProps): JSX.Element {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [close, setClose] = useState(DEFAULT_MESH_SOLID_OPTIONS.close);
  const [fill, setFill] = useState(DEFAULT_MESH_SOLID_OPTIONS.fill);
  const [analytic, setAnalytic] = useState(DEFAULT_MESH_SOLID_OPTIONS.analytic);
  const [effort, setEffort] = useState<Effort>('default');
  const [decimate, setDecimate] = useState(DEFAULT_MESH_SOLID_OPTIONS.decimate);
  /** the options of the run on screen (the report's words depend on them, not on what the toggles say now) */
  const [ran, setRan] = useState<MeshSolidOptions>(DEFAULT_MESH_SOLID_OPTIONS);
  const runBtn = useRef<HTMLButtonElement>(null);
  const src = p.sources.find((s) => s.id === p.sourceId) ?? p.sources[0];
  const limit = src ? triangleLimit(src.tris, decimate) : 'ok';
  const { options, invalid } = optionsOf(fields, close, fill, analytic, effort, decimate, src?.diagonal);
  const suggested = suggestDecimateTol(src?.diagonal);
  const canRun = !!src && !p.busy && limit !== 'over' && invalid.length === 0;
  const run = (): void => { if (!canRun) return; setRan(options); p.onRun(options); };
  /** The refusal card's one-click way out of gaps: tick Close gaps and holes and convert again. */
  const closed = optionsOf(fields, true, fill, analytic, effort, decimate, src?.diagonal);
  const retryClosed = !close && !!src && !p.busy && limit !== 'over' && closed.invalid.length === 0
    ? () => { setClose(true); setRan(closed.options); p.onRun(closed.options); } : null;
  const live = useRef({ run, p });
  live.current = { run, p };
  useEffect(() => { runBtn.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const { p: q } = live.current;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (q.busy) q.onCancelRun(); else q.onClose(); return; }
      // Enter in a field of the panel converts (a button or a disclosure keeps its own Enter)
      const el = e.target as HTMLElement | null;
      if (e.key === 'Enter' && el?.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox' && el.closest('.m2s-panel')) { e.preventDefault(); e.stopPropagation(); live.current.run(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const field = (k: keyof Fields, label: string, unit: string, integer = false, hold?: string): JSX.Element => (
    <label class="fedit-fld m2s-fld" data-path={k}>
      <span class="fedit-fld-label">{label}</span>
      <span class="fedit-num m2s-num">
        <input {...numberAttrs(integer ? 'integer' : 'positive')} type="text" value={fields[k] ?? ''} placeholder={hold ?? t('m2s.auto')} title={t('m2s.auto.tip')} aria-label={label} data-testid={'m2s-' + k}
          aria-invalid={invalid.includes(k) ? 'true' : undefined} onInput={(e) => setFields({ ...fields, [k]: (e.currentTarget as HTMLInputElement).value })} />
        <span class="fedit-unit">{unit}</span>
      </span>
    </label>
  );
  const unit = p.unit;
  return (
    <div class="fedit thread-editor prop-wizard mesh-panel m2s-panel" tabIndex={-1} data-testid="m2s-panel">
      <div class="fedit-head">
        <Icon name="mesh-to-solid" size={22} class="fedit-icon" />
        <div class="fedit-title">{t('m2s.title')}</div>
        <HelpButton topic="wizard:meshSolid" />
        <button type="button" class="fedit-cancel" onClick={p.onClose} title={t('m2s.close')} aria-label={t('m2s.close')}><Icon name="close" size={20} /></button>
      </div>
      <div class="fedit-sec-fields prop-body">
        {p.sources.length > 1 ? (
          <label class="fedit-fld" data-path="source">
            <span class="fedit-fld-label">{t('m2s.source')}</span>
            <select value={src?.id} aria-label={t('m2s.source')} data-testid="m2s-source" disabled={p.busy} onChange={(e) => p.onSource((e.currentTarget as HTMLSelectElement).value)}>
              {p.sources.map((s) => <option key={s.id} value={s.id}>{s.fileUnit ? t('m2s.source.file', { name: s.name }) : s.name}</option>)}
            </select>
          </label>
        ) : src ? <div class="m2s-name" data-testid="m2s-name"><b>{src.fileUnit ? t('m2s.source.file', { name: src.name }) : src.name}</b></div> : <p class="m2s-note">{t('m2s.noMesh')}</p>}
        {src ? <div class="m2s-note" data-testid="m2s-tris">{t('m2s.tris', { tris: src.tris.toLocaleString('en-US'), limit: MAX_TRIANGLES.toLocaleString('en-US') })}</div> : null}
        {src?.fileUnit ? <div class="m2s-note">{t('m2s.fileUnit', { unit: src.fileUnit })}</div> : null}
        {limit === 'warn' ? <p class="m2s-warn" data-testid="m2s-tris-warn">{t('m2s.tris.warn')}</p> : null}
        {limit === 'over' ? <p class="m2s-err" data-testid="m2s-tris-over">{t('m2s.tris.over', { limit: (decimate ? MAX_DECIMATE_INPUT : MAX_TRIANGLES).toLocaleString('en-US') })}</p> : null}
        {decimate && src && src.tris > MAX_TRIANGLES && limit !== 'over' ? <p class="m2s-note" data-testid="m2s-tris-thinned">{t('m2s.tris.thinned', { limit: MAX_TRIANGLES.toLocaleString('en-US') })}</p> : null}

        {p.busy && src ? (
          <div class="m2s-busy" role="status" data-testid="m2s-busy">
            <span class="m2s-spinner" aria-hidden="true" />{t('m2s.busy', { tris: src.tris.toLocaleString('en-US') })}
            <p class="m2s-note">{t('m2s.busy.note')}</p>
          </div>
        ) : null}
        {!p.busy && p.cancelled ? <p class="m2s-note" data-testid="m2s-cancelled">{t('m2s.cancelled')}</p> : null}
        {!p.busy && !p.outcome && !p.cancelled ? (
          <div class="m2s-intro" data-testid="m2s-intro"><p>{t('m2s.intro')}</p><p class="m2s-note">{t('m2s.previewNote')}</p></div>
        ) : null}
        {!p.busy && p.outcome ? <Outcome {...p} ran={ran} retryClosed={retryClosed} /> : null}

        <div class="m2s-options">
          <label class="fedit-fld sk3d-check" data-path="decimate">
            <input type="checkbox" checked={decimate} aria-label={t('m2s.decimate')} data-testid="m2s-decimate" disabled={p.busy} onChange={(e) => setDecimate((e.currentTarget as HTMLInputElement).checked)} />
            <span>{t('m2s.decimate')}</span>
          </label>
          <p class="m2s-note">{t('m2s.decimate.note')}</p>
          {decimate ? (
            <div class="m2s-sub" data-testid="m2s-decimate-options">
              {field('decimateTol', t('m2s.decimateTol'), 'mm', false, suggested !== null ? fmtLength(suggested).replace(/\s?mm$/, '') : undefined)}
              {field('decimateTarget', t('m2s.decimateTarget'), t('m2s.unit.tris'), true)}
              {field('decimateKeepAngle', t('m2s.decimateKeep'), '°')}
            </div>
          ) : null}
          <label class="fedit-fld sk3d-check" data-path="close">
            <input type="checkbox" checked={close} aria-label={t('m2s.closeGaps')} data-testid="m2s-close" disabled={p.busy} onChange={(e) => setClose((e.currentTarget as HTMLInputElement).checked)} />
            <span>{t('m2s.closeGaps')}</span>
          </label>
          <p class="m2s-note">{t('m2s.closeGaps.note')}</p>
          {close ? (
            <div class="m2s-sub" data-testid="m2s-close-options">
              {field('closeTolerance', t('m2s.closeTol'), 'mm')}
              <label class="fedit-fld sk3d-check" data-path="fill">
                <input type="checkbox" checked={fill} aria-label={t('m2s.fill')} data-testid="m2s-fill" onChange={(e) => setFill((e.currentTarget as HTMLInputElement).checked)} />
                <span>{t('m2s.fill')}</span>
              </label>
              {fill ? field('maxHoleEdges', t('m2s.maxHoleEdges'), t('m2s.unit.edges'), true) : null}
            </div>
          ) : null}
          <details class="m2s-advanced" data-testid="m2s-advanced">
            <summary>{t('m2s.advanced')}</summary>
            {field('planeTol', t('m2s.planeTol'), 'mm')}
            {field('angleTolDeg', t('m2s.angleTol'), '°')}
            {field('fitTol', t('m2s.fitTol'), 'mm')}
            <label class="fedit-fld sk3d-check" data-path="analytic">
              <input type="checkbox" checked={analytic} aria-label={t('m2s.analytic')} data-testid="m2s-analytic" onChange={(e) => setAnalytic((e.currentTarget as HTMLInputElement).checked)} />
              <span>{t('m2s.analytic')}</span>
            </label>
            {analytic ? (
              <label class="fedit-fld" data-path="effort">
                <span class="fedit-fld-label">{t('m2s.effort')}</span>
                <select value={effort} aria-label={t('m2s.effort')} data-testid="m2s-effort" disabled={p.busy} onChange={(e) => setEffort((e.currentTarget as HTMLSelectElement).value as Effort)}>
                  {EFFORTS.map((k) => <option value={k}>{t('m2s.effort.' + k)}</option>)}
                </select>
              </label>
            ) : null}
            {analytic && effort === 'unlimited' ? <p class="m2s-note" data-testid="m2s-effort-warn">{t('m2s.effort.warn')}</p> : null}
            <p class="m2s-note">{t('m2s.advanced.note')}</p>
          </details>
          {invalid.length ? <p class="m2s-err" data-testid="m2s-invalid">{t('m2s.invalid')}</p> : null}
        </div>
      </div>
      <div class="prop-nav m2s-nav">
        <div class="m2s-nav-row">
          <button type="button" class="fedit-card-btn" data-testid="m2s-close-panel" onClick={p.onClose}>{t('m2s.close')}</button>
          <span class="m2s-nav-right">
            <span title={MESH_SOLID_ACCEPT_READY ? undefined : t('m2s.accept.tip')}>
              <button type="button" class="fedit-card-btn m2s-accept" data-testid="m2s-accept" disabled={!MESH_SOLID_ACCEPT_READY || !p.outcome?.ok || p.busy} aria-describedby="m2s-accept-note" onClick={p.onAccept}>{t('m2s.accept')}</button>
            </span>
            {p.busy
              ? <button type="button" class="fedit-card-btn" data-testid="m2s-cancel-run" onClick={p.onCancelRun}>{t('m2s.cancelRun')}</button>
              : <button ref={runBtn} type="button" class="fedit-card-btn prop-create" data-testid="m2s-run" disabled={!canRun} onClick={run}>{t(p.outcome ? 'm2s.runAgain' : 'm2s.run')}</button>}
          </span>
        </div>
        {MESH_SOLID_ACCEPT_READY ? null : <p class="m2s-note m2s-accept-note" id="m2s-accept-note" data-testid="m2s-accept-note">{t('m2s.accept.note')}</p>}
      </div>
    </div>
  );
}

/** Refusals that ticking Close gaps and holes can cure (the others need a mesh tool or other options). */
export const CLOSE_FIXES = new Set(['meshNotWatertight']);

function Outcome(p: MeshSolidPanelProps & { ran: MeshSolidOptions; retryClosed: (() => void) | null }): JSX.Element | null {
  const o = p.outcome;
  if (!o) return null;
  if (o.ok) return <Report r={o.report} {...p} />;
  if ('failed' in o) return <div class="m2s-card bad" role="alert"><p class="m2s-card-head" data-testid="m2s-failed"><Icon name="close" size={16} />{t('m2s.failed', { reason: o.failed })}</p></div>;
  return <Refusal r={o.refusal} {...p} />;
}

/** A row that points the view at a place: pressed while it is the one pointed at. */
function PlaceRow(p: { i: number; focus: number | null; onFocus(i: number | null): void; children: JSX.Element | JSX.Element[] | string }): JSX.Element {
  const on = p.focus === p.i;
  return (
    <li>
      <button type="button" class={'m2s-place' + (on ? ' on' : '')} aria-pressed={on} data-testid={'m2s-place-' + p.i} title={t('m2s.hole.show')} onClick={() => p.onFocus(on ? null : p.i)}>
        <Icon name="point" size={14} />{p.children}
      </button>
    </li>
  );
}

/** The Show control: a compact segmented choice of mesh and solid, solid, mesh. */
function ShowSeg(p: { show: MeshSolidShow; onShow(s: MeshSolidShow): void }): JSX.Element {
  const label = (s: MeshSolidShow): string => (s === 'both' ? t('m2s.show.both') : s === 'solid' ? t('m2s.show.solid') : t('m2s.show.mesh'));
  return (
    <div class="m2s-seg" role="radiogroup" aria-label={t('m2s.show')} data-testid="m2s-show">
      <span class="m2s-seg-label">{t('m2s.show')}</span>
      {(['both', 'solid', 'mesh'] as const).map((s) => (
        <button key={s} type="button" role="radio" aria-checked={p.show === s} class={p.show === s ? 'on' : ''} data-show={s} onClick={() => p.onShow(s)}>{label(s)}</button>
      ))}
    </div>
  );
}

function Report(p: MeshSolidPanelProps & { r: MeshSolidReport; ran: MeshSolidOptions }): JSX.Element {
  const r = p.r, u = p.unit;
  const repairKey = (key: string): string => (key === 'collapsed' ? 'm2s.repair.collapsed' : key === 'duplicates' ? 'm2s.repair.duplicates' : key === 'slivers' ? 'm2s.repair.slivers' : key === 'flipped' ? 'm2s.repair.flipped' : key === 'insideOut' ? 'm2s.repair.insideOut' : 'm2s.repair.voids');
  // faces and volume fit one line of the 340 px card; the time goes beside the chips
  const head = [t('m2s.faces', { count: r.faces, n: r.faces.toLocaleString('en-US') }), r.volume.body !== null ? fmtVolume(r.volume.body, u) : null].filter(Boolean).join(' · ');
  const dev = r.deviation ? fmtDeviation(r.deviation.max, u, r.diagonal) : null;
  const rel = r.volume.relative !== null ? fmtPercent(r.volume.relative) : null;
  let place = 0;
  return (
    <div class="m2s-outcome" data-testid="m2s-report">
      <div class="m2s-card ok" role="status">
        <p class="m2s-card-head" data-testid="m2s-headline"><Icon name="check" size={16} />{t('m2s.result')}: {head}</p>
        <div class="m2s-chip-row">
          <ul class="m2s-chips" data-testid="m2s-kinds">{faceChips(r).map((c) => <li key={c.kind} data-kind={c.kind}>{c.text}</li>)}</ul>
          <span class="m2s-took" data-testid="m2s-took">{fmtMs(r.ms)}</span>
        </div>
        {r.decimation ? <p class="m2s-card-text" data-testid="m2s-decimated">{decimationLine(r.decimation, u)}</p> : null}
        <p class="m2s-card-text" data-testid="m2s-faceted">{fitLine(r, p.ran.analytic)}</p>
        {r.budgetExhausted ? <p class="m2s-card-text m2s-budget" data-testid="m2s-budget">{t('m2s.fit.budget')}</p> : null}
      </div>
      <ShowSeg show={p.show} onShow={p.onShow} />
      <p class="m2s-preview-label" data-testid="m2s-preview-label">{t('m2s.preview.label')}</p>
      <details class="m2s-details" data-testid="m2s-details" open={invented(r)}>
        <summary>{t('m2s.details')}</summary>
        {r.closing ? (
          <div class="m2s-invented" data-testid="m2s-invented">
            <h4 class="m2s-h">{t('m2s.invented')}</h4>
            <p class="m2s-note" data-testid="m2s-invented-line">{inventedLine(r.closing, u)}</p>
            {r.closing.holes.length ? (
              <ul class="m2s-places">
                {r.closing.holes.map((h, i) => {
                  const text = `${t('m2s.hole', { i: i + 1, edges: h.edges, area: fmtArea(h.area, u) })}, ${t(h.planar ? 'm2s.hole.planar' : 'm2s.hole.curved')}`;
                  return h.at ? <PlaceRow key={i} i={place++} focus={p.focus} onFocus={p.onFocus}>{text}</PlaceRow> : <li key={i}>{text}</li>;
                })}
              </ul>
            ) : null}
          </div>
        ) : null}
        <dl class="m2s-facts">
          {r.deviation ? <div><dt>{t('m2s.deviation')}</dt><dd data-testid="m2s-deviation">{dev ? t('m2s.deviation.value', { max: dev, rms: fmtDeviation(r.deviation.rms, u) ?? '0' }) : t('m2s.deviation.exact')}</dd></div> : null}
          {r.volume.body !== null ? (
            <div><dt>{t('m2s.volume')}</dt>
              <dd data-testid="m2s-volume">
                {r.volume.mesh !== null ? <span>{t('m2s.volume.mesh', { v: fmtVolume(r.volume.mesh, u) })}</span> : null}
                <span>{t('m2s.volume.solid', { v: fmtVolume(r.volume.body, u) })}</span>
                <span class="m2s-change">{rel ? t('m2s.volume.change', { rel }) : t('m2s.volume.same')}</span>
              </dd>
            </div>
          ) : null}
          <div><dt>{t('m2s.time')}</dt><dd data-testid="m2s-time">{fmtMs(r.ms)}</dd></div>
        </dl>
        {r.repairs.length ? <p class="m2s-note" data-testid="m2s-repairs">{t('m2s.repairs', { list: r.repairs.map((x) => t(repairKey(x.key), { count: x.n })).join(', ') })}</p> : null}
      </details>
    </div>
  );
}

function Refusal(p: MeshSolidPanelProps & { r: MeshSolidRefusal; ran: MeshSolidOptions; retryClosed: (() => void) | null }): JSX.Element {
  const r = p.r, u = p.unit;
  let place = 0;
  const holeRows = r.holes.map((h, i) => {
    const size = h.edges !== null && h.area !== null ? ` (${t('m2s.failedHole.size', { edges: h.edges, area: fmtArea(h.area, u) })})` : '';
    const text = t('m2s.failedHole', { i: i + 1, reason: h.reason }) + size;
    return h.at ? <PlaceRow key={'h' + i} i={place++} focus={p.focus} onFocus={p.onFocus}>{text}</PlaceRow> : <li key={'h' + i}>{text}</li>;
  });
  const posRows = r.positions.map((_, i) => <PlaceRow key={'p' + i} i={place++} focus={p.focus} onFocus={p.onFocus}>{t('m2s.place', { i: i + 1 })}</PlaceRow>);
  const n = holeRows.length + posRows.length;
  return (
    <div class="m2s-outcome" data-testid="m2s-refusal" data-code={r.code}>
      <div class="m2s-card bad" role="alert">
        <p class="m2s-card-head"><Icon name="close" size={16} />{t('m2s.refused')}: {refusalTitle(r.code)}</p>
        <p class="m2s-card-text" data-testid="m2s-advice">{refusalAdvice(r.code, p.ran.close)}</p>
        {n ? <p class="m2s-card-text">{t('m2s.places', { count: n })}</p> : null}
        {CLOSE_FIXES.has(r.code) && !p.ran.close && p.retryClosed
          ? <button type="button" class="fedit-card-btn prop-create m2s-retry" data-testid="m2s-retry-closed" onClick={p.retryClosed}>{t('m2s.retryClosed')}</button> : null}
      </div>
      <details class="m2s-details" data-testid="m2s-details" open>
        <summary>{t('m2s.details')}</summary>
        {n ? <ul class="m2s-places">{holeRows}{posRows}</ul> : null}
        <details class="m2s-technical" data-testid="m2s-technical">
          <summary>{t('m2s.technical')}</summary>
          {r.message ? <p class="m2s-note" data-testid="m2s-message">{t('m2s.kernelMessage', { message: r.message })}</p> : null}
          {r.hint ? <p class="m2s-note" data-testid="m2s-hint">{t('m2s.hint', { hint: r.hint })}</p> : null}
          {r.reason ? <p class="m2s-note">{t('m2s.reason', { reason: r.reason })}</p> : null}
          <p class="m2s-note">{r.code} · {fmtMs(r.ms)}</p>
        </details>
      </details>
    </div>
  );
}
