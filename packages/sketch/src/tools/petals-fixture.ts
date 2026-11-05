/** A flower sketch for the region tests: `n` petals that all meet at the sketch origin. Each petal is two straight lines out from the
 *  origin to the tangent points of a round end (an arc around the end circle), rotated 360/n degrees apart, plus a construction circle. */
export function petalSketch(n = 5, opts: { reuseOrigin?: boolean; construction?: boolean } = {}) {
  const points: Array<{ id: string; x: number; y: number; fixed?: boolean }> = [{ id: 'O', x: 0, y: 0, fixed: true }];
  const entities: Array<Record<string, unknown>> = [];
  const dist = 25, r = 10;                        // end circle centre distance and radius
  const along = Math.sqrt(dist * dist - r * r);   // origin to the tangent point
  const half = Math.asin(r / dist);               // half the opening angle of the two lines
  let k = 0;
  const pt = (x: number, y: number) => { const id = 'p' + ++k; points.push({ id, x, y }); return id; };
  for (let i = 0; i < n; i++) {
    const th = (i * 2 * Math.PI) / n;
    const at = (a: number, d: number) => [d * Math.cos(th + a), d * Math.sin(th + a)] as const;
    const lo = pt(...at(-half, along)), hi = pt(...at(half, along)), c = pt(...at(0, dist));
    const o1 = opts.reuseOrigin === false ? pt(0, 0) : 'O', o2 = opts.reuseOrigin === false ? pt(0, 0) : 'O';
    entities.push({ id: `l${i}a`, type: 'line', p1: o1, p2: lo });
    entities.push({ id: `a${i}`, type: 'arc', c, p1: lo, p2: hi });
    entities.push({ id: `l${i}b`, type: 'line', p1: hi, p2: o2 });
  }
  if (opts.construction !== false) { entities.push({ id: 'ring', type: 'circle', c: 'O', r: 40, construction: true }); }
  return { id: 'F1', type: 'sketch', plane: { kind: 'std', id: 'top' }, points, entities, constraints: [] };
}
/** Area of one petal: the kite origin - tangent point - end centre - tangent point, plus the far sector of the end circle. */
export const PETAL_AREA = (() => {
  const dist = 25, r = 10, along = Math.sqrt(dist * dist - r * r), half = Math.asin(r / dist);
  return along * r + (r * r * (Math.PI + 2 * half)) / 2;
})();

// A ring of stadium-shaped petals whose open outlines (two sides and a rounded end) start and end ON a ring circle: the ring is one
// closed circle entity, so the petal ends are T-junctions (no shared vertex) and the petal is closed only by the ring's own arc.
export function ringPetals(opts: { n?: number; outer?: 'circle' | 'arcs'; ringArcs?: boolean; axis?: 'none' | 'construction' | 'line'; reach?: number } = {}) {
  const n = opts.n ?? 6, R = 20, hw = 4, reach = opts.reach ?? 30;
  const points: Array<{ id: string; x: number; y: number }> = [{ id: 'O', x: 0, y: 0 }];
  const entities: Array<{ id: string; [k: string]: unknown }> = [];
  let k = 0;
  const pt = (x: number, y: number) => { const id = 'p' + ++k; points.push({ id, x, y }); return id; };
  const baseX = Math.sqrt(R * R - hw * hw);
  const ringPts: Array<{ id: string; a: number }> = [];
  for (let i = 0; i < n; i++) {
    const th = (i * 2 * Math.PI) / n, cs = Math.cos(th), sn = Math.sin(th);
    const at = (x: number, y: number) => pt(x * cs - y * sn, x * sn + y * cs);
    const b1 = at(baseX, -hw), b2 = at(baseX, hw), t1 = at(reach, -hw), t2 = at(reach, hw), c = at(reach, 0);
    ringPts.push({ id: b1, a: th - Math.asin(hw / R) }, { id: b2, a: th + Math.asin(hw / R) });
    entities.push({ id: `s${i}a`, type: 'line', p1: b1, p2: t1 });
    entities.push({ id: `e${i}`, type: 'arc', c, p1: t1, p2: t2 });
    entities.push({ id: `s${i}b`, type: 'line', p1: t2, p2: b2 });
    if (opts.axis && opts.axis !== 'none') {
      const base = at(R, 0), tip = at(reach + hw, 0);
      entities.push({ id: `ax${i}`, type: 'line', p1: base, p2: tip, construction: opts.axis === 'construction' });
    }
  }
  if (opts.ringArcs) {
    const sorted = [...ringPts].sort((x, y) => (((x.a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - (((y.a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)));
    sorted.forEach((q, i) => entities.push({ id: `ring${i}`, type: 'arc', c: 'O', p1: q.id, p2: sorted[(i + 1) % sorted.length].id }));
  } else entities.push({ id: 'ring', type: 'circle', c: 'O', r: R });
  entities.push({ id: 'hole', type: 'circle', c: 'O', r: 4 });
  if (opts.outer === 'arcs') {
    points.push({ id: 'ox1', x: 40, y: 0 }, { id: 'ox2', x: -40, y: 0 });
    entities.push({ id: 'out1', type: 'arc', c: 'O', p1: 'ox1', p2: 'ox2' }, { id: 'out2', type: 'arc', c: 'O', p1: 'ox2', p2: 'ox1' });
  } else entities.push({ id: 'outer', type: 'circle', c: 'O', r: 40 });
  return { points, entities };
}
