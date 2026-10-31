// The Screw wizard: one panel over the screw() helper of the Script tab. Size, length, head, drive, where the bearing face
// centre sits and which way the shank points. Every change goes to onDraft with the whole record (the app previews it live in the viewport, debounced
// by the controller); Add screw commits the features, Escape / the cross cancels. Rules: screw.ts.
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '@kit/ui';
import { t } from './i18n';
import { defaultDrive, SCREW_AXES, SCREW_DRIVES, SCREW_HEADS, SCREW_SIZE_LIST, screwIssue, type ScrewParams } from './screw';

export interface ScrewWizardProps {
  params: ScrewParams;
  onDraft(next: ScrewParams): void;
  onApply(next: ScrewParams): void;
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

export function ScrewWizard(p: ScrewWizardProps): JSX.Element {
  const [draft, setDraft] = useState<ScrewParams>(p.params);
  useEffect(() => { p.onDraft(draft); }, []);
  const issue = screwIssue(draft);
  const change = (patch: Partial<ScrewParams>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (!screwIssue(next)) p.onDraft(next);
  };
  const apply = (): void => { if (!issue) p.onApply(draft); };
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && tag !== 'SELECT' && tag !== 'BUTTON') { e.preventDefault(); apply(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };
  const at = (i: 0 | 1 | 2, v: number): void => change({ origin: draft.origin.map((o, k) => (k === i ? v : o)) as ScrewParams['origin'] });
  const sel = <K extends 'size' | 'head' | 'drive' | 'axis'>(key: K, label: string, values: readonly string[], text: (v: string) => string, onPick: (v: string) => void): JSX.Element => (
    <label class="fedit-fld" data-path={key}>
      <span class="fedit-fld-label">{label}</span>
      <select value={draft[key]} aria-label={label} onChange={(e) => onPick((e.currentTarget as HTMLSelectElement).value)}>
        {values.map((v) => <option key={v} value={v}>{text(v)}</option>)}
      </select>
    </label>
  );
  const approx = draft.drive === 'cross' || draft.drive === 'torx';
  return (
    <div class="fedit thread-editor prop-wizard screw-wizard" tabIndex={0} onKeyDown={onKey} data-testid="screw-wizard">
      <div class="fedit-head">
        <Icon name="add-screw" size={22} class="fedit-icon" />
        <div class="fedit-title">{t('screw.title')}</div>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>
      <div class="fedit-sec-fields prop-body">
        {sel('size', t('screw.size'), SCREW_SIZE_LIST, (v) => v, (v) => change({ size: v }))}
        <Num name="length" label={t('screw.length')} unit="mm" min={0.5} step={0.5} value={draft.length} hintText={t('screw.lengthTip')} onChange={(v) => change({ length: v })} />
        {sel('head', t('screw.head'), SCREW_HEADS, (v) => t('screw.head.' + v), (v) => change({ head: v as ScrewParams['head'], drive: defaultDrive(v as ScrewParams['head']) }))}
        {draft.head === 'hex' ? null : sel('drive', t('screw.drive'), SCREW_DRIVES, (v) => t('screw.drive.' + v), (v) => change({ drive: v as ScrewParams['drive'] }))}
        {approx ? <div class="thread-hint" data-testid="screw-approx">{t('screw.driveApprox')}</div> : null}
        <div class="thread-hint" title={t('screw.positionTip')}>{t('screw.position')}</div>
        <Num name="x" label={t('screw.x')} unit="mm" step={0.5} value={draft.origin[0]} hintText={t('screw.positionTip')} onChange={(v) => at(0, v)} />
        <Num name="y" label={t('screw.y')} unit="mm" step={0.5} value={draft.origin[1]} hintText={t('screw.positionTip')} onChange={(v) => at(1, v)} />
        <Num name="z" label={t('screw.z')} unit="mm" step={0.5} value={draft.origin[2]} hintText={t('screw.positionTip')} onChange={(v) => at(2, v)} />
        {sel('axis', t('screw.axis'), SCREW_AXES, (v) => t('screw.axis.' + v), (v) => change({ axis: v as ScrewParams['axis'] }))}
        {issue ? <div class="thread-fit bad" role="alert" data-issue={issue.code}>{issue.code === 'kernel' ? issue.message : t('screw.issue.' + issue.code, issue.params, issue.message)}</div> : null}
        {p.hint ? <div class="fedit-hint" role="alert" data-testid="screw-hint">{p.hint}</div> : null}
      </div>
      <div class="prop-nav">
        <button type="button" class="fedit-card-btn" data-testid="screw-cancel" onClick={p.onCancel}>{t('ui.cancel', undefined, 'Cancel')}</button>
        <button type="button" class="fedit-card-btn prop-create" data-testid="screw-apply" disabled={!!issue} aria-disabled={!!issue} title={issue ? t('screw.blockedTip') : t('screw.applyTip')} onClick={apply}>{t('screw.apply')}</button>
      </div>
    </div>
  );
}
