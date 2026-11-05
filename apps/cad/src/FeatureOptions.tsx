// Option forms for extrude / cut, revolve, chamfer, fillet and shell: dropdowns for the end condition, chamfer type and
// fillet profile with the dependent fields shown and hidden as the kernel reads them (rules in featureOptions.ts). It plugs
// into the generic FeatureEditor through its `options` prop, so sketch, axis, edges and faces keep their pick buttons and
// the shape list. Only fields the kernel really reads are offered.
import { cutFromPatch, nextBodyName, opChoiceOf, opChoices, opPatch, targetBodiesOf, targetBodyOf, targetPatch } from './extrudeOp';
import { usedBodyNames } from './bodyOps';
import { useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import type { PartDoc } from '@ck/part-model';
import { EditorSection as Section, ExprInput, Icon, type OptionsArgs, type OptionsResult } from '@kit/ui';
import { t } from './i18n';
import {
  CHAMFER_TYPES, FILLET_PROFILES, chamferTypeOf, endAllowsDraft, endNeedsDepth, endAllowsTwist, endNeedsObject, endOf, endsFor, filletFullRound, filletProfileOf, filletVariable, FULL_ROUND_FACES, managedPaths, patchFilletFullRound, patchTwist, patchTwistCentre, twistCentreOf, twistOf,
  objectRefChoices, objectRefPatch, objectRefValue, patchChamferType, patchDraft, patchEnd, patchFilletProfile, patchFilletVariable, patchRadii, patchStart,
  planeBaseChoices, planeBasePatch, planeBaseValue, radiiOf, startAllowed, startOf,
  type ChamferType, type EndCondition, type FilletProfile, type FullRoundFace, type StartCondition,
} from './optionRules';
import {
  THIN_CORNERS, THIN_ENDS, THIN_SIDES, openProfile, patchThin, patchThinOn, thinOf, type OpenProfile, type ThinCorner, type ThinEnds, type ThinSide,
} from './thinRules';
import { sketchOpenChains } from '@kit/sketch';
import { axisChoices } from './revolveAxis';
import { rememberRoundPick, roundPickOf, setTangentChain, tangentChainOn } from './roundChain';
import { loftAutoOrder, loftPointIssue } from './featureCreators';
import { carriesThreads, carryPatch, seedInfos, seedLabel } from './patternThreads';
import {
  AXES, DISTANCE_TYPES, ORIENTATIONS, PATH_DISTANCE_TYPES, axisOf, distanceTypeOf, orientationOf, patchDir2, patchDistanceType, patchStartMode, startModeOf, toChoices, toPatch, toValue,
  type Axis, type DistanceType, type Sfx, type StartMode,
} from './patternRules';
import {
  DEGREE_RANGE, EDIT_METHODS, FREEFORM_FRAMES, PROJECT_DIRECTIONS, addableCurves, curveRefLabel, curveRefs, curvesPatch, degreeOf, degreeOutOfRange, directionOf, edits as ffEdits, editsNeedOneFace,
  entries as curveEntries, entriesPatch, entryFrameOf, faceList, frameOf, keepEndsOn, keepEndsPatch, methodOf, netSize, newEdit, newEntry, parsePoints, patchEntry, patchFrame, patchMethod,
  planarOn, planarPatch, planeChoices, planeRef, planeValue, pointsText, retargetSketchCurve, sourceChoices, sourcePatch, sourceValue,
} from './curveRules';
import {
  CONTINUITIES, FAIRINGS, MAX_STOPS, THICKEN_AXES, addStop, alongOf, centreLineOf, centreLinePatch, connectorPatch, connectorsOf, continuityOf, curveEntities, fairingOf, guidesPatch, knitIds, loftGuides, loftProfiles, move, nextFree, patchStop, patchThickenAxis, patchThickenVariable, pathOf, pathPatch, removeAt, removeStop, replaceAt, stopsOf, thickenAxisOf, thickenVariable,
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

/** A To object / From object reference: a list of the planes (and, for an end, the named bodies) headed by what is picked
 *  now, and a Pick button that takes a face, corner or body from the view. */
function ObjectRefField(p: { name: string; label: string; value: unknown; doc: PartDoc | null; selfId: string; bodies: boolean; picking: boolean; onPick?(path: string): void; onChange(ref: Wire): void }): JSX.Element {
  const options = objectRefChoices(p.doc, p.selfId, p.value, p.bodies);
  return (
    <label class={'fedit-fld ref' + (p.picking ? ' picking' : '')} data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <span class="fedit-ref">
        <select value={objectRefValue(p.value)} onChange={(e) => { const r = objectRefPatch((e.currentTarget as HTMLSelectElement).value); if (r) p.onChange(r); }}>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {p.onPick ? <button type="button" class={'fedit-pick' + (p.picking ? ' on' : '')} aria-pressed={p.picking} onClick={() => p.onPick!(p.name)}>{p.picking ? t('ui.editor.pickDone') : t('ui.editor.pick', undefined, 'Pick')}</button> : null}
      </span>
    </label>
  );
}

const endLabel = (e: string): string => t('opt.end.' + e);

/** The body names the other features of the part use (this feature's own is not counted). */
const otherBodyNames = (doc: PartDoc | null, eff: Wire): Set<string> =>
  usedBodyNames(((doc?.features ?? []) as unknown as Array<Record<string, unknown>>).filter((x) => x.id !== eff.id));

/** Which body an Add or Cut acts on: Automatic (every body the shape reaches) or one of the named bodies of the part. Shown once the part names a body. */
function TargetBody(p: { eff: Wire; change: Change; doc: PartDoc | null }): JSX.Element | null {
  const names = [...otherBodyNames(p.doc, p.eff)];
  const cur = targetBodyOf(p.eff);
  if (cur && !names.includes(cur)) names.push(cur);   // a target the part no longer names stays visible (the kernel reports it)
  if (!names.length) return null;
  return (
    <Select name="target" label={t('opt.target')} value={cur} options={[['', t('opt.target.auto')], ...names.map((n) => [n, n] as [string, string])]} onChange={(v) => p.change(targetPatch(v))} />
  );
}

/** Which bodies a Cut changes: All (every body the shape reaches) or the ticked bodies of the part. Shown once the part names a body. */
function CutFrom(p: { eff: Wire; change: Change; doc: PartDoc | null }): JSX.Element | null {
  const names = [...otherBodyNames(p.doc, p.eff)];
  const cur = targetBodiesOf(p.eff);
  for (const n of cur) if (!names.includes(n)) names.push(n);   // a body the part no longer names stays visible (the kernel reports it)
  if (!names.length) return null;
  return (
    <div class="fedit-fld" data-path="target" role="group" aria-label={t('opt.cutFrom')}>
      <span class="fedit-fld-label">{t('opt.cutFrom')}</span>
      <Check name="target.all" label={t('opt.cutFrom.all')} value={!cur.length} onChange={(v) => p.change(cutFromPatch(v ? [] : names))} />
      {names.map((n) => <Check key={n} name={'target.' + n} label={n} value={cur.includes(n)} onChange={(v) => p.change(cutFromPatch(v ? [...cur, n] : cur.filter((x) => x !== n)))} />)}
    </div>
  );
}

/** The body control of an Add or Cut (not of a New body): Cut from for a cut, Target body for an add. */
function BodyTarget(p: { eff: Wire; change: Change; doc: PartDoc | null }): JSX.Element | null {
  const op = opChoiceOf(p.eff.op);
  return op === 'cut' ? <CutFrom {...p} /> : op === 'add' ? <TargetBody {...p} /> : null;
}

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

/** Scale bodies: one factor for every direction, or one per axis (the kernel stretches along cylinder and cone axes and refuses what it cannot keep exact), and the point it grows from. */
function ScaleOptions(p: { eff: Wire; change: Change }): JSX.Element {
  const { eff, change } = p;
  const raw = eff.factor ?? eff.factors;
  const per = Array.isArray(raw) && raw.length === 3 ? raw : null;
  const uniform = !per || per.every((v) => v === per[0]);
  const one = per ? per[0] : raw ?? 1;
  const at = Array.isArray(eff.at) ? eff.at : Array.isArray(eff.origin) ? eff.origin : null;
  const about = at ? 'point' : eff.about === 'origin' ? 'origin' : 'centroid';
  const bodies = Array.isArray(eff.bodies) ? eff.bodies : eff.bodies !== undefined ? [eff.bodies] : [];
  const axis = (i: number, v: number | string) => change({ factor: [0, 1, 2].map((k) => (k === i ? v : per?.[k] ?? one)), factors: null });
  return (
    <Section id="scale" title={t('opt.scale.title')}>
      <Check name="uniform" label={t('opt.scale.uniform')} value={uniform} onChange={(v) => change({ factor: v ? one : [one, one, one], factors: null })} />
      {uniform
        ? <Num name="factor" label={t('opt.scale.factor')} value={one} unit="" plain onChange={(v) => change({ factor: v, factors: null })} />
        : [t('opt.scale.x'), t('opt.scale.y'), t('opt.scale.z')].map((label, i) => <Num key={i} name={`factor.${i}`} label={label} value={per?.[i] ?? one} unit="" plain onChange={(v) => axis(i, v)} />)}
      <Select name="about" label={t('opt.scale.about')} value={about} options={[['centroid', t('opt.scale.about.centroid')], ['origin', t('opt.scale.about.origin')], ...(at ? [['point', t('opt.scale.about.point')] as [string, string]] : [])]}
        onChange={(v) => change({ about: v === 'origin' ? 'origin' : null, at: v === 'point' ? at : null, origin: null })} />
      {at ? <RefText name="at" label={t('opt.scale.point')} text={at.map(fmtNum).join(', ')} /> : null}
      <RefText name="bodies" label={t('opt.scale.bodies')} text={bodies.length ? bodies.map(bodyRefText).join(', ') : t('opt.scale.all')} />
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

/** The Axis of a revolve as a list of the sketch's straight lines, named in words ('Sketch vertical axis'), or null when the sketch is not known (the generic id field stays). */
export function revolveAxisField(doc: PartDoc | null, eff: Wire): { value: string; options: Array<[string, string]> } | null {
  const sk = (doc?.features ?? []).find((f) => f.id === eff.sketch && f.type === 'sketch') as { id: string; type: string } | undefined;
  if (!sk) return null;
  const options = axisChoices(sk);
  const cur = typeof eff.axis === 'string' ? eff.axis : '';
  if (cur && !options.some(([id]) => id === cur)) options.unshift([cur, cur]);
  if (!cur) options.unshift(['', t('opt.axis.none')]);
  return { value: cur, options };
}

function ExtrudeOptions(p: { eff: Wire; change: Change; pickingPath?: string | null; onPick?(path: string): void; revolve: boolean; doc: PartDoc | null; actions?: ThinActions }): JSX.Element {
  const { eff, change } = p;
  const ends = endsFor(p.revolve ? 'revolve' : 'extrude');
  const raw = endOf(eff);
  const end: EndCondition = raw;
  const options: Array<[string, string]> = ends.map((e) => [e, endLabel(e)]);
  if (!ends.includes(raw)) options.unshift([raw, endLabel(raw)]);   // an end the editor does not offer stays visible (the kernel reports it)
  const draftAngle = typeof eff.draft === 'number' ? eff.draft : 0;
  const axisOf = p.revolve ? revolveAxisField(p.doc, eff) : null;
  return (
    <>
      <Section id="end" title={t('opt.section.end')}>
        <Select name="end" label={t('opt.end')} value={end} options={options} onChange={(v) => change(patchEnd(eff, v as EndCondition))} />
        {!p.revolve && endNeedsDepth(end) ? <Num name="depth" label={end === 'mid' ? t('opt.depth.total') : t('opt.depth')} value={eff.depth} unit="mm" onChange={(v) => change({ depth: v })} /> : null}
        {p.revolve ? <Num name="angle" label={end === 'mid' ? t('opt.angle.total') : t('opt.angle')} value={eff.angle ?? 360} unit="°" onChange={(v) => change({ angle: v })} /> : null}
        {!p.revolve && endNeedsObject(end) ? <>
          <ObjectRefField name="endRef" label={t('opt.endRef')} value={eff.endRef} doc={p.doc} selfId={String(eff.id ?? '')} bodies picking={p.pickingPath === 'endRef'} onPick={p.onPick} onChange={(r) => change({ endRef: r })} />
          <Num name="endOffset" label={t('opt.endOffset')} value={eff.endOffset ?? 0} unit="mm" onChange={(v) => change({ endOffset: v })} />
        </> : null}
        {!p.revolve && startAllowed(end) ? <>
          <Select name="start" label={t('opt.start')} value={startOf(eff)} options={[['sketch', t('opt.start.sketch')], ['fromObject', t('opt.start.fromObject')]]} onChange={(v) => change(patchStart(v as StartCondition))} />
          {startOf(eff) === 'fromObject' ? <>
            <ObjectRefField name="startRef" label={t('opt.startRef')} value={eff.startRef} doc={p.doc} selfId={String(eff.id ?? '')} bodies={false} picking={p.pickingPath === 'startRef'} onPick={p.onPick} onChange={(r) => change({ startRef: r })} />
            <Num name="startOffset" label={t('opt.startOffset')} value={eff.startOffset ?? 0} unit="mm" onChange={(v) => change({ startOffset: v })} />
          </> : null}
        </> : null}
      </Section>
      {axisOf ? <Section id="axis" title={t('opt.axis')}>
        <Select name="axis" label={t('opt.axis')} value={axisOf.value} options={axisOf.options} onChange={(v) => change({ axis: v })} />
      </Section> : null}
      <Section id="op" title={t('opt.op')}>
        <Segmented<string> name="op" label={t('opt.op')} value={opChoiceOf(eff.op)} choices={opChoices()} text={(c) => t('opt.op.' + c)} onChange={(v) => change(opPatch(v as 'new' | 'add' | 'cut', eff, otherBodyNames(p.doc, eff)))} />
        {opChoiceOf(eff.op) === 'new' ? <BodyNameField eff={eff} change={change} /> : null}
        <BodyTarget eff={eff} change={change} doc={p.doc} />
        {p.actions?.cutProblem && eff.op === 'cut' ? (
          <div class="fedit-note fedit-warn" role="alert" data-note={'cut-' + p.actions.cutProblem}>
            {t(p.actions.cutProblem === 'nothing' ? 'opt.cut.nothing' : 'opt.cut.miss')}
            <button type="button" data-act="switch-add" onClick={() => change({ op: 'add', flip: null })}>{t('opt.cut.switchAdd')}</button>
          </div>
        ) : null}
      </Section>
      <Section id="options" title={t('opt.section.options')}>
        {end !== 'mid' && end !== 'throughBoth' ? <Check name="flip" label={t('opt.flip')} value={eff.flip} onChange={(v) => change({ flip: v ? true : null })} /> : null}
        {!p.revolve && endAllowsDraft(end) && twistOf(eff) === 0 ? <>
          <Num name="draft" label={t('opt.draft')} value={draftAngle} unit="°" plain onChange={(v) => change(patchDraft(eff, Number(v)))} />
          {draftAngle > 0 ? <Check name="draftOut" label={t('opt.draftOut')} value={eff.draftOut} onChange={(v) => change({ draftOut: v ? true : null })} /> : null}
        </> : null}
        {!p.revolve && endAllowsTwist(end) && draftAngle === 0 ? <>
          <Num name="twist" label={t('opt.twist')} value={twistOf(eff)} unit="°" onChange={(v) => change(patchTwist(eff, v))} />
          {twistOf(eff) !== 0 ? <>
            <Num name="twistCentreX" label={t('opt.twistCentreX')} value={twistCentreOf(eff)[0]} unit="mm" plain onChange={(v) => change(patchTwistCentre(eff, 0, Number(v)))} />
            <Num name="twistCentreY" label={t('opt.twistCentreY')} value={twistCentreOf(eff)[1]} unit="mm" plain onChange={(v) => change(patchTwistCentre(eff, 1, Number(v)))} />
          </> : null}
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
  /** Fillet / chamfer: the feature's edge list with the edges that continue it tangentially, read on the body it is applied to (null: nothing to add). */
  chainEdges?(eff: Wire): Promise<unknown[] | null>;
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

/** "Tangent chain" (fillet and chamfer): on, the edges that continue the picked ones tangentially are rounded too. Switching it re-applies the choice to the feature's own edge list when it came from a known pick.
 *  Switched on for an edge list of unknown origin (picked with the chain off, or in an earlier session), the chain is followed from that list on the body the feature is applied to. */
function TangentChain(p: { eff: Wire; change: Change; actions?: ThinActions }): JSX.Element {
  const [on, setOn] = useState(tangentChainOn());
  const pick = roundPickOf(p.eff.edges);
  const added = pick && Array.isArray(p.eff.edges) ? Math.max(0, p.eff.edges.length - pick.seeds.length) : 0;
  const toggle = (v: boolean) => {
    setTangentChain(v); setOn(v);
    if (pick) { p.change({ edges: v ? pick.all : pick.seeds }); return; }
    const seeds = p.eff.edges;
    if (v && Array.isArray(seeds) && p.actions?.chainEdges) {
      void p.actions.chainEdges(p.eff).then((all) => {
        if (!all || all.length <= seeds.length || !tangentChainOn()) return;
        rememberRoundPick(seeds, all);
        p.change({ edges: all });
      }).catch(() => { /* the body could not be built: the list stays as picked */ });
    }
  };
  return (
    <>
      <Check name="tangentChain" label={t('opt.round.chain')} value={on} onChange={toggle} />
      {added > 0 ? <div class="fedit-note" data-path="tangentChainNote">{t('opt.round.chain.added', { n: String(added) })}</div> : null}
    </>
  );
}

function ChamferOptions(p: { eff: Wire; change: Change; actions?: ThinActions }): JSX.Element {
  const { eff, change } = p;
  const type = chamferTypeOf(eff);
  const first = type === 'equal' ? t('opt.chamfer.distance') : t('opt.chamfer.distance1');
  return (
    <Section id="chamfer" title={t('opt.section.chamfer')}>
      <Select name="chamferType" label={t('opt.chamfer.type')} value={type} options={CHAMFER_TYPES.map((c): [string, string] => [c, t('opt.chamfer.type.' + c)])} onChange={(v) => change(patchChamferType(eff, v as ChamferType))} />
      <Num name="distance" label={first} value={eff.distance} unit="mm" onChange={(v) => change({ distance: v })} />
      {type === 'distances' ? <Num name="distance2" label={t('opt.chamfer.distance2')} value={eff.distance2} unit="mm" onChange={(v) => change({ distance2: v })} /> : null}
      {type === 'angle' ? <Num name="angle" label={t('opt.chamfer.angle')} value={eff.angle} unit="°" onChange={(v) => change({ angle: v })} /> : null}
      <TangentChain eff={eff} change={change} actions={p.actions} />
    </Section>
  );
}

/** A face name for a full round, taken from the view with Pick (a face name, shown read-only). */
function FaceField(p: { name: string; label: string; value: unknown; picking: boolean; onPick?(path: string): void }): JSX.Element {
  const text = typeof p.value === 'string' ? p.value : '';
  return (
    <label class={'fedit-fld ref' + (p.picking ? ' picking' : '') + (text ? '' : ' missing')} data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <span class="fedit-ref">
        <input type="text" value={text} readonly />
        {p.onPick ? <button type="button" class={'fedit-pick' + (p.picking ? ' on' : '')} aria-pressed={p.picking} onClick={() => p.onPick!(p.name)}>{p.picking ? t('ui.editor.pickDone') : t('ui.editor.pick', undefined, 'Pick')}</button> : null}
      </span>
    </label>
  );
}

function FilletOptions(p: { eff: Wire; change: Change; actions?: ThinActions; pickingPath?: string | null; onPick?(path: string): void }): JSX.Element {
  const { eff, change } = p;
  if (filletFullRound(eff)) {
    return (
      <Section id="fillet" title={t('opt.section.fillet')}>
        <Check name="filletType" label={t('opt.fillet.fullRound')} value onChange={(v) => change(patchFilletFullRound(eff, v))} />
        <div class="fedit-note" data-note="fullRound">{t('opt.fillet.fullRoundNote')}</div>
        {FULL_ROUND_FACES.map((k: FullRoundFace) => <FaceField key={k} name={k} label={t('opt.fillet.' + k)} value={eff[k]} picking={p.pickingPath === k} onPick={p.onPick} />)}
      </Section>
    );
  }
  const variable = filletVariable(eff);
  const profile = filletProfileOf(eff);
  const radii = radiiOf(eff);
  const chord = profile === 'chord';
  return (
    <Section id="fillet" title={t('opt.section.fillet')}>
      <Check name="filletType" label={t('opt.fillet.variable')} value={variable} onChange={(v) => change(patchFilletVariable(eff, v))} />
      <Check name="fullRound" label={t('opt.fillet.fullRound')} value={false} onChange={(v) => change(patchFilletFullRound(eff, v))} />
      {variable ? <>
        <Num name="radii0" label={t(chord ? 'opt.fillet.chord0' : 'opt.fillet.radius0')} value={radii[0]} unit="mm" plain onChange={(v) => change(patchRadii(eff, 0, Number(v)))} />
        <Num name="radii1" label={t(chord ? 'opt.fillet.chord1' : 'opt.fillet.radius1')} value={radii[1]} unit="mm" plain onChange={(v) => change(patchRadii(eff, 1, Number(v)))} />
      </> : <Num name="radius" label={t(chord ? 'opt.fillet.chord' : 'opt.fillet.radius')} value={eff.radius} unit="mm" onChange={(v) => change({ radius: v })} />}
      <Select name="profile" label={t('opt.fillet.profile')} value={profile} options={FILLET_PROFILES.map((f): [string, string] => [f, t('opt.fillet.profile.' + f)])} onChange={(v) => change(patchFilletProfile(eff, v as FilletProfile))} />
      {profile === 'conic' ? <Num name="rho" label={t('opt.fillet.rho')} value={eff.rho ?? 0.5} unit="" onChange={(v) => change({ rho: v })} /> : null}
      {profile === 'curvature' ? <Num name="shape" label={t('opt.fillet.shape')} value={eff.shape ?? 0.5} unit="" onChange={(v) => change({ shape: v })} /> : null}
      <TangentChain eff={eff} change={change} actions={p.actions} />
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
  const centre = centreLineOf(eff);
  const centreChoices = all.filter((s) => (s.open && !profiles.includes(s.id) && !guides.includes(s.id)) || s.id === centre);
  const connectors = connectorsOf(eff, profiles.length);
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
      <Section id="loftCentre" title={t('opt.loft.centreLine')}>
        <SketchSelect name="centreLine" value={centre} list={centreChoices} blank={t('opt.loft.centreNone')} onChange={(id) => change(centreLinePatch(id))} />
        <div class="fedit-note" data-note="centreLineNote">{t('opt.loft.centreNote')}</div>
      </Section>
      <Section id="loftConnectors" title={t('opt.loft.connectors')}>
        <div class="fedit-note" data-note="connectorsNote">{t('opt.loft.connectorsNote')}</div>
        {profiles.map((id, i) => (
          <label class="fedit-fld" data-path={'connectors.' + i} key={id + ':' + i}>
            <span class="fedit-fld-label">{t('opt.loft.connector', { name: all.find((s) => s.id === id)?.name ?? id })}</span>
            <input type="number" min="0" max="1" step="0.05" placeholder={t('opt.loft.connectorAuto')} value={connectors[i] ?? ''}
              onChange={(e) => { const v = (e.currentTarget as HTMLInputElement).value; change(connectorPatch(eff, profiles.length, i, v === '' ? null : Number(v))); }} />
          </label>
        ))}
      </Section>
      <Section id="loftOptions" title={t('opt.section.options')}>
        <Check name="surface" label={t('opt.loft.surface')} value={surface} onChange={(v) => change({ surface: v ? true : null })} />
        {!surface ? <Select name="op" label={t('opt.op')} value={opChoiceOf(eff.op)} options={opChoices().map((c) => [c, t('opt.op.' + c)] as [string, string])} onChange={(v) => change(opPatch(v as 'new' | 'add' | 'cut', eff, otherBodyNames(p.doc, eff)))} /> : null}
        {!surface && opChoiceOf(eff.op) === 'new' ? <BodyNameField eff={eff} change={change} /> : null}
        {!surface ? <BodyTarget eff={eff} change={change} doc={p.doc} /> : null}
        <Num name="startNormal" label={t('opt.loft.startTension')} value={tensionOf(eff, 'startNormal')} unit="" plain onChange={(v) => change(tensionPatch('startNormal', Number(v)))} />
        <Num name="endNormal" label={t('opt.loft.endTension')} value={tensionOf(eff, 'endNormal')} unit="" plain onChange={(v) => change(tensionPatch('endNormal', Number(v)))} />
      </Section>
    </>
  );
}

function ThickenOptions(p: { eff: Wire; change: Change }): JSX.Element {
  const { eff, change } = p;
  const variable = thickenVariable(eff);
  const stops = stopsOf(eff);
  const axis = thickenAxisOf(eff);
  const axes: Array<[string, string]> = THICKEN_AXES.map(([k]): [string, string] => [k, t('opt.thicken.axis.' + k)]);
  if (axis === 'custom') axes.unshift(['custom', alongOf(eff).join(', ')]);
  return (
    <Section id="thickness" title={t('opt.section.thickness')}>
      <Check name="thicknessAt" label={t('opt.thicken.variable')} value={variable} onChange={(v) => change(patchThickenVariable(eff, v))} />
      {variable ? <>
        <Select name="along" label={t('opt.thicken.along')} value={axis} options={axes} onChange={(v) => change(patchThickenAxis(eff, v))} />
        <div class="fedit-note" data-note="stopsNote">{t('opt.thicken.stopsNote')}</div>
        {stops.map(([s, th], i) => (
          <div class="fedit-fld" data-path={'stop.' + i} key={i}>
            <Num name={'stop' + i + 's'} label={t('opt.thicken.stopAt')} value={s} unit="mm" plain onChange={(v) => change(patchStop(eff, i, 0, Number(v)))} />
            <Num name={'stop' + i + 't'} label={t('opt.thicken.stopThickness')} value={th} unit="mm" plain onChange={(v) => change(patchStop(eff, i, 1, Number(v)))} />
            <button type="button" class="fedit-pick" data-act="remove-stop" disabled={stops.length <= 2} onClick={() => change(removeStop(eff, i))}>{t('opt.thicken.removeStop')}</button>
          </div>
        ))}
        <button type="button" class="fedit-pick" data-act="add-stop" disabled={stops.length >= MAX_STOPS} onClick={() => change(addStop(eff))}>{t('opt.thicken.addStop')}</button>
      </> : <Num name="thickness" label={t('opt.thicken.thickness')} value={eff.thickness} unit="mm" onChange={(v) => change({ thickness: v })} />}
    </Section>
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
        <BodyTarget eff={eff} change={change} doc={p.doc} />
      </Section>
    </>
  );
}

type PickArgs = { pickingPath?: string | null; onPick?(path: string): void };

/** The object a To object direction reaches: a plane, an earlier Plane feature, or a face picked in the viewport (Pick). */
function ToObjectField(p: { eff: Wire; change: Change; doc: PartDoc | null; sfx: Sfx } & PickArgs): JSX.Element {
  const name = 'to' + p.sfx;
  const picking = p.pickingPath === name;
  return (
    <label class={'fedit-fld ref' + (picking ? ' picking' : '')} data-path={name}>
      <span class="fedit-fld-label">{t('opt.pattern.to')}</span>
      <span class="fedit-ref">
        <select value={toValue(p.eff[name])} onChange={(e) => p.change(toPatch(p.sfx, (e.currentTarget as HTMLSelectElement).value, p.eff[name]))}>
          {toChoices(p.doc, String(p.eff.id ?? ''), p.eff[name]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {p.onPick ? <button type="button" class={'fedit-pick' + (picking ? ' on' : '')} aria-pressed={picking} title={t('opt.pattern.toPick')} onClick={() => p.onPick!(name)}>{picking ? t('ui.editor.pickDone') : t('ui.editor.pick', undefined, 'Pick')}</button> : null}
      </span>
    </label>
  );
}

/** One direction of a linear pattern (Direction 1, or Direction 2 with its None choice): axis, count, distance type and its value, reverse. */
function PatternDirection(p: { eff: Wire; change: Change; doc: PartDoc | null; sfx: Sfx } & PickArgs): JSX.Element {
  const { eff, change, sfx } = p;
  const k = (b: string) => b + sfx;
  const type = distanceTypeOf(eff, sfx);
  const ax = axisOf(eff, sfx);
  const axes: Array<[string, string]> = AXES.map((a) => [a, t('opt.pattern.axis.' + a)]);
  return (
    <Section id={'patternDir' + (sfx || '1')} title={t(sfx ? 'opt.pattern.dir2' : 'opt.pattern.dir1')}>
      <Select name={k('dir')} label={t('opt.pattern.direction')} value={ax || (sfx ? '' : 'x')} options={sfx ? [['', t('opt.pattern.dirNone')], ...axes] : axes}
        onChange={(v) => change(sfx ? patchDir2(eff, v as Axis | '') : { dir: { kind: 'axis', axis: v } })} />
      {sfx && !ax ? null : (
        <>
          <Num name={k('count')} label={t('opt.pattern.count')} value={eff[k('count')]} unit="" onChange={(v) => change({ [k('count')]: v })} />
          <Select name={k('distanceType')} label={t('opt.pattern.distanceType')} value={type} options={DISTANCE_TYPES.map((d): [string, string] => [d, t('opt.pattern.distanceType.' + d)])}
            onChange={(v) => change(patchDistanceType(eff, sfx, v as DistanceType))} />
          {type === 'spacing' ? <Num name={k('spacing')} label={t('opt.pattern.spacing')} value={eff[k('spacing')]} unit="mm" onChange={(v) => change({ [k('spacing')]: v })} /> : null}
          {type === 'extent' ? <Num name={k('extent')} label={t('opt.pattern.extent')} value={eff[k('extent')]} unit="mm" onChange={(v) => change({ [k('extent')]: v })} /> : null}
          {type === 'toObject' ? (
            <>
              <ToObjectField {...p} />
              <Num name={k('toOffset')} label={t('opt.pattern.toOffset')} value={eff[k('toOffset')] ?? 0} unit="mm" onChange={(v) => change({ [k('toOffset')]: Number(v) === 0 ? null : v })} />
              <div class="fedit-hint-line">{t('opt.pattern.toNote')}</div>
            </>
          ) : (
            <Check name={k('reverse')} label={t('opt.pattern.reverse')} value={eff[k('reverse')]} onChange={(v) => change({ [k('reverse')]: v ? true : sfx ? null : false })} />
          )}
        </>
      )}
    </Section>
  );
}

/** A path pattern: the path sketch, the count and spacing (or extent) along it, where the seed sits, flip and orientation. */
function PathPatternFields(p: { eff: Wire; change: Change; doc: PartDoc | null }): JSX.Element {
  const { eff, change } = p;
  const all = sketchInfos(p.doc);
  const path = pathOf(eff);
  const type = distanceTypeOf(eff);
  const mode = startModeOf(eff);
  return (
    <Section id="pathPattern" title={t('opt.pattern.path')}>
      <label class="fedit-fld" data-path="path"><span class="fedit-fld-label">{t('opt.pattern.pathSketch')}</span>
        <SketchSelect name="path" value={path} list={all.filter((s) => s.open || s.id === path)} blank={t('opt.none')} onChange={(v) => change(pathPatch(v))} /></label>
      <Num name="count" label={t('opt.pattern.count')} value={eff.count} unit="" onChange={(v) => change({ count: v })} />
      <Select name="distanceType" label={t('opt.pattern.distanceType')} value={type} options={PATH_DISTANCE_TYPES.map((d): [string, string] => [d, t('opt.pattern.distanceType.' + d)])}
        onChange={(v) => change(patchDistanceType(eff, '', v as DistanceType))} />
      {type === 'extent'
        ? <Num name="extent" label={t('opt.pattern.extent')} value={eff.extent} unit="mm" onChange={(v) => change({ extent: v })} />
        : <Num name="spacing" label={t('opt.pattern.spacing')} value={eff.spacing} unit="mm" onChange={(v) => change({ spacing: v })} />}
      <Select name="startMode" label={t('opt.pattern.startMode')} value={mode} options={[['distance', t('opt.pattern.startMode.distance')], ['fraction', t('opt.pattern.startMode.fraction')]]}
        onChange={(v) => change(patchStartMode(v as StartMode))} />
      {mode === 'fraction'
        ? <Num name="startFraction" label={t('opt.pattern.startFraction')} value={eff.startFraction ?? 0} unit="" onChange={(v) => change({ startFraction: v })} />
        : <Num name="start" label={t('opt.pattern.start')} value={eff.start ?? 0} unit="mm" onChange={(v) => change({ start: Number(v) === 0 ? null : v })} />}
      <Check name="flip" label={t('opt.pattern.flip')} value={eff.flip} onChange={(v) => change({ flip: v ? true : null })} />
      <Select name="orientation" label={t('opt.pattern.orientation')} value={orientationOf(eff)} options={ORIENTATIONS.map((o): [string, string] => [o, t('opt.pattern.orientation.' + o)])}
        onChange={(v) => change({ orientation: v === 'tangent' ? 'tangent' : null })} />
      <div class="fedit-hint-line">{t('opt.pattern.pathNote')}</div>
    </Section>
  );
}

/** Pattern and mirror: the linear pattern's directions or the path pattern's path, the seeds as the user thinks of them ("Hole F4 + Thread F5") and the Carry threads switch. */
function PatternOptions(p: { eff: Wire; change: Change; doc: PartDoc | null } & PickArgs): JSX.Element | null {
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
  const placeNode = p.eff.type === 'lpattern' ? (
    <>
      <PatternDirection {...p} sfx="" />
      <PatternDirection {...p} sfx="2" />
    </>
  ) : p.eff.type === 'curvepattern' ? <PathPatternFields {...p} /> : null;
  if (!infos.length && !anyThread) return axisNode || placeNode ? <>{axisNode}{placeNode}</> : null;
  return (
    <>
    {axisNode}
    {placeNode}
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

// ---- curves: project curve, edit curve, freeform ----

/** A list of face names: shown as text, set with Pick (the viewport selection fills it and keeps following it until Done). */
function FacesField(p: { eff: Wire; label: string; pickingPath?: string | null; onPick?(path: string): void }): JSX.Element {
  const picking = p.pickingPath === 'faces';
  return (
    <label class={'fedit-fld ref' + (picking ? ' picking' : '')} data-path="faces">
      <span class="fedit-fld-label">{p.label}</span>
      <span class="fedit-ref">
        <input type="text" value={faceList(p.eff).join(', ')} readonly />
        {p.onPick ? <button type="button" class={'fedit-pick' + (picking ? ' on' : '')} aria-pressed={picking} onClick={() => p.onPick!('faces')}>{picking ? t('ui.editor.pickDone') : t('ui.editor.pickSelection')}</button> : null}
      </span>
    </label>
  );
}

function ProjectCurveOptions(p: { eff: Wire; change: Change; doc: PartDoc | null } & PickArgs): JSX.Element {
  const { eff, change } = p;
  const cur = sourceValue(eff);
  const choices = sourceChoices(p.doc, String(eff.id ?? ''), eff);
  return (
    <Section id="projectCurve" title={t('opt.section.projectCurve')}>
      <Select name="source" label={t('opt.projectCurve.source')} value={cur} options={cur ? choices : [['', t('opt.none')], ...choices]} onChange={(v) => { if (v) change(sourcePatch(v)); }} />
      <FacesField eff={eff} label={t('opt.projectCurve.faces')} pickingPath={p.pickingPath} onPick={p.onPick} />
      {faceList(eff).length ? null : <div class="fedit-hint-line" data-note="allFaces">{t('opt.projectCurve.allFaces')}</div>}
      <Select name="direction" label={t('opt.projectCurve.direction')} value={directionOf(eff)} options={PROJECT_DIRECTIONS.map((d): [string, string] => [d, t('opt.projectCurve.direction.' + d)])} onChange={(v) => change({ direction: v === 'both' ? null : v })} />
      <Num name="degree" label={t('opt.curve.degree')} value={eff.degree ?? 3} unit="" plain onChange={(v) => change({ degree: v })} />
      {degreeOutOfRange(eff.degree) ? <div class="fedit-note fedit-warn" role="alert" data-note="degree">{t('opt.curve.degreeRange', { min: String(DEGREE_RANGE.min), max: String(DEGREE_RANGE.max) })}</div> : null}
      <Num name="tolerance" label={t('opt.projectCurve.tolerance')} value={eff.tolerance ?? 0.001} unit="mm" plain onChange={(v) => change({ tolerance: v })} />
      <div class="fedit-hint-line">{t('opt.projectCurve.note')}</div>
    </Section>
  );
}

/** One curve of an Edit curve: a sketch curve (sketch and entity lists), an edge or an earlier curve (shown in words); with a remove button. */
function CurveRow(p: { i: number; refs: Wire[]; doc: PartDoc | null; change: Change }): JSX.Element {
  const { i, refs, doc } = p;
  const r = refs[i];
  const sketches = sketchInfos(doc).filter((s) => curveEntities(doc, s.id).length > 0);
  const set = (next: Wire[]) => p.change(curvesPatch(next));
  return (
    <div class="fedit-order-row" data-index={i}>
      <span class="fedit-order-n">{i + 1}</span>
      {r.kind === 'sketchCurve' ? (
        <>
          <SketchSelect name={`curves.${i}`} value={String(r.sketch)} list={sketches} onChange={(v) => set(retargetSketchCurve(doc, refs, i, { sketch: v }))} />
          <select data-path={`curves.${i}.entity`} value={String(r.entity)} onChange={(e) => set(retargetSketchCurve(doc, refs, i, { entity: (e.currentTarget as HTMLSelectElement).value }))}>
            {(() => { const ids = curveEntities(doc, String(r.sketch)); return (ids.includes(String(r.entity)) ? ids : [String(r.entity), ...ids]).map((id) => <option key={id} value={id}>{id}</option>); })()}
          </select>
        </>
      ) : <span class="fedit-ref-text" data-path={`curves.${i}`}>{curveRefLabel(doc, r)}</span>}
      <button type="button" class="fedit-mini" data-act="remove" title={t('opt.order.remove')} aria-label={t('opt.order.remove')} onClick={() => set(refs.filter((_, k) => k !== i))}>×</button>
    </div>
  );
}

function EditCurveOptions(p: { eff: Wire; change: Change; doc: PartDoc | null }): JSX.Element {
  const { eff, change, doc } = p;
  const refs = curveRefs(eff);
  const method = methodOf(eff);
  const list = curveEntries(eff);
  const free = addableCurves(doc, String(eff.id ?? ''), refs);
  const setEntries = (next: Wire[]) => change(entriesPatch(next));
  return (
    <>
      <Section id="editCurveCurves" title={t('opt.editCurve.curves')}>
        <div class="fedit-order" data-path="curves">
          <div class="fedit-fld-label">{t('opt.editCurve.curvesNote')}</div>
          {refs.map((_, i) => <CurveRow key={i} i={i} refs={refs} doc={doc} change={change} />)}
          <button type="button" class="fedit-pick" data-act="add" disabled={!free.length} onClick={() => free.length && change(curvesPatch([...refs, free[0]]))}>{t('opt.editCurve.addCurve')}</button>
        </div>
      </Section>
      <Section id="editCurveFit" title={t('opt.editCurve.fit')}>
        <Select name="method" label={t('opt.editCurve.method')} value={method} options={EDIT_METHODS.map((m): [string, string] => [m, t('opt.editCurve.method.' + m)])} onChange={(v) => change(patchMethod(eff, v as 'count' | 'tolerance'))} />
        <Num name="degree" label={t('opt.curve.degree')} value={eff.degree ?? 5} unit="" plain onChange={(v) => change({ degree: v })} />
        {degreeOutOfRange(eff.degree) ? <div class="fedit-note fedit-warn" role="alert" data-note="degree">{t('opt.curve.degreeRange', { min: String(DEGREE_RANGE.min), max: String(DEGREE_RANGE.max) })}</div> : null}
        {method === 'count'
          ? <Num name="count" label={t('opt.editCurve.count')} value={eff.count ?? degreeOf(eff) + 1} unit="" plain onChange={(v) => change({ count: v })} />
          : <Num name="tolerance" label={t('opt.editCurve.tolerance')} value={eff.tolerance ?? 0.01} unit="mm" plain onChange={(v) => change({ tolerance: v })} />}
        <Check name="keepEnds" label={t('opt.editCurve.keepEnds')} value={keepEndsOn(eff)} onChange={(v) => change(keepEndsPatch(v))} />
        <Check name="keepTangents" label={t('opt.editCurve.keepTangents')} value={eff.keepTangents} onChange={(v) => change({ keepTangents: v ? true : null })} />
        <Check name="keepCorners" label={t('opt.editCurve.keepCorners')} value={eff.keepCorners} onChange={(v) => change({ keepCorners: v ? true : null })} />
        <Check name="planar" label={t('opt.editCurve.planar')} value={planarOn(eff)} onChange={(v) => change(planarPatch(eff, v))} />
        {planarOn(eff) ? <Select name="plane" label={t('opt.editCurve.plane')} value={planeValue(eff.plane)} options={planeChoices(doc, String(eff.id ?? ''), eff.plane)} onChange={(v) => change({ plane: planeRef(v) })} /> : null}
      </Section>
      <Section id="editCurveEdits" title={t('opt.editCurve.edits')}>
        <div class="fedit-order" data-path="entries">
          <div class="fedit-fld-label">{t('opt.editCurve.editsNote')}</div>
          {list.map((e, i) => (
            <div class="fedit-edit" key={i} data-index={i}>
              <div class="fedit-order-row">
                <span class="fedit-order-n">{i + 1}</span>
                <Num name={`entries.${i}.cv`} label={t('opt.editCurve.cv')} value={e.cv} unit="" plain onChange={(v) => setEntries(patchEntry(list, i, { cv: Number(v) }))} />
                <button type="button" class="fedit-mini" data-act="remove" title={t('opt.order.remove')} aria-label={t('opt.order.remove')} onClick={() => setEntries(list.filter((_, k) => k !== i))}>×</button>
              </div>
              <Select name={`entries.${i}.frame`} label={t('opt.editCurve.frame')} value={entryFrameOf(e)} options={[['world', t('opt.editCurve.frame.world')], ['curve', t('opt.editCurve.frame.curve')]]} onChange={(v) => setEntries(patchEntry(list, i, { frame: v === 'curve' ? 'curve' : null }))} />
              {(['dx', 'dy', 'dz'] as const).map((k) => <Num key={k} name={`entries.${i}.${k}`} label={t('opt.editCurve.' + k)} value={e[k] ?? 0} unit="mm" onChange={(v) => setEntries(patchEntry(list, i, { [k]: v }))} />)}
              <Num name={`entries.${i}.weight`} label={t('opt.editCurve.weight')} value={e.weight ?? 1} unit="" plain onChange={(v) => setEntries(patchEntry(list, i, { weight: Number(v) === 1 ? null : v }))} />
              <Check name={`entries.${i}.disabled`} label={t('opt.editCurve.disabled')} value={e.disabled} onChange={(v) => setEntries(patchEntry(list, i, { disabled: v ? true : null }))} />
            </div>
          ))}
          <button type="button" class="fedit-pick" data-act="add-edit" onClick={() => setEntries([...list, newEntry(list)])}>{t('opt.editCurve.addEdit')}</button>
        </div>
      </Section>
    </>
  );
}

function FreeformOptions(p: { eff: Wire; change: Change; doc: PartDoc | null } & PickArgs): JSX.Element {
  const { eff, change, doc } = p;
  const list = ffEdits(eff);
  const [nu, nv] = netSize(eff);
  const setEdits = (next: Wire[]) => change({ edits: next });
  const patch = (i: number, q: Wire) => setEdits(patchEntry(list, i, q));
  return (
    <>
      <Section id="freeformNet" title={t('opt.freeform.net')}>
        <FacesField eff={eff} label={t('opt.freeform.faces')} pickingPath={p.pickingPath} onPick={p.onPick} />
        <Num name="degreeU" label={t('opt.freeform.degreeU')} value={eff.degreeU ?? 3} unit="" plain onChange={(v) => change({ degreeU: v })} />
        <Num name="degreeV" label={t('opt.freeform.degreeV')} value={eff.degreeV ?? 3} unit="" plain onChange={(v) => change({ degreeV: v })} />
        <Num name="spansU" label={t('opt.freeform.spansU')} value={eff.spansU ?? 2} unit="" plain onChange={(v) => change({ spansU: v })} />
        <Num name="spansV" label={t('opt.freeform.spansV')} value={eff.spansV ?? 2} unit="" plain onChange={(v) => change({ spansV: v })} />
        <div class="fedit-hint-line" data-note="net">{t('opt.freeform.netNote', { nu: String(nu), nv: String(nv) })}</div>
        {editsNeedOneFace(eff) ? <div class="fedit-note fedit-warn" role="alert" data-note="oneFace">{t('opt.freeform.oneFace')}</div> : null}
      </Section>
      <Section id="freeformEdits" title={t('opt.freeform.edits')}>
        <div class="fedit-order" data-path="edits">
          <div class="fedit-fld-label">{t('opt.freeform.editsNote')}</div>
          {list.map((e, i) => {
            const frame = frameOf(e);
            const sym = planeValue(e.symmetric);
            return (
              <div class="fedit-edit" key={i} data-index={i}>
                <div class="fedit-order-row">
                  <span class="fedit-order-n">{i + 1}</span>
                  <label class="fedit-fld" data-path={`edits.${i}.points`}>
                    <span class="fedit-fld-label">{t('opt.freeform.points')}</span>
                    <input type="text" value={pointsText(e.points)} placeholder="2,2; 2,3" onChange={(ev) => { const pts = parsePoints((ev.currentTarget as HTMLInputElement).value); if (pts) patch(i, { points: pts }); }} />
                  </label>
                  <button type="button" class="fedit-mini" data-act="remove" title={t('opt.order.remove')} aria-label={t('opt.order.remove')} onClick={() => setEdits(list.filter((_, k) => k !== i))}>×</button>
                </div>
                {(['dx', 'dy', 'dz'] as const).map((k) => <Num key={k} name={`edits.${i}.${k}`} label={t('opt.editCurve.' + k)} value={e[k] ?? 0} unit="mm" onChange={(v) => patch(i, { [k]: v })} />)}
                <Select name={`edits.${i}.frame`} label={t('opt.freeform.frame')} value={frame} options={FREEFORM_FRAMES.map((f): [string, string] => [f, t('opt.freeform.frame.' + f)])} onChange={(v) => patch(i, patchFrame(e, v as 'world' | 'surface' | 'plane'))} />
                {frame === 'plane' ? <Select name={`edits.${i}.plane`} label={t('opt.freeform.plane')} value={planeValue(e.plane)} options={planeChoices(doc, String(eff.id ?? ''), e.plane)} onChange={(v) => patch(i, { plane: planeRef(v) })} /> : null}
                <Num name={`edits.${i}.proportional`} label={t('opt.freeform.proportional')} value={e.proportional ?? 0} unit="" plain onChange={(v) => patch(i, { proportional: Number(v) > 0 ? v : null })} />
                <Select name={`edits.${i}.symmetric`} label={t('opt.freeform.symmetric')} value={sym} options={[['', t('opt.none')], ...planeChoices(doc, String(eff.id ?? ''), e.symmetric)]} onChange={(v) => patch(i, { symmetric: v ? planeRef(v) : null })} />
                <Check name={`edits.${i}.disabled`} label={t('opt.editCurve.disabled')} value={e.disabled} onChange={(v) => patch(i, { disabled: v ? true : null })} />
              </div>
            );
          })}
          <button type="button" class="fedit-pick" data-act="add-edit" onClick={() => setEdits([...list, newEdit(eff)])}>{t('opt.freeform.addEdit')}</button>
        </div>
      </Section>
    </>
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
    case 'revolve': return { hide: revolveAxisField(doc, a.eff) ? new Set([...hide, 'axis']) : hide, node: <ExtrudeOptions {...common} pickingPath={a.pickingPath} onPick={a.onPickRequest} revolve doc={doc} actions={actions} /> };
    case 'chamfer': return { hide, node: <ChamferOptions {...common} actions={actions} /> };
    case 'fillet': return { hide: filletFullRound(a.eff) ? new Set([...hide, 'edges']) : hide, node: <FilletOptions {...common} actions={actions} pickingPath={a.pickingPath} onPick={a.onPickRequest} /> };
    case 'shell': return { hide, node: <ShellOptions {...common} /> };
    case 'loft': return { hide, node: <LoftOptions {...common} doc={doc} /> };
    case 'sweep': return { hide, node: <SweepOptions {...common} doc={doc} /> };
    case 'combine': return { hide, node: <CombineOptions {...common} /> };
    case 'sphere': return { hide, node: <SphereOptions {...common} doc={doc} /> };
    case 'scale': return { hide, node: <ScaleOptions {...common} /> };
    case 'moveBody': return { hide, node: <MoveBodyOptions {...common} doc={doc} /> };
    case 'deleteBody': return { hide, node: <DeleteBodyOptions eff={a.eff} /> };
    case 'fill': return { hide, node: <FillOptions {...common} /> };
    case 'extend': return { hide, node: <ExtendOptions {...common} /> };
    case 'lpattern': case 'cpattern': case 'mirror': case 'curvepattern': return { hide, node: <PatternOptions {...common} doc={doc} pickingPath={a.pickingPath} onPick={a.onPickRequest} /> };
    case 'knit': return { hide, node: <KnitOptions {...common} doc={doc} /> };
    case 'thicken': return { hide, node: <ThickenOptions {...common} /> };
    case 'plane': return { hide, node: <PlaneOptions {...common} doc={doc} /> };
    case 'trimSurface': return { hide, node: <TrimOptions {...common} doc={doc} /> };
    case 'projectCurve': return { hide, node: <ProjectCurveOptions {...common} doc={doc} pickingPath={a.pickingPath} onPick={a.onPickRequest} /> };
    case 'editCurve': return { hide, node: <EditCurveOptions {...common} doc={doc} /> };
    case 'freeform': return { hide, node: <FreeformOptions {...common} doc={doc} pickingPath={a.pickingPath} onPick={a.onPickRequest} /> };
    default: return null;
  }
}
