// The BOSL2 parts library: editable parametric entries ported from BOSL2 (BelfrySCAD/BOSL2, BSD-2-Clause, see THIRD_PARTY.md).
// An entry is DATA plus two pure functions: `script(params, place)` writes the text of a script for the Script API (so the
// user can read and edit it), and `scad(params)` writes the BOSL2 call that produces the same shape in OpenSCAD (the oracle,
// see docs/catalog-bosl.md). Nothing here touches the DOM or the kernel; it also has to load under plain node (type
// stripping) because tools/bosl_reference.mjs imports it, so: no runtime imports, no enums, no parameter properties.

export type ParamType = 'length' | 'angle' | 'integer' | 'bool' | 'choice';
export interface ParamDef {
  key: string;
  type: ParamType;
  default: number | boolean | string;
  min?: number;
  max?: number;
  unit?: string;
  choices?: string[];
  /** Becomes a document variable (a feature parameter stays linked to it). Parameters that only shape a sketch cannot be linked. */
  linked?: boolean;
}
export type Params = Record<string, number | boolean | string>;
export type Category = 'blocks' | 'cylinders' | 'round' | 'profiles';

/** Where an entry is built. */
export interface Place {
  /** Script text of the sketch plane: `'front'` for the ground, `face("F2.C1")` for a face. */
  plane: string;
  ground: boolean;
  /** Face name when placed on a face (the fillet then leaves the footprint edges alone). */
  hostFace?: string;
  /** Centre of the footprint in the sketch plane. */
  at: [number, number];
  /** Variable name prefix when parameters become document variables; null: literal numbers (previews, tests). */
  prefix: string | null;
}

export interface BoslEntry {
  id: string;
  name: string;
  category: Category;
  tags: string[];
  params: ParamDef[];
  /** BOSL2 module and the licence line shown in the UI and copied into the script header. */
  source: { module: string; file: string; licence: 'BSD-2-Clause' };
  notes: string;
  /** Text of the `part(...)` script. */
  script(p: Params, pl: Place): string;
  /** The BOSL2 statement (without $fn) for the oracle. */
  scad(p: Params): string;
  /** null when the parameters make a valid shape, else the reason (not translated: shown under the form). */
  check(p: Params): string | null;
  /** Placement on a face is supported (false: the ground / first body only). */
  onFace: boolean;
  /** Named parameter sets that exercise options the defaults leave off (they are oracle cases too). */
  samples?: Record<string, Params>;
}

// ---------------------------------------------------------------- script text helpers
const n = (v: number): string => String(Math.abs(v) < 1e-13 ? 0 : +v.toPrecision(16));
const P = (a: [number, number]): string => `[${n(a[0])}, ${n(a[1])}]`;
type Pt = [number, number];
type Seg = { k: 'l'; a: Pt; b: Pt } | { k: 'a'; c: Pt; a: Pt; b: Pt };

function header(e: BoslEntry, p: Params, pl: Place): string {
  const vars = e.params.filter((d) => d.linked);
  const lines = [`// ${e.source.module}() ported from BOSL2 (BelfrySCAD/BOSL2, ${e.source.licence}), see THIRD_PARTY.md. Edit the variables or the script freely.`];
  if (pl.prefix !== null && vars.length) lines.push(`variables({ ${vars.map((d) => `${pl.prefix}${d.key}: ${n(Number(p[d.key]))}`).join(', ')} });`);
  return lines.join('\n') + '\n';
}
/** A linked value: `expr('cuboid1_z')` or the number. */
const val = (p: Params, key: string, pl: Place): string => (pl.prefix !== null ? `expr('${pl.prefix}${key}')` : n(Number(p[key])));
const num = (p: Params, key: string): number => Number(p[key]);

/** Closed polygon (counter-clockwise) with each vertex rounded (tangent arc), chamfered (cut) or sharp. */
function cornerPath(pts: Pt[], round: number[], cham: number[]): Seg[] {
  const out: Seg[] = [];
  const m = pts.length;
  const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
  const unit = (a: Pt): Pt => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
  const corners = pts.map((v, i) => {
    const d1 = unit(sub(pts[(i + m - 1) % m], v)), d2 = unit(sub(pts[(i + 1) % m], v));
    const th = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1])));
    if (round[i] > 0) {
      const t = round[i] / Math.tan(th / 2);
      const bis = unit([d1[0] + d2[0], d1[1] + d2[1]]);
      const dc = round[i] / Math.sin(th / 2);
      return { a: [v[0] + d1[0] * t, v[1] + d1[1] * t] as Pt, b: [v[0] + d2[0] * t, v[1] + d2[1] * t] as Pt, c: [v[0] + bis[0] * dc, v[1] + bis[1] * dc] as Pt };
    }
    if (cham[i] > 0) return { a: [v[0] + d1[0] * cham[i], v[1] + d1[1] * cham[i]] as Pt, b: [v[0] + d2[0] * cham[i], v[1] + d2[1] * cham[i]] as Pt, c: null };
    return { a: v, b: v, c: null };
  });
  for (let i = 0; i < m; i++) {
    const cr = corners[i], nx = corners[(i + 1) % m];
    if (cr.c) out.push({ k: 'a', c: cr.c, a: cr.a, b: cr.b });
    else if (cr.a[0] !== cr.b[0] || cr.a[1] !== cr.b[1]) out.push({ k: 'l', a: cr.a, b: cr.b });
    if (Math.hypot(nx.a[0] - cr.b[0], nx.a[1] - cr.b[1]) > 1e-9) out.push({ k: 'l', a: cr.b, b: nx.a });
  }
  return out;
}
/** Segments to sketch-builder calls; `map` carries a profile coordinate to sketch coordinates, `flip` says it reverses orientation. */
function segCalls(segs: Seg[], map: (q: Pt) => Pt, flip: boolean): string {
  return segs.map((s) => {
    if (s.k === 'l') return `.line(${P(map(s.a))}, ${P(map(s.b))})`;
    return flip ? `.arc(${P(map(s.c))}, ${P(map(s.b))}, ${P(map(s.a))})` : `.arc(${P(map(s.c))}, ${P(map(s.a))}, ${P(map(s.b))})`;
  }).join('');
}

/** Selector of the edges a shape's own rounding or chamfer touches: all of them for the first body, the shape's own edges off the host face otherwise. */
function ownEdges(pl: Place, extra = ''): string {
  if (pl.ground) return extra ? `edges({ createdBy: body${extra} })` : `edges('all')`;
  return `edges({ createdBy: body, not: ${extra ? `edges({ union: [edges({ onFace: face('${pl.hostFace}') }), ${extra}] })` : `edges({ onFace: face('${pl.hostFace}') })`} })`;
}
const edgeOp = (kind: 'rounding' | 'chamfer', sel: string, amount: string): string => (kind === 'rounding' ? `.fillet(${sel}, ${amount})` : `.chamfer(${sel}, ${amount})`);

/** Revolve about the shape axis. Ground: the Right plane (sketch x is -Z, y is the radius) with the axis along sketch x. Face: a plane perpendicular to the face through a helper line, its y is the face normal. */
function revolveScript(name: string, pl: Place, segsOrCircle: { segs?: Seg[]; circle?: { c: Pt; r: number } }): string {
  const ground = pl.ground;
  const map = (q: Pt): Pt => (ground ? [-q[1], q[0]] : [q[0] + pl.at[0], q[1] + pl.at[1]]);
  const draw = segsOrCircle.circle
    ? `s.circle(${n(segsOrCircle.circle.r)}, ${P(map(segsOrCircle.circle.c))})`
    : `s${segCalls(segsOrCircle.segs!, map, false)}`;
  if (ground) return `part('${name}')\n  .sketch('right', (s) => ${draw})\n  .revolve(360, { axis: { from: [0, 0], to: [1, 0] } });\n`;
  return `part('${name}')\n  .sketchFeature(${pl.plane}, { points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: ${n(pl.at[0])}, y: ${n(pl.at[1])} }, { id: 'b', x: ${n(pl.at[0] + 1)}, y: ${n(pl.at[1])} }], entities: [{ id: 'ax', type: 'line', p1: 'a', p2: 'b', construction: true }] })\n`
    + `  .feature({ type: 'plane', mode: 'perpendicular', base: { kind: 'face', id: '${pl.hostFace}' }, axis: { kind: 'sketchLine', sketch: '$sketch', entity: 'ax' }, visible: false })\n`
    + `  .sketch(at('$last'), (s) => ${draw})\n  .revolve(360);\n`;
}

// ---------------------------------------------------------------- entries
const anchorParam: ParamDef = { key: 'anchor', type: 'choice', default: 'bottom', choices: ['bottom', 'center'] };
const scadAnchor = (p: Params): string => (p.anchor === 'center' ? 'CENTER' : 'BOTTOM');
const L = (key: string, def: number, min: number, max: number, linked = false): ParamDef => ({ key, type: 'length', default: def, min, max, unit: 'mm', linked });

const cuboid: BoslEntry = {
  id: 'cuboid', name: 'Cuboid', category: 'blocks', tags: ['box', 'block', 'cube', 'brick', 'rectangular', 'rounded box', 'chamfered box', 'plate'],
  params: [L('x', 40, 1, 200), L('y', 30, 1, 200), L('z', 20, 1, 200, true), L('rounding', 0, 0, 50, true), L('chamfer', 0, 0, 50, true), anchorParam],
  source: { module: 'cuboid', file: 'shapes3d.scad', licence: 'BSD-2-Clause' },
  samples: { rounded: { x: 40, y: 30, z: 20, rounding: 5, chamfer: 0, anchor: 'center' }, chamfered: { x: 35, y: 25, z: 18, rounding: 0, chamfer: 3, anchor: 'bottom' } },
  notes: 'rounding or chamfer applies to all twelve edges (BOSL2 accepts both options for edge subsets: not ported). Only one of them may be set.',
  onFace: true,
  check(p) {
    const m = Math.min(num(p, 'x'), num(p, 'y'), num(p, 'z')) / 2;
    if (num(p, 'rounding') > 0 && num(p, 'chamfer') > 0) return 'give rounding or chamfer, not both';
    if (num(p, 'rounding') >= m - 1e-9 || num(p, 'chamfer') >= m - 1e-9) return 'rounding / chamfer must be smaller than half the smallest side';
    return null;
  },
  script(p, pl) {
    const both = p.anchor === 'center';
    const kind = num(p, 'rounding') > 0 ? 'rounding' : num(p, 'chamfer') > 0 ? 'chamfer' : null;
    let s = header(this, p, pl);
    s += `const body_ = part('Cuboid')\n  .sketch(${pl.plane}, (s) => s.rect(${n(num(p, 'x'))}, ${n(num(p, 'y'))}, ${P(pl.at)}))\n  .extrude(${val(p, 'z', pl)}${both ? ", { direction: 'both' }" : ''});\n`;
    if (kind) s += `const body = body_.handle();\nbody_${edgeOp(kind, ownEdges(pl), val(p, kind, pl))};\n`;
    return s;
  },
  scad: (p) => `cuboid([${p.x}, ${p.y}, ${p.z}]${num(p, 'rounding') > 0 ? `, rounding=${p.rounding}` : ''}${num(p, 'chamfer') > 0 ? `, chamfer=${p.chamfer}` : ''}, anchor=${scadAnchor(p)});`,
};

const prismoid: BoslEntry = {
  id: 'prismoid', name: 'Prismoid', category: 'blocks', tags: ['frustum', 'taper', 'tapered block', 'pyramid', 'loft', 'square to rectangle', 'hopper', 'wedge block'],
  params: [L('x1', 40, 1, 200), L('y1', 30, 1, 200), L('x2', 20, 0.5, 200), L('y2', 15, 0.5, 200), L('h', 25, 1, 200), L('shiftx', 0, -50, 50), L('shifty', 0, -50, 50)],
  source: { module: 'prismoid', file: 'shapes3d.scad', licence: 'BSD-2-Clause' },
  notes: 'Rectangle to rectangle loft with an optional shift of the top. Base on the sketch plane (BOSL2 anchor BOTTOM). Rounded / chamfered prismoids are not ported (the kernel has no exact ruled round-corner loft).',
  onFace: true,
  check: (p) => (Math.abs(num(p, 'shiftx')) + num(p, 'x2') / 2 > 1e6 ? 'bad shift' : null),
  script(p, pl) {
    const [u, v] = pl.at;
    const sec = (w: number, h: number, cx: number, cy: number) => `(s) => s.rect(${n(w)}, ${n(h)}, ${P([cx, cy])})`;
    return header(this, p, pl)
      + `part('Prismoid').loft([\n  { on: ${pl.plane}, draw: ${sec(num(p, 'x1'), num(p, 'y1'), u, v)} },\n  { on: at(${pl.plane}, ${n(num(p, 'h'))}), draw: ${sec(num(p, 'x2'), num(p, 'y2'), u + num(p, 'shiftx'), v + num(p, 'shifty'))} },\n]);\n`;
  },
  scad: (p) => `prismoid(size1=[${p.x1}, ${p.y1}], size2=[${p.x2}, ${p.y2}], h=${p.h}, shift=[${p.shiftx}, ${p.shifty}]);`,
};

const cyl: BoslEntry = {
  id: 'cyl', name: 'Cylinder / cone', category: 'cylinders', tags: ['cylinder', 'cone', 'frustum', 'rod', 'pin', 'disc', 'round', 'rounded cylinder', 'chamfered cylinder', 'tapered'],
  params: [L('h', 30, 1, 200, true), L('d1', 20, 1, 200), L('d2', 20, 0.5, 200), L('rounding', 0, 0, 20, true), L('chamfer', 0, 0, 20, true), anchorParam],
  source: { module: 'cyl', file: 'shapes3d.scad', licence: 'BSD-2-Clause' },
  samples: {
    rounded_cylinder: { h: 30, d1: 20, d2: 20, rounding: 3, chamfer: 0, anchor: 'bottom' }, chamfered_cylinder: { h: 25, d1: 24, d2: 24, rounding: 0, chamfer: 2.5, anchor: 'center' },
    rounded_cone: { h: 30, d1: 30, d2: 14, rounding: 2.5, chamfer: 0, anchor: 'bottom' }, chamfered_cone: { h: 28, d1: 26, d2: 12, rounding: 0, chamfer: 3, anchor: 'center' },
  },
  notes: 'd1 = d2 is a cylinder (extrude + fillet / chamfer, all linked to variables); d1 differing is a cone (loft; with rounding or chamfer a revolved profile, whose dimensions are numbers in the sketch). rounding / chamfer apply to both end edges.',
  onFace: true,
  check(p) {
    if (num(p, 'rounding') > 0 && num(p, 'chamfer') > 0) return 'give rounding or chamfer, not both';
    const m = Math.min(num(p, 'h') / 2, num(p, 'd1') / 2, num(p, 'd2') / 2);
    if (num(p, 'rounding') >= m * 0.95 || num(p, 'chamfer') >= m * 0.95) return 'rounding / chamfer must be clearly smaller than half the height and the smaller radius';
    return null;
  },
  script(p, pl) {
    const h = num(p, 'h'), r1 = num(p, 'd1') / 2, r2 = num(p, 'd2') / 2;
    const center = p.anchor === 'center';
    const kind = num(p, 'rounding') > 0 ? 'rounding' : num(p, 'chamfer') > 0 ? 'chamfer' : null;
    let s = header(this, p, pl);
    const cylinder = Math.abs(r1 - r2) < 1e-9;
    if (cylinder) {
      s += `const body_ = part('Cylinder')\n  .sketch(${pl.plane}, (s) => s.circle(${n(r1)}, ${P(pl.at)}))\n  .extrude(${val(p, 'h', pl)}${center ? ", { direction: 'both' }" : ''});\n`;
      if (kind) s += `const body = body_.handle();\nbody_${edgeOp(kind, ownEdges(pl), val(p, kind, pl))};\n`;
      return s;
    }
    if (!kind) {
      const z0 = center ? -h / 2 : 0;
      const at0 = z0 === 0 ? pl.plane : `at(${pl.plane}, ${n(z0)})`;
      const at1 = `at(${pl.plane}, ${n(z0 + h)})`;
      return s + `part('Cone').loft([\n  { on: ${at0}, draw: (s) => s.circle(${n(r1)}, ${P(pl.at)}) },\n  { on: ${at1}, draw: (s) => s.circle(${n(r2)}, ${P(pl.at)}) },\n]);\n`;
    }
    const z0 = center ? -h / 2 : 0, z1 = z0 + h;
    const amt = num(p, kind);
    const pts: Pt[] = [[0, z0], [r1, z0], [r2, z1], [0, z1]];
    let segs: Seg[];
    if (kind === 'rounding') segs = cornerPath(pts, [0, amt, amt, 0], [0, 0, 0, 0]);
    else {
      // BOSL2 chamfer: `amt` across the end face and `amt` along the axis
      const side = (z: number): number => r1 + (r2 - r1) * (z - z0) / h;
      segs = [
        { k: 'l', a: [0, z0], b: [r1 - amt, z0] }, { k: 'l', a: [r1 - amt, z0], b: [side(z0 + amt), z0 + amt] },
        { k: 'l', a: [side(z0 + amt), z0 + amt], b: [side(z1 - amt), z1 - amt] }, { k: 'l', a: [side(z1 - amt), z1 - amt], b: [r2 - amt, z1] },
        { k: 'l', a: [r2 - amt, z1], b: [0, z1] }, { k: 'l', a: [0, z1], b: [0, z0] },
      ];
    }
    if (kind === 'rounding') segs.push({ k: 'l', a: [0, z1], b: [0, z0] });
    return s + revolveScript('Cone', pl, { segs });
  },
  scad: (p) => `cyl(h=${p.h}, d1=${p.d1}, d2=${p.d2}${num(p, 'rounding') > 0 ? `, rounding=${p.rounding}` : ''}${num(p, 'chamfer') > 0 ? `, chamfer=${p.chamfer}` : ''}, anchor=${scadAnchor(p)});`,
};

const tube: BoslEntry = {
  id: 'tube', name: 'Tube', category: 'cylinders', tags: ['pipe', 'ring', 'sleeve', 'bushing', 'spacer', 'hollow cylinder', 'bearing', 'washer'],
  params: [L('h', 30, 1, 200, true), L('od', 30, 2, 200), L('id', 22, 1, 198), anchorParam],
  source: { module: 'tube', file: 'shapes3d.scad', licence: 'BSD-2-Clause' },
  notes: 'Outer diameter od and inner diameter id (BOSL2 also takes the wall thickness: id = od - 2 wall).',
  onFace: true,
  check: (p) => (num(p, 'id') >= num(p, 'od') - 0.2 ? 'id must be smaller than od' : null),
  script(p, pl) {
    return header(this, p, pl) + `part('Tube')\n  .sketch(${pl.plane}, (s) => s.circle(${n(num(p, 'od') / 2)}, ${P(pl.at)}).circle(${n(num(p, 'id') / 2)}, ${P(pl.at)}))\n  .extrude(${val(p, 'h', pl)}${p.anchor === 'center' ? ", { direction: 'both' }" : ''});\n`;
  },
  scad: (p) => `tube(h=${p.h}, od=${p.od}, id=${p.id}, anchor=${scadAnchor(p)});`,
};

const rectTube: BoslEntry = {
  id: 'rect_tube', name: 'Rectangular tube', category: 'blocks', tags: ['box section', 'square tube', 'rhs', 'shs', 'frame', 'hollow box', 'channel'],
  params: [L('h', 30, 1, 200, true), L('x', 30, 2, 200), L('y', 20, 2, 200), L('wall', 3, 0.2, 40), anchorParam],
  source: { module: 'rect_tube', file: 'shapes3d.scad', licence: 'BSD-2-Clause' },
  notes: 'Outer size x by y and a wall thickness (the inside is x - 2 wall by y - 2 wall).',
  onFace: true,
  check: (p) => (num(p, 'wall') * 2 >= Math.min(num(p, 'x'), num(p, 'y')) - 0.1 ? 'wall is too thick for the size' : null),
  script(p, pl) {
    return header(this, p, pl) + `part('Rect tube')\n  .sketch(${pl.plane}, (s) => s.rect(${n(num(p, 'x'))}, ${n(num(p, 'y'))}, ${P(pl.at)}).rect(${n(num(p, 'x') - 2 * num(p, 'wall'))}, ${n(num(p, 'y') - 2 * num(p, 'wall'))}, ${P(pl.at)}))\n  .extrude(${val(p, 'h', pl)}${p.anchor === 'center' ? ", { direction: 'both' }" : ''});\n`;
  },
  scad: (p) => `rect_tube(h=${p.h}, size=[${p.x}, ${p.y}], wall=${p.wall}, anchor=${scadAnchor(p)});`,
};

const pie: BoslEntry = {
  id: 'pie_slice', name: 'Pie slice', category: 'cylinders', tags: ['sector', 'wedge', 'segment', 'slice', 'cake', 'fan', 'quadrant'],
  params: [L('h', 10, 1, 200, true), L('d', 40, 2, 200), { key: 'ang', type: 'angle', default: 60, min: 5, max: 350, unit: 'deg' }, anchorParam],
  source: { module: 'pie_slice', file: 'shapes3d.scad', licence: 'BSD-2-Clause' },
  notes: 'A sector of a cylinder from 0 to ang degrees about the Z axis, apex at the origin.',
  onFace: true,
  check: () => null,
  script(p, pl) {
    const r = num(p, 'd') / 2, a = num(p, 'ang') * Math.PI / 180, [u, v] = pl.at;
    const end: Pt = [u + r * Math.cos(a), v + r * Math.sin(a)];
    return header(this, p, pl) + `part('Pie slice')\n  .sketch(${pl.plane}, (s) => s.line(${P([u, v])}, ${P([u + r, v])}).arc(${P([u, v])}, ${P([u + r, v])}, ${P(end)}).line(${P(end)}, ${P([u, v])}))\n  .extrude(${val(p, 'h', pl)}${p.anchor === 'center' ? ", { direction: 'both' }" : ''});\n`;
  },
  scad: (p) => `pie_slice(h=${p.h}, d=${p.d}, ang=${p.ang}, anchor=${scadAnchor(p)});`,
};

const wedge: BoslEntry = {
  id: 'wedge', name: 'Wedge', category: 'blocks', tags: ['ramp', 'triangular prism', 'gusset', 'slope', 'triangle', 'door stop', 'incline'],
  params: [L('x', 30, 1, 200, true), L('y', 20, 1, 200), L('z', 15, 1, 200)],
  source: { module: 'wedge', file: 'shapes3d.scad', licence: 'BSD-2-Clause' },
  notes: 'A right-triangle prism: legs y and z, length x (the extrusion). Minimum corner at the origin like BOSL2. On a face the length x runs along the face normal.',
  onFace: true,
  check: () => null,
  script(p, pl) {
    const y = num(p, 'y'), z = num(p, 'z'), [u, v] = pl.at;
    const pts = pl.ground ? [[0, y], [0, 0], [-z, 0]] : [[u + y, v], [u, v], [u, v + z]];
    return header(this, p, pl) + `part('Wedge')\n  .sketch(${pl.ground ? "'right'" : pl.plane}, (s) => s.polygon(${JSON.stringify(pts)}))\n  .extrude(${val(p, 'x', pl)});\n`;
  },
  scad: (p) => `wedge([${p.x}, ${p.y}, ${p.z}]);`,
};

const regularPrism: BoslEntry = {
  id: 'regular_prism', name: 'Regular prism', category: 'cylinders', tags: ['hexagon', 'hex', 'octagon', 'pentagon', 'polygon', 'nut', 'hex bar', 'n-gon', 'triangle prism'],
  params: [{ key: 'n', type: 'integer', default: 6, min: 3, max: 24 }, L('h', 20, 1, 200, true), L('r', 15, 1, 100), { key: 'realign', type: 'bool', default: false }, L('rounding', 0, 0, 20, true), L('chamfer', 0, 0, 20, true), anchorParam],
  source: { module: 'regular_prism', file: 'shapes3d.scad', licence: 'BSD-2-Clause' },
  samples: { rounded: { n: 6, h: 20, r: 15, realign: false, rounding: 3, chamfer: 0, anchor: 'bottom' }, chamfered: { n: 5, h: 18, r: 14, realign: true, rounding: 0, chamfer: 2, anchor: 'center' } },
  notes: 'n sided prism, r is the circumradius (a vertex lies on +X unless realign). rounding / chamfer apply to the two end edges.',
  onFace: true,
  check(p) {
    if (num(p, 'rounding') > 0 && num(p, 'chamfer') > 0) return 'give rounding or chamfer, not both';
    const ap = num(p, 'r') * Math.cos(Math.PI / num(p, 'n'));
    if (Math.max(num(p, 'rounding'), num(p, 'chamfer')) >= Math.min(num(p, 'h') / 2, ap) * 0.9) return 'rounding / chamfer is too big for the height or the apothem';
    return null;
  },
  script(p, pl) {
    const nn = Math.round(num(p, 'n')), r = num(p, 'r'), off = p.realign ? Math.PI / nn : 0;
    const pts = Array.from({ length: nn }, (_, i) => [+(pl.at[0] + r * Math.cos(off + 2 * Math.PI * i / nn)).toFixed(6), +(pl.at[1] + r * Math.sin(off + 2 * Math.PI * i / nn)).toFixed(6)]);
    const kind = num(p, 'rounding') > 0 ? 'rounding' : num(p, 'chamfer') > 0 ? 'chamfer' : null;
    let s = header(this, p, pl) + `const body_ = part('Prism')\n  .sketch(${pl.plane}, (s) => s.polygon(${JSON.stringify(pts)}))\n  .extrude(${val(p, 'h', pl)}${p.anchor === 'center' ? ", { direction: 'both' }" : ''});\n`;
    if (kind) s += `const body = body_.handle();\nbody_${edgeOp(kind, pl.ground ? `edges({ createdBy: body, not: edges('|Z') })` : ownEdges(pl, `edges('|Z')`), val(p, kind, pl))};\n`;
    return s;
  },
  scad: (p) => `regular_prism(n=${p.n}, h=${p.h}, r=${p.r}${p.realign ? ', realign=true' : ''}${num(p, 'rounding') > 0 ? `, rounding=${p.rounding}` : ''}${num(p, 'chamfer') > 0 ? `, chamfer=${p.chamfer}` : ''}, anchor=${scadAnchor(p)});`,
};

const sphere: BoslEntry = {
  id: 'spheroid', name: 'Sphere', category: 'round', tags: ['ball', 'globe', 'dome', 'spheroid', 'round', 'knob'],
  params: [L('d', 30, 1, 200), anchorParam],
  source: { module: 'spheroid', file: 'shapes3d.scad', licence: 'BSD-2-Clause' },
  notes: 'An exact spherical face (a half disc revolved 360 degrees).',
  onFace: true,
  check: () => null,
  script(p, pl) {
    const r = num(p, 'd') / 2, z0 = p.anchor === 'center' ? 0 : r;
    const segs: Seg[] = [{ k: 'a', c: [0, z0], a: [0, z0 - r], b: [0, z0 + r] }, { k: 'l', a: [0, z0 + r], b: [0, z0 - r] }];
    return header(this, p, pl) + revolveScript('Sphere', pl, { segs });
  },
  scad: (p) => `spheroid(d=${p.d}, style="orig", anchor=${scadAnchor(p)});`,
};

const torus: BoslEntry = {
  id: 'torus', name: 'Torus', category: 'round', tags: ['donut', 'o-ring', 'ring', 'doughnut', 'seal', 'tyre'],
  params: [L('rmaj', 15, 1, 100), L('rmin', 4, 0.3, 50), anchorParam],
  source: { module: 'torus', file: 'shapes3d.scad', licence: 'BSD-2-Clause' },
  notes: 'Major radius to the tube centre, minor radius of the tube. An exact torus face (a circle revolved 360 degrees).',
  onFace: true,
  check: (p) => (num(p, 'rmin') >= num(p, 'rmaj') - 0.05 ? 'rmin must be smaller than rmaj' : null),
  script(p, pl) {
    const z = p.anchor === 'center' ? 0 : num(p, 'rmin');
    return header(this, p, pl) + revolveScript('Torus', pl, { circle: { c: [num(p, 'rmaj'), z], r: num(p, 'rmin') } });
  },
  scad: (p) => `torus(r_maj=${p.rmaj}, r_min=${p.rmin}, anchor=${p.anchor === 'center' ? 'CENTER' : 'BOTTOM'});`,
};

/** teardrop2d of BOSL2 as segments in (x, z): circle of radius r, tangent lines at `ang`, tip at r / sin(ang) or cut at cap. */
function teardropSegs(r: number, ang: number, cap: number): Seg[] {
  const a = ang * Math.PI / 180;
  const tipY = r / Math.sin(a);
  const tl: Pt = [-r * Math.cos(a), r * Math.sin(a)], tr: Pt = [r * Math.cos(a), r * Math.sin(a)];
  const arc: Seg = { k: 'a', c: [0, 0], a: tl, b: tr };
  if (!(cap > 0) || cap >= tipY) return [arc, { k: 'l', a: tr, b: [0, tipY] }, { k: 'l', a: [0, tipY], b: tl }];
  const dx = (tipY - cap) * Math.tan(a);
  return [arc, { k: 'l', a: tr, b: [dx, cap] }, { k: 'l', a: [dx, cap], b: [-dx, cap] }, { k: 'l', a: [-dx, cap], b: tl }];
}
const teardrop: BoslEntry = {
  id: 'teardrop', name: 'Teardrop', category: 'profiles', tags: ['horizontal hole', 'printable hole', '3d print', 'overhang', 'bridge', 'fdm', 'drop'],
  params: [L('l', 20, 1, 200, true), L('r', 5, 0.5, 50), { key: 'ang', type: 'angle', default: 45, min: 20, max: 80, unit: 'deg' }, L('cap_h', 0, 0, 100)],
  source: { module: 'teardrop', file: 'shapes3d.scad', licence: 'BSD-2-Clause' },
  samples: { capped: { l: 20, r: 5, ang: 45, cap_h: 6 } },
  notes: 'Circle plus the tangent cone of a printable horizontal hole, extruded l along Y, centred (BOSL2 axis BACK). cap_h = 0: pointed tip. Use it as a CUT through a wall for a hole that prints without support. On a face it extrudes along the face normal.',
  onFace: true,
  check(p) { return num(p, 'cap_h') > 0 && num(p, 'cap_h') < num(p, 'r') * Math.sin(num(p, 'ang') * Math.PI / 180) ? 'cap_h is below the circle tangent height' : null; },
  script(p, pl) {
    const segs = teardropSegs(num(p, 'r'), num(p, 'ang'), num(p, 'cap_h'));
    // ground: the Top plane (sketch y is -Z, so z up is -y: orientation flips); face: the face plane as is
    const map = (q: Pt): Pt => (pl.ground ? [q[0], -q[1]] : [q[0] + pl.at[0], q[1] + pl.at[1]]);
    return header(this, p, pl) + `part('Teardrop')\n  .sketch(${pl.ground ? "'top'" : pl.plane}, (s) => s${segCalls(segs, map, pl.ground)})\n  .extrude(${val(p, 'l', pl)}, { direction: 'both' });\n`;
  },
  scad: (p) => `teardrop(l=${p.l}, r=${p.r}, ang=${p.ang}${num(p, 'cap_h') > 0 ? `, cap_h=${p.cap_h}` : ''});`,
};

const onion: BoslEntry = {
  id: 'onion', name: 'Onion', category: 'profiles', tags: ['teardrop 3d', 'dome', 'conical cap', 'printable sphere', 'void top', 'pointed sphere'],
  params: [L('r', 15, 1, 100), { key: 'ang', type: 'angle', default: 45, min: 20, max: 80, unit: 'deg' }, L('cap_h', 0, 0, 200)],
  source: { module: 'onion', file: 'shapes3d.scad', licence: 'BSD-2-Clause' },
  samples: { capped: { r: 15, ang: 30, cap_h: 20 } },
  notes: 'A sphere with a conical hat (a 3D teardrop), centred. cap_h = 0: pointed tip. Revolved profile of a circle arc and straight lines.',
  onFace: true,
  check(p) { return num(p, 'cap_h') > 0 && num(p, 'cap_h') < num(p, 'r') * Math.sin(num(p, 'ang') * Math.PI / 180) ? 'cap_h is below the circle tangent height' : null; },
  script(p, pl) {
    const r = num(p, 'r'), a = num(p, 'ang') * Math.PI / 180, cap = num(p, 'cap_h');
    const tipY = r / Math.sin(a), tr: Pt = [r * Math.cos(a), r * Math.sin(a)];
    const top = cap > 0 && cap < tipY ? cap : tipY;
    const dx = cap > 0 && cap < tipY ? (tipY - cap) * Math.tan(a) : 0;
    const segs: Seg[] = [{ k: 'a', c: [0, 0], a: [0, -r], b: tr }, { k: 'l', a: tr, b: [dx, top] }];
    if (dx > 0) segs.push({ k: 'l', a: [dx, top], b: [0, top] });
    segs.push({ k: 'l', a: [0, top], b: [0, -r] });
    return header(this, p, pl) + revolveScript('Onion', pl, { segs });
  },
  scad: (p) => `onion(r=${p.r}, ang=${p.ang}${num(p, 'cap_h') > 0 ? `, cap_h=${p.cap_h}` : ''});`,
};

export const BOSL_ENTRIES: BoslEntry[] = [cuboid, prismoid, wedge, rectTube, cyl, tube, pie, regularPrism, sphere, torus, teardrop, onion];
export const boslEntry = (id: string): BoslEntry | undefined => BOSL_ENTRIES.find((e) => e.id === id);
export const defaultParams = (e: BoslEntry): Params => Object.fromEntries(e.params.map((d) => [d.key, d.default]));

/** Deterministic pseudo-random parameter sets inside each parameter's range that pass `check` (mulberry32). */
export function randomParams(e: BoslEntry, seed: number, count: number): Params[] {
  let s = seed >>> 0;
  const rnd = (): number => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out: Params[] = [];
  for (let guard = 0; out.length < count && guard < 500; guard++) {
    const p: Params = {};
    for (const d of e.params) {
      if (d.type === 'choice') p[d.key] = d.choices![Math.floor(rnd() * d.choices!.length)];
      else if (d.type === 'bool') p[d.key] = rnd() < 0.5;
      else if (d.type === 'integer') p[d.key] = Math.round(d.min! + rnd() * (d.max! - d.min!));
      else {
        // tame ranges: stay within a fifth to half of the span so shapes stay sane; zero stays reachable for optional lengths
        const lo = d.min!, hi = Math.min(d.max!, Math.max(d.min! * 4, Number(d.default) * 2));
        p[d.key] = d.min === 0 && rnd() < 0.5 ? 0 : +(lo + rnd() * (hi - lo)).toFixed(1);
      }
    }
    if (e.check(p) === null) out.push(p);
  }
  return out;
}
