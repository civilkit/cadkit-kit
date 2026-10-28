// The Knurl wizard: one panel over the knurl() helper of the Script tab. It knurls the cylindrical face that was selected when it opened: pattern, groove
// shape, number of grooves, depth, helix angle (diamond) and the band along the axis. Every change goes to onDraft with the whole record (the app previews
// it live in the viewport, debounced by the controller); Knurl commits the cuts as ordinary features, Escape / the cross cancels. Rules: knurl.ts.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '@kit/ui';
import { t } from './i18n';
import { KNURL_METHODS, KNURL_PATTERNS, KNURL_PROFILES, cosmeticByDefault, knurlHasMethod, knurlIssue, type KnurlParams } from './knurl';

export interface KnurlWizardProps {
  params: KnurlParams;
  /** Why no cylinder could be read from the selection ('notCylinder' | 'oblique' | 'internal'); params.target is then null. */
  reason?: string | null;
  onDraft(next: KnurlParams): void;
  onApply(next: KnurlParams): void;
  onCancel(): void;
  /** The live preview's failure, or null when it is current. */
  hint?: string | null;
}

const fmt = (v: number, d = 2): string => String(Math.round(v * 10 ** d) / 10 ** d);

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

export function KnurlWizard(p: KnurlWizardProps): JSX.Element {
  const [draft, setDraft] = useState<KnurlParams>(p.params);
  useEffect(() => { if (p.params.target) p.onDraft(draft); }, []);
  const chosen = useRef(false);   // the user set Cosmetic themselves: a change of pattern no longer moves it
  const target = draft.target;
  const issue = target ? knurlIssue(draft) : null;
  const blocked = !target || !!issue;
  const change = (patch: Partial<KnurlParams>): void => {
    if (patch.cosmetic !== undefined) chosen.current = true;
    else if (patch.pattern && !chosen.current) patch = { ...patch, cosmetic: cosmeticByDefault(patch.pattern) };
    const next = { ...draft, ...patch };
    setDraft(next);
    if (next.target && !knurlIssue(next)) p.onDraft(next);
  };
  const apply = (): void => { if (!blocked) p.onApply(draft); };
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && tag !== 'SELECT' && tag !== 'BUTTON') { e.preventDefault(); apply(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };
  const from = draft.range?.[0] ?? target?.from ?? 0, to = draft.range?.[1] ?? target?.to ?? 0;
  const pitch = target ? (2 * Math.PI * target.radius) / Math.max(1, draft.count) : 0;
  return (
    <div class="fedit thread-editor prop-wizard knurl-wizard" tabIndex={0} onKeyDown={onKey} data-testid="knurl-wizard">
      <div class="fedit-head">
        <Icon name="add-knurl" size={22} class="fedit-icon" />
        <div class="fedit-title">{t('knurl.title')}</div>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>
      <div class="fedit-sec-fields prop-body">
        {!target ? <div class="thread-fit bad" role="alert" data-testid="knurl-reason">{t('knurl.reason.' + (p.reason ?? 'notCylinder'))}</div> : (
          <>
            <div class="thread-hint" data-testid="knurl-target">{t('knurl.target', { r: fmt(target.radius), axis: target.axis.toUpperCase(), from: fmt(target.from), to: fmt(target.to) })}</div>
            <label class="fedit-fld" data-path="pattern">
              <span class="fedit-fld-label">{t('knurl.pattern')}</span>
              <select value={draft.pattern} aria-label={t('knurl.pattern')} onChange={(e) => change({ pattern: (e.currentTarget as HTMLSelectElement).value as KnurlParams['pattern'] })}>
                {KNURL_PATTERNS.map((k) => <option key={k} value={k}>{t('knurl.pattern.' + k)}</option>)}
              </select>
            </label>
            <label class="fedit-fld" data-path="profile">
              <span class="fedit-fld-label">{t('knurl.profile')}</span>
              <select value={draft.profile} aria-label={t('knurl.profile')} onChange={(e) => change({ profile: (e.currentTarget as HTMLSelectElement).value as KnurlParams['profile'] })}>
                {KNURL_PROFILES.map((k) => <option key={k} value={k}>{t('knurl.profile.' + k)}</option>)}
              </select>
            </label>
            {knurlHasMethod(draft) ? (
              <label class="fedit-fld" data-path="method" title={t('knurl.methodTip')}>
                <span class="fedit-fld-label">{t('knurl.method')}</span>
                <select value={draft.method} aria-label={t('knurl.method')} onChange={(e) => change({ method: (e.currentTarget as HTMLSelectElement).value as KnurlParams['method'] })}>
                  {KNURL_METHODS.map((k) => <option key={k} value={k}>{t('knurl.method.' + k)}</option>)}
                </select>
              </label>
            ) : null}
            <Num name="count" label={t('knurl.count')} min={3} step={1} value={draft.count} hintText={t('knurl.countTip')} onChange={(v) => change({ count: Math.round(v) })} />
            <Num name="depth" label={t('knurl.depth')} unit="mm" min={0.05} step={0.05} value={draft.depth} hintText={t('knurl.depthTip')} onChange={(v) => change({ depth: v })} />
            {draft.pattern === 'diamond' ? <Num name="helixAngle" label={t('knurl.helix')} unit="deg" min={1} max={79} step={1} value={draft.helixAngle} hintText={t('knurl.helixTip')} onChange={(v) => change({ helixAngle: v })} /> : null}
            <Num name="from" label={t('knurl.from')} unit="mm" step={0.5} value={from} hintText={t('knurl.bandTip')} onChange={(v) => change({ range: [v, to] })} />
            <Num name="to" label={t('knurl.to')} unit="mm" step={0.5} value={to} hintText={t('knurl.bandTip')} onChange={(v) => change({ range: [from, v] })} />
            <div class="thread-hint" data-testid="knurl-pitch">{t('knurl.pitch', { pitch: fmt(pitch) })}</div>
            <label class="fedit-fld knurl-cosmetic" data-path="cosmetic" title={t('knurl.cosmeticTip')}>
              <span class="fedit-fld-label">{t('knurl.cosmetic')}</span>
              <input type="checkbox" checked={draft.cosmetic} aria-label={t('knurl.cosmetic')} onChange={(e) => change({ cosmetic: (e.currentTarget as HTMLInputElement).checked })} />
            </label>
            <div class="thread-hint" data-testid="knurl-mode-note">{draft.cosmetic ? t('knurl.cosmeticNote') : draft.pattern !== 'straight' && !(knurlHasMethod(draft) && draft.method === 'faceted') ? t('knurl.slow') : t('knurl.cutNote')}</div>
            {issue ? <div class="thread-fit bad" role="alert" data-issue={issue.code}>{issue.code === 'kernel' ? issue.message : t('knurl.issue.' + issue.code, issue.params, issue.message)}</div> : null}
            {p.hint ? <div class="fedit-hint" role="alert" data-testid="knurl-hint">{p.hint}</div> : null}
          </>
        )}
      </div>
      <div class="prop-nav">
        <button type="button" class="fedit-card-btn" data-testid="knurl-cancel" onClick={p.onCancel}>{t('ui.cancel', undefined, 'Cancel')}</button>
        <button type="button" class="fedit-card-btn prop-create" data-testid="knurl-apply" disabled={blocked} aria-disabled={blocked} title={blocked ? t('knurl.blockedTip') : draft.cosmetic ? t('knurl.applyCosmeticTip') : t('knurl.applyTip')} onClick={apply}>{t('knurl.apply')}</button>
      </div>
    </div>
  );
}
