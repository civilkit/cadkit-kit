// The Knurl wizard: one panel over the knurl() helper of the Script tab. It knurls the cylindrical face that was selected when it opened: pattern, groove
// shape, number of grooves, depth, helix angle (diamond) and the band along the axis. Every change goes to onDraft with the whole record (the app previews
// it live in the viewport, debounced by the controller); Knurl commits the cuts as ordinary features, Escape / the cross cancels. Rules: knurl.ts.
// Opened with no usable cylinder it waits for one: the face the user selects in the viewport (`face`, read against `edges`) becomes the target.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '@kit/ui';
import { t } from './i18n';
import { Check } from './ThreadControls';
import { KNURL_METHODS, KNURL_PATTERNS, KNURL_PROFILES, cosmeticByDefault, knurlAnchor, knurlHasMethod, knurlIssue, knurlTarget, suggestCount, suggestDepth, type KnurlParams } from './knurl';
import type { FaceMesh } from './bearing';
import type { EdgeLike } from './threadData';

export interface KnurlWizardProps {
  params: KnurlParams;
  /** Why no cylinder could be read from the selection ('notCylinder' | 'oblique' | 'internal'); params.target is then null. */
  reason?: string | null;
  /** The face selected in the viewport (the app's one-face selection) and the body's edges: while the wizard has no cylinder, selecting a round face fills it in. */
  face?: string | null;
  edges?: EdgeLike[];
  /** The body's face mesh: tells which faces are flat ends of the cylinder (the band is then built from the nearer end and follows it). */
  mesh?: FaceMesh | null;
  onDraft(next: KnurlParams): void;
  onApply(next: KnurlParams): void;
  onCancel(): void;
  /** The live preview's failure, or null when it is current. */
  hint?: string | null;
  /** The wizard reopened an existing knurl: Update replaces it (the cut or cosmetic form stays), the title says so. */
  edit?: boolean;
  /** Why this knurl cannot be replaced (later features use it); shown in place of a preview and Update is disabled. */
  refusal?: string | null;
  /** The part is built by a script: the next run of the script overwrites an edit made here. */
  scriptNote?: boolean;
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
  useEffect(() => { if (p.params.target && !p.refusal) p.onDraft(draft); }, []);
  const [bad, setBad] = useState<string | null>(null);   // why the face picked in the viewport is not usable
  useEffect(() => {   // the pick: a face selected while no cylinder is chosen
    if (p.edit || draft.target || !p.face || !p.edges) return;
    const found = knurlTarget(p.face, p.edges, p.mesh);
    if (!('target' in found)) { setBad(found.reason); return; }
    const count = suggestCount(found.target.radius);
    const next = { ...draft, target: found.target, count, depth: suggestDepth(found.target.radius, count) };
    setBad(null); setDraft(next);
    if (!knurlIssue(next) && !p.refusal) p.onDraft(next);
  }, [p.face]);
  useEffect(() => {   // waiting for a click in the viewport: focus is on the canvas, so Escape is heard on the window too
    if (p.edit || draft.target) return;
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !e.defaultPrevented) p.onCancel(); };
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [p.edit, !!draft.target]);
  const why = bad ?? p.reason ?? null;
  const chosen = useRef(false);   // the user set Cosmetic themselves: a change of pattern no longer moves it
  const target = draft.target;
  const issue = target ? knurlIssue(draft) : null;
  const blocked = !target || !!issue || !!p.refusal;
  const change = (patch: Partial<KnurlParams>): void => {
    if (patch.cosmetic !== undefined) chosen.current = true;
    else if (patch.pattern && !chosen.current && !p.edit) patch = { ...patch, cosmetic: cosmeticByDefault(patch.pattern) };
    if (patch.count !== undefined && draft.ringPitch !== undefined) patch = { ...patch, ringPitch: undefined };   // a ring pitch kept from the old knurl belonged to its old count
    const next = { ...draft, ...patch };
    setDraft(next);
    if (next.target && !knurlIssue(next) && !p.refusal) p.onDraft(next);
  };
  const apply = (): void => { if (!blocked) p.onApply(draft); };
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && tag !== 'SELECT' && tag !== 'BUTTON') { e.preventDefault(); apply(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };
  const anchor = target && !draft.cosmetic ? knurlAnchor(draft) : null;
  const followNote = target && !draft.cosmetic
    ? anchor ? t('knurl.followNote', { face: anchor.face })
      : target.ends?.length && knurlHasMethod(draft) && draft.method === 'faceted' ? t('knurl.followFaceted') : null
    : null;
  const from = draft.range?.[0] ?? target?.from ?? 0, to = draft.range?.[1] ?? target?.to ?? 0;
  const pitch = target ? (2 * Math.PI * target.radius) / Math.max(1, draft.count) : 0;
  return (
    <div class="fedit thread-editor prop-wizard knurl-wizard" tabIndex={0} onKeyDown={onKey} data-testid="knurl-wizard">
      <div class="fedit-head">
        <Icon name="add-knurl" size={22} class="fedit-icon" />
        <div class="fedit-title">{t(p.edit ? 'knurl.titleEdit' : 'knurl.title')}</div>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>
      <div class="fedit-sec-fields prop-body">
        {!target ? (why ? <div class="thread-fit bad" role="alert" data-testid="knurl-reason">{t('knurl.reason.' + why)}</div> : <div class="thread-hint" data-testid="knurl-pick">{t('knurl.pick')}</div>) : (
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
            {p.edit ? null : (
              <Check name="cosmetic" label={t('knurl.cosmetic')} checked={draft.cosmetic} onChange={(v) => change({ cosmetic: v })} />
            )}
            <div class="thread-hint" data-testid="knurl-mode-note">{draft.cosmetic ? t('knurl.cosmeticNote') : draft.pattern !== 'straight' && !(knurlHasMethod(draft) && draft.method === 'faceted') ? t('knurl.slow') : t('knurl.cutNote')}</div>
            {followNote ? <div class="thread-hint" data-testid="knurl-follow-note">{followNote}</div> : null}
            {p.scriptNote ? <div class="thread-hint" data-testid="knurl-script-note">{t('knurl.scriptNote')}</div> : null}
            {p.refusal ? <div class="thread-fit bad" role="alert" data-testid="knurl-refusal">{p.refusal}</div> : null}
            {issue ? <div class="thread-fit bad" role="alert" data-issue={issue.code}>{issue.code === 'kernel' ? issue.message : t('knurl.issue.' + issue.code, issue.params, issue.message)}</div> : null}
            {p.hint ? <div class="fedit-hint" role="alert" data-testid="knurl-hint">{p.hint}</div> : null}
          </>
        )}
      </div>
      <div class="prop-nav">
        <button type="button" class="fedit-card-btn" data-testid="knurl-cancel" onClick={p.onCancel}>{t('ui.cancel', undefined, 'Cancel')}</button>
        <button type="button" class="fedit-card-btn prop-create" data-testid="knurl-apply" disabled={blocked} aria-disabled={blocked} title={blocked ? t('knurl.blockedTip') : p.edit ? t('knurl.updateTip') : draft.cosmetic ? t('knurl.applyCosmeticTip') : t('knurl.applyTip')} onClick={apply}>{t(p.edit ? 'knurl.update' : 'knurl.apply')}</button>
      </div>
    </div>
  );
}
