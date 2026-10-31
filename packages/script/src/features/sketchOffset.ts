// Sketch offset: a parallel copy of the chain drawn last. Mixed into SketchBuilder by features/index.ts.
// The geometry is the sketch package's own (the GUI Offset tool): lines and arcs joined at the intersection of their offset curves,
// circles, and fit-point splines.
import type { SketchBuilder } from '../recorder';
import type { DraftEntity, SketchDraft } from '../../../sketch/src/index';
import { applyOffset, chainOf, itemOf, leftIsInside } from '../../../sketch/src/tools/offset';

type Priv = { pointList: Array<Record<string, unknown>>; entities: Array<Record<string, unknown>>; cwArcs: Set<string>; np: number; ne: number };

const WHY: Record<string, string> = {
  'app.sketch.hint.offsetCollapsed': 'the offset is larger than the shape allows (an arc radius or a line would shrink to nothing): use a smaller distance',
  'app.sketch.hint.offsetNoJoin': 'two neighbouring segments have no offset corner (their offset curves do not meet): use a different distance',
  'app.sketch.hint.offsetBranch': 'the chain branches (three or more segments meet at a point); draw the branches in separate sketches',
  'app.sketch.hint.offsetSplineMixed': 'a spline can only be offset on its own, not joined to lines or arcs',
  'app.sketch.hint.offsetSplineCollapsed': 'the spline offset folds over itself (the distance is larger than its tightest bend allows)',
  'app.sketch.hint.degenerate': 'the distance is zero',
  'app.sketch.hint.pickCurve': 'there is nothing to offset: draw a line, arc, circle or spline first (cvspline, text and points cannot be offset)',
};

export const sketchOffset = {
  /**
   * Offset the chain drawn last.
   *
   * Offsets the connected chain that contains the most recently drawn entity: lines and arcs joined end to end (the chain stops at a point where three or more meet), a circle, or one fit-point spline. Corners are re-joined at the intersection of the offset lines, arcs keep their centre and change radius, and a segment that would collapse is dropped. Use it for wall thickness: draw the outside once, offset it for the inside, and no coordinate is calculated by hand. SIGN: for an OPEN chain a positive distance is to the LEFT of the direction of travel (the order the points were given in; walking east, left is +y, towards the top of the sketch), negative to the right. For a CLOSED loop or a circle positive is OUTWARD and negative inward, whichever way it was drawn. The chain drawn before stays unless keep: false (the offset replaces it). The ends of an open chain move along the normal of their end segments; close the profile with your own lines at the known end coordinates. Draw only the chain to offset before the call, and the closing lines after it.
   * @domain sketch
   * @param distance signed offset in mm (see SIGN above), not zero
   * @param o.keep keep the original chain next to its copy (default true); false replaces it with the copy
   * @example
   * part('Cup').sketch('front', (s) => { s.polyline([[0, 0], [20, 0], [20, 40]]); s.offset(-2, { keep: false }); s.polyline([[18, 38], [0, 38]]).polyline([[0, 38], [0, 2]]); }).revolve(360, { axis: { from: [0, 0], to: [0, 1] } });
   * @see sketch.polyline, sketch.arc3, sketch.spline, part.revolve
   */
  offset(this: SketchBuilder, distance: number, o: { keep?: boolean } = {}): SketchBuilder {
    const p = this as unknown as Priv;
    if (typeof distance !== 'number' || !Number.isFinite(distance)) throw new Error('offset(distance): the distance is a number in mm, e.g. s.offset(-2)');
    const last = p.entities[p.entities.length - 1];
    if (!last) throw new Error('offset: nothing is drawn yet; draw the chain (polyline, arc3, spline, circle) before offsetting it');
    const draft: SketchDraft = { id: 'script', plane: null, points: p.pointList as never, entities: p.entities as never, constraints: [], temp: [] };
    // the chain in drawing order: its direction of travel is the one of the first segment drawn
    const order = (id: string) => p.entities.findIndex((e) => e.id === id);
    const ids = (last.type === 'line' || last.type === 'arc' ? chainOf(draft, String(last.id)) : [String(last.id)]).sort((a, b) => order(a) - order(b));
    const item = itemOf(draft, ids);
    if (typeof item === 'string') throw new Error(`offset: ${WHY[item] ?? item}`);
    const closed = item.kind === 'circle' || (item.kind === 'path' ? item.path.closed : item.closed);
    let delta = distance;
    if (closed) delta = leftIsInside(item) ? -distance : distance;
    else if (item.kind === 'path') {
      // the kit walks the chain from one of its ends; the script's left is that of the first segment drawn, walked the way it was drawn
      const first = item.path.segs.find((q) => q.id === ids[0]);
      const drawnForward = !(p.entities[order(ids[0])].type === 'arc' && p.cwArcs.has(ids[0]));
      if (first && first.fwd !== drawnForward) delta = -distance;
    }
    const res = applyOffset(draft, ids, delta);
    if (!res.ok) throw new Error(`offset: ${WHY[res.hint] ?? res.hint}`);
    // the constraints the GUI tool writes (parallel, distance) are not needed for a script: only the geometry is kept
    const gone = new Set(o.keep === false ? ids : []);
    const ents = (res.draft.entities as DraftEntity[]).filter((e) => !gone.has(e.id));
    const refs = (rows: Array<Record<string, unknown>>) => new Set(rows.flatMap((e) => [e.c, e.p, e.p1, e.p2, ...(Array.isArray(e.pts) ? e.pts : [])]).filter((x): x is string => typeof x === 'string'));
    const before = refs(draft.entities), after = refs(ents);
    p.entities = ents as never;
    p.pointList = res.draft.points.filter((q) => q.fixed || after.has(q.id) || !before.has(q.id)) as never;
    const top = (rows: Array<{ id: string }>, rx: RegExp) => rows.reduce((m, r) => Math.max(m, Number(rx.exec(r.id)?.[1] ?? 0)), 0);
    p.np = Math.max(p.np, top(res.draft.points, /^p(\d+)$/));
    p.ne = Math.max(p.ne, top(res.draft.entities, /^e(\d+)$/));
    return this;
  },
};
