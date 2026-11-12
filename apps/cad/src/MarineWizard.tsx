// The marine family of the Propeller wizard: the same three steps (Size, Blade, Review) over the helicoid generator in marineData.ts. Every change goes to onDraft with
// the whole parameter record (the app previews it live, debounced by the controller); Create / Apply commits it, Escape / the cross cancels. The family control switches
// back to the airfoil wizard. Reopening a built marine propeller (the record is kept on its hub sketch) works like the airfoil one. See docs/propellers.md.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '@kit/ui';
import { t } from './i18n';
import { MARINE_PRESETS, freeShaftZ, marineReadout, sameMarine, validateMarine, type MarineIssue, type MarineParams } from './marineData';
import { Seg } from './ThreadEditor';

export type MarineStep = 'size' | 'blade' | 'review';
export const MARINE_STEPS: MarineStep[] = ['size', 'blade', 'review'];

export interface MarineWizardProps {
  params: MarineParams;
  edit?: boolean;
  name?: string;
  step?: MarineStep;
  onDraft(next: MarineParams): void;
  onCreate(next: MarineParams): void;
  onCancel(): void;
  /** Back to the airfoil family (a new propeller only). */
  onFamily?(family: 'airfoil'): void;
  /** The settings of the other marine propellers already in the part: a new propeller starts behind them, and one with the same settings at the same place is warned about. */
  others?: MarineParams[];
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

/** The text of one validation issue: a catalogue entry by code, the generator's own message when there is none (the hub length carries a number). */
export function marineIssueText(i: MarineIssue): string {
  return i.code === 'hubShort' ? i.message : t('marine.issue.' + i.code, undefined, i.message);
}

export function MarineWizard(p: MarineWizardProps): JSX.Element {
  // a new propeller starts at a free position along the shaft, not on top of one that is already there
  const [draft, setDraft] = useState<MarineParams>(() => (p.edit || !p.others?.length ? p.params : { ...p.params, shaftZ: freeShaftZ(p.others, p.params) }));
  const [armed, setArmed] = useState(false);
  const [step, setStep] = useState<MarineStep>(p.step ?? 'size');
  const [preset, setPreset] = useState('none');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!p.edit) p.onDraft(draft); }, []);
  const change = (patch: Partial<MarineParams>): void => {
    const next = { ...draft, ...patch };
    setDraft(next); setArmed(false);
    p.onDraft(next);
  };
  const issues = validateMarine(draft);
  const blocked = issues.some((i) => i.level === 'error');
  const dup = !p.edit && !!p.others && sameMarine(p.others, draft);
  // a propeller exactly on top of an identical one is allowed, but only on the second click
  const create = (): void => { if (blocked) return; if (dup && !armed) { setArmed(true); return; } p.onCreate(draft); };
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && step === 'review' && tag !== 'SELECT' && tag !== 'BUTTON') { e.preventDefault(); create(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };
  const at = MARINE_STEPS.indexOf(step);
  const ro = marineReadout(draft);
  const title = (p.edit ? t('marine.title') : t('marine.titleNew')) + (p.edit && p.name ? ` — ${p.name}` : '');
  const applyPreset = (id: string): void => {
    setPreset(id);
    if (id !== 'none') change({ ...MARINE_PRESETS[id] });
  };
  const field = (name: keyof MarineParams, label: string, o: { unit?: string; min?: number; max?: number; step?: number; tip?: string; int?: boolean } = {}): JSX.Element => (
    <Num name={name} label={label} unit={o.unit} min={o.min} max={o.max} step={o.step} hintText={o.tip} value={draft[name] as number}
      onChange={(v) => change({ [name]: o.int ? Math.round(v) : v } as Partial<MarineParams>)} />
  );

  return (
    <div class="fedit thread-editor prop-wizard marine-wizard" ref={root} tabIndex={0} onKeyDown={onKey} data-testid="marine-wizard" data-step={step}>
      <div class="fedit-head">
        <Icon name="add-propeller" size={22} class="fedit-icon" />
        <div class="fedit-title">{title}</div>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>
      <div class="prop-steps" role="tablist" aria-label={t('prop.steps')}>
        {MARINE_STEPS.map((s, i) => (
          <button key={s} type="button" role="tab" aria-selected={s === step} data-step-tab={s} class={'prop-step' + (s === step ? ' on' : '') + (i < at ? ' done' : '')} onClick={() => setStep(s)}>
            <span class="prop-step-n">{i + 1}</span><span>{t('prop.step.' + s)}</span>
          </button>
        ))}
      </div>

      {step === 'size' ? (
        <div class="fedit-sec-fields prop-body" data-section="size">
          {p.edit ? null : (
            <Seg name="family" label={t('prop.family')} value={'marine' as 'airfoil' | 'marine'}
              options={[{ value: 'airfoil', text: t('prop.family.airfoil'), tip: t('prop.family.airfoilTip') }, { value: 'marine', text: t('prop.family.marine'), tip: t('prop.family.marineTip') }]}
              onChange={(v) => { if (v === 'airfoil') p.onFamily?.('airfoil'); }} />
          )}
          <label class="fedit-fld" data-path="preset">
            <span class="fedit-fld-label">{t('prop.preset')}</span>
            <select value={preset} aria-label={t('prop.preset')} onChange={(e) => applyPreset((e.currentTarget as HTMLSelectElement).value)}>
              <option value="none">{t('prop.preset.none')}</option>
              {Object.keys(MARINE_PRESETS).map((k) => <option key={k} value={k}>{t('marine.preset.' + k)}</option>)}
            </select>
          </label>
          {field('diameter', t('prop.diameter'), { unit: 'mm', min: 10, step: 1 })}
          {field('hubDia', t('prop.hubDia'), { unit: 'mm', min: 1, step: 0.5 })}
          {field('hubLength', t('prop.hubLength'), { unit: 'mm', min: 1, step: 0.5, tip: t('marine.hubLengthTip') })}
          {field('boreDia', t('prop.boreDia'), { unit: 'mm', min: 0, step: 0.5 })}
          {field('blades', t('prop.blades'), { min: 2, max: 6, step: 1, int: true })}
          <label class="fedit-fld" data-path="shaftZ">
            <span class="fedit-fld-label">{t('marine.shaftZ')}</span>
            <span class="fedit-num">
              <input type="number" inputMode="decimal" enterKeyHint="done" step={1} value={String(draft.shaftZ ?? 0)} aria-label={t('marine.shaftZ')} title={t('marine.shaftZTip')}
                onChange={(e) => { const raw = (e.currentTarget as HTMLInputElement).value; const v = Number(raw); if (raw.trim() !== '' && Number.isFinite(v)) change({ shaftZ: v }); }} />
              <span class="fedit-unit">mm</span>
            </span>
          </label>
          {dup ? <div class="thread-fit warn" role="status" data-testid="marine-dup">{t('marine.duplicate')}</div> : null}
          <Seg name="direction" label={t('prop.direction')} value={draft.direction} options={[{ value: 'rh', text: t('marine.direction.rh'), tip: t('marine.direction.rhTip') }, { value: 'lh', text: t('marine.direction.lh'), tip: t('marine.direction.lhTip') }]} onChange={(v) => change({ direction: v })} />
        </div>
      ) : null}

      {step === 'blade' ? (
        <div class="fedit-sec-fields prop-body" data-section="blade">
          {field('pitchRatio', t('marine.pitchRatio'), { min: 0.4, max: 2, step: 0.05, tip: t('marine.pitchRatioTip') })}
          {field('pitchProgress', t('marine.pitchProgress'), { min: -0.15, max: 0.5, step: 0.05, tip: t('marine.pitchProgressTip') })}
          {field('rake', t('marine.rake'), { unit: 'deg', min: -20, max: 30, step: 1, tip: t('marine.rakeTip') })}
          {field('ear', t('marine.ear'), { min: 0.25, max: 1.2, step: 0.05, tip: t('marine.earTip') })}
          {field('peak', t('marine.peak'), { min: 0.05, max: 0.95, step: 0.05, tip: t('marine.peakTip') })}
          {field('rootRatio', t('marine.rootRatio'), { min: 0.05, max: 1, step: 0.05, tip: t('marine.rootRatioTip') })}
          {field('tipRatio', t('marine.tipRatio'), { min: 0.05, max: 1, step: 0.05 })}
          {field('skew', t('marine.skew'), { unit: 'deg', min: -45, max: 45, step: 1, tip: t('marine.skewTip') })}
          {field('thickRoot', t('marine.thickRoot'), { min: 0.005, max: 0.08, step: 0.005, tip: t('marine.thickTip') })}
          {field('thickTip', t('marine.thickTipField'), { min: 0.001, max: 0.04, step: 0.001 })}
          {field('maxThickAt', t('marine.maxThickAt'), { min: 0.2, max: 0.7, step: 0.05, tip: t('marine.maxThickAtTip') })}
          {field('edgeThick', t('marine.edgeThick'), { min: 0.02, max: 0.5, step: 0.02, tip: t('marine.edgeThickTip') })}
          {field('tipRounding', t('marine.tipRounding'), { min: 0, max: 0.4, step: 0.05, tip: t('marine.tipRoundingTip') })}
          {field('rootEmbed', t('prop.rootEmbed'), { min: 0.35, max: 0.95, step: 0.05, tip: t('prop.rootEmbedTip') })}
          {field('raySpacing', t('marine.raySpacing'), { unit: 'deg', min: 3, max: 10, step: 0.5, tip: t('marine.raySpacingTip') })}
        </div>
      ) : null}

      {step === 'review' ? (
        <div class="fedit-sec-fields prop-body" data-section="review">
          <dl class="thread-readout" data-testid="marine-readout">
            <dt>{t('prop.diameter')}</dt><dd data-k="diameter">{fmt(draft.diameter)} mm</dd>
            <dt>{t('prop.r.blades')}</dt><dd data-k="blades">{draft.blades}</dd>
            <dt>{t('prop.r.pitch')}</dt><dd data-k="pitch">{fmt(ro.pitch, 1)} mm/rev</dd>
            {draft.pitchProgress !== 0 ? <><dt>{t('marine.r.pitchRoot')}</dt><dd data-k="pitchRoot">{fmt(ro.pitchRoot, 1)} mm/rev</dd></> : null}
            {draft.rake !== 0 ? <><dt>{t('marine.rake')}</dt><dd data-k="rake">{fmt(ro.rake, 1)}&deg;</dd></> : null}
            <dt>{t('prop.r.pitchRatio')}</dt><dd data-k="pitchRatio">{fmt(ro.pitchRatio, 2)}</dd>
            <dt>{t('prop.r.angleRoot')}</dt><dd data-k="angleRoot">{fmt(ro.angleRoot, 1)}&deg;</dd>
            <dt>{t('prop.r.angle70')}</dt><dd data-k="angle70">{fmt(ro.angle70, 1)}&deg;</dd>
            <dt>{t('prop.r.angleTip')}</dt><dd data-k="angleTip">{fmt(ro.angleTip, 1)}&deg;</dd>
            <dt>{t('marine.r.ear')}</dt><dd data-k="ear">{fmt(ro.ear, 2)}</dd>
            <dt>{t('marine.r.chordMax')}</dt><dd data-k="chordMax">{fmt(ro.chordMax, 1)} mm</dd>
          </dl>
          <div class="prop-issues" data-testid="marine-issues">
            {issues.length === 0 ? <div class="thread-fit ok" role="status">{t('prop.issues.none')}</div> : null}
            {issues.map((i, k) => <div key={i.code + k} class={'thread-fit ' + (i.level === 'error' ? 'bad' : 'warn')} role={i.level === 'error' ? 'alert' : 'status'} data-issue={i.code} data-severity={i.level}>{marineIssueText(i)}</div>)}
          </div>
          {dup ? <div class="thread-fit warn" role="status" data-testid="marine-dup">{t('marine.duplicate')}</div> : null}
          {p.hint ? <div class="fedit-hint" role="alert" data-testid="marine-hint">{p.hint}</div> : null}
          <div class="thread-hint" data-testid="marine-notes">{t('marine.help.build')}</div>
          <div class="thread-hint">{t('marine.help.limits')}</div>
          <div class="thread-hint">{t('prop.help.geometry')}</div>
          {p.edit ? <div class="thread-hint">{t('prop.help.edit')}</div> : null}
        </div>
      ) : null}

      <div class="prop-nav">
        <button type="button" class="fedit-card-btn" data-testid="marine-back" disabled={at === 0} onClick={() => setStep(MARINE_STEPS[at - 1])}>{t('prop.back')}</button>
        {step !== 'review'
          ? <button type="button" class="fedit-card-btn" data-testid="marine-next" onClick={() => setStep(MARINE_STEPS[at + 1])}>{t('prop.next')}</button>
          : <button type="button" class="fedit-card-btn prop-create" data-testid="marine-create" disabled={blocked} aria-disabled={blocked} title={blocked ? t('prop.blockedTip') : p.edit ? t('prop.applyTip') : t('prop.createTip')} onClick={create}>{p.edit ? t('prop.apply') : armed ? t('marine.insertAnyway') : t('prop.create')}</button>}
      </div>
    </div>
  );
}
