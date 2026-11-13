// Fasteners with a thread in them: hex nuts (ISO 4032, 4035, 4033), standoffs (round or hex, male-female or female-female) and heat-set inserts. Mixed into PartBuilder by
// features/index.ts. Sizes come from fastenerData.ts (M2 to M16 for nuts, M2 to M6 for standoffs and inserts); every number can be overridden.
//
// Built only from kernel features that already exist: an extrude (or one revolve, for an insert) as a body of its own, cuts limited to that body for the bore, a revolve cut for the
// nut's 30 degree corner chamfer, and the thread feature on the bore. The thread comes in three flavours: 'plain' (a bore at the minor diameter, no thread feature), 'cosmetic'
// (a bore at the tap drill and a cosmetic thread, which shows in the thread list and the drawing) and 'modeled' (the same with the real helical groove, with an optional print
// clearance, slow). A modelled thread falls back to cosmetic with a warning when the kernel cannot cut it.
// NOT modelled: nut bore countersinks, the washer face, nyloc rings, flanges; the standoff's end chamfers; the insert's knurl pattern (rings stand for it).
import type { Num, OffsetPlane, PartBuilder } from '../recorder';
import type { PlaneBase } from '../planes';
import { H } from './h';
import { threadOp } from './misc';
import { cross3, dot3, norm, Pen, type V3 } from './screw';
import { INSERT_SIZES, NUT_SIZES, NUT_TYPES, NUT_STANDARD, STANDOFF_SIZES, minorInternal, type NutType } from './fastenerData';

type Pt = [number, number];
export type FastenerThread = 'plain' | 'cosmetic' | 'modeled';
const THREADS: FastenerThread[] = ['plain', 'cosmetic', 'modeled'];
export type StandoffKind = 'round' | 'hex';
export type StandoffEnds = 'female-female' | 'male-female';

/** Half the angle between the end face of a nut and its chamfer cone, ISO 4032: 30 degrees. */
export const NUT_CHAMFER_ANGLE = 30;
/** The bearing-face circle of a nut as a fraction of the width across flats (the standard's dw min runs from 0.82 s at M4 to 0.94 s at M16). */
export const NUT_BEARING_RATIO = 0.9;

export interface NutOpts {
  /** metric size M2, M2.5, M3, M4, M5, M6, M8, M10, M12, M14 or M16 */ size: string;
  /** 'regular' (ISO 4032, default), 'thin' (ISO 4035) or 'style2' (ISO 4033, M5 and up) */ type?: NutType;
  /** 'plain' (default: bore at the minor diameter), 'cosmetic' or 'modeled' (the helical groove) */ thread?: FastenerThread;
  /** modeled: print clearance in mm, positive = looser, up to 1 (default 0) */ clearance?: Num;
  /** chamfer the corners on both faces at 30 degrees (default true) */ chamfer?: boolean;
  /** the centre of the first face, default [0, 0, 0] */ origin?: [Num, Num, Num];
  /** the direction the thickness extends from that face, default [0, 0, -1] (a nut under a head, like washer) */ axis?: [Num, Num, Num];
  /** overrides of the table: width across flats, thickness */ across?: Num; thickness?: Num;
  /** body and feature name, default 'Nut' */ name?: string;
}
export interface StandoffOpts {
  /** metric size M2, M2.5, M3, M4, M5 or M6 */ size: string;
  /** body length in mm, end to end of the body (a male stud adds to it) */ length: Num;
  /** 'round' (default) or 'hex' */ kind?: StandoffKind;
  /** 'female-female' (default) or 'male-female': a female thread at the first end, a stud at the far one */ ends?: StandoffEnds;
  /** outside diameter (round) or width across flats (hex) in mm; default from the size table */ outer?: Num;
  /** depth of each female thread and length of the male stud in mm; default from the size table */ threadLength?: Num;
  /** 'plain' (default), 'cosmetic' or 'modeled' */ thread?: FastenerThread;
  /** modeled: print clearance in mm, positive = looser (a female thread gets wider, a stud thinner) */ clearance?: Num;
  /** the centre of the first end, default [0, 0, 0] */ origin?: [Num, Num, Num];
  /** the direction the standoff extends from that end, default [0, 0, 1] */ axis?: [Num, Num, Num];
  /** body and feature name, default 'Standoff' */ name?: string;
}
export interface HeatSetInsertOpts {
  /** metric size M2, M2.5, M3, M4, M5 or M6 */ size: string;
  /** 'plain' (default), 'cosmetic' or 'modeled' */ thread?: FastenerThread;
  /** modeled: print clearance in mm, positive = looser */ clearance?: Num;
  /** also cut the recommended hole: true cuts every body it reaches, a body name or a list of names only those (default: no hole) */ hole?: boolean | string | string[];
  /** where the hole mouth is (the face the insert is pressed into), default [0, 0, 0] */ origin?: [Num, Num, Num];
  /** the direction the insert goes into the part, default [0, 0, -1] */ axis?: [Num, Num, Num];
  /** overrides of the table: outside diameter over the knurl, length, hole diameter, hole depth */ outer?: Num; length?: Num; holeDiameter?: Num; holeDepth?: Num;
  /** number of groove rings round the outside, default by length (2 to 4); 0 for a plain cylinder */ rings?: number;
  /** body and feature name, default 'Insert' */ name?: string;
}

interface Frame { d: V3; across(t: number): OffsetPlane; axial: OffsetPlane }
/** The planes of a placement: `across(t)` is square to the axis at t along it (normal = the axis, so an extrude goes along it); `axial` contains the axis (sketch x the radius, sketch y the axis). */
function frameOf(o3: V3, ax: V3, line: number): Frame {
  const d = norm(ax);
  const ref: V3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const dd = dot3(ref, d);
  const u = norm([ref[0] - dd * d[0], ref[1] - dd * d[1], ref[2] - dd * d[2]]);
  const w = cross3(u, d);
  const plane = (spec: PlaneBase): OffsetPlane => ({ kind: 'offset', plane: spec, offset: 0, opts: {}, line });
  return { d, across: (t) => plane({ origin: [o3[0] + d[0] * t, o3[1] + d[1] * t, o3[2] + d[2] * t], normal: d, xdir: u }), axial: plane({ origin: o3, normal: w, xdir: u }) };
}
const hexPts = (across: number): Pt[] => { const R = across / Math.sqrt(3); return Array.from({ length: 6 }, (_, i): Pt => [R * Math.cos((Math.PI / 3) * i), R * Math.sin((Math.PI / 3) * i)]); };
const vec3 = (v: [Num, Num, Num] | undefined, dflt: V3): V3 => [H.num(v?.[0] ?? dflt[0]), H.num(v?.[1] ?? dflt[1]), H.num(v?.[2] ?? dflt[2])];
const THREAD_TAG = 'e1';   // the wall of a cut or an extruded circle is face S.e1 of its feature (the circle is the sketch's first entity)

/** The numbers a nut follows from, shared with the wizard: the size row, the thickness, the width across flats and the bore. */
export function nutGeometry(size: string, type: NutType, thread: FastenerThread, over: { across?: number; thickness?: number } = {}): { d: number; pitch: number; s: number; m: number; e: number; bore: number; dw: number } | null {
  const row = NUT_SIZES[size];
  const m0 = row?.m[type];
  if (!row || m0 === undefined) return null;
  const s = over.across ?? row.s, m = over.thickness ?? m0;
  return { d: row.d, pitch: row.pitch, s, m, e: (2 * s) / Math.sqrt(3), bore: thread === 'plain' ? minorInternal(row.d, row.pitch) : row.tap, dw: NUT_BEARING_RATIO * s };
}

export const fastenerFeatures = {
  /**
   * A hexagon nut (ISO 4032, 4035, 4033) as its own body.
   *
   * Give the metric size (M2 to M16) and type: 'regular' (ISO 4032, default), 'thin' (ISO 4035) or 'style2' (ISO 4033, M5 and up). The width across flats and the thickness come from the standard's table (marked unverified in the app: check them against your nut) and can be overridden. The corners are chamfered at 30 degrees on both faces (chamfer: false leaves them square). thread 'plain' (default) bores the minor diameter; 'cosmetic' bores the tap drill and adds a cosmetic thread; 'modeled' cuts the real helical groove (slow; clearance in mm makes it a printed fit, positive = looser). origin is the centre of the first face and axis the direction the thickness extends (default [0, 0, -1]). The nut is its own body and does not merge with what it touches.
   *
   * @domain features
   * @param o options object { size, type, thread, clearance, chamfer, origin, axis, across, thickness, name }, the fields below
   * @param o.size 'M2' | 'M2.5' | 'M3' | 'M4' | 'M5' | 'M6' | 'M8' | 'M10' | 'M12' | 'M14' | 'M16'
   * @param o.type 'regular' (default, ISO 4032) | 'thin' (ISO 4035) | 'style2' (ISO 4033)
   * @param o.thread 'plain' (default) | 'cosmetic' | 'modeled'
   * @param o.clearance modeled thread: print clearance in mm, positive = looser (default 0)
   * @param o.chamfer chamfer both faces at 30 degrees, default true
   * @param o.origin [x, y, z] of the centre of the first face, default [0, 0, 0]
   * @param o.axis [x, y, z] direction the thickness extends, default [0, 0, -1]
   * @param o.across width across flats override in mm
   * @param o.thickness thickness override in mm
   * @param o.name body and feature name, default 'Nut'
   * @example
   * part('Plate').sketch('front', (s) => s.rect(30, 30)).extrude(4)
   *   .nut({ size: 'M5', origin: [0, 0, 0], axis: [0, 0, -1] });
   * @see standoff, heatSetInsert, washer, screw, part.thread
   */
  nut(this: PartBuilder, o: NutOpts): PartBuilder {
    const line = H.callerLine();
    const fail = (m: string): never => { throw new H.SelectorError(`nut(): ${m}`, line); };
    if (!o || typeof o !== 'object') fail('needs an options object { size, type }');
    if (!NUT_SIZES[String(o.size)]) fail(`size must be one of ${Object.keys(NUT_SIZES).join(', ')}, not ${JSON.stringify(o.size)}`);
    const type: NutType = o.type ?? 'regular';
    if (!NUT_TYPES.includes(type)) fail(`type must be 'regular', 'thin' or 'style2', not ${JSON.stringify(o.type)}`);
    const thread: FastenerThread = o.thread ?? 'plain';
    if (!THREADS.includes(thread)) fail(`thread must be 'plain', 'cosmetic' or 'modeled', not ${JSON.stringify(o.thread)}`);
    const g = nutGeometry(o.size, type, thread, { ...(o.across !== undefined ? { across: H.num(o.across) } : {}), ...(o.thickness !== undefined ? { thickness: H.num(o.thickness) } : {}) });
    if (!g) return fail(`${NUT_STANDARD[type]} has no ${o.size} nut (style 2 starts at M5)`);
    if (!(g.s > 0) || !(g.m > 0)) fail('across and thickness must be positive');
    if (!(g.s > g.bore + 0.5)) fail(`the width across flats (${g.s}) must be more than the bore (${+g.bore.toFixed(3)}) by at least 0.5`);
    const clearance = o.clearance === undefined ? 0 : H.num(o.clearance);
    if (!(Math.abs(clearance) <= 1)) fail(`clearance must be between -1 and 1 mm, not ${clearance}`);
    const o3 = vec3(o.origin, [0, 0, 0]), ax = vec3(o.axis, [0, 0, -1]);
    if (!(Math.hypot(...ax) > 1e-9)) fail('axis must be a non-zero vector');
    const f = frameOf(o3, ax, line);
    const name = o.name ?? 'Nut', lead = 0.5;
    this.sketch(f.across(0), (s) => new Pen(s).poly(hexPts(g.s)), 'Nut profile').extrude(g.m, { newBody: name, name });
    // the bore: a cut through, symmetric about the middle of the nut, limited to this body
    this.sketch(f.across(g.m / 2), (s) => { s.circle(g.bore / 2); }, 'Nut bore').cut(g.m + 2 * lead, { direction: 'both', from: name, name: 'Nut bore' });
    let boreId = '';
    this.steps.push({ line, label: 'nut bore', run: (ctx) => { boreId = ctx.lastFeature ?? ''; return []; } });
    if (o.chamfer !== false) {
      // a revolve cut of the ring outside the two cones: from the bearing-face circle (radius dw / 2) the cone falls away from the face at 30 degrees
      const rc = g.dw / 2, R2 = g.e / 2 + 0.2, drop = (R2 - rc) * Math.tan((NUT_CHAMFER_ANGLE * Math.PI) / 180);
      if (!(2 * drop < g.m)) fail(`the thickness (${g.m}) is too small for a 30 degree chamfer on both faces (it needs more than ${+(2 * drop).toFixed(3)})`);
      const m = g.m;
      this.sketch(f.axial, (s) => new Pen(s).poly([[rc, m + 1], [rc, m], [R2, m - drop], [R2, drop], [rc, 0], [rc, -1], [R2 + 1, -1], [R2 + 1, m + 1]]), 'Nut chamfer')
        .revolve(360, { op: 'cut', from: name, name: 'Nut chamfer' });
    }
    if (thread !== 'plain') {
      this.steps.push({ line, label: 'nut thread', run: (ctx) => [threadOp(ctx, `${boreId}.S.${THREAD_TAG}`, o.size, { modeled: thread === 'modeled', ...(clearance ? { clearance } : {}) })] });
    }
    return this;
  },

  /**
   * A round or hex standoff, female-female or male-female, as its own body.
   *
   * Give the metric size (M2 to M6) and the body length. kind 'round' (default, outside diameter `outer`) or 'hex' (width across flats `outer`). ends 'female-female' (default) cuts a threaded bore of threadLength into both ends; 'male-female' cuts one into the first end and adds a stud of the nominal diameter and threadLength on the far end (the stud is extra length). thread 'plain' (default) bores the minor diameter and leaves the stud plain, 'cosmetic' bores the tap drill and adds cosmetic threads, 'modeled' cuts the helical grooves (slow, clearance in mm for a printed fit). The threads must not meet: threadLength x 2 less than length for female-female, threadLength less than length for male-female. The standoff is its own body.
   *
   * @domain features
   * @param o options object { size, length, kind, ends, outer, threadLength, thread, clearance, origin, axis, name }, the fields below
   * @param o.size 'M2' | 'M2.5' | 'M3' | 'M4' | 'M5' | 'M6'
   * @param o.length body length in mm, end to end
   * @param o.kind 'round' (default) | 'hex'
   * @param o.ends 'female-female' (default) | 'male-female'
   * @param o.outer outside diameter (round) or width across flats (hex) in mm, default from the size
   * @param o.threadLength depth of each female thread and length of the male stud in mm, default from the size
   * @param o.thread 'plain' (default) | 'cosmetic' | 'modeled'
   * @param o.clearance modeled thread: print clearance in mm, positive = looser (default 0)
   * @param o.origin [x, y, z] of the centre of the first end, default [0, 0, 0]
   * @param o.axis [x, y, z] direction the standoff extends, default [0, 0, 1]
   * @param o.name body and feature name, default 'Standoff'
   * @example
   * part('Board').sketch('front', (s) => s.rect(60, 40)).extrude(1.6)
   *   .standoff({ size: 'M3', length: 10, kind: 'hex', ends: 'male-female', origin: [20, 10, 1.6] });
   * @see nut, heatSetInsert, part.thread
   */
  standoff(this: PartBuilder, o: StandoffOpts): PartBuilder {
    const line = H.callerLine();
    const fail = (m: string): never => { throw new H.SelectorError(`standoff(): ${m}`, line); };
    if (!o || typeof o !== 'object') fail('needs an options object { size, length }');
    const row = STANDOFF_SIZES[String(o.size)];
    if (!row) return fail(`size must be one of ${Object.keys(STANDOFF_SIZES).join(', ')}, not ${JSON.stringify(o.size)}`);
    const kind: StandoffKind = o.kind ?? 'round';
    if (kind !== 'round' && kind !== 'hex') fail(`kind must be 'round' or 'hex', not ${JSON.stringify(o.kind)}`);
    const ends: StandoffEnds = o.ends ?? 'female-female';
    if (ends !== 'female-female' && ends !== 'male-female') fail(`ends must be 'female-female' or 'male-female', not ${JSON.stringify(o.ends)}`);
    const thread: FastenerThread = o.thread ?? 'plain';
    if (!THREADS.includes(thread)) fail(`thread must be 'plain', 'cosmetic' or 'modeled', not ${JSON.stringify(o.thread)}`);
    const L = H.num(o.length), outer = o.outer === undefined ? row[kind] : H.num(o.outer), tl = o.threadLength === undefined ? row.thread : H.num(o.threadLength);
    if (!(L > 0)) fail('length must be positive');
    if (!(tl > 0)) fail('threadLength must be positive');
    const bore = thread === 'plain' ? minorInternal(row.d, row.pitch) : row.tap;
    const need = row.d + 1;
    if (!(outer >= need)) fail(`${kind === 'round' ? 'outer (the diameter)' : 'outer (the width across flats)'} ${outer} must be at least ${need} for ${o.size}: the wall would be under 0.5 mm`);
    if (ends === 'female-female' ? !(2 * tl < L) : !(tl < L)) fail(ends === 'female-female' ? `the two threads (${tl} deep each) would meet: length (${L}) must be more than twice threadLength` : `the thread (${tl} deep) must be shorter than the length (${L})`);
    const clearance = o.clearance === undefined ? 0 : H.num(o.clearance);
    if (!(Math.abs(clearance) <= 1)) fail(`clearance must be between -1 and 1 mm, not ${clearance}`);
    const o3 = vec3(o.origin, [0, 0, 0]), ax = vec3(o.axis, [0, 0, 1]);
    if (!(Math.hypot(...ax) > 1e-9)) fail('axis must be a non-zero vector');
    const f = frameOf(o3, ax, line);
    const name = o.name ?? 'Standoff', lead = 0.5;
    const th = (id: () => string): void => {
      if (thread === 'plain') return;
      this.steps.push({ line, label: 'standoff thread', run: (ctx) => [threadOp(ctx, `${id()}.S.${THREAD_TAG}`, o.size, { modeled: thread === 'modeled', ...(clearance ? { clearance } : {}) })] });
    };
    this.sketch(f.across(0), (s) => { if (kind === 'round') s.circle(outer / 2); else new Pen(s).poly(hexPts(outer)); }, 'Standoff profile').extrude(L, { newBody: name, name });
    // a bore at each female end: the cut spans from `lead` outside the end face to the thread depth
    const bores: string[] = [];
    const female = (atEnd: boolean): void => {
      const centre = atEnd ? L - (tl - lead) / 2 : (tl - lead) / 2;
      this.sketch(f.across(centre), (s) => { s.circle(bore / 2); }, atEnd ? 'Far bore' : 'First bore').cut(tl + lead, { direction: 'both', from: name, name: atEnd ? 'Far bore' : 'First bore' });
      const k = bores.push('') - 1;
      this.steps.push({ line, label: 'standoff bore', run: (ctx) => { bores[k] = ctx.lastFeature ?? ''; return []; } });
      th(() => bores[k]);
    };
    female(false);
    if (ends === 'female-female') female(true);
    else {
      this.sketch(f.across(L), (s) => { s.circle(row.d / 2); }, 'Stud').extrude(tl, { name: 'Stud' });
      const k = bores.push('') - 1;
      this.steps.push({ line, label: 'standoff stud', run: (ctx) => { bores[k] = ctx.lastFeature ?? ''; return []; } });
      th(() => bores[k]);
    }
    return this;
  },

  /**
   * A heat-set threaded insert as its own body, optionally with its hole.
   *
   * Give the metric size (M2 to M6). The outside diameter, length, recommended hole diameter and depth are typical catalogue values from the table (unverified: check your insert's sheet) and can be overridden. The insert is one revolve of a ring with `rings` groove rings round the outside standing for the knurl. origin is the centre of the hole mouth (the face the insert is pressed into) and axis the direction it goes in (default [0, 0, -1]); the insert is flush with the face. hole: true also cuts the recommended hole (diameter and depth from the table, smaller than the insert's outside diameter by the interference of the press fit) into every body it reaches, before the insert is added; hole: 'Name' (or a list) cuts only those bodies. thread 'plain' (default), 'cosmetic' or 'modeled' as for nut().
   *
   * @domain features
   * @param o options object { size, thread, clearance, hole, origin, axis, outer, length, holeDiameter, holeDepth, rings, name }, the fields below
   * @param o.size 'M2' | 'M2.5' | 'M3' | 'M4' | 'M5' | 'M6'
   * @param o.thread 'plain' (default) | 'cosmetic' | 'modeled'
   * @param o.clearance modeled thread: print clearance in mm, positive = looser
   * @param o.hole true to cut the recommended hole into every body it reaches, a body name or list of names for just those; default none
   * @param o.origin [x, y, z] of the centre of the hole mouth, default [0, 0, 0]
   * @param o.axis [x, y, z] direction the insert goes into the part, default [0, 0, -1]
   * @param o.outer outside diameter override over the knurl, mm
   * @param o.length insert length override, mm
   * @param o.holeDiameter hole diameter override, mm
   * @param o.holeDepth hole depth override, mm
   * @param o.rings number of groove rings, default 2 to 4 by length, 0 for none
   * @param o.name body and feature name, default 'Insert'
   * @example
   * part('Block').sketch('front', (s) => s.rect(30, 30)).extrude(12)
   *   .heatSetInsert({ size: 'M3', hole: true, origin: [0, 0, 12], axis: [0, 0, -1] });
   * @see nut, standoff, part.hole
   */
  heatSetInsert(this: PartBuilder, o: HeatSetInsertOpts): PartBuilder {
    const line = H.callerLine();
    const fail = (m: string): never => { throw new H.SelectorError(`heatSetInsert(): ${m}`, line); };
    if (!o || typeof o !== 'object') fail('needs an options object { size }');
    const row = INSERT_SIZES[String(o.size)];
    if (!row) return fail(`size must be one of ${Object.keys(INSERT_SIZES).join(', ')}, not ${JSON.stringify(o.size)}`);
    const thread: FastenerThread = o.thread ?? 'plain';
    if (!THREADS.includes(thread)) fail(`thread must be 'plain', 'cosmetic' or 'modeled', not ${JSON.stringify(o.thread)}`);
    const num = (v: Num | undefined, dflt: number): number => (v === undefined ? dflt : H.num(v));
    const od = num(o.outer, row.od), L = num(o.length, row.length), hd = num(o.holeDiameter, row.hole), hdepth = num(o.holeDepth, row.depth);
    const bore = thread === 'plain' ? minorInternal(row.d, row.pitch) : row.tap;
    if (!(od > 0) || !(L > 0) || !(hd > 0) || !(hdepth > 0)) fail('outer, length, holeDiameter and holeDepth must be positive');
    if (!(od > bore + 0.8)) fail(`outer (${od}) must be more than the bore (${+bore.toFixed(3)}) by at least 0.8 mm`);
    if (!(hd <= od)) fail(`the hole (${hd}) must not be larger than the insert's outside diameter (${od}): nothing would hold it`);
    if (!(hdepth >= L)) fail(`the hole depth (${hdepth}) must be at least the insert length (${L})`);
    const clearance = o.clearance === undefined ? 0 : H.num(o.clearance);
    if (!(Math.abs(clearance) <= 1)) fail(`clearance must be between -1 and 1 mm, not ${clearance}`);
    const rings = o.rings === undefined ? (L < 5 ? 2 : L < 9 ? 3 : 4) : Math.round(o.rings);
    if (!(rings >= 0 && rings <= 8)) fail('rings must be between 0 and 8');
    const o3 = vec3(o.origin, [0, 0, 0]), ax = vec3(o.axis, [0, 0, -1]);
    if (!(Math.hypot(...ax) > 1e-9)) fail('axis must be a non-zero vector');
    const f = frameOf(o3, ax, line);
    const name = o.name ?? 'Insert', lead = 0.5;
    if (o.hole !== undefined && o.hole !== false) {
      const from = typeof o.hole === 'string' || Array.isArray(o.hole) ? { from: o.hole } : {};
      this.sketch(f.across((hdepth - lead) / 2), (s) => { s.circle(hd / 2); }, 'Insert hole').cut(hdepth + lead, { direction: 'both', name: 'Insert hole', ...from });
    }
    const ro = od / 2, rb = bore / 2, gd = Math.max(0.15, 0.05 * od), gw = Math.min(0.8, L / (2 * (rings + 1)));
    this.sketch(f.axial, (s) => {
      const pts: Pt[] = [[rb, 0], [ro, 0]];
      for (let i = 1; i <= rings; i++) {
        const z = (L * i) / (rings + 1);
        pts.push([ro, z - gw / 2], [ro - gd, z - gw / 4], [ro - gd, z + gw / 4], [ro, z + gw / 2]);
      }
      pts.push([ro, L], [rb, L]);
      new Pen(s).poly(pts);
    }, 'Insert profile').revolve(360, { newBody: name, name });
    if (thread !== 'plain') {
      this.steps.push({ line, label: 'insert thread', run: (ctx) => [threadOp(ctx, `${ctx.lastFeature}.S.e${4 + 4 * rings}`, o.size, { modeled: thread === 'modeled', ...(clearance ? { clearance } : {}) })] });
    }
    return this;
  },
};
