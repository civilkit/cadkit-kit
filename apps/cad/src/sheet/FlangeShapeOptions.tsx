// The width, shape, holes and relief sections of the edge flange editor (and the width section of the hem editor): the part of the edge the flange
// covers, the outline of its leg, the holes in the leg and the relief beside a partial flange. The patches are in flangeShape.ts; the app side
// (picking points, making the outline sketch) is reached through flangeActions.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { PartDoc } from '@ck/part-model';
import { EditorSection as Section } from '@kit/ui';
import { t } from '../i18n';
import { Check, Num, Select } from '../FeatureOptions';
import { activeRule, sheetThickness } from './model';
import { flangeActions, useSpanPicked } from './flangeActions';
import {
  addHole, circlesOfSketch, holesOf, inlineInfo, isPartial, parsePoint, patchHole, patchHolesFromCircles, patchProfileRect, patchProfileSketch, patchRelief, patchReliefSize,
  patchSpan, patchSpanMode, patchSpanPoints, pointText, profileOf, reliefOf, removeHole, sketchBox, sketchFromProfile, sketchOrigin, spanOf, type SpanMode,
} from './flangeShape';

type Wire = Record<string, unknown>;
type Props = { eff: Wire; change(patch: Wire): void; doc: PartDoc | null; pickingPath?: string | null; onPick?(path: string): void; hem?: boolean };

/** The sketches of the document (id and name) that have something drawn in them and are not the outline of the plate itself (the sketch of a base or contour
 *  flange), for the outline list; the one the flange names stays listed. */
function sketchChoices(doc: PartDoc | null, keep?: string): Array<[string, string]> {
  const plate = new Set((doc?.features ?? []).filter((f) => f.type === 'baseFlange' || f.type === 'contourFlange').map((f) => String((f as unknown as { sketch?: string }).sketch)));
  const out = (doc?.features ?? []).filter((f) => f.type === 'sketch' && ((f as unknown as { entities?: unknown[] }).entities?.length ?? 0) > 0 && (!plate.has(f.id) || f.id === keep))
    .map((f): [string, string] => [f.id, String((f as { name?: string }).name ?? f.id)]);
  if (keep && !out.some(([id]) => id === keep)) out.push([keep, keep]);   // a sketch the outline names that is gone stays visible (the kernel reports it)
  return out;
}

/** How much of the edge the flange covers: all of it, from a start along it for a length, or between two points. */
export function SpanSection(p: Props): JSX.Element {
  const { eff, change, hem } = p;
  const span = spanOf(eff, !!hem);
  const [local, setLocal] = useState<SpanMode>(span.mode);
  const mode: SpanMode = span.mode !== 'whole' ? span.mode : local;
  const picking = p.pickingPath === 'span';
  const got = useSpanPicked();
  // the two points as typed: kept as text so a half-typed point does not jump back
  const [text, setText] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const shownFrom = text.from !== '' || !span.from ? text.from : pointText(span.from);
  const shownTo = text.to !== '' || !span.to ? text.to : pointText(span.to);
  const setPoint = (which: 'from' | 'to', v: string): void => {
    const next = { from: which === 'from' ? v : shownFrom, to: which === 'to' ? v : shownTo };
    setText(next);
    const [a, b] = [parsePoint(next.from), parsePoint(next.to)];
    if (a && b) change(patchSpanPoints(eff, a, b, !!hem));
  };
  const edgeLen = flangeActions.current?.edgeLength(eff) ?? null;
  const modes: Array<[string, string]> = [['whole', t('opt.sheet.span.whole')], ['length', t(hem ? 'opt.sheet.span.start' : 'opt.sheet.span.length')], ['points', t('opt.sheet.span.points')]];
  return (
    <Section id="sheetSpan" title={t('opt.sheet.section.span')} summary={span.mode === 'whole' ? undefined : t('opt.sheet.span.partial')}>
      <Select name="spanMode" label={t('opt.sheet.span.mode')} value={mode} options={modes}
        onChange={(v) => { setLocal(v as SpanMode); setText({ from: '', to: '' }); change(patchSpanMode(eff, v as SpanMode, edgeLen ? +(edgeLen / 2).toPrecision(6) : 20, !!hem)); }} />
      {span.perEdge ? (
        <div class="fedit-note" data-note="perEdge">
          {t('opt.sheet.span.perEdge')}
          <button type="button" class="fedit-pick" data-act="clear-spans" onClick={() => change(patchSpanMode(eff, 'whole', 20, !!hem))}>{t('opt.sheet.span.clear')}</button>
        </div>
      ) : null}
      {mode === 'length' ? (
        <>
          <Num name="start" label={t('opt.sheet.span.startField')} value={span.start ?? 0} unit="mm" onChange={(v) => change(patchSpan(eff, { start: v }, !!hem))} />
          {!hem ? <Num name="length" label={t('opt.sheet.span.lengthField')} value={span.length} unit="mm" onChange={(v) => change(patchSpan(eff, { length: v }, false))} /> : null}
          <div class="fedit-note" data-note="span">{t(hem ? 'opt.sheet.span.noteHem' : 'opt.sheet.span.note')}</div>
        </>
      ) : null}
      {mode === 'points' ? (
        <>
          <label class="fedit-fld" data-path="from">
            <span class="fedit-fld-label">{t('opt.sheet.span.from')}</span>
            <input type="text" value={shownFrom} placeholder="x, y, z" onChange={(e) => setPoint('from', (e.currentTarget as HTMLInputElement).value)} />
          </label>
          <label class="fedit-fld" data-path="to">
            <span class="fedit-fld-label">{t('opt.sheet.span.to')}</span>
            <input type="text" value={shownTo} placeholder="x, y, z" onChange={(e) => setPoint('to', (e.currentTarget as HTMLInputElement).value)} />
          </label>
          {p.onPick ? <button type="button" class={'fedit-pick' + (picking ? ' on' : '')} aria-pressed={picking} data-act="pick-span" onClick={() => p.onPick!('span')}>{picking ? t('opt.sheet.span.done') : t('opt.sheet.span.pick')}</button> : null}
          {picking ? <span class="fedit-pick-note" data-note="pickSpan">{t(got ? 'opt.sheet.span.pickSecond' : 'opt.sheet.span.pickFirst')}</span> : null}
          <div class="fedit-note" data-note="span">{t('opt.sheet.span.notePoints')}</div>
        </>
      ) : null}
    </Section>
  );
}

/** The shape of the leg: a rectangle, the outline of a sketch, or an outline an import made. */
export function ShapeSection(p: Props): JSX.Element {
  const { eff, change, doc } = p;
  const prof = profileOf(eff);
  const [wantSketch, setWantSketch] = useState(false);
  const kind = prof.kind === 'rect' && wantSketch ? 'sketch' : prof.kind;
  const sketchId = prof.kind === 'sketch' ? prof.sketch : '';
  const choices = sketchChoices(doc, sketchId || undefined);
  const kinds: Array<[string, string]> = [['rect', t('opt.sheet.leg.rect')], ['sketch', t('opt.sheet.leg.sketch')]];
  if (prof.kind === 'inline') kinds.push(['inline', t('opt.sheet.leg.inline')]);
  const info = prof.kind === 'inline' ? inlineInfo(prof.segs) : null;
  const check = prof.kind === 'inline' ? sketchFromProfile('x', 'x', { kind: 'std', id: 'front' }, prof.segs) : null;
  return (
    <Section id="sheetLeg" title={t('opt.sheet.section.leg')} summary={prof.kind === 'rect' ? undefined : prof.kind === 'sketch' ? t('opt.sheet.leg.sketchShort') : t('opt.sheet.leg.inlineShort')}>
      <Select name="legShape" label={t('opt.sheet.leg.shape')} value={kind} options={kinds}
        onChange={(v) => {
          if (v === 'rect') { setWantSketch(false); change(patchProfileRect(eff)); }
          else if (v === 'sketch') setWantSketch(true);
        }} />
      {kind === 'sketch' ? (
        <>
          <Select name="legSketch" label={t('opt.sheet.leg.sketchField')} value={sketchId} options={[...(sketchId ? [] : [['', t('opt.sheet.leg.chooseSketch')] as [string, string]]), ...choices]}
            onChange={(v) => { if (v) { setWantSketch(false); change(patchProfileSketch(eff, v)); } }} />
          {sketchId ? <button type="button" class="fedit-pick" data-act="edit-profile-sketch" onClick={() => flangeActions.current?.editSketch(sketchId)}>{t('opt.sheet.leg.editSketch')}</button> : null}
        </>
      ) : null}
      {kind !== 'inline' ? <button type="button" class="fedit-pick" data-act="new-profile-sketch" disabled={!flangeActions.current} onClick={() => flangeActions.current?.newSketch()}>{t('opt.sheet.leg.newSketch')}</button> : null}
      {kind === 'rect' ? <div class="fedit-note" data-note="legRect">{t('opt.sheet.leg.rectNote')}</div> : null}
      {kind === 'sketch' ? <div class="fedit-note" data-note="legSketch">{t('opt.sheet.leg.sketchNote')}</div> : null}
      {prof.kind !== 'rect' ? <div class="fedit-note" data-note="legHeight">{t('opt.sheet.leg.heightNote')}</div> : null}
      {prof.kind === 'inline' && info ? (
        <>
          <div class="fedit-note" data-note="legInline">{t('opt.sheet.leg.inlineNote', { lines: String(info.lines), arcs: String(info.arcs), w: String(+info.width.toFixed(2)), h: String(+info.height.toFixed(2)) })}</div>
          <button type="button" class="fedit-pick" data-act="convert-profile" disabled={!check?.ok || !flangeActions.current} onClick={() => flangeActions.current?.convert()}>{t('opt.sheet.leg.convert')}</button>
          {check && !check.ok ? <div class="fedit-note" data-note="noConvert">{t(check.reason === 'offsetV' ? 'opt.sheet.leg.noConvertV' : 'opt.sheet.leg.noConvertH', { by: String(check.by) })}</div> : null}
        </>
      ) : null}
    </Section>
  );
}

/** The holes of the leg (they need an outline): circles listed with their centre in (v, h) and radius, and circles ticked from a sketch. */
export function HolesSection(p: Props): JSX.Element {
  const { eff, change, doc } = p;
  const prof = profileOf(eff);
  const list = holesOf(eff);
  const withSketch = (doc?.features ?? []).filter((f) => f.type === 'sketch' && circlesOfSketch(doc, f.id).length > 0).map((f): [string, string] => [f.id, String((f as { name?: string }).name ?? f.id)]);
  const own = prof.kind === 'sketch' ? prof.sketch : '';
  const [pick, setPick] = useState('');
  const from = pick || (own && withSketch.some(([id]) => id === own) ? own : withSketch[0]?.[0] ?? '');
  const circles = from ? circlesOfSketch(doc, from) : [];
  // circles are measured from the lower left corner of the outline sketch (the kernel's origin for a sketch outline); for another outline they are as drawn
  const origin: [number, number] = own ? sketchOrigin(doc, own) : [0, 0];
  const box = own ? sketchBox(doc, own) : null;
  const inside = (c: { center: [number, number]; radius: number }): boolean => from === own && !!box && c.center[0] - c.radius > box[0] && c.center[0] + c.radius < box[2] && c.center[1] - c.radius > box[1] && c.center[1] + c.radius < box[3];
  const has = (c: { center: [number, number]; radius: number }): number => list.findIndex((h) => h.kind === 'circle' && Math.hypot(h.center[0] - (c.center[0] - origin[0]), h.center[1] - (c.center[1] - origin[1])) < 1e-4 && Math.abs(h.radius - c.radius) < 1e-4);
  return (
    <Section id="sheetHoles" title={t('opt.sheet.section.holes')} summary={list.length ? String(list.length) : undefined}>
      {prof.kind === 'rect' ? <div class="fedit-note" data-note="holesNeedOutline">{t('opt.sheet.holes.needOutline')}</div> : (
        <>
          {list.map((h, i) => h.kind === 'circle' ? (
            <div class="fedit-fld" data-path={'holes.' + i} key={i}>
              <Num name={'holes' + i + 'v'} label={t('opt.sheet.holes.v', { n: String(i + 1) })} value={h.center[0]} unit="mm" onChange={(v) => change(patchHole(eff, i, { v: Number(v) }))} />
              <Num name={'holes' + i + 'h'} label={t('opt.sheet.holes.h', { n: String(i + 1) })} value={h.center[1]} unit="mm" onChange={(v) => change(patchHole(eff, i, { h: Number(v) }))} />
              <Num name={'holes' + i + 'r'} label={t('opt.sheet.holes.radius', { n: String(i + 1) })} value={h.radius} unit="mm" onChange={(v) => change(patchHole(eff, i, { radius: Number(v) }))} />
              <button type="button" class="fedit-pick" data-act="remove-hole" onClick={() => change(removeHole(eff, i))}>{t('opt.sheet.holes.remove')}</button>
            </div>
          ) : (
            <div class="fedit-note" data-note="holeLoop" key={i}>{t('opt.sheet.holes.loop', { n: String(i + 1), segs: String(h.segs) })}
              <button type="button" class="fedit-pick" data-act="remove-hole" onClick={() => change(removeHole(eff, i))}>{t('opt.sheet.holes.remove')}</button>
            </div>
          ))}
          <button type="button" class="fedit-pick" data-act="add-hole" onClick={() => change(addHole(eff))}>{t('opt.sheet.holes.add')}</button>
          {withSketch.length ? (
            <div class="fedit-fld" data-path="holeCircles" role="group" aria-label={t('opt.sheet.holes.fromSketch')}>
              <Select name="holeSketch" label={t('opt.sheet.holes.fromSketch')} value={from} options={withSketch} onChange={setPick} />
              {circles.map((c) => {
                const auto = inside(c);
                return <Check key={c.id} name={'circle.' + c.id} label={t(auto ? 'opt.sheet.holes.circleAuto' : 'opt.sheet.holes.circle', { id: c.id, d: String(+(c.radius * 2).toFixed(3)) })} value={auto || has(c) >= 0}
                  onChange={(v) => { if (auto) return; const at = has(c); change(v && at < 0 ? patchHolesFromCircles(eff, [c], origin) : !v && at >= 0 ? removeHole(eff, at) : {}); }} />;
              })}
            </div>
          ) : null}
          {prof.kind === 'sketch' ? <div class="fedit-note" data-note="holesSketch">{t('opt.sheet.holes.sketchNote')}</div> : null}
        </>
      )}
    </Section>
  );
}

/** The relief beside a partial flange: none (only the notch), the rule's rectangle, or a rectangle of your own. */
export function ReliefSection(p: Props): JSX.Element | null {
  const { eff, change, doc } = p;
  const partial = isPartial(eff, !!p.hem) || (!p.hem && profileOf(eff).kind !== 'rect');
  if (!partial) return null;
  const r = reliefOf(eff);
  const rule = activeRule(doc);
  const th = sheetThickness(doc);
  const dflt = { width: typeof rule?.reliefWidth === 'number' ? rule.reliefWidth : th, depth: typeof rule?.reliefDepth === 'number' ? rule.reliefDepth : th / 2 };
  const modes: Array<[string, string]> = [['none', t('opt.sheet.relief.none')], ['rectangular', t('opt.sheet.relief.rule', { w: String(dflt.width), d: String(dflt.depth) })], ['custom', t('opt.sheet.relief.custom')]];
  return (
    <Section id="sheetFlangeRelief" title={t('opt.sheet.section.flangeRelief')} summary={r.mode === 'none' ? undefined : (r.mode === 'custom' ? t('opt.sheet.relief.customShort') : t('opt.sheet.relief.ruleShort'))}>
      <Select name="relief" label={t('opt.sheet.relief.mode')} value={r.mode} options={modes} onChange={(v) => change(patchRelief(eff, v as 'none' | 'rectangular' | 'custom', dflt))} />
      {r.mode === 'custom' ? (
        <>
          <Num name="reliefW" label={t('opt.sheet.relief.width')} value={r.width ?? dflt.width} unit="mm" onChange={(v) => change(patchReliefSize(eff, { width: v }))} />
          <Num name="reliefD" label={t('opt.sheet.relief.depth')} value={r.depth ?? dflt.depth} unit="mm" onChange={(v) => change(patchReliefSize(eff, { depth: v }))} />
        </>
      ) : null}
      <div class="fedit-note" data-note="relief">{t('opt.sheet.relief.note')}</div>
    </Section>
  );
}

