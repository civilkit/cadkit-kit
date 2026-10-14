// Option forms for extrude / cut, revolve, chamfer, fillet and shell: dropdowns for the end condition, chamfer type and
// fillet profile with the dependent fields shown and hidden as the kernel reads them (rules in featureOptions.ts). It plugs
// into the generic FeatureEditor through its `options` prop, so sketch, axis, edges and faces keep their pick buttons and
// the shape list. Only fields the kernel really reads are offered.
import { useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import type { PartDoc } from '@ck/part-model';
import { ExprInput, Icon, type OptionsArgs, type OptionsResult } from '@kit/ui';
import { t } from './i18n';
import {
  CHAMFER_TYPES, FILLET_PROFILES, chamferTypeOf, endAllowsDraft, endNeedsDepth, endNeedsFace, endNeedsPoint, endOf, endsFor, filletProfileOf, filletVariable, managedPaths,
  patchChamferType, patchDraft, patchEnd, patchFilletProfile, patchFilletVariable, patchRadii, radiiOf,
  type ChamferType, type EndCondition, type FilletProfile,
} from './optionRules';
import {
  CONTINUITIES, FAIRINGS, continuityOf, curveEntities, fairingOf, guidesPatch, knitIds, loftGuides, loftProfiles, move, nextFree, pathOf, pathPatch, removeAt, replaceAt,
  sketchInfos, surfaceInfos, sweepGuides, sweepGuidesPatch, tensionOf, tensionPatch, toggleKnit, type CurveRef, type SketchInfo,
} from './surfaceRules';

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

function Num(p: { name: string; label: string; value: unknown; unit: string; plain?: boolean; onChange(v: number | string): void }): JSX.Element {
  return (
    <label class="fedit-fld" data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <span class="fedit-num">
        <ExprInput value={typeof p.value === 'number' || typeof p.value === 'string' ? p.value : ''} unit={p.unit} label={p.label} plain={p.plain} onValue={p.onChange} />
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
          <Num name="draft" label={t('opt.draft')} value={draftAngle} unit="°" plain onChange={(v) => change(patchDraft(eff, Number(v)))} />
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
        <Num name="radii0" label={t(chord ? 'opt.fillet.chord0' : 'opt.fillet.radius0')} value={radii[0]} unit="mm" plain onChange={(v) => change(patchRadii(eff, 0, Number(v)))} />
        <Num name="radii1" label={t(chord ? 'opt.fillet.chord1' : 'opt.fillet.radius1')} value={radii[1]} unit="mm" plain onChange={(v) => change(patchRadii(eff, 1, Number(v)))} />
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

// ---- surfaces: loft, sweep, fill, extend, knit, trim ----

/** One sketch drop-down (with a blank entry when `blank` is given). */
function SketchSelect(p: { value: string; list: SketchInfo[]; blank?: string; onChange(id: string): void; name: string }): JSX.Element {
  const known = p.list.some((s) => s.id === p.value);
  return (
    <select data-path={p.name} value={p.value} onChange={(e) => p.onChange((e.currentTarget as HTMLSelectElement).value)}>
      {p.blank !== undefined ? <option value="">{p.blank}</option> : null}
      {!known && p.value ? <option value={p.value}>{p.value}</option> : null}
      {p.list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

/** An ordered list of sketches: a drop-down per row, up / down / remove buttons, and an add button. */
function SketchList(p: { name: string; label: string; ids: string[]; list: SketchInfo[]; min: number; addLabel: string; onChange(ids: string[]): void }): JSX.Element {
  const free = nextFree(p.list.map((s) => s.id), p.ids);
  return (
    <div class="fedit-order" data-path={p.name}>
      <div class="fedit-fld-label">{p.label}</div>
      {p.ids.map((id, i) => (
        <div class="fedit-order-row" key={i} data-index={i}>
          <span class="fedit-order-n">{i + 1}</span>
          <SketchSelect name={`${p.name}.${i}`} value={id} list={p.list} onChange={(v) => p.onChange(replaceAt(p.ids, i, v))} />
          <button type="button" class="fedit-mini" data-act="up" disabled={i === 0} title={t('opt.order.up')} aria-label={t('opt.order.up')} onClick={() => p.onChange(move(p.ids, i, -1))}>↑</button>
          <button type="button" class="fedit-mini" data-act="down" disabled={i === p.ids.length - 1} title={t('opt.order.down')} aria-label={t('opt.order.down')} onClick={() => p.onChange(move(p.ids, i, 1))}>↓</button>
          <button type="button" class="fedit-mini" data-act="remove" disabled={p.ids.length <= p.min} title={t('opt.order.remove')} aria-label={t('opt.order.remove')} onClick={() => p.onChange(removeAt(p.ids, i))}>×</button>
        </div>
      ))}
      <button type="button" class="fedit-pick" data-act="add" disabled={!free} onClick={() => free && p.onChange([...p.ids, free])}>{p.addLabel}</button>
    </div>
  );
}

function LoftOptions(p: { eff: Wire; change: Change; doc: PartDoc | null }): JSX.Element {
  const { eff, change } = p;
  const all = sketchInfos(p.doc);
  const surface = eff.surface === true;
  const profiles = loftProfiles(eff);
  const guides = loftGuides(eff);
  const profileChoices = all.filter((s) => (surface ? s.closed || s.open : s.closed) || profiles.includes(s.id));
  const guideChoices = all.filter((s) => s.open && !profiles.includes(s.id));
  return (
    <>
      <Section id="loftProfiles" title={t('opt.loft.profiles')}>
        <SketchList name="sketches" label={t('opt.loft.profilesNote')} ids={profiles} list={profileChoices} min={2} addLabel={t('opt.loft.addProfile')} onChange={(ids) => change({ sketches: ids })} />
      </Section>
      <Section id="loftGuides" title={t('opt.loft.guides')}>
        <SketchList name="guides" label={t('opt.loft.guidesNote')} ids={guides} list={guideChoices} min={0} addLabel={t('opt.loft.addGuide')} onChange={(ids) => change(guidesPatch(ids))} />
      </Section>
      <Section id="loftOptions" title={t('opt.section.options')}>
        <Check name="surface" label={t('opt.loft.surface')} value={surface} onChange={(v) => change({ surface: v ? true : null })} />
        {!surface ? <Select name="op" label={t('opt.op')} value={eff.op === 'cut' ? 'cut' : 'add'} options={[['add', t('opt.op.add')], ['cut', t('opt.op.cut')]]} onChange={(v) => change({ op: v })} /> : null}
        <Num name="startNormal" label={t('opt.loft.startTension')} value={tensionOf(eff, 'startNormal')} unit="" plain onChange={(v) => change(tensionPatch('startNormal', Number(v)))} />
        <Num name="endNormal" label={t('opt.loft.endTension')} value={tensionOf(eff, 'endNormal')} unit="" plain onChange={(v) => change(tensionPatch('endNormal', Number(v)))} />
      </Section>
    </>
  );
}

function SweepOptions(p: { eff: Wire; change: Change; doc: PartDoc | null }): JSX.Element {
  const { eff, change } = p;
  const all = sketchInfos(p.doc);
  const profile = typeof eff.sketch === 'string' ? eff.sketch : '';
  const path = pathOf(eff);
  const guides = sweepGuides(eff);
  const guideSketches = all.filter((s) => s.id !== profile && s.id !== path);
  const setGuide = (i: number, g: CurveRef) => change(sweepGuidesPatch(replaceAt(guides, i, g)));
  const addGuide = () => {
    const sk = guideSketches.find((s) => !guides.some((g) => g.sketch === s.id));
    const entity = sk ? curveEntities(p.doc, sk.id)[0] : undefined;
    if (sk && entity) change(sweepGuidesPatch([...guides, { sketch: sk.id, entity }]));
  };
  return (
    <>
      <Section id="sweepProfile" title={t('opt.sweep.profile')}>
        <label class="fedit-fld" data-path="sketch"><span class="fedit-fld-label">{t('opt.sweep.profileSketch')}</span>
          <SketchSelect name="sketch" value={profile} list={all.filter((s) => s.closed || s.id === profile)} onChange={(v) => change({ sketch: v })} /></label>
        <label class="fedit-fld" data-path="path"><span class="fedit-fld-label">{t('opt.sweep.pathSketch')}</span>
          <SketchSelect name="path" value={path} list={all.filter((s) => (s.open || s.id === path) && s.id !== profile)} blank={t('opt.none')} onChange={(v) => change(pathPatch(v))} /></label>
      </Section>
      <Section id="sweepGuides" title={t('opt.sweep.guides')}>
        <div class="fedit-order" data-path="guides">
          <div class="fedit-fld-label">{t('opt.sweep.guidesNote')}</div>
          {guides.map((g, i) => (
            <div class="fedit-order-row" key={i} data-index={i}>
              <span class="fedit-order-n">{i + 1}</span>
              <SketchSelect name={`guides.${i}`} value={g.sketch} list={guideSketches} onChange={(id) => setGuide(i, { sketch: id, entity: curveEntities(p.doc, id)[0] ?? g.entity })} />
              {curveEntities(p.doc, g.sketch).length > 1 ? (
                <select data-path={`guides.${i}.entity`} value={g.entity} onChange={(e) => setGuide(i, { sketch: g.sketch, entity: (e.currentTarget as HTMLSelectElement).value })}>
                  {curveEntities(p.doc, g.sketch).map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
              ) : null}
              <button type="button" class="fedit-mini" data-act="remove" title={t('opt.order.remove')} aria-label={t('opt.order.remove')} onClick={() => change(sweepGuidesPatch(removeAt(guides, i)))}>×</button>
            </div>
          ))}
          <button type="button" class="fedit-pick" data-act="add" disabled={!guideSketches.length} onClick={addGuide}>{t('opt.sweep.addGuide')}</button>
        </div>
      </Section>
      <Section id="sweepOptions" title={t('opt.section.options')}>
        {!guides.length ? <Num name="twist" label={t('opt.sweep.twist')} value={typeof eff.twist === 'number' ? eff.twist : 0} unit="°" onChange={(v) => change({ twist: Number(v) ? v : null })} /> : null}
        <Select name="op" label={t('opt.op')} value={eff.op === 'cut' ? 'cut' : 'add'} options={[['add', t('opt.op.add')], ['cut', t('opt.op.cut')]]} onChange={(v) => change({ op: v })} />
      </Section>
    </>
  );
}

function FillOptions(p: { eff: Wire; change: Change }): JSX.Element {
  const { eff, change } = p;
  return (
    <Section id="fill" title={t('opt.section.fill')}>
      <Select name="continuity" label={t('opt.fill.continuity')} value={continuityOf(eff)} options={CONTINUITIES.map((c): [string, string] => [c, t('opt.fill.continuity.' + c)])} onChange={(v) => change({ continuity: v })} />
      <Select name="fairing" label={t('opt.fill.fairing')} value={fairingOf(eff)} options={FAIRINGS.map((f): [string, string] => [f, t('opt.fill.fairing.' + f)])} onChange={(v) => change({ fairing: v === 'meowNURBS' ? null : v })} />
      <Check name="merge" label={t('opt.fill.merge')} value={eff.merge !== false} onChange={(v) => change({ merge: v })} />
    </Section>
  );
}

function ExtendOptions(p: { eff: Wire; change: Change }): JSX.Element {
  return (
    <Section id="extend" title={t('opt.section.extend')}>
      <Num name="distance" label={t('opt.extend.distance')} value={p.eff.distance} unit="mm" onChange={(v) => p.change({ distance: v })} />
      <div class="fedit-hint-line">{t('opt.extend.note')}</div>
    </Section>
  );
}

function KnitOptions(p: { eff: Wire; change: Change; doc: PartDoc | null }): JSX.Element {
  const { eff, change } = p;
  const all = surfaceInfos(p.doc, typeof eff.id === 'string' ? eff.id : undefined);
  const ids = knitIds(eff);
  const allIds = all.map((s) => s.id);
  return (
    <>
      <Section id="knitSurfaces" title={t('opt.knit.surfaces')}>
        {all.map((s) => (
          <Check key={s.id} name={`surfaces.${s.id}`} label={s.name} value={ids.includes(s.id)} onChange={() => change({ surfaces: toggleKnit(allIds, ids, s.id) })} />
        ))}
      </Section>
      <Section id="knit" title={t('opt.section.options')}>
        <Check name="solid" label={t('opt.knit.solid')} value={eff.solid === true} onChange={(v) => change({ solid: v ? true : null })} />
      </Section>
    </>
  );
}

function TrimOptions(p: { eff: Wire; change: Change; doc: PartDoc | null }): JSX.Element {
  const { eff, change } = p;
  const all = surfaceInfos(p.doc, typeof eff.id === 'string' ? eff.id : undefined);
  const target = typeof eff.surface === 'string' ? eff.surface : '';
  const tool = typeof eff.toolSurface === 'string' ? eff.toolSurface : '';
  const opts = (cur: string, except: string): Array<[string, string]> => {
    const l = all.filter((s) => s.id !== except).map((s): [string, string] => [s.id, s.name]);
    return cur && !l.some(([id]) => id === cur) ? [[cur, cur], ...l] : l;
  };
  return (
    <Section id="trim" title={t('opt.section.trim')}>
      <Select name="surface" label={t('opt.trim.surface')} value={target} options={opts(target, tool)} onChange={(v) => change({ surface: v })} />
      <Select name="toolSurface" label={t('opt.trim.tool')} value={tool} options={[['', t('opt.trim.toolPlane')], ...opts(tool, target)]} onChange={(v) => change(v ? { toolSurface: v, plane: null } : { toolSurface: null })} />
      <Check name="flip" label={t('opt.trim.flip')} value={eff.flip} onChange={(v) => change({ flip: v })} />
      <Check name="mutual" label={t('opt.trim.mutual')} value={eff.mutual} onChange={(v) => change({ mutual: v })} />
    </Section>
  );
}

/** The `options` prop of FeatureEditor: the form for the feature's type, or null (the generic fields stay). `doc` feeds the sketch and surface lists. */
export function optionsFor(a: OptionsArgs & { eff: Wire }, doc: PartDoc | null = null): OptionsResult | null {
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
    case 'loft': return { hide, node: <LoftOptions {...common} doc={doc} /> };
    case 'sweep': return { hide, node: <SweepOptions {...common} doc={doc} /> };
    case 'fill': return { hide, node: <FillOptions {...common} /> };
    case 'extend': return { hide, node: <ExtendOptions {...common} /> };
    case 'knit': return { hide, node: <KnitOptions {...common} doc={doc} /> };
    case 'trimSurface': return { hide, node: <TrimOptions {...common} doc={doc} /> };
    default: return null;
  }
}
