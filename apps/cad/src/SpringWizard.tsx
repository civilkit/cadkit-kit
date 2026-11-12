// The Spring wizard: one panel over the spring() helper of the Script tab. Outer diameter, wire diameter, free length and turns, the winding hand, where the first end
// centre sits and which way the spring extends. Every change goes to onDraft with the whole record (the app previews it live in the viewport, debounced by the
// controller); Add spring commits the features as one tree folder, Escape / the cross cancels. Rules: spring.ts.
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '@kit/ui';
import { t } from './i18n';
import { springIssue, springSummary, SPRING_AXES, SPRING_HANDS, type SpringParams } from './spring';

export interface SpringWizardProps {
  params: SpringParams;
  onDraft(next: SpringParams): void;
  onApply(next: SpringParams): void;
  onCancel(): void;
  /** The live preview's failure, or null when it is current. */
  hint?: string | null;
}

function Num(p: { name: string; label: string; value: number; unit?: string; min?: number; step?: number; onChange(v: number): void; hintText?: string }): JSX.Element {
  return (
    <label class="fedit-fld" data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <span class="fedit-num">
        <input type="number" inputMode="decimal" enterKeyHint="done" step={p.step ?? 'any'} min={p.min} value={String(p.value)} aria-label={p.label} title={p.hintText}
          onChange={(e) => { const raw = (e.currentTarget as HTMLInputElement).value; const v = Number(raw); if (raw.trim() !== '' && Number.isFinite(v)) p.onChange(v); }} />
        {p.unit ? <span class="fedit-unit">{p.unit}</span> : null}
      </span>
    </label>
  );
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

export function SpringWizard(p: SpringWizardProps): JSX.Element {
  const [draft, setDraft] = useState<SpringParams>(p.params);
  useEffect(() => { p.onDraft(draft); }, []);
  const issue = springIssue(draft);
  const change = (patch: Partial<SpringParams>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (!springIssue(next)) p.onDraft(next);
  };
  const apply = (): void => { if (!issue) p.onApply(draft); };
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && tag !== 'SELECT' && tag !== 'BUTTON' && tag !== 'INPUT') { e.preventDefault(); apply(); }
    if (e.key === 'Enter' && tag === 'INPUT' && (e.target as HTMLInputElement).type === 'number') { e.preventDefault(); apply(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };
  const at = (i: 0 | 1 | 2, v: number): void => change({ origin: draft.origin.map((o, k) => (k === i ? v : o)) as SpringParams['origin'] });
  const s = issue ? null : springSummary(draft);
  return (
    <div class="fedit thread-editor prop-wizard spring-wizard" tabIndex={0} onKeyDown={onKey} data-testid="spring-wizard">
      <div class="fedit-head">
        <Icon name="add-spring" size={22} class="fedit-icon" />
        <div class="fedit-title">{t('spring.title')}</div>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>
      <div class="fedit-sec-fields prop-body">
        <Num name="outer" label={t('spring.outer')} unit="mm" min={0.1} step={0.5} value={draft.outer} hintText={t('spring.outerTip')} onChange={(v) => change({ outer: v })} />
        <Num name="wire" label={t('spring.wire')} unit="mm" min={0.05} step={0.1} value={draft.wire} onChange={(v) => change({ wire: v })} />
        <Num name="length" label={t('spring.length')} unit="mm" min={0.1} step={1} value={draft.length} hintText={t('spring.lengthTip')} onChange={(v) => change({ length: v })} />
        <Num name="coils" label={t('spring.coils')} min={0.25} step={0.25} value={draft.coils} hintText={t('spring.coilsTip')} onChange={(v) => change({ coils: v })} />
        <label class="fedit-fld" data-path="hand">
          <span class="fedit-fld-label">{t('spring.hand')}</span>
          <select value={draft.hand} aria-label={t('spring.hand')} onChange={(e) => change({ hand: (e.currentTarget as HTMLSelectElement).value as SpringParams['hand'] })}>
            {SPRING_HANDS.map((h) => <option key={h} value={h}>{t('spring.hand.' + h)}</option>)}
          </select>
        </label>
        {s ? <div class="thread-hint" data-testid="spring-summary">{t('spring.summary', { pitch: r2(s.pitch), gap: r2(s.gap), mean: r2(s.meanDiameter), wireLength: r2(s.wireLength) })}</div> : null}
        <div class="thread-hint" data-testid="spring-ground-note">{t('spring.noGround')}</div>
        <div class="thread-hint" title={t('spring.positionTip')}>{t('spring.position')}</div>
        <Num name="x" label={t('spring.x')} unit="mm" step={0.5} value={draft.origin[0]} hintText={t('spring.positionTip')} onChange={(v) => at(0, v)} />
        <Num name="y" label={t('spring.y')} unit="mm" step={0.5} value={draft.origin[1]} hintText={t('spring.positionTip')} onChange={(v) => at(1, v)} />
        <Num name="z" label={t('spring.z')} unit="mm" step={0.5} value={draft.origin[2]} hintText={t('spring.positionTip')} onChange={(v) => at(2, v)} />
        <label class="fedit-fld" data-path="axis">
          <span class="fedit-fld-label">{t('spring.axis')}</span>
          <select value={draft.axis} aria-label={t('spring.axis')} onChange={(e) => change({ axis: (e.currentTarget as HTMLSelectElement).value as SpringParams['axis'] })}>
            {SPRING_AXES.map((v) => <option key={v} value={v}>{t('spring.axis.' + v)}</option>)}
          </select>
        </label>
        {issue ? <div class="thread-fit bad" role="alert" data-issue={issue.code}>{issue.code === 'kernel' ? issue.message : t('spring.issue.' + issue.code, issue.params, issue.message)}</div> : null}
        {p.hint ? <div class="fedit-hint" role="alert" data-testid="spring-hint">{p.hint}</div> : null}
      </div>
      <div class="prop-nav">
        <button type="button" class="fedit-card-btn" data-testid="spring-cancel" onClick={p.onCancel}>{t('ui.cancel', undefined, 'Cancel')}</button>
        <button type="button" class="fedit-card-btn prop-create" data-testid="spring-apply" disabled={!!issue} aria-disabled={!!issue} title={issue ? t('spring.blockedTip') : t('spring.applyTip')} onClick={apply}>{t('spring.apply')}</button>
      </div>
    </div>
  );
}
