// The Washer wizard: one panel over the washer() helper of the Script tab. Flat or spring, a size from the standard tables (filterable) or your own numbers, where the
// first face centre sits and which way the thickness extends. Every change goes to onDraft with the whole record (the app previews it live in the viewport, debounced
// by the controller); Add washer commits the features as one tree folder, Escape / the cross cancels. Rules: washer.ts, sizes: washerSizes.ts.
// "Washer on this hole": the app reads the picked hole (washerHole.ts) and hands the result in as `picked`; the wizard then takes the standard size whose clearance
// hole the hole contains and places the washer coaxial on the face the hole opens on. The size, the end of a through hole and the offset stay editable.
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '@kit/ui';
import { t } from './i18n';
import { SizePicker, type SizeMode } from './SizePicker';
import { holePlacement, washerIssue, washerOnHole, WASHER_AXES, WASHER_KINDS, type WasherParams } from './washer';
import { findWasherSize, WASHER_SIZES, washerLabel, washerSizesOf, type HoleSize } from './washerSizes';
import type { HoleResult } from './washerHole';

export interface WasherWizardProps {
  params: WasherParams;
  onDraft(next: WasherParams): void;
  onApply(next: WasherParams): void;
  onCancel(): void;
  /** The live preview's failure, or null when it is current. */
  hint?: string | null;
  /** A hole the user just picked on the part (read by washerHole.ts); `id` changes with every pick so the same hole can be picked again. */
  picked?: { id: number; result: HoleResult } | null;
  /** Ask the app to wait for a click on a hole (face pick mode). */
  onPickHole?(): void;
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

export function WasherWizard(p: WasherWizardProps): JSX.Element {
  const [draft, setDraft] = useState<WasherParams>(p.params);
  const [mode, setMode] = useState<SizeMode>(findWasherSize(p.params.kind, p.params.inner, p.params.outer, p.params.thickness) ? 'standard' : 'custom');
  useEffect(() => { p.onDraft(draft); }, []);
  /** how the size was read off the hole, and why a pick was refused */
  const [read, setRead] = useState<{ size: HoleSize | null } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const hole = draft.hole ?? null;
  const issue = washerIssue(draft);
  const change = (patch: Partial<WasherParams>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (!washerIssue(next)) p.onDraft(next);
  };
  /** editing a size number leaves the standard list */
  const edit = (patch: Partial<WasherParams>): void => { setMode('custom'); setRead(null); change(patch); };
  const apply = (): void => { if (!issue) p.onApply(draft); };
  useEffect(() => {
    const pk = p.picked;
    if (!pk) return;
    if (!pk.result.ok) { setRefusal(pk.result.reason); return; }
    setRefusal(null);
    const on = washerOnHole(draft, pk.result.hole, draft.offset ?? 0);
    setRead({ size: on.size });
    setMode(on.size ? 'standard' : 'custom');
    change(on.params);
  }, [p.picked?.id]);
  /** editing the placement by hand leaves the hole */
  const free = (patch: Partial<WasherParams>): void => { setRead(null); change({ ...patch, hole: null }); };
  const withOffset = (offset: number): void => { if (hole) change({ offset, ...holePlacement(hole, offset) }); };
  const otherSeat = (): void => {
    if (!hole || hole.seats.length < 2) return;
    const next = { ...hole, seat: (hole.seat + 1) % hole.seats.length };
    change({ hole: next, ...holePlacement(next, draft.offset ?? 0) });
  };
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && tag !== 'SELECT' && tag !== 'BUTTON' && tag !== 'INPUT') { e.preventDefault(); apply(); }
    if (e.key === 'Enter' && tag === 'INPUT' && (e.target as HTMLInputElement).type === 'number') { e.preventDefault(); apply(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };
  const at = (i: 0 | 1 | 2, v: number): void => free({ origin: draft.origin.map((o, k) => (k === i ? v : o)) as WasherParams['origin'] });
  const sizes = washerSizesOf(draft.kind);
  const rows = sizes.map((w) => ({ id: w.id, label: washerLabel(w) }));
  const current = findWasherSize(draft.kind, draft.inner, draft.outer, draft.thickness);
  const pick = (id: string): void => {
    const w = WASHER_SIZES.find((x) => x.id === id);
    if (w) { setMode('standard'); setRead(null); change({ inner: w.inner, outer: w.outer, thickness: w.thickness, gap: w.thickness }); }
  };
  const setKind = (kind: WasherParams['kind']): void => {
    if (kind === draft.kind) return;
    // in the standard list keep the same nominal size where the other kind has it, else the M8 row
    const was = current?.size ?? 'M8';
    const w = washerSizesOf(kind).find((x) => x.size === was) ?? washerSizesOf(kind).find((x) => x.size === 'M8') ?? washerSizesOf(kind)[0];
    if (hole && mode === 'standard') { const on = washerOnHole({ ...draft, kind }, hole, draft.offset ?? 0); setRead({ size: on.size }); change(on.params); }
    else if (mode === 'standard' && w) change({ kind, inner: w.inner, outer: w.outer, thickness: w.thickness, gap: w.thickness });
    else change({ kind });
  };
  return (
    <div class="fedit thread-editor prop-wizard washer-wizard" tabIndex={0} onKeyDown={onKey} data-testid="washer-wizard">
      <div class="fedit-head">
        <Icon name="add-washer" size={22} class="fedit-icon" />
        <div class="fedit-title">{t('washer.title')}</div>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>
      <div class="fedit-sec-fields prop-body">
        <label class="fedit-fld" data-path="kind">
          <span class="fedit-fld-label">{t('washer.kind')}</span>
          <select value={draft.kind} aria-label={t('washer.kind')} onChange={(e) => setKind((e.currentTarget as HTMLSelectElement).value as WasherParams['kind'])}>
            {WASHER_KINDS.map((k) => <option key={k} value={k}>{t('washer.kind.' + k)}</option>)}
          </select>
        </label>
        {p.onPickHole ? (
          <div class="washer-hole" data-testid="washer-hole">
            <button type="button" class="fedit-card-btn" data-testid="washer-pick-hole" title={t('washer.hole.pickTip')} onClick={p.onPickHole}>{t('washer.hole.pick')}</button>
            {refusal ? <div class="thread-fit bad" role="alert" data-testid="washer-hole-refused" data-reason={refusal}>{t('washer.hole.refused.' + refusal)}</div> : null}
            {hole ? (
              <div class="thread-hint" data-testid="washer-hole-read">
                <div>{t('washer.hole.read', { d: +hole.diameter.toFixed(3), face: hole.seats[hole.seat]?.face ?? '' })}</div>
                {read?.size ? <div data-testid="washer-hole-size" data-fit={read.size.fit}>{read.size.fit === 'contains'
                  ? t('washer.hole.matched', { size: read.size.size.size, standard: read.size.size.standard, clearance: read.size.clearance })
                  : t('washer.hole.nearest', { size: read.size.size.size, standard: read.size.size.standard, clearance: read.size.clearance })}</div> : null}
                {hole.counterbore ? <div data-testid="washer-hole-cbore">{t('washer.hole.cbore')}</div> : null}
                {hole.blind ? <div>{t('washer.hole.blind')}</div> : null}
                {hole.seats.length > 1 ? <button type="button" class="fedit-card-btn" data-testid="washer-hole-other" onClick={otherSeat}>{t('washer.hole.other')}</button> : null}
              </div>
            ) : <div class="thread-hint">{t('washer.hole.none')}</div>}
          </div>
        ) : null}
        <SizePicker rows={rows} mode={mode} onMode={setMode} selectedId={current?.id ?? null} onPick={pick} testId="washer-size"
          standardLabel={t('washer.standard')} customLabel={t('washer.custom')} filterPlaceholder={t('washer.filter')} emptyText={t('washer.noMatch')} />
        <Num name="inner" label={t('washer.inner')} unit="mm" min={0.1} step={0.1} value={draft.inner} hintText={t('washer.innerTip')} onChange={(v) => edit({ inner: v })} />
        <Num name="outer" label={t('washer.outer')} unit="mm" min={0.1} step={0.5} value={draft.outer} onChange={(v) => edit({ outer: v })} />
        <Num name="thickness" label={t('washer.thickness')} unit="mm" min={0.05} step={0.1} value={draft.thickness} onChange={(v) => edit({ thickness: v })} />
        {draft.kind === 'spring' ? (
          <>
            <Num name="gap" label={t('washer.gap')} unit="mm" min={0.05} step={0.1} value={draft.gap} hintText={t('washer.gapTip')} onChange={(v) => change({ gap: v })} />
            <div class="thread-hint" data-testid="washer-flat-note">{t('washer.noLift')}</div>
          </>
        ) : null}
        <div class="thread-hint" title={t('washer.positionTip')}>{t('washer.position')}</div>
        {hole ? <Num name="offset" label={t('washer.offset')} unit="mm" step={0.1} value={draft.offset ?? 0} hintText={t('washer.offsetTip')} onChange={withOffset} /> : null}
        <Num name="x" label={t('washer.x')} unit="mm" step={0.5} value={draft.origin[0]} hintText={t('washer.positionTip')} onChange={(v) => at(0, v)} />
        <Num name="y" label={t('washer.y')} unit="mm" step={0.5} value={draft.origin[1]} hintText={t('washer.positionTip')} onChange={(v) => at(1, v)} />
        <Num name="z" label={t('washer.z')} unit="mm" step={0.5} value={draft.origin[2]} hintText={t('washer.positionTip')} onChange={(v) => at(2, v)} />
        <label class="fedit-fld" data-path="axis">
          <span class="fedit-fld-label">{t('washer.axis')}</span>
          <select value={draft.axis} aria-label={t('washer.axis')} onChange={(e) => free({ axis: (e.currentTarget as HTMLSelectElement).value as WasherParams['axis'] })}>
            {WASHER_AXES.map((v) => <option key={v} value={v}>{t('washer.axis.' + v)}</option>)}
          </select>
        </label>
        {issue ? <div class="thread-fit bad" role="alert" data-issue={issue.code}>{issue.code === 'kernel' ? issue.message : t('washer.issue.' + issue.code, issue.params, issue.message)}</div> : null}
        {p.hint ? <div class="fedit-hint" role="alert" data-testid="washer-hint">{p.hint}</div> : null}
      </div>
      <div class="prop-nav">
        <button type="button" class="fedit-card-btn" data-testid="washer-cancel" onClick={p.onCancel}>{t('ui.cancel', undefined, 'Cancel')}</button>
        <button type="button" class="fedit-card-btn prop-create" data-testid="washer-apply" disabled={!!issue} aria-disabled={!!issue} title={issue ? t('washer.blockedTip') : t('washer.applyTip')} onClick={apply}>{t('washer.apply')}</button>
      </div>
    </div>
  );
}
