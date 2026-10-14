// Option forms for extrude / cut, revolve, chamfer, fillet and shell: dropdowns for the end condition, chamfer type and
// fillet profile with the dependent fields shown and hidden as the kernel reads them (rules in featureOptions.ts). It plugs
// into the generic FeatureEditor through its `options` prop, so sketch, axis, edges and faces keep their pick buttons and
// the shape list. Only fields the kernel really reads are offered.
import { useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { Icon, type OptionsArgs, type OptionsResult } from '@kit/ui';
import { t } from './i18n';
import {
  CHAMFER_TYPES, FILLET_PROFILES, chamferTypeOf, endAllowsDraft, endNeedsDepth, endNeedsFace, endNeedsPoint, endOf, endsFor, filletProfileOf, filletVariable, managedPaths,
  patchChamferType, patchDraft, patchEnd, patchFilletProfile, patchFilletVariable, patchRadii, radiiOf,
  type ChamferType, type EndCondition, type FilletProfile,
} from './optionRules';

type Wire = Record<string, unknown>;
type Change = (patch: Wire) => void;

function Section(p: { id: string; title: string; children: ComponentChildren }): JSX.Element {
  const [closed, setClosed] = useState(false);
  return (
    <div class={'fedit-sec' + (closed ? ' closed' : '')} data-section={p.id}>
      <div class="fedit-sec-head" onClick={() => setClosed(!closed)}>
        <span class="fedit-sec-title">{p.title}</span>
        <Icon name="chevron" size={14} class="fedit-chev" />
      </div>
      {closed ? null : <div class="fedit-sec-fields">{p.children}</div>}
    </div>
  );
}

function Select(p: { name: string; label: string; value: string; options: Array<[string, string]>; onChange(v: string): void }): JSX.Element {
  return (
    <label class="fedit-fld" data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <select value={p.value} onChange={(e) => p.onChange((e.currentTarget as HTMLSelectElement).value)}>
        {p.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function Num(p: { name: string; label: string; value: unknown; unit: string; onChange(v: number): void }): JSX.Element {
  return (
    <label class="fedit-fld" data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <span class="fedit-num">
        <input
          type="number"
          value={String(p.value ?? '')}
          onChange={(e) => {
            const raw = (e.currentTarget as HTMLInputElement).value;
            const v = Number(raw);
            if (raw.trim() !== '' && Number.isFinite(v)) p.onChange(v);
          }}
        />
        <span class="fedit-unit">{p.unit}</span>
      </span>
    </label>
  );
}

function Check(p: { name: string; label: string; value: unknown; onChange(v: boolean): void }): JSX.Element {
  return (
    <label class="fedit-fld bool" data-path={p.name}>
      <input type="checkbox" checked={Boolean(p.value)} onChange={(e) => p.onChange((e.currentTarget as HTMLInputElement).checked)} />
      <span class="fedit-fld-label">{p.label}</span>
    </label>
  );
}

/** A reference field filled from the viewport: the text, and a Pick button that turns picking on (a click on a face fills it). */
function PickField(p: { name: string; label: string; value: unknown; picking: boolean; onPick?(path: string): void }): JSX.Element {
  return (
    <label class={'fedit-fld ref' + (p.picking ? ' picking' : '')} data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <span class="fedit-ref">
        <input type="text" value={typeof p.value === 'string' ? p.value : ''} readonly />
        {p.onPick ? <button type="button" class={'fedit-pick' + (p.picking ? ' on' : '')} aria-pressed={p.picking} onClick={() => p.onPick!(p.name)}>{p.picking ? t('ui.editor.pickDone') : t('ui.editor.pick', undefined, 'Pick')}</button> : null}
      </span>
    </label>
  );
}

const endLabel = (e: string): string => t('opt.end.' + e);

function ExtrudeOptions(p: { eff: Wire; change: Change; pickingPath?: string | null; onPick?(path: string): void; revolve: boolean }): JSX.Element {
  const { eff, change } = p;
  const ends = endsFor(p.revolve ? 'revolve' : 'extrude');
  const raw = endOf(eff);
  const end: EndCondition = raw;
  const options: Array<[string, string]> = ends.map((e) => [e, endLabel(e)]);
  if (!ends.includes(raw)) options.unshift([raw, endLabel(raw)]);   // an end the editor does not offer stays visible (the kernel reports it)
  const draftAngle = typeof eff.draft === 'number' ? eff.draft : 0;
  return (
    <>
      <Section id="end" title={t('opt.section.end')}>
        <Select name="end" label={t('opt.end')} value={end} options={options} onChange={(v) => change(patchEnd(eff, v as EndCondition))} />
        {!p.revolve && endNeedsDepth(end) ? <Num name="depth" label={end === 'mid' ? t('opt.depth.total') : t('opt.depth')} value={eff.depth} unit="mm" onChange={(v) => change({ depth: v })} /> : null}
        {p.revolve ? <Num name="angle" label={end === 'mid' ? t('opt.angle.total') : t('opt.angle')} value={eff.angle ?? 360} unit="°" onChange={(v) => change({ angle: v })} /> : null}
        {endNeedsFace(end) ? <PickField name="endFace" label={t('opt.endFace')} value={eff.endFace} picking={p.pickingPath === 'endFace'} onPick={p.onPick} /> : null}
        {end === 'offsetFromFace' ? <Num name="endOffset" label={t('opt.endOffset')} value={eff.endOffset ?? 0} unit="mm" onChange={(v) => change({ endOffset: v })} /> : null}
        {endNeedsPoint(end) ? <PickField name="endPoint" label={t('opt.endPoint')} value={eff.endPoint} picking={p.pickingPath === 'endPoint'} onPick={p.onPick} /> : null}
      </Section>
      <Section id="options" title={t('opt.section.options')}>
        {end !== 'mid' && end !== 'throughBoth' ? <Check name="flip" label={t('opt.flip')} value={eff.flip} onChange={(v) => change({ flip: v ? true : null })} /> : null}
        {!p.revolve && endAllowsDraft(end) ? <>
          <Num name="draft" label={t('opt.draft')} value={draftAngle} unit="°" onChange={(v) => change(patchDraft(eff, v))} />
          {draftAngle > 0 ? <Check name="draftOut" label={t('opt.draftOut')} value={eff.draftOut} onChange={(v) => change({ draftOut: v ? true : null })} /> : null}
        </> : null}
      </Section>
    </>
  );
}

function ChamferOptions(p: { eff: Wire; change: Change }): JSX.Element {
  const { eff, change } = p;
  const type = chamferTypeOf(eff);
  const first = type === 'equal' ? t('opt.chamfer.distance') : t('opt.chamfer.distance1');
  return (
    <Section id="chamfer" title={t('opt.section.chamfer')}>
      <Select name="chamferType" label={t('opt.chamfer.type')} value={type} options={CHAMFER_TYPES.map((c): [string, string] => [c, t('opt.chamfer.type.' + c)])} onChange={(v) => change(patchChamferType(eff, v as ChamferType))} />
      <Num name="distance" label={first} value={eff.distance} unit="mm" onChange={(v) => change({ distance: v })} />
      {type === 'distances' ? <Num name="distance2" label={t('opt.chamfer.distance2')} value={eff.distance2} unit="mm" onChange={(v) => change({ distance2: v })} /> : null}
      {type === 'angle' ? <Num name="angle" label={t('opt.chamfer.angle')} value={eff.angle} unit="°" onChange={(v) => change({ angle: v })} /> : null}
    </Section>
  );
}

function FilletOptions(p: { eff: Wire; change: Change }): JSX.Element {
  const { eff, change } = p;
  const variable = filletVariable(eff);
  const profile = filletProfileOf(eff);
  const radii = radiiOf(eff);
  const chord = profile === 'chord';
  return (
    <Section id="fillet" title={t('opt.section.fillet')}>
      <Check name="filletType" label={t('opt.fillet.variable')} value={variable} onChange={(v) => change(patchFilletVariable(eff, v))} />
      {variable ? <>
        <Num name="radii0" label={t(chord ? 'opt.fillet.chord0' : 'opt.fillet.radius0')} value={radii[0]} unit="mm" onChange={(v) => change(patchRadii(eff, 0, v))} />
        <Num name="radii1" label={t(chord ? 'opt.fillet.chord1' : 'opt.fillet.radius1')} value={radii[1]} unit="mm" onChange={(v) => change(patchRadii(eff, 1, v))} />
      </> : <Num name="radius" label={t(chord ? 'opt.fillet.chord' : 'opt.fillet.radius')} value={eff.radius} unit="mm" onChange={(v) => change({ radius: v })} />}
      <Select name="profile" label={t('opt.fillet.profile')} value={profile} options={FILLET_PROFILES.map((f): [string, string] => [f, t('opt.fillet.profile.' + f)])} onChange={(v) => change(patchFilletProfile(eff, v as FilletProfile))} />
      {profile === 'conic' ? <Num name="rho" label={t('opt.fillet.rho')} value={eff.rho ?? 0.5} unit="" onChange={(v) => change({ rho: v })} /> : null}
      {profile === 'curvature' ? <Num name="shape" label={t('opt.fillet.shape')} value={eff.shape ?? 0.5} unit="" onChange={(v) => change({ shape: v })} /> : null}
    </Section>
  );
}

function ShellOptions(p: { eff: Wire; change: Change }): JSX.Element {
  return (
    <Section id="shell" title={t('opt.section.shell')}>
      <Num name="thickness" label={t('opt.shell.thickness')} value={p.eff.thickness} unit="mm" onChange={(v) => p.change({ thickness: v })} />
      <Check name="outward" label={t('opt.shell.outward')} value={p.eff.outward} onChange={(v) => p.change({ outward: v ? true : null })} />
    </Section>
  );
}

/** The `options` prop of FeatureEditor: the form for the feature's type, or null (the generic fields stay). */
export function optionsFor(a: OptionsArgs & { eff: Wire }): OptionsResult | null {
  const type = String(a.eff.type ?? '');
  const hide = managedPaths(type);
  if (!hide.size) return null;
  const common = { eff: a.eff, change: a.change };
  switch (type) {
    case 'extrude': return { hide, node: <ExtrudeOptions {...common} pickingPath={a.pickingPath} onPick={a.onPickRequest} revolve={false} /> };
    case 'revolve': return { hide, node: <ExtrudeOptions {...common} pickingPath={a.pickingPath} onPick={a.onPickRequest} revolve /> };
    case 'chamfer': return { hide, node: <ChamferOptions {...common} /> };
    case 'fillet': return { hide, node: <FilletOptions {...common} /> };
    case 'shell': return { hide, node: <ShellOptions {...common} /> };
    default: return null;
  }
}
