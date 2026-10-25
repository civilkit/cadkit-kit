// Option forms for extrude / cut, revolve, chamfer, fillet and shell: dropdowns for the end condition, chamfer type and
// fillet profile with the dependent fields shown and hidden as the kernel reads them (rules in featureOptions.ts). It plugs
// into the generic FeatureEditor through its `options` prop, so sketch, axis, edges and faces keep their pick buttons and
// the shape list. Only fields the kernel really reads are offered.
import { nextBodyName, opChoiceOf, opChoices, opPatch } from './extrudeOp';
import { usedBodyNames } from './bodyOps';
import { useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import type { PartDoc } from '@ck/part-model';
import { EditorSection as Section, ExprInput, Icon, type OptionsArgs, type OptionsResult } from '@kit/ui';
import { t } from './i18n';
import {
  CHAMFER_TYPES, FILLET_PROFILES, chamferTypeOf, endAllowsDraft, endNeedsDepth, endNeedsFace, endNeedsPoint, endOf, endsFor, filletProfileOf, filletVariable, managedPaths,
  patchChamferType, patchDraft, patchEnd, patchFilletProfile, patchFilletVariable, patchRadii, planeBaseChoices, planeBasePatch, planeBaseValue, radiiOf,
  type ChamferType, type EndCondition, type FilletProfile,
} from './optionRules';
import {
  THIN_CORNERS, THIN_ENDS, THIN_SIDES, openProfile, patchThin, patchThinOn, thinOf, type OpenProfile, type ThinCorner, type ThinEnds, type ThinSide,
} from './thinRules';
import { sketchOpenChains } from '@kit/sketch';
import { roundPickOf, setTangentChain, tangentChainOn } from './roundChain';
import { loftAutoOrder, loftPointIssue } from './featureCreators';
import { carriesThreads, carryPatch, seedInfos, seedLabel } from './patternThreads';
import {
  CONTINUITIES, FAIRINGS, continuityOf, curveEntities, fairingOf, guidesPatch, knitIds, loftGuides, loftProfiles, move, nextFree, pathOf, pathPatch, removeAt, replaceAt,
  sketchInfos, surfaceInfos, sweepGuides, sweepGuidesPatch, tensionOf, tensionPatch, toggleKnit, type CurveRef, type SketchInfo,
} from './surfaceRules';

type Wire = Record<string, unknown>;
type Change = (patch: Wire) => void;

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

/** The body names the other features of the part use (this feature's own is not counted). */
const otherBodyNames = (doc: PartDoc | null, eff: Wire): Set<string> =>
  usedBodyNames(((doc?.features ?? []) as unknown as Array<Record<string, unknown>>).filter((x) => x.id !== eff.id));

/** A body reference of a feature in words: its name, or the face that tells which body. */
export function bodyRefText(ref: unknown): string {
  if (typeof ref === 'string') return t('opt.combine.ref.face', { face: ref });
  const r = (ref && typeof ref === 'object' ? ref : {}) as Record<string, unknown>;
  if (typeof r.body === 'string') return r.body;
  if (typeof r.face === 'string') return t('opt.combine.ref.face', { face: r.face });
  if (typeof r.feature === 'string') return t('opt.combine.ref.feature', { id: r.feature });
  if (typeof r.lump === 'number') return t('opt.combine.ref.lump', { n: r.lump + 1 });
  if (typeof r.surface === 'string') return t('opt.combine.ref.surface', { id: r.surface });
  return '';
}

function RefText(p: { name: string; label: string; text: string }): JSX.Element {
  return (
    <label class="fedit-fld" data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <input type="text" value={p.text} readonly />
    </label>
  );
}

/** Combine bodies: how the target and the tool bodies are combined, and whether the tools are kept. Which bodies they are is set where the feature is made (the Bodies panel). */
function CombineOptions(p: { eff: Wire; change: Change }): JSX.Element {
  const { eff, change } = p;
  const op = typeof eff.op === 'string' ? eff.op : 'union';
  const choices = ['union', 'cut', 'intersect', ...(op === 'split' ? ['split'] : [])];
  const tools = Array.isArray(eff.tools) ? eff.tools : [];
  return (
    <Section id="combine" title={t('opt.op')}>
      <Segmented<string> name="op" label={t('opt.op')} value={op} choices={choices} text={(c) => t('opt.op.' + c)} onChange={(v) => change({ op: v })} />
      <RefText name="target" label={t('opt.combine.target')} text={bodyRefText(eff.target)} />
      <RefText name="tools" label={t('opt.combine.tools')} text={tools.map(bodyRefText).join(', ')} />
      <Check name="keepTools" label={t('opt.combine.keepTools')} value={eff.keepTools} onChange={(v) => change({ keepTools: v ? true : null })} />
    </Section>
  );
}

const fmtNum = (n: unknown): string => (typeof n === 'number' && isFinite(n) ? String(+n.toFixed(3)) : '0');
/** What a moveBody does in words: the translation and the turn; changed by dragging the body (the triball), not typed here. */
export function moveSummary(eff: Wire): string {
  const tr = Array.isArray(eff.translate) ? eff.translate : [];
  const out: string[] = [];
  if (tr.some((x) => Number(x) !== 0)) out.push(t('opt.move.by', { x: fmtNum(tr[0]), y: fmtNum(tr[1]), z: fmtNum(tr[2]) }));
  const r = eff.rotate as { axis?: unknown[]; angle?: unknown } | undefined;
  if (r && typeof r === 'object' && Number(r.angle) !== 0) out.push(t('opt.move.turn', { angle: fmtNum(r.angle), x: fmtNum(r.axis?.[0]), y: fmtNum(r.axis?.[1]), z: fmtNum(r.axis?.[2]) }));
  return out.join('; ') || t('opt.move.none');
}

/** Move or copy bodies: which bodies, how far they went (read-only: drag the body to change it), and whether this makes a copy, and its name. */
function MoveBodyOptions(p: { eff: Wire; change: Change; doc: PartDoc | null }): JSX.Element {
  const { eff, change } = p;
  const bodies = Array.isArray(eff.bodies) ? eff.bodies : eff.bodies !== undefined ? [eff.bodies] : [];
  const copy = eff.copy === true;
  return (
    <Section id="moveBody" title={t('opt.move.title')}>
      <RefText name="bodies" label={t('opt.move.bodies')} text={bodies.map(bodyRefText).join(', ')} />
      <RefText name="translate" label={t('opt.move.how')} text={moveSummary(eff)} />
      <Check name="copy" label={t('opt.move.copy')} value={copy} onChange={(v) => change(v ? { copy: true, body: typeof eff.body === 'string' && eff.body ? eff.body : nextBodyName(otherBodyNames(p.doc, eff)) } : { copy: null, body: null })} />
      {copy ? <BodyNameField eff={eff} change={change} /> : null}
    </Section>
  );
}

/** A ball: where its centre is, how big, and whether it is a body of its own, joins the part or cuts it. */
function SphereOptions(p: { eff: Wire; change: Change; doc: PartDoc | null }): JSX.Element {
  const { eff, change } = p;
  const c = Array.isArray(eff.center) ? eff.center : [0, 0, 0];
  const at = (i: number, v: number | string) => change({ center: [0, 1, 2].map((k) => (k === i ? v : c[k] ?? 0)) });
  return (
    <Section id="sphere" title={t('opt.sphere.title')}>
      <Num name="radius" label={t('opt.sphere.radius')} value={eff.radius} unit="mm" onChange={(v) => change({ radius: v })} />
      {[t('opt.sphere.centerX'), t('opt.sphere.centerY'), t('opt.sphere.centerZ')].map((label, i) => <Num key={i} name={`center.${i}`} label={label} value={c[i] ?? 0} unit="mm" onChange={(v) => at(i, v)} />)}
      <Select name="op" label={t('opt.op')} value={opChoiceOf(eff.op)} options={opChoices().map((k) => [k, t('opt.op.' + k)] as [string, string])} onChange={(v) => change(opPatch(v as 'new' | 'add' | 'cut', eff, otherBodyNames(p.doc, eff)))} />
      {opChoiceOf(eff.op) === 'new' ? <BodyNameField eff={eff} change={change} /> : null}
    </Section>
  );
}

/** Delete or keep bodies: which bodies (the mode is the generic field). */
function DeleteBodyOptions(p: { eff: Wire }): JSX.Element {
  const bodies = Array.isArray(p.eff.bodies) ? p.eff.bodies : [];
  return (
    <Section id="deleteBody" title={t('opt.move.bodies')}>
      <RefText name="bodies" label={t('opt.move.bodies')} text={bodies.map(bodyRefText).join(', ')} />
    </Section>
  );
}

/** The name a new body gets in the document: the Bodies panel lists it, and later features refer to it. */
function BodyNameField(p: { eff: Wire; change: Change }): JSX.Element {
  return (
    <label class="fedit-fld" data-path="body">
      <span class="fedit-fld-label">{t('opt.bodyName')}</span>
      <input type="text" value={typeof p.eff.body === 'string' ? p.eff.body : ''} spellcheck={false} onChange={(e) => p.change({ body: (e.currentTarget as HTMLInputElement).value.trim() || null })} />
    </label>
  );
}

function ExtrudeOptions(p: { eff: Wire; change: Change; pickingPath?: string | null; onPick?(path: string): void; revolve: boolean; doc: PartDoc | null; actions?: ThinActions }): JSX.Element {
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
      <Section id="op" title={t('opt.op')}>
        <Segmented<string> name="op" label={t('opt.op')} value={opChoiceOf(eff.op)} choices={opChoices()} text={(c) => t('opt.op.' + c)} onChange={(v) => change(opPatch(v as 'new' | 'add' | 'cut', eff, otherBodyNames(p.doc, eff)))} />
        {opChoiceOf(eff.op) === 'new' ? <BodyNameField eff={eff} change={change} /> : null}
        {p.actions?.cutProblem && eff.op === 'cut' ? (
          <div class="fedit-note fedit-warn" role="alert" data-note={'cut-' + p.actions.cutProblem}>
            {t(p.actions.cutProblem === 'nothing' ? 'opt.cut.nothing' : 'opt.cut.miss')}
            <button type="button" data-act="switch-add" onClick={() => change({ op: 'add', flip: null })}>{t('opt.cut.switchAdd')}</button>
          </div>
        ) : null}
      </Section>
      <Section id="options" title={t('opt.section.options')}>
        {end !== 'mid' && end !== 'throughBoth' ? <Check name="flip" label={t('opt.flip')} value={eff.flip} onChange={(v) => change({ flip: v ? true : null })} /> : null}
        {!p.revolve && endAllowsDraft(end) ? <>
          <Num name="draft" label={t('opt.draft')} value={draftAngle} unit="°" plain onChange={(v) => change(patchDraft(eff, Number(v)))} />
          {draftAngle > 0 ? <Check name="draftOut" label={t('opt.draftOut')} value={eff.draftOut} onChange={(v) => change({ draftOut: v ? true : null })} /> : null}
        </> : null}
      </Section>
      <ThinSection eff={eff} change={change} doc={p.doc} actions={p.actions} />
    </>
  );
}


// ---- thin wall (Extrude, Extruded cut, Revolve) ----

/** What the open-profile hint card can do beyond changing the feature's own fields; the app implements them (each is ONE undo step). */
export interface ThinActions {
  /** Add the closing line to the sketch. */
  closeWithLine(sketchId: string): void;
  /** Turn the extrude into a surface extrude. */
  asSurface(): void;
  /** The cut in the editor removed nothing: no body under the sketch (`nothing`) or a body it does not reach (`miss`). */
  cutProblem?: 'nothing' | 'miss' | null;
}

const ARCH = 'M3 14 Q12 0 21 14';
const SIDE_ICON: Record<ThinSide, JSX.Element> = {
  // an arch (the profile curve) with a band on the chosen side: inside = below, outside = above, both = either side, mid = centred
  inside: <svg viewBox="0 0 24 16" width="24" height="16" aria-hidden="true"><path d={ARCH} fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="4" transform="translate(0 2.5)" /><path d={ARCH} fill="none" stroke="currentColor" stroke-width="1.2" /></svg>,
  outside: <svg viewBox="0 0 24 16" width="24" height="16" aria-hidden="true"><path d={ARCH} fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="4" transform="translate(0 -2.5)" /><path d={ARCH} fill="none" stroke="currentColor" stroke-width="1.2" /></svg>,
  both: <svg viewBox="0 0 24 16" width="24" height="16" aria-hidden="true"><path d={ARCH} fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="7" /><path d={ARCH} fill="none" stroke="currentColor" stroke-width="1.2" /></svg>,
  mid: <svg viewBox="0 0 24 16" width="24" height="16" aria-hidden="true"><path d={ARCH} fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="4" /><path d={ARCH} fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2" /></svg>,
};

/** A segmented control: one button per choice, the chosen one pressed. */
function Segmented<T extends string>(p: { name: string; label: string; value: T; choices: T[]; text(c: T): string; icon?(c: T): JSX.Element; onChange(v: T): void }): JSX.Element {
  return (
    <div class="fedit-fld seg" data-path={p.name} role="radiogroup" aria-label={p.label}>
      <span class="fedit-fld-label">{p.label}</span>
      <span class="fedit-seg">
        {p.choices.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={p.value === c} class={'fedit-seg-btn' + (p.value === c ? ' on' : '')} data-value={c} title={p.text(c)} onClick={() => p.onChange(c)}>
            {p.icon ? p.icon(c) : null}<span class="fedit-seg-text">{p.text(c)}</span>
          </button>
        ))}
      </span>
    </div>
  );
}

/** The sketch of the feature holds an open chain (a thin wall can be made of it, with its end caps). */
const hasOpenChain = (doc: PartDoc | null, sketchId: unknown): boolean => {
  const sk = ((doc?.features ?? []) as unknown as Array<{ id: string; type: string }>).find((f) => f.type === 'sketch' && f.id === sketchId);
  return !!sk && sketchOpenChains(sk as never).length > 0;
};

/** The hint that replaces the dead-end "profile is not closed" error: three one-click ways out. */
function OpenProfileCard(p: { info: OpenProfile; eff: Wire; change: Change; revolve: boolean; doc: PartDoc | null; actions?: ThinActions }): JSX.Element {
  const { info, eff, change } = p;
  const g = info.gap;
  const d = g ? String(Math.round(g.distance * 100) / 100) : '';
  return (
    <div class="fedit-card open-profile" role="status" data-card="open-profile">
      <div class="fedit-card-title">{t('opt.open.title')}</div>
      <div class="fedit-card-body">{g ? t(g.near ? 'opt.open.gapNear' : 'opt.open.gap', { d }) : t('opt.open.body')}</div>
      <div class="fedit-card-actions">
        <button type="button" class="fedit-card-btn" data-act="thin" onClick={() => change(patchThinOn(eff, p.doc, true))}>{t('opt.open.thin')}</button>
        <button type="button" class="fedit-card-btn" data-act="close" disabled={!g || !p.actions} title={g ? undefined : t('opt.open.noGap')} onClick={() => p.actions?.closeWithLine(info.sketchId)}>{t('opt.open.close')}</button>
        {!p.revolve ? <button type="button" class="fedit-card-btn" data-act="surface" disabled={!p.actions} onClick={() => p.actions?.asSurface()}>{t('opt.open.surface')}</button> : null}
      </div>
    </div>
  );
}

function ThinSection(p: { eff: Wire; change: Change; doc: PartDoc | null; actions?: ThinActions }): JSX.Element {
  const { eff, change } = p;
  const thin = thinOf(eff);
  const info = thin ? null : openProfile(p.doc, eff.sketch);
  return (
    <>
      {info ? <OpenProfileCard info={info} eff={eff} change={change} revolve={eff.type === 'revolve'} doc={p.doc} actions={p.actions} /> : null}
      <Section id="thin" title={t('opt.section.thin')}>
        <Check name="thin" label={t('opt.thin.on')} value={!!thin} onChange={(v) => change(patchThinOn(eff, p.doc, v))} />
        {thin ? <>
          <Num name="thin.thickness" label={t('opt.thin.thickness')} value={thin.thickness} unit="mm" onChange={(v) => change(patchThin(eff, 'thickness', v))} />
          <Segmented<ThinSide> name="thin.side" label={t('opt.thin.side')} value={thin.side} choices={THIN_SIDES} text={(c) => t('opt.thin.side.' + c)} icon={(c) => SIDE_ICON[c]} onChange={(v) => change(patchThin(eff, 'side', v))} />
          {thin.side === 'both' ? <Num name="thin.thickness2" label={t('opt.thin.thickness2')} value={thin.thickness2 ?? thin.thickness} unit="mm" onChange={(v) => change(patchThin(eff, 'thickness2', v))} /> : null}
          {hasOpenChain(p.doc, eff.sketch) ? <Segmented<ThinEnds> name="thin.ends" label={t('opt.thin.ends')} value={thin.ends} choices={THIN_ENDS} text={(c) => t('opt.thin.ends.' + c)} onChange={(v) => change(patchThin(eff, 'ends', v))} /> : null}
          <Segmented<ThinCorner> name="thin.cornerStyle" label={t('opt.thin.corner')} value={thin.cornerStyle} choices={THIN_CORNERS} text={(c) => t('opt.thin.corner.' + c)} onChange={(v) => change(patchThin(eff, 'cornerStyle', v))} />
        </> : null}
      </Section>
    </>
  );
}

/** "Tangent chain" (fillet and chamfer): on, the edges that continue the picked ones tangentially are rounded too. Switching it re-applies the choice to the feature's own edge list when it came from a known pick. */
function TangentChain(p: { eff: Wire; change: Change }): JSX.Element {
  const [on, setOn] = useState(tangentChainOn());
  const pick = roundPickOf(p.eff.edges);
  const added = pick && Array.isArray(p.eff.edges) ? Math.max(0, p.eff.edges.length - pick.seeds.length) : 0;
  return (
    <>
      <Check name="tangentChain" label={t('opt.round.chain')} value={on} onChange={(v) => { setTangentChain(v); setOn(v); if (pick) p.change({ edges: v ? pick.all : pick.seeds }); }} />
      {added > 0 ? <div class="fedit-note" data-path="tangentChainNote">{t('opt.round.chain.added', { n: String(added) })}</div> : null}
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
      <TangentChain eff={eff} change={change} />
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
      <TangentChain eff={eff} change={change} />
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
  const profileChoices = all.filter((s) => (surface ? s.closed || s.open : s.closed || s.point) || profiles.includes(s.id)).map((s) => (s.point ? { ...s, name: `${t('opt.loft.pointTag')}: ${s.name}` } : s));
  const isPoint = (id: string) => all.some((s) => s.id === id && s.point);
  const issue = surface ? (profiles.some(isPoint) ? 'loftPointSurface' : null) : loftPointIssue(profiles, isPoint) ?? (guides.length && profiles.some(isPoint) ? 'loftPointGuides' : null);
  const autoOrder = surface ? null : loftAutoOrder(p.doc, profiles);
  const guideChoices = all.filter((s) => s.open && !profiles.includes(s.id));
  return (
    <>
      <Section id="loftProfiles" title={t('opt.loft.profiles')}>
        <SketchList name="sketches" label={t('opt.loft.profilesNote')} ids={profiles} list={profileChoices} min={2} addLabel={t('opt.loft.addProfile')} onChange={(ids) => change({ sketches: ids })} />
        {!surface && autoOrder ? <div class="fedit-note fedit-warn" role="alert" data-note="loftOrder">{t('opt.loft.loftOrder')}<button type="button" data-act="auto-order" onClick={() => change({ sketches: autoOrder })}>{t('opt.loft.autoOrder')}</button></div> : null}
        {issue ? <div class="fedit-note fedit-warn" role="alert" data-note={issue}>{t('opt.loft.' + issue)}</div> : <div class="fedit-note" data-note="pointHint">{t('opt.loft.pointHint')}</div>}
      </Section>
      <Section id="loftGuides" title={t('opt.loft.guides')}>
        <SketchList name="guides" label={t('opt.loft.guidesNote')} ids={guides} list={guideChoices} min={0} addLabel={t('opt.loft.addGuide')} onChange={(ids) => change(guidesPatch(ids))} />
      </Section>
      <Section id="loftOptions" title={t('opt.section.options')}>
        <Check name="surface" label={t('opt.loft.surface')} value={surface} onChange={(v) => change({ surface: v ? true : null })} />
        {!surface ? <Select name="op" label={t('opt.op')} value={opChoiceOf(eff.op)} options={opChoices().map((c) => [c, t('opt.op.' + c)] as [string, string])} onChange={(v) => change(opPatch(v as 'new' | 'add' | 'cut', eff, otherBodyNames(p.doc, eff)))} /> : null}
        {!surface && opChoiceOf(eff.op) === 'new' ? <BodyNameField eff={eff} change={change} /> : null}
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
        <Select name="op" label={t('opt.op')} value={opChoiceOf(eff.op)} options={opChoices().map((c) => [c, t('opt.op.' + c)] as [string, string])} onChange={(v) => change(opPatch(v as 'new' | 'add' | 'cut', eff, otherBodyNames(p.doc, eff)))} />
        {opChoiceOf(eff.op) === 'new' ? <BodyNameField eff={eff} change={change} /> : null}
      </Section>
    </>
  );
}

/** Pattern and mirror: the seeds as the user thinks of them ("Hole F4 + Thread F5") and the Carry threads switch. */
function PatternOptions(p: { eff: Wire; change: Change; doc: PartDoc | null }): JSX.Element | null {
  const features = (p.doc?.features ?? []) as unknown as Wire[];
  const infos = seedInfos(features, p.eff);
  const carry = carriesThreads(p.eff);
  const name = (type: string) => t('feature.' + type, undefined, type);
  const anyThread = features.some((f) => f.type === 'thread' && !f.suppressed);
  // The kernel turns a circular pattern about a world axis through the origin only (x, y or z); other references are an error.
  const ax = p.eff.axis as { kind?: string; axis?: string } | undefined;
  const axisNode = p.eff.type === 'cpattern' ? (
    <Section id="patternAxis" title={t('opt.pattern.axis')}>
      <Select name="axis" label={t('opt.pattern.axis')} value={ax?.kind === 'axis' && ax.axis ? ax.axis : 'z'} options={[['x', t('opt.pattern.axis.x')], ['y', t('opt.pattern.axis.y')], ['z', t('opt.pattern.axis.z')]]}
        onChange={(v) => p.change({ axis: { kind: 'axis', axis: v } })} />
    </Section>
  ) : null;
  if (!infos.length && !anyThread) return axisNode;
  return (
    <>
    {axisNode}
    <Section id="patternThreads" title={t('opt.pattern.threads')}>
      <div class="fedit-seeds" data-testid="pattern-seeds">
        {infos.map((i) => <div key={i.id} class="fedit-seed" data-seed={i.id}>{seedLabel(i, name)}</div>)}
      </div>
      <Check name="carryThreads" label={t('opt.pattern.carry')} value={carry} onChange={(v) => p.change(carryPatch(v))} />
      <div class="fedit-hint-line">{t(carry ? 'opt.pattern.carryOn' : 'opt.pattern.carryOff')}</div>
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

/** The Base plane of a reference plane, as a selector: Front / Top / Right, an earlier Plane feature, or the planar face it hangs on. */
function PlaneOptions(p: { eff: Wire; change: Change; doc: PartDoc | null }): JSX.Element {
  const choices = planeBaseChoices(p.doc, String(p.eff.id ?? ''), p.eff.base);
  return (
    <Section id="planeBase" title={t('opt.plane.base')}>
      <Select name="base" label={t('opt.plane.base')} value={planeBaseValue(p.eff.base)} options={choices} onChange={(v) => p.change(planeBasePatch(v))} />
    </Section>
  );
}

/** The `options` prop of FeatureEditor: the form for the feature's type, or null (the generic fields stay). `doc` feeds the sketch and surface lists. */
export function optionsFor(a: OptionsArgs & { eff: Wire }, doc: PartDoc | null = null, actions?: ThinActions): OptionsResult | null {
  const type = String(a.eff.type ?? '');
  const hide = managedPaths(type);
  if (!hide.size) return null;
  const common = { eff: a.eff, change: a.change };
  switch (type) {
    case 'extrude': return { hide, node: <ExtrudeOptions {...common} pickingPath={a.pickingPath} onPick={a.onPickRequest} revolve={false} doc={doc} actions={actions} /> };
    case 'revolve': return { hide, node: <ExtrudeOptions {...common} pickingPath={a.pickingPath} onPick={a.onPickRequest} revolve doc={doc} actions={actions} /> };
    case 'chamfer': return { hide, node: <ChamferOptions {...common} /> };
    case 'fillet': return { hide, node: <FilletOptions {...common} /> };
    case 'shell': return { hide, node: <ShellOptions {...common} /> };
    case 'loft': return { hide, node: <LoftOptions {...common} doc={doc} /> };
    case 'sweep': return { hide, node: <SweepOptions {...common} doc={doc} /> };
    case 'combine': return { hide, node: <CombineOptions {...common} /> };
    case 'sphere': return { hide, node: <SphereOptions {...common} doc={doc} /> };
    case 'moveBody': return { hide, node: <MoveBodyOptions {...common} doc={doc} /> };
    case 'deleteBody': return { hide, node: <DeleteBodyOptions eff={a.eff} /> };
    case 'fill': return { hide, node: <FillOptions {...common} /> };
    case 'extend': return { hide, node: <ExtendOptions {...common} /> };
    case 'lpattern': case 'cpattern': case 'mirror': return { hide, node: <PatternOptions {...common} doc={doc} /> };
    case 'knit': return { hide, node: <KnitOptions {...common} doc={doc} /> };
    case 'plane': return { hide, node: <PlaneOptions {...common} doc={doc} /> };
    case 'trimSurface': return { hide, node: <TrimOptions {...common} doc={doc} /> };
    default: return null;
  }
}
