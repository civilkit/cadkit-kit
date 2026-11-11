// Washers: a flat washer (an annulus extruded to its thickness) or a split spring washer (the annulus with a straight radial gap cut out of it),
// placed by an origin and an axis. Mixed into PartBuilder by features/index.ts. Sizes live in the app (apps/cad/src/washerSizes.ts); here every number is given.
//
// Built from one sketch and one extrude (plus a reference plane when the face is not on the origin plane of its axis), as a body of its own (newBody), so it patterns, mirrors and copies like any extruded feature.
// NOT modelled: the lift (helical twist) of a real spring washer. The split ring is flat; the gap is cut square (parallel walls).
import { at, type Num, type OffsetPlane, type PartBuilder, type Plane, type SketchBuilder } from '../recorder';
import type { PlaneBase } from '../planes';
import { H } from './h';
import { dot3, norm, Pen, type V3 } from './screw';

export type WasherKind = 'flat' | 'spring';
export interface WasherOpts {
  /** 'flat' (default) or 'spring' (split ring) */
  kind?: WasherKind;
  /** hole diameter, mm */ inner: Num;
  /** outside diameter, mm */ outer: Num;
  /** thickness (the height along the axis), mm */ thickness: Num;
  /** spring only: width of the gap across the split, mm (default: the thickness) */ gap?: Num;
  /** the centre of the first (bearing) face, default [0, 0, 0] */ origin?: [Num, Num, Num];
  /** the direction the thickness extends from that face, default [0, 0, -1] (a washer under a head, sitting on a part below) */ axis?: [Num, Num, Num];
  /** feature name in the tree, default 'Washer' */ name?: string;
}

export const washerFeatures = {
  /**
   * A flat or split spring washer as its own body, placed by an origin and an axis.
   *
   * kind 'flat' (default) is a ring with the given inner and outer diameter and thickness. kind 'spring' is the same ring split by a straight gap of width `gap` (default the thickness) on the +X side of the placement frame; it is flat (no lift). origin is the centre of the washer's first side and the thickness runs from it along axis (default [0, 0, -1], so a washer at a screw's origin lies under its head, around the shank). The washer does not merge with what it touches. For standard sizes (ISO 7089, ISO 7093-1, DIN 127 B) see the Washer wizard in the app.
   *
   * @domain features
   * @param o options object { kind, inner, outer, thickness, gap, origin, axis, name }, the fields below
   * @param o.kind 'flat' (default) | 'spring'
   * @param o.inner hole diameter in mm (an M8 washer: 8.4)
   * @param o.outer outside diameter in mm (16)
   * @param o.thickness thickness in mm (1.6)
   * @param o.gap spring only: gap width across the split in mm, default the thickness
   * @param o.origin [x, y, z] of the centre of the first side, default [0, 0, 0]
   * @param o.axis [x, y, z] direction the thickness extends, default [0, 0, -1]
   * @param o.name feature name in the tree, default 'Washer'
   * @example
   * part('Plate').sketch('front', (s) => s.rect(30, 30)).extrude(4)
   *   .washer({ inner: 8.4, outer: 16, thickness: 1.6, origin: [0, 0, 4], axis: [0, 0, 1] });
   * @see screw, part.sketch, part.extrude
   */
  washer(this: PartBuilder, o: WasherOpts): PartBuilder {
    const line = H.callerLine();
    const fail = (m: string): never => { throw new H.SelectorError(`washer(): ${m}`, line); };
    if (!o || typeof o !== 'object') fail('needs an options object { inner, outer, thickness }');
    const kind: WasherKind = o.kind ?? 'flat';
    if (kind !== 'flat' && kind !== 'spring') fail(`kind must be 'flat' or 'spring', not ${JSON.stringify(o.kind)}`);
    const di = H.num(o.inner), dO = H.num(o.outer), th = H.num(o.thickness);
    if (!(di > 0)) fail('inner must be positive');
    if (!(dO > di)) fail(`outer (${dO}) must be larger than inner (${di})`);
    if (!(th > 0)) fail('thickness must be positive');
    const gap = o.gap === undefined ? th : H.num(o.gap);
    if (kind === 'spring' && !(gap > 0 && gap < di)) fail(`gap must be positive and smaller than the hole (${di}), not ${gap}`);
    const origin: V3 = [H.num(o.origin?.[0] ?? 0), H.num(o.origin?.[1] ?? 0), H.num(o.origin?.[2] ?? 0)];
    const ax: V3 = [H.num(o.axis?.[0] ?? 0), H.num(o.axis?.[1] ?? 0), H.num(o.axis?.[2] ?? -1)];
    if (!(Math.hypot(...ax) > 1e-9)) fail('axis must be a non-zero vector');
    const d = norm(ax);
    const Ro = dO / 2, Ri = di / 2, hg = gap / 2;
    if (kind === 'spring' && !(hg < Ri)) fail(`the gap (${gap}) must be smaller than the hole (${di})`);
    // an axis along x, y or z sits on a standard plane (one sketch and one extrude; a plane feature as well when the face is not at the origin of that axis)
    const k = [0, 1, 2].find((i) => Math.abs(Math.abs(d[i]) - 1) < 1e-9);
    // frames of the standard planes as the kernel makes them: sketch x, sketch y and normal in world axes (see plane())
    const STD = [
      { base: 'right' as const, x: [0, 0, -1] as V3, y: [0, 1, 0] as V3, n: [1, 0, 0] as V3 },
      { base: 'top' as const, x: [1, 0, 0] as V3, y: [0, 0, -1] as V3, n: [0, 1, 0] as V3 },
      { base: 'front' as const, x: [1, 0, 0] as V3, y: [0, 1, 0] as V3, n: [0, 0, 1] as V3 },
    ];
    let sketchOn: Plane | OffsetPlane; let c: [number, number] = [0, 0]; let flip = false;
    if (k !== undefined) {
      const f = STD[k];
      const off = dot3(origin, f.n);
      sketchOn = Math.abs(off) < 1e-12 ? f.base : at(f.base, off);
      c = [dot3(origin, f.x), dot3(origin, f.y)];
      flip = d[k] < 0;
    } else {
      const ref: V3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const dd = dot3(ref, d);
      const u = norm([ref[0] - dd * d[0], ref[1] - dd * d[1], ref[2] - dd * d[2]]);
      sketchOn = { kind: 'offset', plane: { origin, normal: d, xdir: u } as PlaneBase, offset: 0, opts: {}, line } as OffsetPlane;
    }
    const profile = kind === 'flat'
      ? (s: SketchBuilder): void => { s.circle(Ro, c); s.circle(Ri, c); }
      : (s: SketchBuilder): void => {
        const xo = Math.sqrt(Ro * Ro - hg * hg), xi = Math.sqrt(Ri * Ri - hg * hg);
        const pen = new Pen(s);
        const P = (x: number, y: number): [number, number] => [c[0] + x, c[1] + y];
        pen.arc(c, P(xo, hg), P(xo, -hg), true);     // the long way round the outside
        pen.arc(c, P(xi, hg), P(xi, -hg), true);     // and round the inside
        pen.line(P(xo, -hg), P(xi, -hg)); pen.line(P(xo, hg), P(xi, hg));   // the two walls of the gap
      };
    this.sketch(sketchOn, profile, kind === 'flat' ? 'Washer profile' : 'Split washer profile').extrude(th, { newBody: true, name: o.name ?? 'Washer', ...(flip ? { flip: true } : {}) });
    return this;
  },
};
