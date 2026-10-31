// The Propeller wizard: a guided panel in three steps (Size, Blade, Review) over the airfoil-loft generator in propData.ts. Every change goes to onDraft with
// the whole parameter record (the app previews it live in the viewport, debounced by the controller); Create / Apply commits it, Escape / the cross cancels.
// The same panel reopens on a built propeller (the record is kept on its hub sketch) for the "edit propeller" round trip. See docs/propellers.md.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '@kit/ui';
import { t } from './i18n';
import {
  AIRFOIL_KINDS, PROP_PRESETS, TWIST_MODES, airfoilShape, propReadout, threePoint, validateProp,
  type PropIssue, type PropParams,
} from './propData';
import { Seg } from './ThreadEditor';

export type WizardStep = 'size' | 'blade' | 'review';
export const WIZARD_STEPS: WizardStep[] = ['size', 'blade', 'review'];

export interface PropellerWizardProps {
  params: PropParams;
  /** Editing a built propeller (button says Apply, the title carries its name) instead of making a new one. */
  edit?: boolean;
  name?: string;
  step?: WizardStep;
  onDraft(next: PropParams): void;
  onCreate(next: PropParams): void;
  onCancel(): void;
  /** Switch to the marine family (a new propeller only). */
  onFamily?(family: 'marine'): void;
  /** The live preview's failure, or null when it is current. */
  hint?: string | null;
}

const fmt = (v: number, d = 3): string => String(Math.round(v * 10 ** d) / 10 ** d);

function Num(p: { name: string; label: string; value: number; unit?: string; min?: number; max?: number; step?: number; onChange(v: number): void; hintText?: string }): JSX.Element {
  return (
    <label class="fedit-fld" data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <span class="fedit-num">
        <input type="number" inputMode="decimal" enterKeyHint="done" step={p.step ?? 'any'} min={p.min} max={p.max} value={String(p.value)} aria-label={p.label} title={p.hintText}
          onChange={(e) => { const raw = (e.currentTarget as HTMLInputElement).value; const v = Number(raw); if (raw.trim() !== '' && Number.isFinite(v)) p.onChange(v); }} />
        {p.unit ? <span class="fedit-unit">{p.unit}</span> : null}
      </span>
    </label>
  );
}

/** A small graph of a three-point curve (root, mid, tip) against the span from hub to tip: three handles that drag (or step with the arrow keys). */
export function CurveGraph(p: {
  name: string; title: string; values: [number, number, number]; exp: number; min: number; max: number; step: number; unit?: string;
  onChange(values: [number, number, number]): void;
}): JSX.Element {
  const W = 220, H = 96, padL = 10, padR = 10, padT = 8, padB = 14;
  const iw = W - padL - padR, ih = H - padT - padB;
  const span = p.max - p.min;
  const x = (s: number): number => padL + s * iw;
  const y = (v: number): number => padT + ih - ((v - p.min) / span) * ih;
  const clamp = (v: number): number => Math.min(p.max, Math.max(p.min, Math.round(v / p.step) * p.step));
  const path: string[] = [];
  for (let i = 0; i <= 40; i++) { const s = i / 40; path.push(`${i ? 'L' : 'M'}${x(s).toFixed(1)} ${y(Math.min(p.max, Math.max(p.min, threePoint(...p.values, s, p.exp)))).toFixed(1)}`); }
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const set = (i: number, v: number): void => { const n = [...p.values] as [number, number, number]; n[i] = Number(clamp(v).toFixed(6)); p.onChange(n); };
  const fromPointer = (e: PointerEvent): number => {
    const r = svg.current!.getBoundingClientRect();
    const py = ((e.clientY - r.top) / r.height) * H;
    return p.min + ((padT + ih - py) / ih) * span;
  };
  const labels = ['root', 'mid', 'tip'] as const;
  const xs = [0, Math.pow(0.5, 1 / Math.max(0.2, p.exp)), 1];
  return (
    <div class="prop-curve" data-curve={p.name}>
      <div class="prop-curve-title">{p.title}</div>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={p.title} onPointerMove={(e) => { if (drag.current !== null) set(drag.current, fromPointer(e as unknown as PointerEvent)); }}
        onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
        <rect x={padL} y={padT} width={iw} height={ih} class="prop-curve-box" />
        <path d={path.join('')} class="prop-curve-line" fill="none" />
        {labels.map((k, i) => {
          const label = t('prop.curve.' + k);
          return (
            <g key={k}>
              <circle cx={x(xs[i])} cy={y(p.values[i])} r={5.5} class="prop-curve-handle" data-handle={k} role="slider" tabIndex={0} aria-label={label}
                aria-valuemin={p.min} aria-valuemax={p.max} aria-valuenow={p.values[i]} aria-valuetext={t('prop.curve.handle', { name: label, value: fmt(p.values[i], 3) + (p.unit ? ' ' + p.unit : '') })}
                onPointerDown={(e) => { drag.current = i; (e.currentTarget as Element).setPointerCapture?.((e as unknown as PointerEvent).pointerId); }}
                onKeyDown={(e) => {
                  const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
                  if (!d) return;
                  e.preventDefault(); e.stopPropagation();
                  set(i, p.values[i] + d * p.step * (e.shiftKey ? 10 : 1));
                }} />
              <text x={x(xs[i])} y={H - 3} text-anchor="middle" class="prop-curve-label">{label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** The airfoil at the mid section, in unit chord, as a small outline. */
function AirfoilPreview({ p }: { p: PropParams }): JSX.Element {
  const a = airfoilShape(p, p.thickMid, 40);
  const W = 220, H = 70, s = 190;
  const pt = (x: number, y: number): string => `${(15 + (1 - x) * s).toFixed(1)} ${(H / 2 - y * s).toFixed(1)}`;
  const d = a.upper.x.map((x, i) => `${i ? 'L' : 'M'}${pt(x, a.upper.y[i])}`).join('') + a.lower.x.map((x, i) => `L${pt(a.lower.x[a.lower.x.length - 1 - i], a.lower.y[a.lower.x.length - 1 - i])}`).join('') + 'Z';
  return <svg viewBox={`0 0 ${W} ${H}`} class="prop-airfoil" role="img" aria-label={t('prop.airfoil')} data-testid="prop-airfoil"><path d={d} class="prop-airfoil-shape" /></svg>;
}

/** The text of one validation issue. */
export function issueText(i: PropIssue): string {
  const params: Record<string, string> = { field: t('prop.' + i.field, undefined, String(i.field)) };
  for (const [k, v] of Object.entries(i.params ?? {})) params[k] = String(v);
  return t('prop.issue.' + i.code, params, i.message);
}

export function PropellerWizard(p: PropellerWizardProps): JSX.Element {
  const [draft, setDraft] = useState<PropParams>(p.params);
  const [step, setStep] = useState<WizardStep>(p.step ?? 'size');
  const [preset, setPreset] = useState('none');
  const root = useRef<HTMLDivElement>(null);
  // a new propeller shows its default in the viewport at once
  useEffect(() => { if (!p.edit) p.onDraft(draft); }, []);
  const change = (patch: Partial<PropParams>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    p.onDraft(next);
  };
  const issues = validateProp(draft);
  const errors = issues.filter((i) => i.severity === 'error');
  const blocked = errors.length > 0;
  const create = (): void => { if (!blocked) p.onCreate(draft); };
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && step === 'review' && tag !== 'SELECT' && tag !== 'BUTTON') { e.preventDefault(); create(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };
  const at = WIZARD_STEPS.indexOf(step);
  const ro = propReadout(draft);
  const title = (p.edit ? t('prop.title') : t('prop.titleNew')) + (p.edit && p.name ? ` — ${p.name}` : '');
  const applyPreset = (id: string): void => {
    setPreset(id);
    if (id !== 'none') change({ ...PROP_PRESETS[id], varPrefix: draft.varPrefix });
  };
  const twist = draft.twist;
  const field = (name: keyof PropParams, label: string, o: { unit?: string; min?: number; max?: number; step?: number; tip?: string; int?: boolean } = {}): JSX.Element => (
    <Num name={name} label={label} unit={o.unit} min={o.min} max={o.max} step={o.step} hintText={o.tip} value={draft[name] as number}
      onChange={(v) => change({ [name]: o.int ? Math.round(v) : v } as Partial<PropParams>)} />
  );

  return (
    <div class="fedit thread-editor prop-wizard" ref={root} tabIndex={0} onKeyDown={onKey} data-testid="prop-wizard" data-step={step}>
      <div class="fedit-head">
        <Icon name="add-propeller" size={22} class="fedit-icon" />
        <div class="fedit-title">{title}</div>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>
      <div class="prop-steps" role="tablist" aria-label={t('prop.steps')}>
        {WIZARD_STEPS.map((s, i) => (
          <button key={s} type="button" role="tab" aria-selected={s === step} data-step-tab={s} class={'prop-step' + (s === step ? ' on' : '') + (i < at ? ' done' : '')} onClick={() => setStep(s)}>
            <span class="prop-step-n">{i + 1}</span><span>{t('prop.step.' + s)}</span>
          </button>
        ))}
      </div>

      {step === 'size' ? (
        <div class="fedit-sec-fields prop-body" data-section="size">
          {p.edit ? null : (
            <Seg name="family" label={t('prop.family')} value={'airfoil' as 'airfoil' | 'marine'}
              options={[{ value: 'airfoil', text: t('prop.family.airfoil'), tip: t('prop.family.airfoilTip') }, { value: 'marine', text: t('prop.family.marine'), tip: t('prop.family.marineTip') }]}
              onChange={(v) => { if (v === 'marine') p.onFamily?.('marine'); }} />
          )}
          <label class="fedit-fld" data-path="preset">
            <span class="fedit-fld-label">{t('prop.preset')}</span>
            <select value={preset} aria-label={t('prop.preset')} onChange={(e) => applyPreset((e.currentTarget as HTMLSelectElement).value)}>
              <option value="none">{t('prop.preset.none')}</option>
              {Object.keys(PROP_PRESETS).map((k) => <option key={k} value={k}>{t('prop.preset.' + k)}</option>)}
            </select>
          </label>
          {field('diameter', t('prop.diameter'), { unit: 'mm', min: 10, step: 1 })}
          {field('hubDia', t('prop.hubDia'), { unit: 'mm', min: 1, step: 0.5 })}
          {field('hubLength', t('prop.hubLength'), { unit: 'mm', min: 1, step: 0.5 })}
          {field('boreDia', t('prop.boreDia'), { unit: 'mm', min: 0, step: 0.5 })}
          {field('blades', t('prop.blades'), { min: 2, max: 8, step: 1, int: true })}
          <Seg name="direction" label={t('prop.direction')} value={draft.direction} options={[{ value: 'ccw', text: t('prop.direction.ccw') }, { value: 'cw', text: t('prop.direction.cw') }]} onChange={(v) => change({ direction: v })} />
          <div class="thread-hint">{t('prop.directionTip')}</div>
        </div>
      ) : null}

      {step === 'blade' ? (
        <div class="fedit-sec-fields prop-body" data-section="blade">
          <Seg name="twist" label={t('prop.twist')} value={twist} options={TWIST_MODES.map((m) => ({ value: m, text: t('prop.twist.' + m), tip: t('prop.twist.' + m + 'Tip') }))} onChange={(v) => change({ twist: v })} />
          {twist === 'pitch' ? field('pitch', t('prop.pitch'), { unit: 'mm/rev', min: 1, step: 1 }) : null}
          {twist === 'angle' ? field('pitchAngle', t('prop.pitchAngle'), { unit: 'deg', min: 1, max: 80, step: 0.5 }) : null}
          {twist === 'angle' ? field('refRadius', t('prop.refRadius'), { min: 0.25, max: 1, step: 0.05, tip: t('prop.refRadiusTip') }) : null}
          {twist === 'linear' ? field('rootAngle', t('prop.rootAngle'), { unit: 'deg', min: 1, max: 80, step: 0.5 }) : null}
          {twist === 'linear' ? field('tipAngle', t('prop.tipAngle'), { unit: 'deg', min: 1, max: 80, step: 0.5 }) : null}
          <CurveGraph name="chord" title={t('prop.chord')} unit="mm" min={1} max={Math.max(60, Math.ceil(Math.max(draft.chordRoot, draft.chordMid, draft.chordTip) * 1.25))} step={0.5} exp={draft.chordExp}
            values={[draft.chordRoot, draft.chordMid, draft.chordTip]} onChange={([a, b, c]) => change({ chordRoot: a, chordMid: b, chordTip: c })} />
          {field('chordRoot', t('prop.chordRoot'), { unit: 'mm', min: 1, step: 0.5 })}
          {field('chordMid', t('prop.chordMid'), { unit: 'mm', min: 1, step: 0.5 })}
          {field('chordTip', t('prop.chordTip'), { unit: 'mm', min: 1, step: 0.5 })}
          {field('chordExp', t('prop.curve.exp'), { min: 0.2, max: 5, step: 0.1, tip: t('prop.curve.expTip') })}
          <CurveGraph name="thick" title={t('prop.thick')} min={0.02} max={0.3} step={0.005} exp={draft.thickExp} values={[draft.thickRoot, draft.thickMid, draft.thickTip]}
            onChange={([a, b, c]) => change({ thickRoot: a, thickMid: b, thickTip: c })} />
          {field('thickRoot', t('prop.thickRoot'), { min: 0.02, max: 0.4, step: 0.005 })}
          {field('thickMid', t('prop.thickMid'), { min: 0.02, max: 0.4, step: 0.005 })}
          {field('thickTip', t('prop.thickTip'), { min: 0.02, max: 0.4, step: 0.005 })}
          {field('thickExp', t('prop.curve.exp'), { min: 0.2, max: 5, step: 0.1, tip: t('prop.curve.expTip') })}
          <Seg name="airfoil" label={t('prop.airfoil')} value={draft.airfoil} options={AIRFOIL_KINDS.map((k) => ({ value: k, text: t('prop.airfoil.' + k), tip: t('prop.airfoil.' + k + 'Tip') }))} onChange={(v) => change({ airfoil: v })} />
          <AirfoilPreview p={draft} />
          {draft.airfoil !== 'plate' ? field('camber', t('prop.camber'), { min: 0, max: 0.12, step: 0.005, tip: t('prop.camberTip') }) : null}
          {draft.airfoil === 'naca4' ? field('camberPos', t('prop.camberPos'), { min: 0.1, max: 0.9, step: 0.05 }) : null}
          {field('pivot', t('prop.pivot'), { min: 0, max: 1, step: 0.05, tip: t('prop.pivotTip') })}
          {field('rake', t('prop.rake'), { unit: 'deg', min: -45, max: 45, step: 0.5, tip: t('prop.rakeTip') })}
          {field('skew', t('prop.skew'), { unit: 'mm', step: 0.5, tip: t('prop.skewTip') })}
          {field('rootEmbed', t('prop.rootEmbed'), { min: 0.3, max: 0.9, step: 0.05, tip: t('prop.rootEmbedTip') })}
          {field('sections', t('prop.sections'), { min: 5, max: 12, step: 1, int: true, tip: t('prop.sectionsTip') })}
          <div class="thread-hint">{t('prop.curve.drag')}</div>
        </div>
      ) : null}

      {step === 'review' ? (
        <div class="fedit-sec-fields prop-body" data-section="review">
          <dl class="thread-readout" data-testid="prop-readout">
            <dt>{t('prop.diameter')}</dt><dd data-k="diameter">{fmt(draft.diameter)} mm</dd>
            <dt>{t('prop.r.blades')}</dt><dd data-k="blades">{draft.blades}</dd>
            <dt>{t('prop.r.pitch')}</dt><dd data-k="pitch">{fmt(ro.pitch, 1)} mm/rev</dd>
            <dt>{t('prop.r.pitchRatio')}</dt><dd data-k="pitchRatio">{fmt(ro.pitchRatio, 2)}</dd>
            <dt>{t('prop.r.angleRoot')}</dt><dd data-k="angleRoot">{fmt(ro.angleRoot, 1)}&deg;</dd>
            <dt>{t('prop.r.angle70')}</dt><dd data-k="angle70">{fmt(ro.angle70, 1)}&deg;</dd>
            <dt>{t('prop.r.angleTip')}</dt><dd data-k="angleTip">{fmt(ro.angleTip, 1)}&deg;</dd>
            <dt>{t('prop.r.area')}</dt><dd data-k="area">{fmt(ro.areaRatio, 2)}</dd>
          </dl>
          <div class="prop-issues" data-testid="prop-issues">
            {issues.length === 0 ? <div class="thread-fit ok" role="status">{t('prop.issues.none')}</div> : null}
            {issues.map((i, k) => <div key={i.code + k} class={'thread-fit ' + (i.severity === 'error' ? 'bad' : 'warn')} role={i.severity === 'error' ? 'alert' : 'status'} data-issue={i.code} data-severity={i.severity}>{issueText(i)}</div>)}
          </div>
          {p.hint ? <div class="fedit-hint" role="alert" data-testid="prop-hint">{p.hint}</div> : null}
          <div class="thread-hint" data-testid="prop-nofillet">{t('prop.help.noFillet')}</div>
          <div class="thread-hint">{t('prop.help.variables')}</div>
          <div class="thread-hint">{t('prop.help.geometry')}</div>
          {p.edit ? <div class="thread-hint">{t('prop.help.edit')}</div> : null}
        </div>
      ) : null}

      <div class="prop-nav">
        <button type="button" class="fedit-card-btn" data-testid="prop-back" disabled={at === 0} onClick={() => setStep(WIZARD_STEPS[at - 1])}>{t('prop.back')}</button>
        {step !== 'review'
          ? <button type="button" class="fedit-card-btn" data-testid="prop-next" onClick={() => setStep(WIZARD_STEPS[at + 1])}>{t('prop.next')}</button>
          : <button type="button" class="fedit-card-btn prop-create" data-testid="prop-create" disabled={blocked} aria-disabled={blocked} title={blocked ? t('prop.blockedTip') : p.edit ? t('prop.applyTip') : t('prop.createTip')} onClick={create}>{p.edit ? t('prop.apply') : t('prop.create')}</button>}
      </div>
    </div>
  );
}

