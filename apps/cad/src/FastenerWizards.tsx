// The fastener wizards: Nut, Standoff and Heat-set insert, three panels over the nut(), standoff() and heatSetInsert() helpers of the Script tab. Every change goes to onDraft with
// the whole record (the app previews it live in the viewport, debounced by the controller); the Add button commits the features as one tree folder, Escape / the cross cancels.
// Rules: fasteners.ts.
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { Icon, kindForMin, numberAttrs } from '@kit/ui';
import { t } from './i18n';
import {
  CLEARANCE_LIMIT, FASTENER_AXES, FASTENER_THREADS, INSERT_SIZE_NAMES, NUT_TYPES, STANDOFF_ENDS, STANDOFF_KINDS, STANDOFF_SIZE_NAMES, insertDefaults, insertIssue, insertSummary, nutIssue,
  nutSizeNames, nutSummary, standoffDefaults, standoffIssue, standoffSummary,
  type FastenerIssue, type InsertParams, type NutParams, type StandoffParams,
} from './fasteners';

interface WizardProps<P> {
  params: P;
  onDraft(next: P): void;
  onApply(next: P): void;
  onCancel(): void;
  /** The live preview's failure, or null when it is current. */
  hint?: string | null;
}

function Num(p: { name: string; label: string; value: number; unit?: string; min?: number; max?: number; step?: number; onChange(v: number): void; hintText?: string }): JSX.Element {
  return (
    <label class="fedit-fld" data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <span class="fedit-num">
        <input {...numberAttrs(kindForMin(p.min))} type="number" step={p.step ?? 'any'} min={p.min} max={p.max} value={String(p.value)} aria-label={p.label} title={p.hintText}
          onChange={(e) => { const raw = (e.currentTarget as HTMLInputElement).value; const v = Number(raw); if (raw.trim() !== '' && Number.isFinite(v)) p.onChange(v); }} />
        {p.unit ? <span class="fedit-unit">{p.unit}</span> : null}
      </span>
    </label>
  );
}
function Pick(p: { name: string; label: string; value: string; options: Array<{ value: string; text: string }>; onChange(v: string): void; hintText?: string }): JSX.Element {
  return (
    <label class="fedit-fld" data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <select value={p.value} aria-label={p.label} title={p.hintText} onChange={(e) => p.onChange((e.currentTarget as HTMLSelectElement).value)}>
        {p.options.map((o) => <option key={o.value} value={o.value}>{o.text}</option>)}
      </select>
    </label>
  );
}
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** The draft, the live check, and the key handling every wizard shares. */
function useWizard<P>(p: WizardProps<P>, check: (v: P) => FastenerIssue | null): { draft: P; issue: FastenerIssue | null; change(patch: Partial<P>): void; apply(): void; onKey(e: KeyboardEvent): void } {
  const [draft, setDraft] = useState<P>(p.params);
  useEffect(() => { p.onDraft(draft); }, []);
  const issue = check(draft);
  const change = (patch: Partial<P>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (!check(next)) p.onDraft(next);
  };
  const apply = (): void => { if (!issue) p.onApply(draft); };
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && tag !== 'SELECT' && tag !== 'BUTTON' && tag !== 'INPUT') { e.preventDefault(); apply(); }
    if (e.key === 'Enter' && tag === 'INPUT' && (e.target as HTMLInputElement).type === 'number') { e.preventDefault(); apply(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };
  return { draft, issue, change, apply, onKey };
}

/** The panel frame: title, cross, the fields, the issue and preview hint, and the Cancel / Add buttons. */
function Frame(p: { id: 'nut' | 'standoff' | 'insert'; icon: string; title: string; apply: string; applyTip: string; issue: FastenerIssue | null; issueText: string; hint?: string | null; onCancel(): void; onApply(): void; onKey(e: KeyboardEvent): void; children: ComponentChildren }): JSX.Element {
  const { id, issue } = p;
  return (
    <div class={`fedit thread-editor prop-wizard fastener-wizard ${id}-wizard`} tabIndex={0} onKeyDown={p.onKey} data-testid={`${id}-wizard`}>
      <div class="fedit-head">
        <Icon name={p.icon} size={22} class="fedit-icon" />
        <div class="fedit-title">{p.title}</div>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>
      <div class="fedit-sec-fields prop-body">
        {p.children}
        {issue ? <div class="thread-fit bad" role="alert" data-issue={issue.code}>{p.issueText}</div> : null}
        {p.hint ? <div class="fedit-hint" role="alert" data-testid={`${id}-hint`}>{p.hint}</div> : null}
      </div>
      <div class="prop-nav">
        <button type="button" class="fedit-card-btn" data-testid={`${id}-cancel`} onClick={p.onCancel}>{t('ui.cancel', undefined, 'Cancel')}</button>
        <button type="button" class="fedit-card-btn prop-create" data-testid={`${id}-apply`} disabled={!!issue} aria-disabled={!!issue} title={issue ? t('fastener.blockedTip') : p.applyTip} onClick={p.onApply}>{p.apply}</button>
      </div>
    </div>
  );
}

/** The thread choice, the print clearance of a modelled one, and the note that it is slow. */
function ThreadFields(p: { thread: string; clearance: number; onThread(v: (typeof FASTENER_THREADS)[number]): void; onClearance(v: number): void }): JSX.Element {
  return (
    <>
      <Pick name="thread" label={t('fastener.thread')} value={p.thread} hintText={t('fastener.thread.tip')} options={FASTENER_THREADS.map((v) => ({ value: v, text: t('fastener.thread.' + v) }))} onChange={(v) => p.onThread(v as (typeof FASTENER_THREADS)[number])} />
      {p.thread === 'modeled' ? <Num name="clearance" label={t('fastener.clearance')} unit="mm" step={0.05} min={-CLEARANCE_LIMIT} max={CLEARANCE_LIMIT} value={p.clearance} hintText={t('fastener.clearance.tip')} onChange={p.onClearance} /> : null}
      {p.thread === 'modeled' ? <div class="thread-hint" data-testid="fastener-modeled-note">{t('fastener.modeledNote')}</div> : null}
    </>
  );
}

/** Where the first face sits and which way the part extends. */
function PlaceFields(p: { origin: [number, number, number]; axis: string; axisLabel: string; positionLabel?: string; onOrigin(v: [number, number, number]): void; onAxis(v: (typeof FASTENER_AXES)[number]): void }): JSX.Element {
  const at = (i: 0 | 1 | 2, v: number): void => p.onOrigin(p.origin.map((o, k) => (k === i ? v : o)) as [number, number, number]);
  return (
    <>
      <div class="thread-hint" title={t('fastener.positionTip')}>{p.positionLabel ?? t('fastener.position')}</div>
      <Num name="x" label={t('fastener.x')} unit="mm" step={0.5} value={p.origin[0]} hintText={t('fastener.positionTip')} onChange={(v) => at(0, v)} />
      <Num name="y" label={t('fastener.y')} unit="mm" step={0.5} value={p.origin[1]} hintText={t('fastener.positionTip')} onChange={(v) => at(1, v)} />
      <Num name="z" label={t('fastener.z')} unit="mm" step={0.5} value={p.origin[2]} hintText={t('fastener.positionTip')} onChange={(v) => at(2, v)} />
      <Pick name="axis" label={p.axisLabel} value={p.axis} options={FASTENER_AXES.map((v) => ({ value: v, text: t('fastener.axis.' + v) }))} onChange={(v) => p.onAxis(v as (typeof FASTENER_AXES)[number])} />
    </>
  );
}

export type NutWizardProps = WizardProps<NutParams>;
export function NutWizard(p: NutWizardProps): JSX.Element {
  const w = useWizard(p, nutIssue);
  const { draft, change } = w;
  const s = w.issue ? null : nutSummary(draft);
  // a size the new type has no row for (style 2 below M5) falls to the smallest size of that type
  const setType = (type: NutParams['type']): void => change({ type, size: nutSizeNames(type).includes(draft.size) ? draft.size : nutSizeNames(type)[0] });
  return (
    <Frame id="nut" icon="add-nut" title={t('nut.title')} apply={t('nut.apply')} applyTip={t('nut.applyTip')} issue={w.issue} issueText={w.issue ? (w.issue.code === 'kernel' ? w.issue.message : t('nut.issue.' + w.issue.code, w.issue.params, w.issue.message)) : ''} hint={p.hint} onCancel={p.onCancel} onApply={w.apply} onKey={w.onKey}>
      <Pick name="type" label={t('nut.type')} value={draft.type} options={NUT_TYPES.map((v) => ({ value: v, text: t('nut.type.' + v) }))} onChange={(v) => setType(v as NutParams['type'])} />
      <Pick name="size" label={t('fastener.size')} value={draft.size} options={nutSizeNames(draft.type).map((n) => ({ value: n, text: n }))} onChange={(v) => change({ size: v })} />
      <label class="fedit-fld" data-path="chamfer" title={t('nut.chamferTip')}>
        <span class="fedit-fld-label">{t('nut.chamfer')}</span>
        <input type="checkbox" checked={draft.chamfer} aria-label={t('nut.chamfer')} onChange={(e) => change({ chamfer: (e.currentTarget as HTMLInputElement).checked })} />
      </label>
      <ThreadFields thread={draft.thread} clearance={draft.clearance} onThread={(thread) => change({ thread })} onClearance={(clearance) => change({ clearance })} />
      {s ? <div class="thread-hint" data-testid="nut-summary">{t('nut.summary', { standard: s.standard, s: r2(s.s), e: r2(s.e), m: r2(s.m), bore: r2(s.bore) })}</div> : null}
      <div class="thread-hint" data-testid="nut-unverified"><span class="mat-badge">{t('fastener.unverified')}</span> {t('nut.unverified')}{s?.unverified ? ' ' + t('nut.unverifiedRow') : ''}</div>
      <PlaceFields origin={draft.origin} axis={draft.axis} axisLabel={t('nut.axis')} onOrigin={(origin) => change({ origin })} onAxis={(axis) => change({ axis })} />
    </Frame>
  );
}

export type StandoffWizardProps = WizardProps<StandoffParams>;
export function StandoffWizard(p: StandoffWizardProps): JSX.Element {
  const w = useWizard(p, standoffIssue);
  const { draft, change } = w;
  const s = w.issue ? null : standoffSummary(draft);
  return (
    <Frame id="standoff" icon="add-standoff" title={t('standoff.title')} apply={t('standoff.apply')} applyTip={t('standoff.applyTip')} issue={w.issue} issueText={w.issue ? (w.issue.code === 'kernel' ? w.issue.message : t('standoff.issue.' + w.issue.code, w.issue.params, w.issue.message)) : ''} hint={p.hint} onCancel={p.onCancel} onApply={w.apply} onKey={w.onKey}>
      <Pick name="size" label={t('fastener.size')} value={draft.size} options={STANDOFF_SIZE_NAMES.map((n) => ({ value: n, text: n }))} onChange={(size) => change({ size, ...standoffDefaults(size, draft.kind) })} />
      <Pick name="kind" label={t('standoff.kind')} value={draft.kind} options={STANDOFF_KINDS.map((v) => ({ value: v, text: t('standoff.kind.' + v) }))} onChange={(kind) => change({ kind: kind as StandoffParams['kind'], outer: standoffDefaults(draft.size, kind as StandoffParams['kind']).outer })} />
      <Pick name="ends" label={t('standoff.ends')} value={draft.ends} options={STANDOFF_ENDS.map((v) => ({ value: v, text: t('standoff.ends.' + v) }))} onChange={(ends) => change({ ends: ends as StandoffParams['ends'] })} />
      <Num name="length" label={t('standoff.length')} unit="mm" min={0.1} step={1} value={draft.length} hintText={t('standoff.lengthTip')} onChange={(length) => change({ length })} />
      <Num name="outer" label={draft.kind === 'round' ? t('standoff.outerRound') : t('standoff.outerHex')} unit="mm" min={0.1} step={0.5} value={draft.outer} onChange={(outer) => change({ outer })} />
      <Num name="threadLength" label={t('standoff.threadLength')} unit="mm" min={0.1} step={0.5} value={draft.threadLength} hintText={t('standoff.threadLengthTip')} onChange={(threadLength) => change({ threadLength })} />
      <ThreadFields thread={draft.thread} clearance={draft.clearance} onThread={(thread) => change({ thread })} onClearance={(clearance) => change({ clearance })} />
      {s ? <div class="thread-hint" data-testid="standoff-summary">{t('standoff.summary', { total: r2(s.total), bore: r2(s.bore), volume: Math.round(s.volume) })}</div> : null}
      <div class="thread-hint" data-testid="standoff-unverified"><span class="mat-badge">{t('fastener.unverified')}</span> {t('standoff.unverified')}</div>
      <PlaceFields origin={draft.origin} axis={draft.axis} axisLabel={t('standoff.axis')} onOrigin={(origin) => change({ origin })} onAxis={(axis) => change({ axis })} />
    </Frame>
  );
}

export interface InsertWizardProps extends WizardProps<InsertParams> {
  /** The names of the document's bodies, for the "cut it into" list. */
  bodies?: string[];
}
export function InsertWizard(p: InsertWizardProps): JSX.Element {
  const w = useWizard(p, insertIssue);
  const { draft, change } = w;
  const s = w.issue ? null : insertSummary(draft);
  const bodies = p.bodies ?? [];
  return (
    <Frame id="insert" icon="add-insert" title={t('insert.title')} apply={t('insert.apply')} applyTip={t('insert.applyTip')} issue={w.issue} issueText={w.issue ? (w.issue.code === 'kernel' ? w.issue.message : t('insert.issue.' + w.issue.code, w.issue.params, w.issue.message)) : ''} hint={p.hint} onCancel={p.onCancel} onApply={w.apply} onKey={w.onKey}>
      <Pick name="size" label={t('fastener.size')} value={draft.size} options={INSERT_SIZE_NAMES.map((n) => ({ value: n, text: n }))} onChange={(size) => change({ size, ...insertDefaults(size) })} />
      <Num name="outer" label={t('insert.outer')} unit="mm" min={0.1} step={0.1} value={draft.outer} hintText={t('insert.outerTip')} onChange={(outer) => change({ outer })} />
      <Num name="length" label={t('insert.length')} unit="mm" min={0.1} step={0.1} value={draft.length} onChange={(length) => change({ length })} />
      <Num name="holeDiameter" label={t('insert.holeDiameter')} unit="mm" min={0.1} step={0.1} value={draft.holeDiameter} hintText={t('insert.holeDiameterTip')} onChange={(holeDiameter) => change({ holeDiameter })} />
      <Num name="holeDepth" label={t('insert.holeDepth')} unit="mm" min={0.1} step={0.5} value={draft.holeDepth} hintText={t('insert.holeDepthTip')} onChange={(holeDepth) => change({ holeDepth })} />
      <Num name="rings" label={t('insert.rings')} min={0} max={8} step={1} value={draft.rings} hintText={t('insert.ringsTip')} onChange={(rings) => change({ rings: Math.round(rings) })} />
      <ThreadFields thread={draft.thread} clearance={draft.clearance} onThread={(thread) => change({ thread })} onClearance={(clearance) => change({ clearance })} />
      <label class="fedit-fld" data-path="hole" title={t('insert.holeTip')}>
        <span class="fedit-fld-label">{t('insert.hole')}</span>
        <input type="checkbox" checked={draft.hole} aria-label={t('insert.hole')} onChange={(e) => change({ hole: (e.currentTarget as HTMLInputElement).checked })} />
      </label>
      {draft.hole && bodies.length > 0 ? (
        <Pick name="holeIn" label={t('insert.holeIn')} value={draft.holeIn} options={[{ value: '', text: t('insert.holeIn.all') }, ...bodies.map((b) => ({ value: b, text: b }))]} onChange={(holeIn) => change({ holeIn })} />
      ) : null}
      {s ? <div class="thread-hint" data-testid="insert-summary">{t('insert.summary', { interference: r2(s.interference), bore: r2(s.bore) })}</div> : null}
      {draft.hole ? <div class="thread-hint" data-testid="insert-hole-note">{t('insert.holeNote')}</div> : null}
      <div class="thread-hint" data-testid="insert-unverified"><span class="mat-badge">{t('fastener.unverified')}</span> {t('insert.unverified')}</div>
      <PlaceFields origin={draft.origin} axis={draft.axis} axisLabel={t('insert.axis')} positionLabel={t('insert.position')} onOrigin={(origin) => change({ origin })} onAxis={(axis) => change({ axis })} />
    </Frame>
  );
}
