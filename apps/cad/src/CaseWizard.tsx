// The Case wizard: one panel over the caseBox() helper of the Script tab. Outside width, depth and height, the wall, the corner radius, the height of the lid, the lip joint
// (tongue height and width, clearance, which half carries it), the names of the two halves and where the case stands. Every change goes to onDraft with the whole record (the app
// previews it live in the viewport, debounced by the controller); Add case commits the features as one tree folder, Escape / the cross cancels. Rules: case.ts.
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '@kit/ui';
import { t } from './i18n';
import { CASE_TONGUE_SIDES, caseIssue, caseSummary, withChange, type CaseParams } from './case';

export interface CaseWizardProps {
  params: CaseParams;
  /** The document already holds features: the new case is kept apart from them (shown as a note). */
  hasOthers?: boolean;
  onDraft(next: CaseParams): void;
  onApply(next: CaseParams): void;
  onCancel(): void;
  /** The live preview's failure, or null when it is current. */
  hint?: string | null;
}

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
function Text(p: { name: string; label: string; value: string; onChange(v: string): void }): JSX.Element {
  return (
    <label class="fedit-fld" data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <input type="text" value={p.value} aria-label={p.label} onInput={(e) => p.onChange((e.currentTarget as HTMLInputElement).value)} />
    </label>
  );
}

export function CaseWizard(p: CaseWizardProps): JSX.Element {
  const [draft, setDraft] = useState<CaseParams>(p.params);
  useEffect(() => { p.onDraft(draft); }, []);
  const issue = caseIssue(draft);
  const change = (patch: Partial<CaseParams>): void => {
    const next = withChange(draft, patch);
    setDraft(next);
    if (!caseIssue(next)) p.onDraft(next);
  };
  const apply = (): void => { if (!issue) p.onApply(draft); };
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && tag !== 'SELECT' && tag !== 'BUTTON' && tag !== 'INPUT') { e.preventDefault(); apply(); }
    if (e.key === 'Enter' && tag === 'INPUT' && (e.target as HTMLInputElement).type === 'number') { e.preventDefault(); apply(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };
  const at = (i: 0 | 1 | 2, v: number): void => change({ origin: draft.origin.map((o, k) => (k === i ? v : o)) as CaseParams['origin'] });
  const s = issue ? null : caseSummary(draft);
  return (
    <div class="fedit thread-editor prop-wizard case-wizard" tabIndex={0} onKeyDown={onKey} data-testid="case-wizard">
      <div class="fedit-head">
        <Icon name="add-case" size={22} class="fedit-icon" />
        <div class="fedit-title">{t('case.title')}</div>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>
      <div class="fedit-sec-fields prop-body">
        <Num name="width" label={t('case.width')} unit="mm" min={0.1} step={1} value={draft.width} hintText={t('case.sizeTip')} onChange={(v) => change({ width: v })} />
        <Num name="depth" label={t('case.depth')} unit="mm" min={0.1} step={1} value={draft.depth} hintText={t('case.sizeTip')} onChange={(v) => change({ depth: v })} />
        <Num name="height" label={t('case.height')} unit="mm" min={0.1} step={1} value={draft.height} hintText={t('case.sizeTip')} onChange={(v) => change({ height: v })} />
        <Num name="wall" label={t('case.wall')} unit="mm" min={0.4} step={0.1} value={draft.wall} hintText={t('case.wallTip')} onChange={(v) => change({ wall: v })} />
        <Num name="radius" label={t('case.radius')} unit="mm" min={0} step={0.5} value={draft.radius} hintText={t('case.radiusTip')} onChange={(v) => change({ radius: v })} />
        <Num name="lidHeight" label={t('case.lidHeight')} unit="mm" min={0.1} step={0.5} value={draft.lidHeight} hintText={t('case.lidHeightTip')} onChange={(v) => change({ lidHeight: v })} />
        <div class="thread-hint">{t('case.lip')}</div>
        <Num name="tongueHeight" label={t('case.tongueHeight')} unit="mm" min={0.1} step={0.1} value={draft.tongueHeight} hintText={t('case.tongueHeightTip')} onChange={(v) => change({ tongueHeight: v })} />
        <Num name="tongueFraction" label={t('case.tongueFraction')} min={0.05} max={0.95} step={0.05} value={draft.tongueFraction} hintText={t('case.tongueFractionTip')} onChange={(v) => change({ tongueFraction: v })} />
        <Num name="clearance" label={t('case.clearance')} unit="mm" min={0} max={1} step={0.05} value={draft.clearance} hintText={t('case.clearanceTip')} onChange={(v) => change({ clearance: v })} />
        <label class="fedit-fld" data-path="tongueOn">
          <span class="fedit-fld-label">{t('case.tongueOn')}</span>
          <select value={draft.tongueOn} aria-label={t('case.tongueOn')} onChange={(e) => change({ tongueOn: (e.currentTarget as HTMLSelectElement).value as CaseParams['tongueOn'] })}>
            {CASE_TONGUE_SIDES.map((v) => <option key={v} value={v}>{t('case.tongueOn.' + v)}</option>)}
          </select>
        </label>
        <Text name="baseName" label={t('case.baseName')} value={draft.baseName} onChange={(v) => change({ baseName: v })} />
        <Text name="lidName" label={t('case.lidName')} value={draft.lidName} onChange={(v) => change({ lidName: v })} />
        {s ? <div class="thread-hint" data-testid="case-summary">{t('case.summary', s)}</div> : null}
        <div class="thread-hint" data-testid="case-not-included">{t('case.notIncluded')}</div>
        {p.hasOthers ? <div class="thread-hint" data-testid="case-others">{t('case.otherBodies')}</div> : null}
        <div class="thread-hint" title={t('case.positionTip')}>{t('case.position')}</div>
        <Num name="x" label={t('case.x')} unit="mm" step={0.5} value={draft.origin[0]} hintText={t('case.positionTip')} onChange={(v) => at(0, v)} />
        <Num name="y" label={t('case.y')} unit="mm" step={0.5} value={draft.origin[1]} hintText={t('case.positionTip')} onChange={(v) => at(1, v)} />
        <Num name="z" label={t('case.z')} unit="mm" step={0.5} value={draft.origin[2]} hintText={t('case.positionTip')} onChange={(v) => at(2, v)} />
        {issue ? <div class="thread-fit bad" role="alert" data-issue={issue.code}>{issue.code === 'kernel' ? issue.message : t('case.issue.' + issue.code, issue.params, issue.message)}</div> : null}
        {p.hint ? <div class="fedit-hint" role="alert" data-testid="case-hint">{p.hint}</div> : null}
      </div>
      <div class="prop-nav">
        <button type="button" class="fedit-card-btn" data-testid="case-cancel" onClick={p.onCancel}>{t('ui.cancel', undefined, 'Cancel')}</button>
        <button type="button" class="fedit-card-btn prop-create" data-testid="case-apply" disabled={!!issue} aria-disabled={!!issue} title={issue ? t('case.blockedTip') : t('case.applyTip')} onClick={apply}>{t('case.apply')}</button>
      </div>
    </div>
  );
}
