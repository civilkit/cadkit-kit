// The Spring wizard: one panel over the spring() helper of the Script tab. Outer diameter, wire diameter, free length and turns, the winding hand, where the first end
// centre sits and which way the spring extends. Every change goes to onDraft with the whole record (the app previews it live in the viewport, debounced by the
// controller); Add spring commits the features as one tree folder, Escape / the cross cancels. Rules: spring.ts.
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon, kindForMin, numberAttrs } from '@kit/ui';
import { t } from './i18n';
import { EXTENSION_DEFAULTS, TORSION_DEFAULTS, springIssue, springSummary, DEFAULT_SPRING, SPRING_AXES, SPRING_ENDS, SPRING_HANDS, SPRING_KINDS, type SpringParams } from './spring';

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
        <input {...numberAttrs(kindForMin(p.min))} type="number" step={p.step ?? 'any'} min={p.min} value={String(p.value)} aria-label={p.label} title={p.hintText}
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
  /** switching type starts from that type's usual numbers, keeping where it sits and which way it winds */
  const setKind = (kind: SpringParams['kind']): void => {
    if (kind === draft.kind) return;
    change(kind === 'extension'
      ? { kind, ...EXTENSION_DEFAULTS, ends: 'plain', topOuter: null, progression: 1 }
      : kind === 'torsion'
      ? { kind, ...TORSION_DEFAULTS, ends: 'plain', topOuter: null, progression: 1 }
      : { kind, outer: DEFAULT_SPRING.outer, wire: DEFAULT_SPRING.wire, coils: DEFAULT_SPRING.coils, length: DEFAULT_SPRING.length });
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
        <label class="fedit-fld" data-path="kind">
          <span class="fedit-fld-label">{t('spring.kind')}</span>
          <select value={draft.kind} aria-label={t('spring.kind')} onChange={(e) => setKind((e.currentTarget as HTMLSelectElement).value as SpringParams['kind'])}>
            {SPRING_KINDS.map((v) => <option key={v} value={v}>{t('spring.kind.' + v)}</option>)}
          </select>
        </label>
        <Num name="outer" label={t('spring.outer')} unit="mm" min={0.1} step={0.5} value={draft.outer} hintText={t('spring.outerTip')} onChange={(v) => change({ outer: v })} />
        <Num name="wire" label={t('spring.wire')} unit="mm" min={0.05} step={0.1} value={draft.wire} onChange={(v) => change({ wire: v })} />
        {draft.kind === 'compression' ? <Num name="length" label={t('spring.length')} unit="mm" min={0.1} step={1} value={draft.length} hintText={t('spring.lengthTip')} onChange={(v) => change({ length: v })} /> : null}
        <Num name="coils" label={t('spring.coils')} min={0.25} step={0.25} value={draft.coils} hintText={draft.kind !== 'compression' ? t('spring.coilsBodyTip') : t('spring.coilsTip')} onChange={(v) => change({ coils: v })} />
        <label class="fedit-fld" data-path="hand">
          <span class="fedit-fld-label">{t('spring.hand')}</span>
          <select value={draft.hand} aria-label={t('spring.hand')} onChange={(e) => change({ hand: (e.currentTarget as HTMLSelectElement).value as SpringParams['hand'] })}>
            {SPRING_HANDS.map((h) => <option key={h} value={h}>{t('spring.hand.' + h)}</option>)}
          </select>
        </label>
        {draft.kind === 'compression' ? <Num name="topOuter" label={t('spring.topOuter')} unit="mm" min={0.1} step={0.5} value={draft.topOuter ?? draft.outer} hintText={t('spring.topOuterTip')} onChange={(v) => change({ topOuter: v === draft.outer ? null : v })} /> : null}
        {draft.kind === 'compression' ? <Num name="progression" label={t('spring.progression')} min={0.05} step={0.1} value={draft.progression} hintText={t('spring.progressionTip')} onChange={(v) => change({ progression: v })} /> : null}
        {draft.kind === 'compression' ? <label class="fedit-fld" data-path="ends">
          <span class="fedit-fld-label">{t('spring.ends')}</span>
          <select value={draft.ends} aria-label={t('spring.ends')} title={t('spring.endsTip')} onChange={(e) => change({ ends: (e.currentTarget as HTMLSelectElement).value as SpringParams['ends'] })}>
            {SPRING_ENDS.map((v) => <option key={v} value={v}>{t('spring.ends.' + v)}</option>)}
          </select>
        </label> : null}
        {draft.kind === 'compression' && draft.ends !== 'plain' ? <Num name="closedTurns" label={t('spring.closedTurns')} min={0.25} step={0.25} value={draft.closedTurns} hintText={t('spring.closedTurnsTip')} onChange={(v) => change({ closedTurns: v })} /> : null}
        {s && draft.kind === 'torsion' ? <div class="thread-hint" data-testid="spring-summary">{t('spring.legAngle', { angle: Math.round(s.legAngle), length: r2(s.length) })}</div> : null}
        {s && draft.kind === 'extension' ? <div class="thread-hint" data-testid="spring-summary">{t('spring.overall', { length: r2(s.length) })}</div> : null}
        {s && draft.kind === 'compression' ? <div class="thread-hint" data-testid="spring-summary">{t('spring.summary', { pitch: r2(s.pitch), gap: r2(s.gap), mean: r2(s.meanDiameter), wireLength: r2(s.wireLength) })}</div> : null}
        {draft.kind === 'compression' && draft.ends === 'ground' ? <div class="thread-hint" data-testid="spring-ground-note">{t('spring.groundNote')}</div> : null}
        {draft.kind === 'extension' ? <div class="thread-hint" data-testid="spring-extension-note">{t('spring.extensionNote')}</div> : null}
        {draft.kind === 'torsion' ? <div class="thread-hint" data-testid="spring-torsion-note">{t('spring.torsionNote')}</div> : null}
        {draft.kind === 'torsion' ? <Num name="leg1" label={t('spring.leg1')} unit="mm" min={0.1} step={1} value={draft.leg1} onChange={(v) => change({ leg1: v })} /> : null}
        {draft.kind === 'torsion' ? <Num name="leg2" label={t('spring.leg2')} unit="mm" min={0.1} step={1} value={draft.leg2} onChange={(v) => change({ leg2: v })} /> : null}
        {draft.kind !== 'compression' || draft.ends !== 'plain' || draft.progression !== 1 || (draft.topOuter !== null && draft.topOuter !== draft.outer) ? <div class="thread-hint" data-testid="spring-slow-note">{t('spring.slowNote')}</div> : null}
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
