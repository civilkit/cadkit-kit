import { describe, expect, it } from 'vitest';
import type { DraftConstraint, SketchDraft } from './index';
import { annotate } from './annotations';
import { angleSpec } from './tools/constraints';
import { layoutDimensions, obbOverlap, segmentObb, labelSize, type Obb, type PlacedDim, type ToPx } from './dimLayout';

/** The typed outline of the PET bottle: base, bevel, body, spline shoulder, neck, support ring, mouth, back down the axis. */
function bottle(): SketchDraft {
  const xy: Array<[number, number]> = [[0, 10], [5, 10], [15, 0], [25, 0], [35, 10], [35, 130], [35, 145], [25, 160], [15, 175], [15, 185], [20, 185], [20, 190], [15, 190], [15, 200], [0, 200]];
  const points = [{ id: 'O', x: 0, y: 0, fixed: true }, ...xy.map(([x, y], i) => ({ id: `p${i + 1}`, x, y }))];
  const line = (i: number, a: string, b: string) => ({ id: `e${i}`, type: 'line', p1: a, p2: b });
  const entities: Array<{ id: string; type: string; p1?: string; p2?: string; pts?: string[] }> = [
    line(1, 'p1', 'p2'), line(2, 'p2', 'p3'), line(3, 'p3', 'p4'), line(4, 'p4', 'p5'), line(5, 'p5', 'p6'),
    { id: 'e6', type: 'spline', pts: ['p6', 'p7', 'p8', 'p9'] },
    line(7, 'p9', 'p10'), line(8, 'p10', 'p11'), line(9, 'p11', 'p12'), line(10, 'p12', 'p13'), line(11, 'p13', 'p14'), line(12, 'p14', 'p15'), line(13, 'p15', 'p1'),
  ];
  const len = (a: string, b: string) => { const p = points.find((q) => q.id === a)!, q = points.find((r) => r.id === b)!; return Math.hypot(p.x - q.x, p.y - q.y); };
  const constraints: DraftConstraint[] = entities.filter((e) => e.type === 'line').map((e, i) => ({ id: `k${i + 1}`, type: 'distance', refs: [String(e.p1), String(e.p2)], value: len(String(e.p1), String(e.p2)) }));
  // the angles at the bevel corners
  [['e1', 'e2', 125], ['e2', 'e3', 135], ['e3', 'e4', 135], ['e4', 'e5', 135]].forEach(([a, b, v], i) => constraints.push({ id: `a${i + 1}`, type: 'angle', refs: [String(a), String(b)], value: Number(v) }));
  return { id: 'F1', plane: { kind: 'std', id: 'front' }, points, entities, constraints, temp: [] } as unknown as SketchDraft;
}

/** Front plane as the screen shows it at `z` pixels per mm: x right, y up (so down on the screen), the bottle's foot near the bottom. */
const view = (z: number, mirror = false): ToPx => (u, v) => ({ x: 300 + (mirror ? -u : u) * z, y: 760 - v * z });
const VIEWPORT = { w: 1000, h: 800 };
const rectOf = (d: PlacedDim): Obb => ({ x: d.label.x, y: d.label.y, hw: d.label.w / 2, hh: d.label.h / 2, a: (d.label.slopeDeg * Math.PI) / 180 });

describe('dimension layout on the bottle outline', () => {
  for (const z of [1.9, 3.4]) {
    it(`at ${z} px/mm: no label touches another label or another segment's hit zone, and the long ones are shown`, () => {
      const d = bottle();
      const to = view(z);
      const placed = layoutDimensions(d, annotate(d), { to, viewport: VIEWPORT });
      const shown = placed.filter((p) => !p.hidden);
      expect(placed).toHaveLength(16);
      for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
        expect(obbOverlap(rectOf(shown[i]), rectOf(shown[j])), `${shown[i].text} / ${shown[j].text}`).toBe(false);
      }
      // another segment's hit zone: every line of the outline except the ones the dimension measures
      for (const p of shown) {
        const c = d.constraints.find((k) => k.id === p.id)!;
        const own = new Set(d.entities.filter((e) => c.refs!.every((r) => r === e.p1 || r === e.p2) || c.refs!.includes(e.id)).map((e) => e.id));
        for (const e of d.entities) {
          if (own.has(e.id) || e.type !== 'line') continue;
          const a = d.points.find((q) => q.id === e.p1)!, b = d.points.find((q) => q.id === e.p2)!;
          const pa = to(a.x, a.y)!, pb = to(b.x, b.y)!;
          expect(obbOverlap(rectOf(p), segmentObb(pa, pb)), `${p.text} on ${e.id}`).toBe(false);
        }
      }
      // the long dimensions keep the first level and are never the ones given up
      for (const id of ['k5', 'k12']) { const p = placed.find((q) => q.id === id)!; expect(p.hidden).toBe(false); expect(p.level).toBe(1); }
      // at the larger zoom most of them fit
      if (z > 3) expect(shown.length).toBeGreaterThanOrEqual(12);
      for (const p of shown) { expect(p.label.x).toBeGreaterThan(0); expect(p.label.x).toBeLessThan(VIEWPORT.w); expect(p.label.y).toBeGreaterThan(0); expect(p.label.y).toBeLessThan(VIEWPORT.h); }
    });
  }

  it('texts are upright (-90..90) and the same whether the view is mirrored or not', () => {
    const d = bottle();
    for (const mirror of [false, true]) {
      const placed = layoutDimensions(d, annotate(d), { to: view(3.4, mirror), viewport: VIEWPORT });
      for (const p of placed.filter((q) => !q.hidden)) { expect(p.label.slopeDeg).toBeGreaterThan(-90 - 1e-9); expect(p.label.slopeDeg).toBeLessThanOrEqual(90 + 1e-9); }
    }
  });

  it('a segment shorter than its label gets the text outside the extension lines', () => {
    const d = bottle();
    const placed = layoutDimensions(d, annotate(d), { to: view(1.9), viewport: VIEWPORT });
    const k1 = placed.find((p) => p.id === 'k1')!;      // 5 mm = 9.5 px against a 40 px label
    expect(k1.outside).toBe(true);
    expect(placed.find((p) => p.id === 'k5')!.outside).toBe(false);   // 120 mm
    const lbl = labelSize(k1.text);
    expect(k1.label.w).toBe(lbl.w);
  });

  it('labels stay out of the controls and inside the view', () => {
    const d = bottle();
    const to = view(3.4);
    const keepOut = [{ x: 0, y: 0, w: 1000, h: 90 }];            // a bar over the top of the drawing
    const placed = layoutDimensions(d, annotate(d), { to, viewport: VIEWPORT, keepOut });
    for (const p of placed.filter((q) => !q.hidden)) expect(p.label.y - p.label.h / 2).toBeGreaterThanOrEqual(90 - 1);
    const tiny = layoutDimensions(d, annotate(d), { to, viewport: { w: 200, h: 200 } });
    for (const p of tiny.filter((q) => !q.hidden)) { expect(p.label.x - p.label.w / 2).toBeGreaterThanOrEqual(0); expect(p.label.x + p.label.w / 2).toBeLessThanOrEqual(200); }
  });

  it('when no place is free the label is hidden, not drawn over others; hovering what it measures lets it peek', () => {
    const d = bottle();
    const crowded = layoutDimensions(d, annotate(d), { to: view(0.4), viewport: VIEWPORT });
    expect(crowded.some((p) => p.hidden)).toBe(true);
    const hidden = crowded.find((p) => p.hidden)!;
    const c = d.constraints.find((k) => k.id === hidden.id)!;
    expect(hidden.peek).toBe(false);
    const hov = layoutDimensions(d, annotate(d), { to: view(0.4), viewport: VIEWPORT, focus: new Set(c.refs!) });
    expect(hov.find((p) => p.id === hidden.id)!.peek).toBe(true);
  });

  it('long dimensions are placed first, so a short one never pushes them out', () => {
    const d = bottle();
    const all = layoutDimensions(d, annotate(d), { to: view(1.9), viewport: VIEWPORT });
    const onlyLong = layoutDimensions({ ...d, constraints: d.constraints.filter((k) => ['k5', 'k12'].includes(k.id)) }, annotate({ ...d, constraints: d.constraints.filter((k) => ['k5', 'k12'].includes(k.id)) }), { to: view(1.9), viewport: VIEWPORT });
    for (const id of ['k5', 'k12']) {
      const a = all.find((p) => p.id === id)!, b = onlyLong.find((p) => p.id === id)!;
      expect([a.level, a.side]).toEqual([b.level, b.side]);
    }
  });
});

describe('the density setting', () => {
  const run = (display: 'all' | 'driving' | 'selected', extra: Partial<Parameters<typeof layoutDimensions>[2]> = {}) => {
    const d = bottle();
    // one reference dimension beside the driving ones
    const anns = [...annotate(d), ...annotate({ ...d, constraints: [{ id: 'r1', type: 'distance', refs: ['p5', 'p6'], value: 120 }] }).map((a) => ({ ...a, id: 'r1', driven: true }))];
    return layoutDimensions(d, anns, { to: view(3.4), viewport: VIEWPORT, display, ...extra });
  };
  it('All shows driving and reference ones', () => {
    const p = run('all');
    expect(p.find((x) => x.id === 'r1')!.hidden).toBe(false);
    expect(p.find((x) => x.id === 'k1')).toBeTruthy();
  });
  it('Driving only hides the reference ones', () => {
    const p = run('driving');
    expect(p.find((x) => x.id === 'r1')!.hidden).toBe(true);
    expect(p.find((x) => x.id === 'k5')!.hidden).toBe(false);
  });
  it('Selected only shows a dimension when its entity is selected or hovered, or the Dimension tool is active', () => {
    expect(run('selected').every((x) => x.hidden)).toBe(true);
    const sel = run('selected', { focus: new Set(['e5']) });
    expect(sel.filter((x) => !x.hidden).map((x) => x.id).sort()).toEqual(['a4', 'k5', 'r1']);
    expect(sel.find((x) => x.id === 'k5')!.hidden).toBe(false);
    expect(sel.find((x) => x.id === 'k12')!.hidden).toBe(true);
    expect(run('selected', { dimensionTool: true }).filter((x) => x.hidden).length).toBeLessThan(run('all').length);
  });
});

describe('angle dimensions on every corner of the bottle outline', () => {
  /** The bottle with an interior angle dimension at each corner where two lines meet (right angles as squares). */
  function withAngles(): SketchDraft {
    const d = bottle();
    const lines = d.entities.filter((e) => e.type === 'line');
    const extra: DraftConstraint[] = [];
    const done = new Set<string>();
    for (const a of lines) for (const b of lines) {
      const key = [a.id, b.id].sort().join('|');
      const shared = a.id !== b.id && [a.p1, a.p2].find((x) => x === b.p1 || x === b.p2);
      if (!shared || done.has(key)) continue;
      done.add(key);
      const spec = angleSpec(d, a.id, b.id)!;
      extra.push({ id: `x${extra.length + 1}`, type: 'angle', refs: [...spec.refs], value: Math.round(spec.measured * 1e6) / 1e6, ...(Object.keys(spec.extra).length ? spec.extra : {}) } as DraftConstraint);
    }
    return { ...d, constraints: [...d.constraints.filter((c) => c.type !== 'angle'), ...extra] };
  }
  for (const z of [1.9, 3.4]) {
    it(`at ${z} px/mm: all corners dimensioned, no label overlaps another label or another segment's hit zone`, () => {
      const d = withAngles();
      const angles = d.constraints.filter((c) => c.type === 'angle');
      expect(angles.length).toBe(11);          // every corner between two lines (the spline's ends have none)
      const to = view(z);
      const placed = layoutDimensions(d, annotate(d), { to, viewport: VIEWPORT });
      const shown = placed.filter((p) => !p.hidden);
      for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) expect(obbOverlap(rectOf(shown[i]), rectOf(shown[j])), `${shown[i].text} / ${shown[j].text}`).toBe(false);
      for (const p of shown) {
        const c = d.constraints.find((k) => k.id === p.id)!;
        const own = new Set(d.entities.filter((e) => c.refs!.every((r) => r === e.p1 || r === e.p2) || c.refs!.includes(e.id)).map((e) => e.id));
        for (const e of d.entities) {
          if (own.has(e.id) || e.type !== 'line') continue;
          const a = d.points.find((q) => q.id === e.p1)!, b = d.points.find((q) => q.id === e.p2)!;
          expect(obbOverlap(rectOf(p), segmentObb(to(a.x, a.y)!, to(b.x, b.y)!)), `${p.text} on ${e.id}`).toBe(false);
        }
      }
      console.log(`bottle with angles at ${z} px/mm: ${shown.length} of ${placed.length} shown`);
      if (z > 3) expect(shown.length).toBeGreaterThanOrEqual(12);
    });
  }
  it('a right angle is a square corner mark (no arrowheads) unless the setting is off', () => {
    const d = withAngles();
    const ninety = d.constraints.find((c) => c.type === 'angle' && Math.abs((c as { value?: number }).value! - 90) < 1e-6)!;
    const sq = annotate(d).find((a) => a.id === ninety.id)!.shape!;
    expect(sq.kind === 'angle' && sq.square).toBe(true);
    expect(sq.arrows).toEqual([]);
    const arc = annotate(d, { squareRight: false }).find((a) => a.id === ninety.id)!.shape!;
    expect(arc.kind === 'angle' && arc.square).toBeFalsy();
    expect(arc.arrows).toHaveLength(2);
  });
});
