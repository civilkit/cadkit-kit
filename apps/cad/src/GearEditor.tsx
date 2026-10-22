// The Gear editor: type (spur, ring, helical, herringbone, rack), size (module or diametral pitch, teeth, pressure angle, face width), shaft and hub, tooth form
// (addendum, dedendum, root fillet, backlash, profile shift), an optional mating gear and the readout (diameters, contact ratio, minimum teeth). Same
// draft protocol as the other editors: every change goes to onDraft with the whole parameter record, Enter / the tick confirm, Escape / the cross cancel.
// The features are regenerated from the record by gearData.gearOps (see docs/gears.md).
import { useRef, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { Icon } from '@kit/ui';
import { t } from './i18n';
import { GEAR_TYPES, centreDistance, gearGeom, gearModule, gearReadout, keySize, type GearParams, type GearType } from './gearData';
import { Seg } from './ThreadEditor';

export interface GearEditorProps {
  params: GearParams | null;
  name?: string;
  onDraft(next: GearParams): void;
  onConfirm(next: GearParams): void;
  onCancel(): void;
  hint?: string | null;
}

const fmt = (v: number, d = 3): string => String(Math.round(v * 10 ** d) / 10 ** d);

function Section(p: { id: string; title: string; children: ComponentChildren }): JSX.Element {
  const [closed, setClosed] = useState(false);
  return (
    <div class={'fedit-sec' + (closed ? ' closed' : '')} data-section={p.id}>
      <div class="fedit-sec-head" role="button" tabIndex={0} aria-expanded={!closed} onClick={() => setClosed(!closed)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setClosed(!closed); } }}>
        <span class="fedit-sec-title">{p.title}</span>
        <Icon name="chevron" size={14} class="fedit-chev" />
      </div>
      {closed ? null : <div class="fedit-sec-fields">{p.children}</div>}
    </div>
  );
}

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

function Check(p: { name: string; label: string; value: boolean; onChange(v: boolean): void }): JSX.Element {
  return (
    <label class="fedit-fld bool" data-path={p.name}>
      <input type="checkbox" checked={p.value} onChange={(e) => p.onChange((e.currentTarget as HTMLInputElement).checked)} />
      <span class="fedit-fld-label">{p.label}</span>
    </label>
  );
}

export function GearEditor(p: GearEditorProps): JSX.Element {
  const [draft, setDraft] = useState<GearParams | null>(p.params);
  const root = useRef<HTMLDivElement>(null);
  if (!draft) return <div class="fedit empty"><div class="fedit-hint">{t('ui.editor.empty', undefined, 'No feature selected.')}</div></div>;
  const change = (patch: Partial<GearParams>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    p.onDraft(next);
  };
  const confirm = (): void => p.onConfirm(draft);
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && tag !== 'SELECT' && tag !== 'BUTTON') { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };
  const g = gearGeom(draft);
  const ro = gearReadout(draft);
  const rack = draft.type === 'rack';
  const ring = draft.type === 'internal';
  const helical = draft.type === 'helical';
  const hb = draft.type === 'herringbone';
  const helish = helical || hb;
  const canMate = draft.type === 'spur' || helical || hb;
  const mate = canMate ? draft.mate : undefined;
  const setType = (type: GearType): void => {
    const patch: Partial<GearParams> = { type };
    if (type === 'rack' || type === 'internal') patch.mate = undefined;
    if (type === 'rack' && draft.teeth > 30) patch.teeth = 10;
    if (type === 'internal' && draft.teeth < 24) patch.teeth = 40;
    if (type === 'helical' && !(draft.helixAngle > 0)) patch.helixAngle = 15;
    if (type === 'herringbone') {
      // the catalogue default for a herringbone is 30 degrees (the helical default of 15 counts as untouched), and the groove starts at about 3 modules
      if (!(draft.helixAngle > 15 && draft.helixAngle <= 45)) patch.helixAngle = 30;
      if (!(draft.grooveWidth > 0)) patch.grooveWidth = Math.round(3 * gearModule(draft) * 1000) / 1000;
    }
    change(patch);
  };
  const warn = (code: string): string => t('gear.warn.' + code, { z: String(ro.minTeeth), x: fmt(ro.minShift, 2), a: fmt(draft.helixAngle) });
  const key = keySize(draft.boreDia);
  const title = t('gear.title') + (p.name ? ` — ${p.name}` : '');
  const hasBore = !rack;

  return (
    <div class="fedit thread-editor gear-editor" ref={root} tabIndex={0} onKeyDown={onKey} data-testid="gear-editor">
      <div class="fedit-head">
        <Icon name="add-gear" size={22} class="fedit-icon" />
        <div class="fedit-title">{title}</div>
        <button type="button" class="fedit-confirm" onClick={confirm} title={t('ui.editor.confirm', undefined, 'Confirm')} aria-label={t('ui.editor.confirm', undefined, 'Confirm')}><Icon name="check" size={20} /></button>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>

      <Section id="gear" title={t('gear.section.gear')}>
        <Seg name="type" label={t('gear.type')} value={draft.type}
          options={GEAR_TYPES.map((x) => ({ value: x, text: t('gear.type.' + x), tip: t('gear.type.' + x + 'Tip') }))} onChange={setType} />
        <Seg name="sizing" label={t('gear.sizing')} value={draft.sizing}
          options={[{ value: 'module', text: t('gear.sizing.module') }, { value: 'dp', text: t('gear.sizing.dp') }]}
          onChange={(v) => change(v === 'dp' ? { sizing: 'dp', dp: Math.round((25.4 / gearModule(draft)) * 1000) / 1000 } : { sizing: 'module', module: Math.round(gearModule(draft) * 1000) / 1000 })} />
        {draft.sizing === 'module'
          ? <Num name="module" label={t('gear.module')} unit="mm" min={0.1} step={0.05} value={draft.module} onChange={(v) => change({ module: Math.max(0.1, v) })} />
          : <Num name="dp" label={t('gear.dp')} unit="1/in" min={0.5} step={0.5} value={draft.dp} onChange={(v) => change({ dp: Math.max(0.5, v) })} />}
        <Num name="teeth" label={rack ? t('gear.teethRack') : t('gear.teeth')} min={rack ? 1 : 6} step={1} value={draft.teeth} onChange={(v) => change({ teeth: Math.max(rack ? 1 : 6, Math.round(v)) })} />
        <Num name="pressureAngle" label={t('gear.pressureAngle')} unit="deg" min={10} max={30} step={0.5} value={draft.pressureAngle} onChange={(v) => change({ pressureAngle: Math.min(30, Math.max(10, v)) })} />
        <Num name="faceWidth" label={t('gear.faceWidth')} unit="mm" min={0.1} value={draft.faceWidth} onChange={(v) => change({ faceWidth: Math.max(0.1, v) })} />
        {helish ? <Num name="helixAngle" label={t('gear.helixAngle')} unit="deg" min={1} max={45} step={1} value={draft.helixAngle} onChange={(v) => change({ helixAngle: Math.min(45, Math.max(1, v)) })} /> : null}
        {helical ? (
          <Seg name="hand" label={t('gear.hand')} value={draft.hand}
            options={[{ value: 'right', text: t('gear.hand.right'), icon: 'helix-right' }, { value: 'left', text: t('gear.hand.left'), icon: 'helix-left' }]} onChange={(v) => change({ hand: v })} />
        ) : null}
        {hb ? (
          <Seg name="hand" label={t('gear.handV')} value={draft.hand}
            options={[{ value: 'right', text: t('gear.hand.vLeading'), icon: 'helix-right', tip: t('gear.hand.vLeadingTip') }, { value: 'left', text: t('gear.hand.vTrailing'), icon: 'helix-left', tip: t('gear.hand.vTrailingTip') }]} onChange={(v) => change({ hand: v })} />
        ) : null}
        {hb ? <Num name="grooveWidth" label={t('gear.groove')} unit="mm" min={0} value={draft.grooveWidth} hintText={t('gear.grooveTip')} onChange={(v) => change({ grooveWidth: Math.max(0, v) })} /> : null}
        {helical ? <div class="thread-hint" data-testid="gear-twist">{t('gear.twistNote', { a: fmt(Math.abs(g.twist), 2) })}</div> : null}
        {ring ? <Num name="rimThickness" label={t('gear.rim')} unit="mm" min={0} value={draft.rimThickness} hintText={t('gear.rimTip')} onChange={(v) => change({ rimThickness: Math.max(0, v) })} /> : null}
      </Section>

      {hasBore ? (
        <Section id="shaft" title={t('gear.section.shaft')}>
          <Num name="boreDia" label={t('gear.bore')} unit="mm" min={0} value={draft.boreDia} onChange={(v) => change({ boreDia: Math.max(0, v) })} />
          {!ring && draft.boreDia > 0 ? <Check name="keyway" label={t('gear.keyway')} value={draft.keyway} onChange={(v) => change({ keyway: v })} /> : null}
          {draft.keyway && draft.boreDia > 0 && !ring ? <Num name="keyWidth" label={t('gear.keyWidth')} unit="mm" min={0} value={draft.keyWidth || key.width} onChange={(v) => change({ keyWidth: Math.max(0, v) })} /> : null}
          {draft.keyway && draft.boreDia > 0 && !ring ? <Num name="keyDepth" label={t('gear.keyDepth')} unit="mm" min={0} value={draft.keyDepth || key.depth} onChange={(v) => change({ keyDepth: Math.max(0, v) })} /> : null}
          {!ring ? <Num name="hubDia" label={t('gear.hubDia')} unit="mm" min={0} value={draft.hubDia} onChange={(v) => change({ hubDia: Math.max(0, v) })} /> : null}
          {!ring ? <Num name="hubLength" label={t('gear.hubLength')} unit="mm" min={0} value={draft.hubLength} hintText={t(hb ? 'gear.hubLengthTipHb' : 'gear.hubLengthTip')} onChange={(v) => change({ hubLength: Math.max(0, v) })} /> : null}
        </Section>
      ) : null}

      <Section id="tooth" title={t('gear.section.tooth')}>
        <Num name="addendum" label={t('gear.addendum')} unit="x m" min={0.2} step={0.05} value={draft.addendum} onChange={(v) => change({ addendum: Math.max(0.2, v) })} />
        <Num name="dedendum" label={t('gear.dedendum')} unit="x m" min={0.2} step={0.05} value={draft.dedendum} onChange={(v) => change({ dedendum: Math.max(0.2, v) })} />
        {rack ? null : <Num name="rootFillet" label={t('gear.rootFillet')} unit="x m" min={0} max={0.6} step={0.05} value={draft.rootFillet} onChange={(v) => change({ rootFillet: Math.min(0.6, Math.max(0, v)) })} />}
        <Num name="shift" label={t('gear.shift')} min={-1} max={1.5} step={0.05} value={draft.shift} onChange={(v) => change({ shift: Math.min(1.5, Math.max(-1, v)) })} />
        <Num name="backlash" label={t('gear.backlash')} unit="mm" min={0} step={0.01} value={draft.backlash} hintText={t('gear.backlashTip')} onChange={(v) => change({ backlash: Math.max(0, v) })} />
      </Section>

      {canMate ? (
        <Section id="pair" title={t('gear.section.pair')}>
          <Check name="mate" label={t('gear.mate')} value={!!mate}
            onChange={(on) => change(on ? { mate: { teeth: draft.teeth * 2, boreDia: draft.boreDia, hubDia: 0, hubLength: 0 }, backlash: draft.backlash > 0 ? draft.backlash : Math.round(0.06 * g.mn * 1000) / 1000 } : { mate: undefined })} />
          {mate ? <Num name="mateTeeth" label={t('gear.mateTeeth')} min={6} step={1} value={mate.teeth} onChange={(v) => change({ mate: { ...mate, teeth: Math.max(6, Math.round(v)) } })} /> : null}
          {mate ? <Num name="mateBore" label={t('gear.mateBore')} unit="mm" min={0} value={mate.boreDia} onChange={(v) => change({ mate: { ...mate, boreDia: Math.max(0, v) } })} /> : null}
          {mate ? <Num name="mateHubDia" label={t('gear.mateHubDia')} unit="mm" min={0} value={mate.hubDia} onChange={(v) => change({ mate: { ...mate, hubDia: Math.max(0, v) } })} /> : null}
          {mate ? <Num name="mateHubLength" label={t('gear.mateHubLength')} unit="mm" min={0} value={mate.hubLength} onChange={(v) => change({ mate: { ...mate, hubLength: Math.max(0, v) } })} /> : null}
          {mate ? <div class="thread-hint" data-testid="gear-centre">{t('gear.centre', { a: fmt(centreDistance(draft), 3), ratio: fmt(mate.teeth / draft.teeth, 3) })}</div> : null}
        </Section>
      ) : null}

      <Section id="readout" title={t('gear.section.readout')}>
        <dl class="thread-readout" data-testid="gear-readout">
          {rack ? (
            <>
              <dt>{t('gear.r.pitch')}</dt><dd data-k="pitch">{fmt(g.pitch, 3)} mm</dd>
              <dt>{t('gear.r.length')}</dt><dd data-k="length">{fmt(g.pitch * draft.teeth, 3)} mm</dd>
            </>
          ) : (
            <>
              <dt>{t('gear.r.pitchDia')}</dt><dd data-k="pitchDia">{fmt(ro.pitchDia)} mm</dd>
              <dt>{t('gear.r.outsideDia')}</dt><dd data-k="outsideDia">{fmt(ro.outsideDia)} mm</dd>
              <dt>{t('gear.r.rootDia')}</dt><dd data-k="rootDia">{fmt(ro.rootDia)} mm</dd>
              <dt>{t('gear.r.baseDia')}</dt><dd data-k="baseDia">{fmt(ro.baseDia)} mm</dd>
            </>
          )}
          <dt>{t('gear.r.contact')}</dt><dd data-k="contact">{fmt(helish ? ro.totalContactRatio : ro.contactRatio, 2)}</dd>
          {hb ? (
            <>
              <dt>{t('gear.r.faceWidth')}</dt><dd data-k="faceWidth">{fmt(draft.faceWidth)} mm</dd>
              <dt>{t('gear.r.groove')}</dt><dd data-k="groove">{fmt(Math.max(0, draft.grooveWidth))} mm</dd>
              <dt>{t('gear.r.overlapHalf')}</dt><dd data-k="overlapHalf">{fmt(ro.overlapHalf)}</dd>
            </>
          ) : null}
          {rack ? null : <><dt>{t('gear.r.minTeeth')}</dt><dd data-k="minTeeth">{ro.minTeeth}</dd></>}
        </dl>
        <div class="thread-hint">{t(mate ? 'gear.r.contactNotePair' : 'gear.r.contactNote')}</div>
        {hb ? <div class="thread-hint" data-testid="gear-hb-note">{t('gear.r.contactNoteHb')}</div> : null}
        {ro.warnings.map((w) => <div key={w} class="thread-fit warn" role="status" data-warning={w}>
          <span>{warn(w)}</span>
          {w === 'undercut' && ro.minShift > 0 ? <button type="button" data-testid="gear-use-shift" onClick={() => change({ shift: ro.minShift })}>{t('gear.useShift', { x: fmt(ro.minShift, 2) })}</button> : null}
        </div>)}
      </Section>

      {p.hint ? <div class="fedit-hint" role="alert">{p.hint}</div> : null}
    </div>
  );
}
