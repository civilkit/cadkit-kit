// The Tray wizard: one panel over the gridTray() helper of the Script tab. Size in grid units (or the inside size of a drawer, which says how many units it takes and can fill the
// length), the scoop radius, the end walls, wall and floor, magnet holes, the printer bed (the part is checked against it) and where the tray stands. Every change goes to onDraft with
// the whole record (the app previews it live in the viewport, debounced by the controller); Add tray commits the features as one tree folder, Escape / the cross cancels. Rules: tray.ts.
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon , ProblemSlot, PanelHint } from '@kit/ui';
import { t } from './i18n';
import { PRINTERS, TRAY_ENDS, TRAY_KINDS, drawerFit, fillDrawerLength, trayIssue, traySummary, withChange, type TrayParams } from './tray';

export interface TrayWizardProps {
  params: TrayParams;
  /** The document already holds features: the new tray is kept apart from them (shown as a note). */
  hasOthers?: boolean;
  onDraft(next: TrayParams): void;
  onApply(next: TrayParams): void;
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

export function TrayWizard(p: TrayWizardProps): JSX.Element {
  const [draft, setDraft] = useState<TrayParams>(p.params);
  useEffect(() => { p.onDraft(draft); }, []);
  const issue = trayIssue(draft);
  const change = (patch: Partial<TrayParams>): void => {
    const next = withChange(draft, patch);
    setDraft(next);
    if (!trayIssue(next)) p.onDraft(next);
  };
  const apply = (): void => { if (!issue) p.onApply(draft); };
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && tag !== 'SELECT' && tag !== 'BUTTON' && tag !== 'INPUT') { e.preventDefault(); apply(); }
    if (e.key === 'Enter' && tag === 'INPUT' && (e.target as HTMLInputElement).type === 'number') { e.preventDefault(); apply(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };
  const at = (i: 0 | 1 | 2, v: number): void => change({ origin: draft.origin.map((o, k) => (k === i ? v : o)) as TrayParams['origin'] });
  const isTray = draft.kind === 'tray';
  const s = issue ? null : traySummary(draft);
  const fit = drawerFit(draft);
  const filled = fillDrawerLength(draft);
  const canFill = !!fit && (filled.lengthUnits !== draft.lengthUnits || filled.heightUnits !== draft.heightUnits);
  return (
    <div class="fedit thread-editor prop-wizard tray-wizard" tabIndex={0} onKeyDown={onKey} data-testid="tray-wizard">
      <div class="fedit-head">
        <Icon name="add-tray" size={22} class="fedit-icon" />
        <div class="fedit-title">{t('tray.title')}</div>
        <ProblemSlot />
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>
      <div class="fedit-sec-fields prop-body">
        <label class="fedit-fld" data-path="kind">
          <span class="fedit-fld-label">{t('tray.kind')}</span>
          <select value={draft.kind} aria-label={t('tray.kind')} title={t('tray.kindTip')} onChange={(e) => change({ kind: (e.currentTarget as HTMLSelectElement).value as TrayParams['kind'] })}>
            {TRAY_KINDS.map((v) => <option key={v} value={v}>{t('tray.kind.' + v)}</option>)}
          </select>
        </label>
        <div class="thread-hint">{t('tray.size')}</div>
        <Num name="widthUnits" label={t('tray.widthUnits')} min={0.5} step={0.5} value={draft.widthUnits} hintText={t('tray.unitsTip')} onChange={(v) => change({ widthUnits: v })} />
        <Num name="lengthUnits" label={t('tray.lengthUnits')} min={0.5} step={0.5} value={draft.lengthUnits} hintText={t('tray.unitsTip')} onChange={(v) => change({ lengthUnits: v })} />
        {isTray ? (
        <Num name="heightUnits" label={t('tray.heightUnits')} min={1} step={1} value={draft.heightUnits} hintText={t('tray.heightTip')} onChange={(v) => change({ heightUnits: v })} />
        ) : null}
        {isTray ? (
        <Num name="scoopRadius" label={t('tray.scoopRadius')} unit="mm" min={0} step={0.5} value={draft.scoopRadius} hintText={t('tray.scoopRadiusTip')} onChange={(v) => change({ scoopRadius: v })} />
        ) : null}
        {isTray ? (
        <>
        <label class="fedit-fld" data-path="endWalls">
          <span class="fedit-fld-label">{t('tray.endWalls')}</span>
          <select value={draft.endWalls} aria-label={t('tray.endWalls')} title={t('tray.endWallsTip')} onChange={(e) => change({ endWalls: (e.currentTarget as HTMLSelectElement).value as TrayParams['endWalls'] })}>
            {TRAY_ENDS.map((v) => <option key={v} value={v}>{t('tray.endWalls.' + v)}</option>)}
          </select>
        </label>
        </>
        ) : null}
        {isTray ? (
        <Num name="wall" label={t('tray.wall')} unit="mm" min={0.4} step={0.2} value={draft.wall} hintText={t('tray.wallTip')} onChange={(v) => change({ wall: v })} />
        ) : null}
        {isTray ? (
        <Num name="floor" label={t('tray.floor')} unit="mm" min={0.4} step={0.2} value={draft.floor} hintText={t('tray.floorTip')} onChange={(v) => change({ floor: v })} />
        ) : null}
        {!isTray ? <Num name="base" label={t('tray.base')} unit="mm" min={0.4} step={0.2} value={draft.base} hintText={t('tray.baseTip')} onChange={(v) => change({ base: v })} /> : null}
        {!isTray ? (
          <label class="fedit-fld" data-path="split">
            <span class="fedit-fld-label">{t('tray.split')}</span>
            <input type="checkbox" checked={draft.split} aria-label={t('tray.split')} title={t('tray.splitTip')} onChange={(e) => change({ split: (e.currentTarget as HTMLInputElement).checked })} />
          </label>
        ) : null}
        {!isTray ? <Num name="clearance" label={t('tray.clearance')} unit="mm" min={0} max={0.5} step={0.05} value={draft.clearance} hintText={t('tray.clearanceTip')} onChange={(v) => change({ clearance: v })} /> : null}
        <Num name="cornerRadius" label={t('tray.cornerRadius')} unit="mm" min={0} step={0.25} value={draft.cornerRadius} hintText={t('tray.cornerRadiusTip')} onChange={(v) => change({ cornerRadius: v })} />
        {isTray ? (
        <>
        <label class="fedit-fld" data-path="foot">
          <span class="fedit-fld-label">{t('tray.foot')}</span>
          <input type="checkbox" checked={draft.foot} aria-label={t('tray.foot')} title={t('tray.footTip')} onChange={(e) => change({ foot: (e.currentTarget as HTMLInputElement).checked })} />
        </label>
        </>
        ) : null}
        {isTray ? (
        <>
        <label class="fedit-fld" data-path="magnets">
          <span class="fedit-fld-label">{t('tray.magnets')}</span>
          <input type="checkbox" checked={draft.magnets} aria-label={t('tray.magnets')} title={t('tray.magnetsTip')} onChange={(e) => change({ magnets: (e.currentTarget as HTMLInputElement).checked })} />
        </label>
        </>
        ) : null}

        <div class="thread-hint">{t('tray.drawer')}</div>
        <Num name="drawerWidth" label={t('tray.drawerWidth')} unit="mm" min={0} step={1} value={draft.drawerWidth} hintText={t('tray.drawerTip')} onChange={(v) => change({ drawerWidth: v })} />
        <Num name="drawerDepth" label={t('tray.drawerDepth')} unit="mm" min={0} step={1} value={draft.drawerDepth} hintText={t('tray.drawerTip')} onChange={(v) => change({ drawerDepth: v })} />
        <Num name="drawerHeight" label={t('tray.drawerHeight')} unit="mm" min={0} step={1} value={draft.drawerHeight} hintText={t('tray.drawerTip')} onChange={(v) => change({ drawerHeight: v })} />
        <label class="fedit-fld" data-path="halfUnits">
          <span class="fedit-fld-label">{t('tray.halfUnits')}</span>
          <input type="checkbox" checked={draft.halfUnits} aria-label={t('tray.halfUnits')} onChange={(e) => change({ halfUnits: (e.currentTarget as HTMLInputElement).checked })} />
        </label>
        {fit ? (
          <div class="thread-hint" data-testid="tray-fit">
            {t('tray.fit', {
              widthUnits: fit.widthUnits, lengthUnits: fit.lengthUnits, leftWidth: fit.leftWidth, leftDepth: fit.leftDepth,
              height: fit.heightUnits > 0 ? t('tray.fitHeight', { heightUnits: fit.heightUnits }) : '', leftHeight: fit.heightUnits > 0 ? t('tray.fitLeftHeight', { leftHeight: fit.leftHeight }) : '',
            })}
          </div>
        ) : null}
        {fit ? <button type="button" class="fedit-card-btn" data-testid="tray-fill" disabled={!canFill} title={t('tray.fillLengthTip')} onClick={() => change({ lengthUnits: filled.lengthUnits, heightUnits: filled.heightUnits })}>{t('tray.fillLength')}</button> : null}
        {s && s.fitsDrawer !== null ? <div class={'thread-hint' + (s.fitsDrawer ? '' : ' bad')} data-testid="tray-fits">{t(s.fitsDrawer ? 'tray.fitsYes' : 'tray.fitsNo')}</div> : null}

        <label class="fedit-fld" data-path="printer">
          <span class="fedit-fld-label">{t('tray.printer')}</span>
          <select value={draft.printer} aria-label={t('tray.printer')} onChange={(e) => change({ printer: (e.currentTarget as HTMLSelectElement).value as TrayParams['printer'] })}>
            {PRINTERS.map((x) => <option key={x.id} value={x.id}>{x.id === 'custom' ? t('tray.printer.custom', undefined, x.name) : `${x.name} (${x.bed} mm)`}</option>)}
          </select>
        </label>
        <Num name="bed" label={t('tray.bed')} unit="mm" min={0} step={1} value={draft.bed} hintText={t('tray.bedTip')} onChange={(v) => change({ bed: v })} />
        {s && !isTray && s.pieces > 1 ? <div class="thread-hint" data-testid="tray-pieces">{t('tray.pieces', { pieces: s.pieces, pieceWidth: s.pieceWidth, pieceLength: s.pieceLength })}</div> : null}
        {s && draft.bed > 0 ? <div class={'thread-hint' + (s.tooLong ? ' bad' : '')} data-testid="tray-bed">{t(s.tooLong ? 'tray.bedTooLong' : 'tray.bedFits', { longest: s.longest, bed: draft.bed })}</div> : null}

        <div class="thread-hint">{t('tray.grid')}</div>
        <Num name="pitch" label={t('tray.pitch')} unit="mm" min={1} step={1} value={draft.pitch} onChange={(v) => change({ pitch: v })} />
        {isTray ? (
        <Num name="unitHeight" label={t('tray.unitHeight')} unit="mm" min={0.5} step={0.5} value={draft.unitHeight} onChange={(v) => change({ unitHeight: v })} />
        ) : null}
        {isTray ? (
        <Num name="tolerance" label={t('tray.tolerance')} unit="mm" min={0} step={0.1} value={draft.tolerance} hintText={t('tray.toleranceTip')} onChange={(v) => change({ tolerance: v })} />
        ) : null}
        <label class="fedit-fld" data-path="name">
          <span class="fedit-fld-label">{t('tray.name')}</span>
          <input type="text" value={draft.name} aria-label={t('tray.name')} onInput={(e) => change({ name: (e.currentTarget as HTMLInputElement).value })} />
        </label>
        {s ? <div class="thread-hint" data-testid="tray-summary">{!isTray ? t('tray.summaryPlate', { width: s.width, length: s.length, height: s.height }) : t('tray.summary', { width: s.width, length: s.length, height: s.height, inner: s.inner, depth: s.depth, volume: s.volume })}</div> : null}
        {isTray ? <div class="thread-hint" data-testid="tray-not-included">{t('tray.notIncluded')}</div> : null}
        {p.hasOthers ? <div class="thread-hint" data-testid="tray-others">{t('tray.otherBodies')}</div> : null}
        <div class="thread-hint" title={t('tray.positionTip')}>{t('tray.position')}</div>
        <Num name="x" label={t('tray.x')} unit="mm" step={0.5} value={draft.origin[0]} hintText={t('tray.positionTip')} onChange={(v) => at(0, v)} />
        <Num name="y" label={t('tray.y')} unit="mm" step={0.5} value={draft.origin[1]} hintText={t('tray.positionTip')} onChange={(v) => at(1, v)} />
        <Num name="z" label={t('tray.z')} unit="mm" step={0.5} value={draft.origin[2]} hintText={t('tray.positionTip')} onChange={(v) => at(2, v)} />
        {issue ? <div class="thread-fit bad" role="alert" data-issue={issue.code}>{issue.code === 'kernel' ? issue.message : t('tray.issue.' + issue.code, issue.params, issue.message)}</div> : null}
        <PanelHint hint={p.hint} testid="tray-hint" />
      </div>
      <div class="prop-nav">
        <button type="button" class="fedit-card-btn" data-testid="tray-cancel" onClick={p.onCancel}>{t('ui.cancel', undefined, 'Cancel')}</button>
        <button type="button" class="fedit-card-btn prop-create" data-testid="tray-apply" disabled={!!issue} aria-disabled={!!issue} title={issue ? t('tray.blockedTip') : t('tray.applyTip')} onClick={apply}>{t('tray.apply')}</button>
      </div>
    </div>
  );
}
