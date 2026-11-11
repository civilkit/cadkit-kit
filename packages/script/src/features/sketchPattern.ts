// Sketch-level repeats. Mixed into SketchBuilder by features/index.ts.
import type { SketchBuilder } from '../recorder';

type Pt = [number, number];
type Priv = { pt(x: number, y: number): string };

export const sketchPattern = {
  /**
   * Repeat a drawing around a centre.
   *
   * polar(count, draw) runs `draw(s)` count times; copy i is rotated by i * 360 / count degrees about `about` (default the sketch origin). Draw the first copy where you want it and write the shapes once: a petal, a spoke, a tooth. The copies are separate loops, so a sketch with five petals extrudes or cuts as five regions. angle spreads the copies over a part of a turn instead (angle: 90 with count 4 gives 0, 30, 60 and 90 degrees), start turns the first copy.
   * @domain sketch
   * @param count number of copies, at least 1
   * @param draw function that draws one copy with the same sketch builder
   * @param o.about centre of rotation [x, y] (default [0, 0])
   * @param o.angle total angle the copies span (default 360, copies evenly around the circle)
   * @param o.start rotation of the first copy in degrees (default 0)
   * @example
   * part('Petals').sketch('front', (s) => s.polar(5, (c) => { c.arc3([9, 0], [22, 7.5], [38, 0]); c.arc3([38, 0], [22, -7.5], [9, 0]); })).extrude(2);
   * @see sketch.arc3, part.circularPattern, sketch.polarCurve
   */
  polar(this: SketchBuilder, count: number | ((angle: number) => number), draw?: ((s: SketchBuilder) => void) | { count?: number; closed?: boolean; from?: number; to?: number; center?: Pt }, o: { about?: Pt; angle?: number; start?: number } = {}): SketchBuilder {
    // polar((angle) => radius, { count, closed }) is the polar CURVE (see sketch.polarCurve); polar(count, draw) is the pattern
    if (typeof count === 'function') return this.polarCurve(count, (draw && typeof draw === 'object' ? draw : {}));
    if (typeof draw === 'object') throw new Error('polar: the second argument is a function that draws one copy, e.g. polar(5, (s) => s.circle(3, [20, 0]))');
    if (!Number.isInteger(count) || count < 1) throw new Error('polar: count must be a whole number of at least 1');
    if (typeof draw !== 'function') throw new Error('polar: the second argument is a function that draws one copy, e.g. polar(5, (s) => s.circle(3, [20, 0]))');
    const p = this as unknown as Priv;
    const [cx, cy] = o.about ?? [0, 0], total = o.angle ?? 360, step = total === 360 ? total / count : count > 1 ? total / (count - 1) : 0;
    for (let i = 0; i < count; i++) {
      const a = ((o.start ?? 0) + i * step) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      const own = Object.getOwnPropertyDescriptor(p, 'pt');
      const orig = p.pt.bind(p);
      (p as Priv).pt = (x: number, y: number) => orig(cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c);
      try { draw(this); } finally { if (own) Object.defineProperty(p, 'pt', own); else delete (p as Partial<Priv>).pt; }
    }
    return this;
  },
};
