// The turbo-impeller wizard: three steps (Hub, Blade, Review) over the generator in impellerData.ts. A standalone wizard (not a Propeller family): every change goes to onDraft with
// the whole parameter record (the app previews it live, debounced by the controller); Create / Apply commits it, Escape / the cross cancels. Reopening a built impeller (the record is kept on its hub sketch) works like the marine family's. See docs/impellers.md.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '@kit/ui';
import { t } from './i18n';
import { IMPELLER_PRESETS, impellerReadout, validateImpeller, type ImpellerIssue, type ImpellerParams } from './impellerData';

export type ImpellerStep = 'hub' | 'blade' | 'review';
export const IMPELLER_STEPS: ImpellerStep[] = ['hub', 'blade', 'review'];

export interface ImpellerWizardProps {
  params: ImpellerParams;
  edit?: boolean;
  name?: string;
  step?: ImpellerStep;
  onDraft(next: ImpellerParams): void;
  onCreate(next: ImpellerParams): void;
  onCancel(): void;
  /** The live preview's failure, or null when it is current. */
  hint?: string | null;
}

const fmt = (v: number, d = 3): string => String(Math.round(v * 10 ** d) / 10 ** d);

function Num(p: { name: string; label: string; value: number; unit?: string; min?: number; max?: number; step?: number; onChange(v: number): void; hintText?: string }): JSX.Element {
  return (
    <label class="fedit-fld" data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <span class="fedit-num">
        <input type="number" step={p.step ?? 'any'} min={p.min} max={p.max} value={String(p.value)} aria-label={p.label} title={p.hintText}
          onChange={(e) => { const raw = (e.currentTarget as HTMLInputElement).value; const v = Number(raw); if (raw.trim() !== '' && Number.isFinite(v)) p.onChange(v); }} />
        {p.unit ? <span class="fedit-unit">{p.unit}</span> : null}
      </span>
    </label>
  );
}

/** The text of one validation issue: a catalogue entry by code, the generator's own message when there is none. */
export function impellerIssueText(i: ImpellerIssue): string {
  return t('impeller.issue.' + i.code, undefined, i.message);
}

export function ImpellerWizard(p: ImpellerWizardProps): JSX.Element {
  const [draft, setDraft] = useState<ImpellerParams>(p.params);
  const [step, setStep] = useState<ImpellerStep>(p.step ?? 'hub');
  const [preset, setPreset] = useState('none');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!p.edit) p.onDraft(draft); }, []);
  const change = (patch: Partial<ImpellerParams>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    p.onDraft(next);
  };
  const issues = validateImpeller(draft);
  const blocked = issues.some((i) => i.level === 'error');
  const create = (): void => { if (!blocked) p.onCreate(draft); };
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && step === 'review' && tag !== 'SELECT' && tag !== 'BUTTON') { e.preventDefault(); create(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };
  const at = IMPELLER_STEPS.indexOf(step);
  const ro = impellerReadout(draft);
  const title = (p.edit ? t('impeller.title') : t('impeller.titleNew')) + (p.edit && p.name ? ` — ${p.name}` : '');
  const applyPreset = (id: string): void => {
    setPreset(id);
    if (id !== 'none') change({ ...IMPELLER_PRESETS[id] });
  };
  const field = (name: keyof ImpellerParams, label: string, o: { unit?: string; min?: number; max?: number; step?: number; tip?: string; int?: boolean } = {}): JSX.Element => (
    <Num name={name} label={label} unit={o.unit} min={o.min} max={o.max} step={o.step} hintText={o.tip} value={draft[name] as number}
      onChange={(v) => change({ [name]: o.int ? Math.round(v) : v } as Partial<ImpellerParams>)} />
  );

  return (
    <div class="fedit thread-editor prop-wizard impeller-wizard" ref={root} tabIndex={0} onKeyDown={onKey} data-testid="impeller-wizard" data-step={step}>
      <div class="fedit-head">
        <Icon name="add-propeller" size={22} class="fedit-icon" />
        <div class="fedit-title">{title}</div>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>
      <div class="prop-steps" role="tablist" aria-label={t('prop.steps')}>
        {IMPELLER_STEPS.map((s, i) => (
          <button key={s} type="button" role="tab" aria-selected={s === step} data-step-tab={s} class={'prop-step' + (s === step ? ' on' : '') + (i < at ? ' done' : '')} onClick={() => setStep(s)}>
            <span class="prop-step-n">{i + 1}</span><span>{t('impeller.step.' + s)}</span>
          </button>
        ))}
      </div>

      {step === 'hub' ? (
        <div class="fedit-sec-fields prop-body" data-section="hub">
          <label class="fedit-fld" data-path="preset">
            <span class="fedit-fld-label">{t('prop.preset')}</span>
            <select value={preset} aria-label={t('prop.preset')} onChange={(e) => applyPreset((e.currentTarget as HTMLSelectElement).value)}>
              <option value="none">{t('prop.preset.none')}</option>
              {Object.keys(IMPELLER_PRESETS).map((k) => <option key={k} value={k}>{t('impeller.preset.' + k)}</option>)}
            </select>
          </label>
          {field('exducerDiameter', t('impeller.exducerDiameter'), { unit: 'mm', min: 5, step: 1, tip: t('impeller.exducerDiameterTip') })}
          {field('inducerDiameter', t('impeller.inducerDiameter'), { unit: 'mm', min: 2, step: 0.5, tip: t('impeller.inducerDiameterTip') })}
          {field('hubLength', t('impeller.hubLength'), { unit: 'mm', min: 1, step: 0.5, tip: t('impeller.hubLengthTip') })}
          {field('boreDiameter', t('impeller.boreDiameter'), { unit: 'mm', min: 0, step: 0.5, tip: t('impeller.boreDiameterTip') })}
          {field('mainBlades', t('impeller.mainBlades'), { min: 3, max: 12, step: 1, int: true, tip: t('impeller.mainBladesTip') })}
          {field('splitterBlades', t('impeller.splitterBlades'), { min: 0, max: 12, step: 1, int: true, tip: t('impeller.splitterBladesTip') })}
        </div>
      ) : null}

      {step === 'blade' ? (
        <div class="fedit-sec-fields prop-body" data-section="blade">
          {field('wrapDeg', t('impeller.wrapDeg'), { unit: 'deg', min: 20, max: 160, step: 1, tip: t('impeller.wrapDegTip') })}
          {field('bladeThickness', t('impeller.bladeThickness'), { unit: 'mm', min: 0.3, step: 0.1, tip: t('impeller.bladeThicknessTip') })}
          {field('tipThickness', t('impeller.tipThickness'), { unit: 'mm', min: 0.2, step: 0.1, tip: t('impeller.tipThicknessTip') })}
          {field('splitterStart', t('impeller.splitterStart'), { min: 0.15, max: 0.85, step: 0.05, tip: t('impeller.splitterStartTip') })}
          {field('spanZ', t('impeller.spanZ'), { unit: 'mm', min: 0.1, step: 0.1, tip: t('impeller.spanZTip') })}
          {field('spanR', t('impeller.spanR'), { unit: 'mm', min: 0.1, step: 0.1, tip: t('impeller.spanRTip') })}
          {field('rootEmbed', t('impeller.rootEmbed'), { unit: 'mm', min: 0.3, max: 3, step: 0.1, tip: t('impeller.rootEmbedTip') })}
          {field('stations', t('impeller.stations'), { min: 8, max: 24, step: 1, int: true, tip: t('impeller.stationsTip') })}
        </div>
      ) : null}

      {step === 'review' ? (
        <div class="fedit-sec-fields prop-body" data-section="review">
          <dl class="thread-readout" data-testid="impeller-readout">
            <dt>{t('impeller.r.exducer')}</dt><dd data-k="exducer">{fmt(ro.exducerRadius)} mm</dd>
            <dt>{t('impeller.r.inducer')}</dt><dd data-k="inducer">{fmt(ro.inducerRadius)} mm</dd>
            <dt>{t('impeller.r.mainBlades')}</dt><dd data-k="mainBlades">{ro.mainBlades}</dd>
            <dt>{t('impeller.r.splitterBlades')}</dt><dd data-k="splitterBlades">{ro.splitterBlades}</dd>
            <dt>{t('impeller.r.wrap')}</dt><dd data-k="wrap">{fmt(ro.wrapDeg, 1)}&deg;</dd>
            <dt>{t('impeller.r.stations')}</dt><dd data-k="stations">{ro.stations}</dd>
            <dt>{t('impeller.r.span')}</dt><dd data-k="span">{fmt(ro.span, 2)} mm</dd>
            <dt>{t('impeller.r.tipPitch')}</dt><dd data-k="tipPitch">{fmt(ro.tipPitch, 1)} mm</dd>
          </dl>
          <div class="prop-issues" data-testid="impeller-issues">
            {issues.length === 0 ? <div class="thread-fit ok" role="status">{t('prop.issues.none')}</div> : null}
            {issues.map((i, k) => <div key={i.code + k} class={'thread-fit ' + (i.level === 'error' ? 'bad' : 'warn')} role={i.level === 'error' ? 'alert' : 'status'} data-issue={i.code} data-severity={i.level}>{impellerIssueText(i)}</div>)}
          </div>
          {p.hint ? <div class="fedit-hint" role="alert" data-testid="impeller-hint">{p.hint}</div> : null}
          <div class="thread-hint" data-testid="impeller-notes">{t('impeller.help.build')}</div>
          <div class="thread-hint">{t('impeller.help.limits')}</div>
          {p.edit ? <div class="thread-hint">{t('prop.help.edit')}</div> : null}
        </div>
      ) : null}

      <div class="prop-nav">
        <button type="button" class="fedit-card-btn" data-testid="impeller-back" disabled={at === 0} onClick={() => setStep(IMPELLER_STEPS[at - 1])}>{t('prop.back')}</button>
        {step !== 'review'
          ? <button type="button" class="fedit-card-btn" data-testid="impeller-next" onClick={() => setStep(IMPELLER_STEPS[at + 1])}>{t('prop.next')}</button>
          : <button type="button" class="fedit-card-btn prop-create" data-testid="impeller-create" disabled={blocked} aria-disabled={blocked} title={blocked ? t('prop.blockedTip') : p.edit ? t('prop.applyTip') : t('prop.createTip')} onClick={create}>{p.edit ? t('prop.apply') : t('prop.create')}</button>}
      </div>
    </div>
  );
}
