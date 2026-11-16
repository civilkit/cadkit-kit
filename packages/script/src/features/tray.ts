// Grid trays and bins (Gridfinity-style sizes): a block of whole or half grid units with a scooped cavity along its length, open at the ends (a tray) or closed by an end wall (a bin).
// Mixed into PartBuilder by features/index.ts. The wizard in the app (apps/cad/src/tray.ts) adds the drawer-fit calculation and the checks that need no kernel.
//
// The block is one extrude of the plan (a rounded rectangle) as its own body; the cavity is one cut of the cross-section (a rectangle whose lower corners are the scoop radius) along the
// length; magnet holes are one cut of circles from the underside. Every step after the extrude is a cut limited to this body, so other bodies in the part stay as they are.
// foot: true adds the Gridfinity foot under every grid cell (three lofts per cell: a 0.8 mm chamfer, 1.8 mm straight, a 2.15 mm chamfer, 4.75 mm in all) so the part seats in a Gridfinity baseplate;
// the foot is part of the height and the floor is then the thickness above it.
// NOT modelled yet: a stacking flange, dividers and labels, several narrow trays in one module.
import { at, type Num, type PartBuilder } from '../recorder';
import { H } from './h';

export type TrayEnds = 'none' | 'front' | 'back' | 'both';
export interface GridTrayOpts {
  /** width (x) in grid units; half units allowed */ widthUnits: Num;
  /** length (y) in grid units; half units allowed */ lengthUnits: Num;
  /** height (z) in height units */ heightUnits: Num;
  /** size of one grid unit, mm, default 42 */ pitch?: Num;
  /** size of one height unit, mm, default 7 */ unitHeight?: Num;
  /** each outside size is this much less than a whole number of units, so neighbours fit, mm, default 0.5 */ tolerance?: Num;
  /** wall thickness, at least 0.4, default 1.2 */ wall?: Num;
  /** floor thickness under the lowest point of the scoop, default 1.2 */ floor?: Num;
  /** radius of the scoop along the lower edges of the cavity, mm; 0 = square, default 8 */ scoopRadius?: Num;
  /** outside corner radius of the plan, mm, default 3.75 (the Gridfinity corner) */ cornerRadius?: Num;
  /** which ends get a wall: 'none' (default, an open tray), 'front' (low y), 'back' (high y) or 'both' (a bin) */ endWalls?: TrayEnds;
  /** the Gridfinity foot under every grid cell (4.75 mm, inside the height), so the part seats in a baseplate; the floor is then measured above it, default false */ foot?: boolean;
  /** magnet holes in the underside, four per whole grid unit, default false */ magnets?: boolean;
  /** magnet hole diameter, default 6 */ magnetDiameter?: Num;
  /** magnet hole depth, default 2 */ magnetDepth?: Num;
  /** body and feature name, default 'Tray' */ name?: string;
  /** centre of the bottom face, default [0, 0, 0]; the tray stands up from there along +z */ origin?: [Num, Num, Num];
}

/** Distance of a magnet hole from the centre of its grid unit, mm (the Gridfinity spacing is 26 mm between holes). */
export const MAGNET_OFFSET = 13;
/** The Gridfinity foot: height of the lower chamfer, the straight part and the upper chamfer, mm (4.75 in all). */
export const FOOT_STEPS = [0.8, 1.8, 2.15] as const;
export const FOOT_HEIGHT = 4.75;
/** The smallest plan corner radius the foot is built for: the foot's corner is the plan corner less the upper chamfer and the lower chamfer, and must stay above 0. */
export const FOOT_MIN_CORNER = 3.1;
/** The thinnest material left under a magnet hole, mm. */
export const MAGNET_FLOOR = 0.8;
const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;
const isHalf = (v: number): boolean => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9;

/** The numbers of a tray after the defaults and the checks; throws SelectorError with the line of the call. */
export function trayGeometry(o: GridTrayOpts, line?: number): {
  width: number; length: number; height: number; wall: number; floor: number; scoop: number; corner: number; ends: TrayEnds; foot: boolean; footHeight: number; magnets: boolean; magnetDiameter: number; magnetDepth: number;
  innerWidth: number; cavityDepth: number; widthUnits: number; lengthUnits: number; heightUnits: number; pitch: number; unitHeight: number; volume: number;
} {
  const fail = (m: string): never => { throw new H.SelectorError(`gridTray(): ${m}`, line); };
  if (!o || typeof o !== 'object') fail('needs an options object { widthUnits, lengthUnits, heightUnits }');
  const wu = H.num(o.widthUnits), lu = H.num(o.lengthUnits), hu = H.num(o.heightUnits);
  if (!(wu > 0) || !(lu > 0) || !(hu > 0)) fail('widthUnits, lengthUnits and heightUnits must be more than 0');
  if (!isHalf(wu) || !isHalf(lu)) fail(`the width and length are whole or half grid units (1, 1.5, 2, ...), not ${wu} x ${lu}`);
  const pitch = o.pitch === undefined ? 42 : H.num(o.pitch), unitHeight = o.unitHeight === undefined ? 7 : H.num(o.unitHeight);
  if (!(pitch > 0) || !(unitHeight > 0)) fail('pitch and unitHeight must be more than 0');
  const tol = o.tolerance === undefined ? 0.5 : H.num(o.tolerance);
  if (!(tol >= 0 && tol < pitch / 2)) fail(`tolerance must be between 0 and half the pitch (${pitch / 2} mm), not ${tol}`);
  const width = wu * pitch - tol, length = lu * pitch - tol, height = hu * unitHeight;
  const wall = o.wall === undefined ? 1.2 : H.num(o.wall);
  if (!(wall >= 0.4)) fail(`wall must be at least 0.4 mm, not ${wall}`);
  if (!(2 * wall < Math.min(width, length))) fail(`two walls (${r6(2 * wall)} mm) must be less than the smallest outside size (${r6(Math.min(width, length))} mm)`);
  const foot = o.foot === true, footHeight = foot ? FOOT_HEIGHT : 0;
  const floor = o.floor === undefined ? 1.2 : H.num(o.floor);
  if (!(floor >= 0.4)) fail(`floor must be at least 0.4 mm, not ${floor}`);
  if (!(floor < height - footHeight)) fail(foot ? `the foot (${FOOT_HEIGHT} mm) and the floor (${floor} mm) must be less than the height (${r6(height)} mm): a taller tray or a thinner floor` : `the floor (${floor} mm) must be less than the height (${r6(height)} mm)`);
  const scoop = o.scoopRadius === undefined ? 8 : H.num(o.scoopRadius);
  const innerWidth = width - 2 * wall, cavityDepth = height - footHeight - floor;
  if (!(scoop >= 0)) fail('scoopRadius must be 0 or more');
  if (!(2 * scoop <= innerWidth)) fail(`the scoop radius (${scoop} mm) is more than half the inside width (${r6(innerWidth)} mm): at most ${r6(innerWidth / 2)} mm`);
  if (!(scoop <= cavityDepth)) fail(`the scoop radius (${scoop} mm) is deeper than the cavity (${r6(cavityDepth)} mm): a smaller radius, a thinner floor or a taller tray`);
  const corner = o.cornerRadius === undefined ? 3.75 : H.num(o.cornerRadius);
  if (!(corner >= 0) || !(2 * corner <= Math.min(width, length))) fail(`cornerRadius must be between 0 and half the smallest outside size (${r6(Math.min(width, length) / 2)} mm), not ${corner}`);
  if (foot) {
    if (!(corner >= FOOT_MIN_CORNER)) fail(`the foot needs a plan corner radius of at least ${FOOT_MIN_CORNER} mm, not ${corner}`);
    const cell = Math.min(footCells(wu, pitch)[0].size, footCells(lu, pitch)[0].size) - tol;
    if (!(cell > 2 * (FOOT_STEPS[0] + FOOT_STEPS[2]) + 2 * (corner - FOOT_STEPS[2] - FOOT_STEPS[0]))) fail(`the foot does not fit a ${r6(cell)} mm cell: a larger pitch or a smaller corner radius`);
  }
  const ends = o.endWalls ?? 'none';
  if (ends !== 'none' && ends !== 'front' && ends !== 'back' && ends !== 'both') fail(`endWalls is 'none', 'front', 'back' or 'both', not ${JSON.stringify(o.endWalls)}`);
  const magnets = o.magnets === true;
  const magnetDiameter = o.magnetDiameter === undefined ? 6 : H.num(o.magnetDiameter), magnetDepth = o.magnetDepth === undefined ? 2 : H.num(o.magnetDepth);
  if (magnets) {
    if (!(magnetDiameter > 0) || !(magnetDepth > 0)) fail('magnetDiameter and magnetDepth must be more than 0');
    if (!(MAGNET_OFFSET + magnetDiameter / 2 < pitch / 2)) fail(`a magnet hole of ${magnetDiameter} mm does not fit in a ${pitch} mm unit`);
    if (!(floor + footHeight >= magnetDepth + MAGNET_FLOOR)) fail(`the floor (${floor} mm${foot ? ' above the foot' : ''}) must be at least the magnet depth plus ${MAGNET_FLOOR} mm (${r6(magnetDepth + MAGNET_FLOOR - footHeight)} mm)`);
  }
  // the cavity is the inside width less its two lower corners, along the length less the end walls; the scoop takes (1 - pi/4) r^2 off each lower corner
  const along = length - ((ends === 'front' || ends === 'both') ? wall : 0) - ((ends === 'back' || ends === 'both') ? wall : 0);
  const section = innerWidth * cavityDepth - 2 * (1 - Math.PI / 4) * scoop * scoop;
  const feet = foot ? footCells(wu, pitch).reduce((a, cx) => a + footCells(lu, pitch).reduce((b, cy) => b + footVolume(cx.size - tol, cy.size - tol), 0), 0) : 0;
  const volume = width * length * (height - footHeight) + feet - section * Math.max(0, Math.min(along, length));
  return { width, length, height, wall, floor, scoop, corner, ends, foot, footHeight, magnets, magnetDiameter, magnetDepth, innerWidth, cavityDepth, widthUnits: wu, lengthUnits: lu, heightUnits: hu, pitch, unitHeight, volume };
}

/** The grid cells along one direction: whole units of `pitch` and, for a half unit, one cell of half the pitch; `centre` is from the middle of the whole length. */
export function footCells(units: number, pitch: number): Array<{ size: number; centre: number }> {
  const out: Array<{ size: number; centre: number }> = [];
  const whole = Math.floor(units + 1e-9), half = units - whole > 1e-9;
  const total = units * pitch;
  for (let i = 0; i < whole; i++) out.push({ size: pitch, centre: r6(-total / 2 + (i + 0.5) * pitch) });
  if (half) out.push({ size: pitch / 2, centre: r6(-total / 2 + whole * pitch + pitch / 4) });
  return out;
}
/** Volume of one foot under a w x l cell (its top size, before the corner rounding): the two chamfers and the straight part, exact for rectangles that grow by a fixed amount. */
function footVolume(w: number, l: number): number {
  const [c1, st, c2] = FOOT_STEPS;
  const area = (d: number): number => (w - 2 * d) * (l - 2 * d);
  const prism = (h: number, d0: number, d1: number): number => (h / 6) * (area(d0) + 4 * area((d0 + d1) / 2) + area(d1));
  return prism(c1, c1 + c2, c2) + st * area(c2) + prism(c2, c2, 0);
}

/** The centres of the magnet holes, relative to the centre of the bottom face: four around the centre of every whole grid unit. */
export function magnetPoints(g: { widthUnits: number; lengthUnits: number; pitch: number }): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const nx = Math.floor(g.widthUnits), ny = Math.floor(g.lengthUnits);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const cx = -g.widthUnits * g.pitch / 2 + (i + 0.5) * g.pitch, cy = -g.lengthUnits * g.pitch / 2 + (j + 0.5) * g.pitch;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) pts.push([r6(cx + sx * MAGNET_OFFSET), r6(cy + sy * MAGNET_OFFSET)]);
  }
  return pts;
}

export interface GridBaseplateOpts {
  /** width (x) in grid units, whole or half */ widthUnits: Num;
  /** length (y) in grid units, whole or half */ lengthUnits: Num;
  /** size of one grid unit, mm, default 42 */ pitch?: Num;
  /** thickness of the plate under the pockets, mm, default 1.2 */ base?: Num;
  /** how much bigger each pocket is than the foot all round, mm, default 0.1 */ clearance?: Num;
  /** outside corner radius of the plate, mm, default 3.75 */ cornerRadius?: Num;
  /** printer bed, mm: a plate bigger than this in x or y is made as several pieces of at most this size (square corners), each its own body named 'Name i-j'; default none */ bed?: Num;
  /** body and feature name, default 'Baseplate' */ name?: string;
  /** centre of the bottom face, default [0, 0, 0] */ origin?: [Num, Num, Num];
}

/** `units` cut into the fewest equal-as-possible parts of at most `max` units (whole or half units): each part with where it starts. */
export function splitUnits(units: number, max: number): Array<{ at: number; n: number }> {
  const parts = Math.max(1, Math.ceil(units / max - 1e-9));
  const base = Math.floor((units / parts) * 2 + 1e-9) / 2;
  let extra = Math.round((units - base * parts) * 2);          // half units still to give out, one to each of the first parts
  const out: Array<{ at: number; n: number }> = [];
  let at = 0;
  for (let i = 0; i < parts; i++) { const n = base + (extra > 0 ? 0.5 : 0); if (extra > 0) extra--; out.push({ at, n }); at += n; }
  return out;
}

/** The numbers of a baseplate after the defaults and the checks; throws SelectorError with the line of the call. */
export function baseplateGeometry(o: GridBaseplateOpts, line?: number): { width: number; length: number; height: number; base: number; clearance: number; corner: number; pitch: number; widthUnits: number; lengthUnits: number; web: number; pieces: Array<{ x0: number; y0: number; w: number; l: number }>; split: boolean } {
  const fail = (m: string): never => { throw new H.SelectorError(`gridBaseplate(): ${m}`, line); };
  if (!o || typeof o !== 'object') fail('needs an options object { widthUnits, lengthUnits }');
  const wu = H.num(o.widthUnits), lu = H.num(o.lengthUnits);
  if (!(wu > 0) || !(lu > 0)) fail('widthUnits and lengthUnits must be more than 0');
  if (!isHalf(wu) || !isHalf(lu)) fail(`the width and length are whole or half grid units (1, 1.5, 2, ...), not ${wu} x ${lu}`);
  const pitch = o.pitch === undefined ? 42 : H.num(o.pitch);
  if (!(pitch > 0)) fail('pitch must be more than 0');
  const base = o.base === undefined ? 1.2 : H.num(o.base);
  if (!(base >= 0.4)) fail(`base must be at least 0.4 mm, not ${base}`);
  const clearance = o.clearance === undefined ? 0.1 : H.num(o.clearance);
  if (!(clearance >= 0 && clearance <= 0.5)) fail(`clearance must be between 0 and 0.5 mm, not ${clearance}`);
  const corner = o.cornerRadius === undefined ? 3.75 : H.num(o.cornerRadius);
  if (!(corner >= FOOT_MIN_CORNER) || !(2 * corner <= Math.min(wu, lu) * pitch)) fail(`cornerRadius must be at least ${FOOT_MIN_CORNER} mm (the pockets follow it) and at most half the smallest size, not ${corner}`);
  // the pockets are the foot plus the clearance; the top of one is 0.5 mm under the pitch plus twice the clearance, so the ridge between two pockets is this wide
  const web = r6(0.5 - 2 * clearance);
  if (!(web >= 0.2)) fail(`clearance ${clearance} mm leaves a ridge of ${web} mm between pockets: use 0.15 mm or less`);
  const bed = o.bed === undefined ? 0 : H.num(o.bed);
  if (!(bed >= 0)) fail(`bed must be 0 or more, not ${bed}`);
  let xs = [{ at: 0, n: wu }], ys = [{ at: 0, n: lu }];
  if (bed > 0) {
    const max = Math.floor((bed / pitch) * 2 + 1e-9) / 2;
    if (!(max >= 0.5)) fail(`the bed (${bed} mm) is smaller than half a grid unit (${pitch / 2} mm)`);
    xs = splitUnits(wu, max); ys = splitUnits(lu, max);
  }
  const pieces = ys.flatMap((y) => xs.map((x) => ({ x0: x.at, y0: y.at, w: x.n, l: y.n })));
  return { width: wu * pitch, length: lu * pitch, height: r6(FOOT_HEIGHT + base), base, clearance, corner, pitch, widthUnits: wu, lengthUnits: lu, web, pieces, split: pieces.length > 1 };
}

/** The pockets of one baseplate piece centred on (ox, oy), cut into body `name`. */
function baseplatePockets(part: PartBuilder, g: ReturnType<typeof baseplateGeometry>, name: string, ox: number, oy: number, wu: number, lu: number, oz: number): void {
  const [c1, st, c2] = FOOT_STEPS, zt = oz + g.height;
  const sec = (d: number, cx: number, cy: number, w: number, l: number) => (s: { rrect(w: number, h: number, r: number, c: [number, number]): unknown }) => { s.rrect(r6(w - 2 * d), r6(l - 2 * d), r6(g.corner + g.clearance - d), [ox + cx, oy + cy]); };
  for (const cx of footCells(wu, g.pitch)) for (const cy of footCells(lu, g.pitch)) {
    const w = cx.size - 0.5 + 2 * g.clearance, l = cy.size - 0.5 + 2 * g.clearance, f = sec;
    const z = [zt, zt - c2, zt - c2 - st, zt - c2 - st - c1].map((v) => at('front', r6(v)));
    const opts = { op: 'cut' as const, from: name };
    part.loft([{ on: z[1], draw: f(c2, cx.centre, cy.centre, w, l) }, { on: z[0], draw: f(0, cx.centre, cy.centre, w, l) }], opts);
    part.loft([{ on: z[2], draw: f(c2, cx.centre, cy.centre, w, l) }, { on: z[1], draw: f(c2, cx.centre, cy.centre, w, l) }], opts);
    part.loft([{ on: z[3], draw: f(c2 + c1, cx.centre, cy.centre, w, l) }, { on: z[2], draw: f(c2, cx.centre, cy.centre, w, l) }], opts);
  }
}

export const trayFeatures = {
  /**
   * A tray or bin on a grid (Gridfinity-style units) as its own body, scooped along its length.
   *
   * Outside widthUnits x lengthUnits grid units (42 mm, 0.5 mm under) and heightUnits x 7 mm tall, standing on origin along +z. The cavity has a scoop of scoopRadius (default 8) on its lower edges and runs the whole length: open at both ends, or closed by endWalls ('front', 'back', 'both' = a bin). foot: true adds the Gridfinity foot (4.75 mm, inside the height) under every cell so it seats in a baseplate. magnets cuts 6 x 2 mm holes underneath. Not included: stacking flange, dividers, labels.
   * @domain features
   * @param o options object { widthUnits, lengthUnits, heightUnits, ... }
   * @param o.widthUnits width (x) in grid units, half units allowed
   * @param o.lengthUnits length (y) in grid units, half units allowed
   * @param o.heightUnits height in height units
   * @param o.pitch grid unit in mm, default 42
   * @param o.unitHeight height unit in mm, default 7
   * @param o.tolerance each outside size is this much less than whole units, in mm, default 0.5
   * @param o.wall wall thickness in mm, default 1.2
   * @param o.floor floor thickness in mm, default 1.2
   * @param o.scoopRadius radius of the scoop along the lower edges of the cavity in mm, default 8
   * @param o.cornerRadius outside plan corner radius in mm, default 3.75
   * @param o.endWalls 'none' (default) | 'front' | 'back' | 'both'
   * @param o.foot Gridfinity foot under every grid cell, default false; the floor is then measured above it
   * @param o.magnets magnet holes in the underside, default false
   * @param o.magnetDiameter in mm, default 6
   * @param o.magnetDepth in mm, default 2
   * @param o.name body name, default 'Tray'
   * @param o.origin [x, y, z] centre of the bottom, default [0, 0, 0]
   * @example
   * part('Tray').gridTray({ widthUnits: 1, lengthUnits: 4, heightUnits: 4, scoopRadius: 10 });
   * @see part.caseBox
   */
  gridTray(this: PartBuilder, o: GridTrayOpts): PartBuilder {
    const line = H.callerLine();
    const g = trayGeometry(o, line);
    const [ox, oy, oz] = [0, 1, 2].map((i) => H.num(o.origin?.[i] ?? 0));
    const name = o.name === undefined ? 'Tray' : String(o.name).trim();
    if (!name) throw new H.SelectorError('gridTray(): name must not be empty', line);
    const base = r6(oz) === 0 ? 'front' as const : at('front', oz);
    const zb = oz + g.footHeight;                           // the block stands on the foot (or on the origin without one)
    this.sketch(g.foot ? at('front', r6(zb)) : base, (s) => { s.rrect(g.width, g.length, g.corner, [ox, oy]); }, `${name} outline`).extrude(g.height - g.footHeight, { newBody: name, name });
    if (g.foot) {
      // one foot under every grid cell, lofted from the top down so each piece lands on the one above: the upper chamfer, the straight part, the lower chamfer; the corner radius shrinks with the size
      const [c1, st, c2] = FOOT_STEPS, tol = g.pitch * g.widthUnits - g.width;
      const loops = (d: number, cx: number, cy: number, w: number, l: number) => (s: { rrect(w: number, h: number, r: number, c: [number, number]): unknown }) => { s.rrect(r6(w - 2 * d), r6(l - 2 * d), r6(g.corner - d), [ox + cx, oy + cy]); };
      for (const cx of footCells(g.widthUnits, g.pitch)) for (const cy of footCells(g.lengthUnits, g.pitch)) {
        const w = cx.size - tol, l = cy.size - tol, f = loops;
        const z = [zb, zb - c2, zb - c2 - st, zb - c2 - st - c1].map((v) => at('front', r6(v)));
        this.loft([{ on: z[1], draw: f(c2, cx.centre, cy.centre, w, l) }, { on: z[0], draw: f(0, cx.centre, cy.centre, w, l) }]);
        this.loft([{ on: z[2], draw: f(c2, cx.centre, cy.centre, w, l) }, { on: z[1], draw: f(c2, cx.centre, cy.centre, w, l) }]);
        this.loft([{ on: z[3], draw: f(c2 + c1, cx.centre, cy.centre, w, l) }, { on: z[2], draw: f(c2, cx.centre, cy.centre, w, l) }]);
      }
    }
    // cavity: the cross-section sketched on a plane across the length ('top': sketch x = world X, sketch y = world -Z) and cut along +Y from the front end wall (or from outside the body) to the back
    const yFront = oy - g.length / 2, yBack = oy + g.length / 2;
    const y0 = (g.ends === 'front' || g.ends === 'both') ? yFront + g.wall : yFront - 1;
    const y1 = (g.ends === 'back' || g.ends === 'both') ? yBack - g.wall : yBack + 1;
    const extra = g.scoop + 1;                              // the rectangle goes above the top so its upper (rounded) corners are cut away
    const zLo = oz + g.footHeight + g.floor, zHi = oz + g.height + extra;
    this.sketch(at('top', r6(y0)), (s) => { s.rrect(g.innerWidth, zHi - zLo, g.scoop, [ox, -r6((zLo + zHi) / 2)]); }, `${name} cavity`).cut(r6(y1 - y0), { direction: 'away', from: name, name: `${name} cavity` });
    if (g.magnets) {
      const pts = magnetPoints(g);
      this.sketch(base, (s) => { for (const [x, y] of pts) s.circle(g.magnetDiameter / 2, [ox + x, oy + y]); }, `${name} magnets`).cut(g.magnetDepth, { direction: 'away', from: name, name: `${name} magnet holes` });
    }
    return this;
  },
  /**
   * A Gridfinity baseplate: a plate of pockets the foot of a tray or bin seats in.
   *
   * widthUnits x lengthUnits cells of pitch (default 42 mm, no tolerance, so plates butt), a plate base (default 1.2 mm) under the pockets and 4.75 mm of pocket, 4.75 + base tall. Each pocket is the foot profile plus clearance (default 0.1 mm) all round, cut as three lofts per cell. With the default clearance the ridge between two pockets is 0.3 mm at the top.
   * @domain features
   * @param o options object { widthUnits, lengthUnits, ... }
   * @param o.widthUnits width (x) in grid units
   * @param o.lengthUnits length (y) in grid units
   * @param o.pitch grid unit in mm, default 42
   * @param o.base plate thickness under the pockets in mm, default 1.2
   * @param o.clearance pocket oversize all round in mm, default 0.1
   * @param o.cornerRadius outside plan corner radius in mm, default 3.75
   * @param o.bed printer bed in mm: a bigger plate is made as pieces of at most this size, square cornered, each its own body
   * @param o.name body name, default 'Baseplate'
   * @param o.origin [x, y, z] centre of the bottom, default [0, 0, 0]
   * @example
   * part('Plate').gridBaseplate({ widthUnits: 3, lengthUnits: 4 });
   * @see part.gridTray
   */
  gridBaseplate(this: PartBuilder, o: GridBaseplateOpts): PartBuilder {
    const line = H.callerLine();
    const g = baseplateGeometry(o, line);
    const [ox, oy, oz] = [0, 1, 2].map((i) => H.num(o.origin?.[i] ?? 0));
    const name = o.name === undefined ? 'Baseplate' : String(o.name).trim();
    if (!name) throw new H.SelectorError('gridBaseplate(): name must not be empty', line);
    const base = r6(oz) === 0 ? 'front' as const : at('front', oz);
    const nx = g.pieces.filter((q) => q.y0 === 0).length;
    g.pieces.forEach((pc, k) => {
      const pn = g.split ? `${name} ${(k % nx) + 1}-${Math.floor(k / nx) + 1}` : name;
      const px = ox - g.width / 2 + (pc.x0 + pc.w / 2) * g.pitch, py = oy - g.length / 2 + (pc.y0 + pc.l / 2) * g.pitch;
      this.sketch(base, (s) => { s.rrect(pc.w * g.pitch, pc.l * g.pitch, g.split ? 0 : g.corner, [r6(px), r6(py)]); }, `${pn} outline`).extrude(g.height, { newBody: pn, name: pn });
      baseplatePockets(this, g, pn, r6(px), r6(py), pc.w, pc.l, oz);
    });
    return this;
  },
};
