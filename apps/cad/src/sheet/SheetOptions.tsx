// The option forms of the sheet metal features. They plug into the generic FeatureEditor through `optionsFor` (FeatureOptions.tsx), so the
// sketch and edge pickers, the preview and Confirm / Cancel are the ones every feature has; these forms draw the numbers and choices.
import type { JSX } from 'preact';
import type { PartDoc } from '@ck/part-model';
import { EditorSection as Section, VarsContext, useScope, type OptionsResult, textAttrs } from '@kit/ui';
import { t } from '../i18n';
import { useState } from 'preact/hooks';
import { Icon } from '@kit/ui';
import { Check, Num, Select } from '../FeatureOptions';
import {
  MAX_THEN, RING, addEdgePick, addThen, contourCurves, cornerSize, cornerText, cornersOf, foldLineOf, panelEdge, patchContourCurve, patchCornerMode, patchFoldCurve, patchFoldSketch,
  patchThen, removeThen, ruleNames, sheetManagedPaths, sketchLines, thenOf, wallChoices,
} from './options';
import { activeRule, rulesOf } from './model';
import { usePanels } from './panels';
import { HolesSection, ReliefSection, ShapeSection, SpanSection } from './FlangeShapeOptions';

type Wire = Record<string, unknown>;
type Change = (patch: Wire) => void;
type Props = { eff: Wire; change: Change; doc: PartDoc | null; pickingPath?: string | null; onPick?(path: string): void };

const SHAPES = (): Array<[string, string]> => [['notch', t('opt.sheet.shape.notch')], ['round', t('opt.sheet.shape.round')], ['rectangular', t('opt.sheet.shape.rectangular')], ['tear', t('opt.sheet.shape.tear')]];
const HEIGHTS = (): Array<[string, string]> => [['outer', t('opt.sheet.heightFrom.outer')], ['inner', t('opt.sheet.heightFrom.inner')], ['tangent', t('opt.sheet.heightFrom.tangent')]];
const POSITIONS = (): Array<[string, string]> => [['inside', t('opt.sheet.position.inside')], ['outside', t('opt.sheet.position.outside')], ['middle', t('opt.sheet.position.middle')]];
const FOLD_POS = (): Array<[string, string]> => [['centerline', t('opt.sheet.foldPosition.centerline')], ['start', t('opt.sheet.foldPosition.start')], ['end', t('opt.sheet.foldPosition.end')], ['mould', t('opt.sheet.foldPosition.mould')]];
const NAME_FOLLOWS = ['bendRadius', 'reliefWidth', 'reliefDepth', 'cornerRelief', 'gap'];

/** The one rules editor: stock (name, thickness, k-factor, bend radius) and relief settings. Empty fields follow the thickness (the kernel's defaults). */
export function SheetRulesOptions(p: Props): JSX.Element {
  const { eff, change } = p;
  const shape = String(eff.cornerReliefShape ?? 'notch');
  // inside a rule, `Thickness` is the rule's own thickness (the kernel reads it), so a field may say =Thickness*2
  const scope = useScope();
  const th = typeof eff.thickness === 'number' ? eff.thickness : 2.5;
  const inRule = { ...scope, values: { ...scope.values, Thickness: th } };
  return (
    <VarsContext.Provider value={inRule}>
      <Section id="sheetStock" title={t('opt.sheet.section.stock')}>
        <label class="fedit-fld" data-path="name">
          <span class="fedit-fld-label">{t('opt.sheet.rule.name')}</span>
          <input {...textAttrs} type="text" value={String(eff.name ?? '')} onChange={(e) => change({ name: (e.currentTarget as HTMLInputElement).value })} />
        </label>
        <Num name="thickness" label={t('opt.sheet.thickness')} value={eff.thickness} unit="mm" onChange={(v) => change({ thickness: v })} />
        <Num name="kFactor" label={t('opt.sheet.kFactor')} value={eff.kFactor} unit="" plain onChange={(v) => change({ kFactor: v })} />
        <Num name="bendRadius" label={t('opt.sheet.bendRadius')} value={eff.bendRadius} unit="mm" onChange={(v) => change({ bendRadius: v })} />
        <Check name="active" label={t('opt.sheet.active')} value={eff.active !== false} onChange={(v) => change({ active: v })} />
      </Section>
      <Section id="sheetRelief" title={t('opt.sheet.section.relief')}>
        <Num name="reliefWidth" label={t('opt.sheet.reliefWidth')} value={eff.reliefWidth} unit="mm" onChange={(v) => change({ reliefWidth: v })} />
        <Num name="reliefDepth" label={t('opt.sheet.reliefDepth')} value={eff.reliefDepth} unit="mm" onChange={(v) => change({ reliefDepth: v })} />
        <Num name="cornerRelief" label={t('opt.sheet.cornerRelief')} value={eff.cornerRelief} unit="mm" onChange={(v) => change({ cornerRelief: v })} />
        <Select name="cornerReliefShape" label={t('opt.sheet.cornerReliefShape')} value={shape} options={SHAPES()} onChange={(v) => change({ cornerReliefShape: v })} />
        {shape !== 'notch' ? <div class="fedit-note" data-note="shape">{t('opt.sheet.shapeNote')}</div> : null}
        <Num name="gap" label={t('opt.sheet.gap')} value={eff.gap} unit="mm" onChange={(v) => change({ gap: v })} />
        <Num name="hemGap" label={t('opt.sheet.hemGap')} value={eff.hemGap} unit="mm" onChange={(v) => change({ hemGap: v })} />
        <div class="fedit-note" data-note="follows">{t('opt.sheet.followsNote')}</div>
        <button type="button" class="fedit-pick" data-act="reset-defaults" onClick={() => change(Object.fromEntries(NAME_FOLLOWS.map((k) => [k, null])))}>{t('opt.sheet.useDefaults')}</button>
      </Section>
    </VarsContext.Provider>
  );
}

/** The rule list of a base or contour flange: the active rule, or one by name. */
function RuleSelect(p: Props): JSX.Element {
  const names = ruleNames(p.doc);
  const cur = typeof p.eff.rule === 'string' ? p.eff.rule : '';
  const opts: Array<[string, string]> = [['', t('opt.sheet.rule.active')], ...names.map((n): [string, string] => [n, n])];
  if (cur && !names.includes(cur)) opts.push([cur, cur]);   // a rule the part no longer has stays visible (the kernel reports it)
  return <Select name="rule" label={t('opt.sheet.rule')} value={cur} options={opts} onChange={(v) => p.change({ rule: v || null })} />;
}

export function BaseFlangeOptions(p: Props): JSX.Element {
  const rules = rulesOf(p.doc);
  return (
    <Section id="sheet" title={t('opt.sheet.section.sheet')}>
      <RuleSelect {...p} />
      {!rules.length ? <div class="fedit-note" data-note="noRule">{t('opt.sheet.noRule')}</div> : null}
      <Check name="flip" label={t('opt.sheet.flip.base')} value={p.eff.flip} onChange={(v) => p.change({ flip: v ? true : null })} />
    </Section>
  );
}

export function ContourFlangeOptions(p: Props): JSX.Element {
  const all = sketchLines(p.doc, p.eff.sketch);
  const on = contourCurves(p.eff, all);
  return (
    <Section id="sheet" title={t('opt.sheet.section.contour')}>
      <RuleSelect {...p} />
      <Num name="distance" label={t('opt.sheet.distance')} value={p.eff.distance} unit="mm" onChange={(v) => p.change({ distance: v })} />
      {all.length > 1 ? (
        <div class="fedit-fld" data-path="curves" role="group" aria-label={t('opt.sheet.curves')}>
          <span class="fedit-fld-label">{t('opt.sheet.curves')}</span>
          {all.map((id) => <Check key={id} name={'curve.' + id} label={id} value={on.includes(id)} onChange={(v) => p.change(patchContourCurve(p.eff, all, id, v))} />)}
        </div>
      ) : null}
      <Check name="flip" label={t('opt.sheet.flip.side')} value={p.eff.flip} onChange={(v) => p.change({ flip: v ? true : null })} />
      <Check name="reverse" label={t('opt.sheet.reverse')} value={p.eff.reverse} onChange={(v) => p.change({ reverse: v ? true : null })} />
    </Section>
  );
}

/** Edge flange and hem on a sheet with more than one panel: add an edge of any panel by role (`P2.tip`, `P1.side.start`) or ring edge (`{ edge, panel }`)
 *  to the edges the viewport picks gave. Not shown while the sheet has a single panel (the viewport pick is enough). */
function PanelEdges(p: Props): JSX.Element | null {
  const { count: panels, walls } = usePanels();
  const [panel, setPanel] = useState(0);
  const [wall, setWall] = useState('');
  const [ring, setRing] = useState(0);
  if (panels < 2) return null;
  const k = Math.min(panel, panels - 1);
  const choices = wallChoices(walls, k);
  const w = wall === RING || choices.includes(wall) ? wall : choices[0];
  const label = (x: string): string => (x === 'tip' ? t('opt.sheet.panel.wall.tip') : x === 'side.start' ? t('opt.sheet.panel.wall.start') : x === 'side.end' ? t('opt.sheet.panel.wall.end') : t('opt.sheet.panel.wall.named', { name: x.replace(/^side\./, '') }));
  const opts: Array<[string, string]> = [...choices.map((x): [string, string] => [x, label(x)]), [RING, t('opt.sheet.panel.wall.ring')]];
  return (
    <Section id="sheetPanel" title={t('opt.sheet.section.panel')}>
      <Select name="panel" label={t('opt.sheet.panel')} value={String(k)} options={Array.from({ length: panels }, (_, i): [string, string] => [String(i), t('opt.sheet.panel.name', { n: String(i) })])} onChange={(v) => setPanel(+v)} />
      <Select name="panelWall" label={t('opt.sheet.panel.where')} value={w} options={opts} onChange={setWall} />
      {w === RING ? <Num name="panelRing" label={t('opt.sheet.panel.ring')} value={ring} unit="" plain onChange={(v) => setRing(typeof v === 'number' ? v : 0)} /> : null}
      <button type="button" class="fedit-pick" data-act="add-panel-edge" onClick={() => p.change(addEdgePick(p.eff, panelEdge(k, w, ring)))}>{t('opt.sheet.panel.add')}</button>
      <div class="fedit-note" data-note="panelEdges">{t('opt.sheet.panel.note')}</div>
    </Section>
  );
}

export function EdgeFlangeOptions(p: Props): JSX.Element {
  const { eff, change } = p;
  const chain = thenOf(eff);
  return (
    <>
      <Section id="sheet" title={t('opt.sheet.section.flange')}>
        <Num name="height" label={t('opt.sheet.height')} value={eff.height} unit="mm" onChange={(v) => change({ height: v })} />
        <Num name="angle" label={t('opt.sheet.angle')} value={eff.angle ?? 90} unit="°" onChange={(v) => change({ angle: v })} />
        <Num name="radius" label={t('opt.sheet.radius')} value={eff.radius} unit="mm" onChange={(v) => change({ radius: v })} />
        <Select name="heightFrom" label={t('opt.sheet.heightFrom')} value={String(eff.heightFrom ?? 'outer')} options={HEIGHTS()} onChange={(v) => change({ heightFrom: v })} />
        <Select name="position" label={t('opt.sheet.position')} value={String(eff.position ?? 'inside')} options={POSITIONS()} onChange={(v) => change({ position: v })} />
        <Check name="flip" label={t('opt.sheet.flip.dir')} value={eff.flip} onChange={(v) => change({ flip: v ? true : null })} />
      </Section>
      <PanelEdges {...p} />
      <SpanSection {...p} />
      <ShapeSection {...p} />
      <HolesSection {...p} />
      <ReliefSection {...p} />
      <Section id="sheetThen" title={t('opt.sheet.section.then')} summary={chain.length ? String(chain.length) : undefined}>
        {chain.map((b, i) => (
          <div class="fedit-fld" data-path={'then.' + i} key={i}>
            <Num name={'then' + i + 'angle'} label={t('opt.sheet.then.angle', { n: String(i + 2) })} value={b.angle ?? 90} unit="°" onChange={(v) => change(patchThen(eff, i, { angle: v }))} />
            <Num name={'then' + i + 'height'} label={t('opt.sheet.then.height', { n: String(i + 2) })} value={b.height} unit="mm" onChange={(v) => change(patchThen(eff, i, { height: v }))} />
            <Check name={'then' + i + 'flip'} label={t('opt.sheet.flip.dir')} value={b.flip} onChange={(v) => change(patchThen(eff, i, { flip: v ? true : undefined }))} />
            <button type="button" class="fedit-pick" data-act="remove-then" onClick={() => change(removeThen(eff, i))}>{t('opt.sheet.then.remove')}</button>
          </div>
        ))}
        <button type="button" class="fedit-pick" data-act="add-then" disabled={chain.length >= MAX_THEN} onClick={() => change(addThen(eff))}>{t('opt.sheet.then.add')}</button>
      </Section>
    </>
  );
}

export function HemOptions(p: Props): JSX.Element {
  return (
    <>
      <Section id="sheet" title={t('opt.sheet.section.hem')}>
        <Num name="length" label={t('opt.sheet.hemLength')} value={p.eff.length} unit="mm" onChange={(v) => p.change({ length: v })} />
        <Num name="gap" label={t('opt.sheet.hemGapField')} value={p.eff.gap} unit="mm" onChange={(v) => p.change({ gap: v })} />
        <Check name="flip" label={t('opt.sheet.flip.dir')} value={p.eff.flip} onChange={(v) => p.change({ flip: v ? true : null })} />
      </Section>
      <PanelEdges {...p} />
      <SpanSection {...p} hem />
      <ReliefSection {...p} hem />
    </>
  );
}

export function FoldOptions(p: Props): JSX.Element {
  const { eff, change, doc } = p;
  const line = foldLineOf(eff);
  const sketches = (doc?.features ?? []).filter((f) => f.type === 'sketch' && sketchLines(doc, f.id).length).map((f): [string, string] => [f.id, String((f as { name?: string }).name ?? f.id)]);
  const lines = sketchLines(doc, line?.sketch);
  const panels = usePanels().count;
  const panel = typeof eff.panel === 'number' ? eff.panel : null;
  return (
    <Section id="sheet" title={t('opt.sheet.section.fold')}>
      {line || !Array.isArray(eff.points) ? (
        <>
          <Select name="foldSketch" label={t('opt.sheet.foldSketch')} value={line?.sketch ?? ''} options={[...(line ? [] : [['', '']] as Array<[string, string]>), ...sketches]} onChange={(v) => change(patchFoldSketch(doc, v))} />
          <Select name="foldCurve" label={t('opt.sheet.foldLine')} value={line?.curve ?? ''} options={lines.map((id): [string, string] => [id, id])} onChange={(v) => change(patchFoldCurve(eff, v))} />
        </>
      ) : <div class="fedit-note" data-note="points">{t('opt.sheet.foldPoints')}</div>}
      <Num name="angle" label={t('opt.sheet.angle')} value={eff.angle ?? 90} unit="°" onChange={(v) => change({ angle: v })} />
      <Num name="radius" label={t('opt.sheet.radius')} value={eff.radius} unit="mm" onChange={(v) => change({ radius: v })} />
      <Select name="position" label={t('opt.sheet.foldPosition')} value={String(eff.position ?? 'centerline')} options={FOLD_POS()} onChange={(v) => change({ position: v })} />
      {panels > 1 || panel !== null ? (
        <Select name="panel" label={t('opt.sheet.panel')} value={panel === null ? '' : String(panel)}
          options={[['', t('opt.sheet.panel.auto')], ...Array.from({ length: Math.max(panels, (panel ?? 0) + 1) }, (_, k): [string, string] => [String(k), t('opt.sheet.panel.name', { n: String(k) })])]}
          onChange={(v) => change({ panel: v === '' ? null : +v })} />
      ) : null}
      <Check name="flip" label={t('opt.sheet.flip.dir')} value={eff.flip} onChange={(v) => change({ flip: v ? true : null })} />
    </Section>
  );
}

/** Convert to sheet: the thickness the kernel reads from the body unless given, and the rule that supplies the k-factor. */
export function ConvertOptions(p: Props): JSX.Element {
  const rule = activeRule(p.doc);
  const ruleT = typeof rule?.thickness === 'number' ? rule.thickness : null;
  const given = typeof p.eff.thickness === 'number' || typeof p.eff.thickness === 'string';
  return (
    <Section id="sheet" title={t('opt.sheet.section.convert')}>
      <Num name="thickness" label={t('opt.sheet.thickness')} value={p.eff.thickness} unit="mm" onChange={(v) => p.change({ thickness: v })} />
      {!given ? <div class="fedit-note" data-note="thicknessAuto">{t('opt.sheet.convert.auto')}</div> : null}
      {ruleT !== null && p.eff.thickness !== ruleT ? <button type="button" class="fedit-pick" data-act="use-rule-thickness" onClick={() => p.change({ thickness: ruleT })}>{t('opt.sheet.convert.useRule', { t: String(ruleT), rule: String(rule?.name ?? '') })}</button> : null}
      {given ? <button type="button" class="fedit-pick" data-act="read-thickness" onClick={() => p.change({ thickness: null })}>{t('opt.sheet.convert.readBody')}</button> : null}
      <RuleSelect {...p} />
      <div class="fedit-note" data-note="convert">{t('opt.sheet.convert.note')}</div>
    </Section>
  );
}

/** Cut across bends: which sketch regions (the Shapes list of the editor) are cut out of the flat pattern. */
export function CutOptions(p: Props): JSX.Element {
  return (
    <Section id="sheet" title={t('opt.sheet.section.cut')}>
      <div class="fedit-note" data-note="cut">{t('opt.sheet.cut.note')}</div>
    </Section>
  );
}

/** Corner round or chamfer: the corners picked in the view (vertex mode), the mode and the size. */
export function CornerOptions(p: Props): JSX.Element {
  const { eff, change } = p;
  const corners = cornersOf(eff);
  const chamfer = eff.mode === 'chamfer';
  const picking = p.pickingPath === 'corners';
  return (
    <>
      <Section id="sheetCorners" title={t('opt.sheet.section.corners')} summary={corners.length ? String(corners.length) : undefined}>
        <div class={'fedit-fld ref' + (picking ? ' picking' : '') + (corners.length ? '' : ' missing')} data-path="corners">
          <span class="fedit-fld-label">{t('opt.sheet.corners')}</span>
          <span class="fedit-ref">
            <span class="fedit-chips">
              <span class="fedit-count">{t(corners.length === 1 ? 'opt.sheet.corners.one' : 'opt.sheet.corners.n', { n: String(corners.length) })}</span>
              {corners.map((c, i) => (
                <span class="fedit-chip" key={i}>
                  <span class="fedit-chip-text">{cornerText(c)}</span>
                  <button type="button" class="fedit-chip-x" aria-label={t('opt.sheet.corners.remove')} title={t('opt.sheet.corners.remove')} onClick={() => change({ corners: corners.filter((_, j) => j !== i) })}><Icon name="close" size={12} /></button>
                </span>
              ))}
            </span>
            {p.onPick ? <button type="button" class={'fedit-pick' + (picking ? ' on' : '')} aria-pressed={picking} data-act="pick-corners" onClick={() => p.onPick!('corners')}>{picking ? t('opt.sheet.corners.done') : t('opt.sheet.corners.pick')}</button> : null}
          </span>
          {picking ? <span class="fedit-pick-note">{t('opt.sheet.corners.pickNote')}</span> : null}
        </div>
      </Section>
      <Section id="sheet" title={t('opt.sheet.section.corner')}>
        <Select name="mode" label={t('opt.sheet.corner.mode')} value={chamfer ? 'chamfer' : 'round'} options={[['round', t('opt.sheet.corner.round')], ['chamfer', t('opt.sheet.corner.chamfer')]]} onChange={(v) => change(patchCornerMode(eff, v === 'chamfer' ? 'chamfer' : 'round'))} />
        <Num name={chamfer ? 'distance' : 'radius'} label={chamfer ? t('opt.sheet.corner.distance') : t('opt.sheet.corner.radius')} value={cornerSize(eff)} unit="mm"
          onChange={(v) => change(chamfer ? { distance: v, size: null } : { radius: v, size: null })} />
        <div class="fedit-note" data-note="corner">{t('opt.sheet.corner.note')}</div>
      </Section>
    </>
  );
}

/** The form for a sheet metal feature type, or null for any other type. */
export function sheetOptionsFor(type: string, p: Props): OptionsResult | null {
  const hide = sheetManagedPaths(type);
  if (!hide.size) return null;
  switch (type) {
    case 'sheetRules': return { hide, node: <SheetRulesOptions {...p} /> };
    case 'baseFlange': return { hide, node: <BaseFlangeOptions {...p} /> };
    case 'contourFlange': return { hide, node: <ContourFlangeOptions {...p} /> };
    case 'edgeFlange': return { hide, node: <EdgeFlangeOptions {...p} /> };
    case 'hem': return { hide, node: <HemOptions {...p} /> };
    case 'fold': return { hide, node: <FoldOptions {...p} /> };
    case 'sheetConvert': return { hide, node: <ConvertOptions {...p} /> };
    case 'sheetCut': return { hide, node: <CutOptions {...p} /> };
    case 'sheetCorner': return { hide, node: <CornerOptions {...p} /> };
    default: return null;
  }
}
