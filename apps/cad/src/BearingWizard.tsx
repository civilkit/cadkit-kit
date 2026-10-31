// The Bearing wizard: one panel over the bearing() helper of the Script tab. Pick a size from the ISO 15 table (search by designation: 608, 6204, MR63) or
// type bore, outer diameter and width; seal type, chamfer, balls of an open bearing, where the first face sits and which way the bearing extends. A read-out
// gives the housing seat (diameter and depth with the fit allowance) and, when the wizard was opened on a flat face, a box cuts that pocket. Every change goes
// to onDraft with the whole record (the app previews it live, debounced by the controller); Add bearing commits the features, Escape / the cross cancels.
// Rules: bearing.ts.
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '@kit/ui';
import { t } from './i18n';
import { bearingIssue, bearingNumbers, bearingSeat, BEARING_AXES, BEARING_SEALS, findBearings, SEAT_FITS, withPreset, type BearingParams } from './bearing';
import { bearingPreset } from '@kit/script';

export interface BearingWizardProps {
  params: BearingParams;
  onDraft(next: BearingParams): void;
  onApply(next: BearingParams): void;
  onCancel(): void;
  /** The live preview's failure, or null when it is current. */
  hint?: string | null;
}

const fmt = (v: number): string => String(Math.round(v * 1000) / 1000);
const sealKey = (s: string): string => (s === 'open' ? 'open' : s === '2Z' ? 'shield' : 'seal');

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

export function BearingWizard(p: BearingWizardProps): JSX.Element {
  const [draft, setDraft] = useState<BearingParams>(p.params);
  const [search, setSearch] = useState<string>('');   // empty: the list shows every size, the current one selected
  useEffect(() => { p.onDraft(draft); }, []);
  const issue = bearingIssue(draft);
  const change = (patch: Partial<BearingParams>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (!bearingIssue(next)) p.onDraft(next);
  };
  const apply = (): void => { if (!issue) p.onApply(draft); };
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && tag !== 'SELECT' && tag !== 'BUTTON' && tag !== 'TEXTAREA') { e.preventDefault(); apply(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };
  // typing a whole designation (608, 6204-2RS, mr63zz) picks it; anything shorter only narrows the list
  const onSearch = (q: string): void => {
    setSearch(q);
    const hit = bearingPreset(q);
    if (hit) { const next = withPreset(draft, hit.preset, hit.seal); setDraft(next); if (!bearingIssue(next)) p.onDraft(next); }
  };
  const matches = findBearings(search);
  const size = (patch: Partial<Pick<BearingParams, 'bore' | 'od' | 'width'>>): void => change({ ...patch, designation: '', balls: null, ballDiameter: null });
  const at = (i: 0 | 1 | 2, v: number): void => change({ origin: draft.origin.map((o, k) => (k === i ? v : o)) as BearingParams['origin'] });
  const num = bearingNumbers(draft);
  const seat = bearingSeat(draft);
  const sel = <K extends 'seal' | 'axis' | 'seatFit'>(key: K, label: string, values: readonly string[], text: (v: string) => string, onPick: (v: string) => void): JSX.Element => (
    <label class="fedit-fld" data-path={key}>
      <span class="fedit-fld-label">{label}</span>
      <select value={draft[key]} aria-label={label} onChange={(e) => onPick((e.currentTarget as HTMLSelectElement).value)}>
        {values.map((v) => <option key={v} value={v}>{text(v)}</option>)}
      </select>
    </label>
  );
  return (
    <div class="fedit thread-editor prop-wizard bearing-wizard" tabIndex={0} onKeyDown={onKey} data-testid="bearing-wizard">
      <div class="fedit-head">
        <Icon name="add-bearing" size={22} class="fedit-icon" />
        <div class="fedit-title">{t('bearing.title')}</div>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>
      <div class="fedit-sec-fields prop-body">
        <label class="fedit-fld" data-path="search">
          <span class="fedit-fld-label">{t('bearing.search')}</span>
          <input type="search" value={search} placeholder={t('bearing.searchHint')} aria-label={t('bearing.search')} title={t('bearing.searchTip')} onInput={(e) => onSearch((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <label class="fedit-fld" data-path="preset">
          <span class="fedit-fld-label">{t('bearing.preset')}</span>
          <select size={6} value={draft.designation} aria-label={t('bearing.preset')} onChange={(e) => {
            const hit = bearingPreset((e.currentTarget as HTMLSelectElement).value);
            if (hit) change(withPreset(draft, hit.preset));
          }}>
            {matches.length ? matches.map((m) => <option key={m.designation} value={m.designation}>{`${m.designation}  ${fmt(m.bore)} x ${fmt(m.od)} x ${fmt(m.width)}`}</option>)
              : <option value="" disabled>{t('bearing.noMatch')}</option>}
          </select>
        </label>
        <div class="thread-hint" data-testid="bearing-nominal">{draft.designation ? t('bearing.nominal', { name: draft.designation }) : t('bearing.custom')}</div>
        <Num name="bore" label={t('bearing.bore')} unit="mm" min={0.1} step={0.5} value={draft.bore} onChange={(v) => size({ bore: v })} />
        <Num name="od" label={t('bearing.od')} unit="mm" min={0.2} step={0.5} value={draft.od} onChange={(v) => size({ od: v })} />
        <Num name="width" label={t('bearing.width')} unit="mm" min={0.1} step={0.5} value={draft.width} onChange={(v) => size({ width: v })} />
        {sel('seal', t('bearing.seal'), BEARING_SEALS, (v) => t('bearing.seal.' + sealKey(v)), (v) => change({ seal: v as BearingParams['seal'], balls: null, ballDiameter: null }))}
        <Num name="chamfer" label={t('bearing.chamfer')} unit="mm" min={0} step={0.05} value={draft.chamfer ?? num?.chamfer ?? 0} hintText={t('bearing.chamferTip')} onChange={(v) => change({ chamfer: v })} />
        {draft.seal === 'open' ? (
          <>
            <Num name="balls" label={t('bearing.balls')} min={3} step={1} value={draft.balls ?? num?.balls ?? 0} hintText={t('bearing.ballsTip')} onChange={(v) => change({ balls: Math.round(v) })} />
            <Num name="ballDiameter" label={t('bearing.ballDiameter')} unit="mm" min={0.1} step={0.1} value={draft.ballDiameter !== null ? draft.ballDiameter : num ? Math.round(num.ballDiameter * 1000) / 1000 : 0} hintText={t('bearing.ballDiameterTip')} onChange={(v) => change({ ballDiameter: v })} />
          </>
        ) : null}
        <div class="thread-hint" data-testid="bearing-approx">{t('bearing.approx')}</div>
        <div class="thread-hint" title={t('bearing.positionTip')}>{t('bearing.position')}</div>
        <Num name="x" label={t('bearing.x')} unit="mm" step={0.5} value={draft.origin[0]} hintText={t('bearing.positionTip')} onChange={(v) => at(0, v)} />
        <Num name="y" label={t('bearing.y')} unit="mm" step={0.5} value={draft.origin[1]} hintText={t('bearing.positionTip')} onChange={(v) => at(1, v)} />
        <Num name="z" label={t('bearing.z')} unit="mm" step={0.5} value={draft.origin[2]} hintText={t('bearing.positionTip')} onChange={(v) => at(2, v)} />
        {sel('axis', t('bearing.axis'), BEARING_AXES, (v) => t('bearing.axis.' + v), (v) => change({ axis: v as BearingParams['axis'] }))}
        <div class="thread-hint">{t('bearing.seat.title')}</div>
        {sel('seatFit', t('bearing.seat.fit'), SEAT_FITS, (v) => t('bearing.fit.' + v), (v) => change({ seatFit: v as BearingParams['seatFit'] }))}
        <div class="thread-hint" data-testid="bearing-seat" title={t('bearing.seat.tip')}>{t('bearing.seat.readout', { d: fmt(seat.diameter), depth: fmt(seat.depth), note: seat.note })}</div>
        <label class="fedit-fld bearing-cut-seat" data-path="seat" title={draft.placedOn ? t('bearing.seat.cutTip') : t('bearing.seat.needFace')}>
          <span class="fedit-fld-label">{t('bearing.seat.cut')}</span>
          <input type="checkbox" checked={draft.seat && !!draft.placedOn} disabled={!draft.placedOn} aria-label={t('bearing.seat.cut')} onChange={(e) => change({ seat: (e.currentTarget as HTMLInputElement).checked })} />
        </label>
        {draft.placedOn ? null : <div class="thread-hint" data-testid="bearing-seat-note">{t('bearing.seat.needFace')}</div>}
        {issue ? <div class="thread-fit bad" role="alert" data-issue={issue.code}>{issue.code === 'model' ? issue.message : t('bearing.issue.' + issue.code, issue.params, issue.message)}</div> : null}
        {p.hint ? <div class="fedit-hint" role="alert" data-testid="bearing-hint">{p.hint}</div> : null}
      </div>
      <div class="prop-nav">
        <button type="button" class="fedit-card-btn" data-testid="bearing-cancel" onClick={p.onCancel}>{t('ui.cancel', undefined, 'Cancel')}</button>
        <button type="button" class="fedit-card-btn prop-create" data-testid="bearing-apply" disabled={!!issue} aria-disabled={!!issue} title={issue ? t('bearing.blockedTip') : t('bearing.applyTip')} onClick={apply}>{t('bearing.apply')}</button>
      </div>
    </div>
  );
}
