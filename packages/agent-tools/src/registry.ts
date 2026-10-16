// The method registry for the script API: what list_methods / docs read. This is a MINIMAL registry written from
// docs/scripting.md and the exports of @kit/script; the @kit/skill package (generated registry, BM25 search) can replace it
// by passing its own object with the same shape to AgentSession.open({ registry }).
import { EXAMPLES } from '@kit/script';

export interface MethodDoc {
  name: string;
  /** Where it lives: the global scope, the part chain, the sketch builder or a selector. */
  group: 'global' | 'part' | 'sketch' | 'selector';
  signature: string;
  summary: string;
  notes?: string;
  example?: string;
}
export interface Recipe { id: string; title: string; code: string }
export interface Registry {
  methods(): MethodDoc[];
  recipes(): Recipe[];
  /** Ranked search by name, summary and notes. */
  search(query: string, limit?: number): MethodDoc[];
  get(name: string): MethodDoc | undefined;
  guide(): string;
}

const M = (group: MethodDoc['group'], name: string, signature: string, summary: string, example?: string, notes?: string): MethodDoc => ({ group, name, signature, summary, ...(example ? { example } : {}), ...(notes ? { notes } : {}) });

export const METHODS: MethodDoc[] = [
  M('global', 'part', "part(name?) -> chain", 'Start the part; the script must build one (the last wins). Every call on the chain adds ONE feature.', "part('Bracket').sketch('front', s => s.rect(60, 40)).extrude(12)"),
  M('global', 'variables', 'variables({name: number | "expr"}) -> numbers', 'Named values; strings are expressions over earlier ones. They become the document Variables.', 'const { w, t } = variables({ w: 60, t: "w/5" })'),
  M('global', 'expr', 'expr("w*2") -> Expr', 'Keep a feature parameter linked to variables (stored as =w*2). Inside a sketch only its current number is used.'),
  M('global', 'through', 'through()', 'Cut depth marker: through everything.', ".cut(through())"),
  M('global', 'at', "at(plane, offset)", "A standard plane ('front' z, 'top' y, 'right' x) moved along its normal; adds a reference plane feature.", "part('P').sketch(at('front', 10), s => s.circle(5))"),
  M('selector', 'face', "face(sel) -> face selector", "ONE planar face of the body as it is just before the step. '>X' '<X' '>Y' '<Y' '>Z' '<Z' (extreme face with that normal), '#top' = '>Z', '#bottom' = '<Z'.", ".hole(face('>Z'), [0, 0], { diameter: 8 })", "The 'top' sketch plane extrudes along +Y so its top face is face('>Y'); 'front' extrudes along +Z."),
  M('selector', 'edges', "edges(sel | rule) -> edge selector", "'all', '|X' '|Y' '|Z' (straight edges parallel to the axis), '>X'..'<Z' (edges in the extreme plane) or a rule object whose keys AND together: parallel, outside, inside, not, onFace, lengthGreater, lengthLess, near+within, union, intersect, difference.", ".fillet(edges('|Z'), 4)  // or edges({ parallel: 'Z', lengthGreater: 10 })"),
  M('part', 'sketch', "sketch(plane | face(..) | at(..), fn(s), name?)", "Sketch on 'front' | 'top' | 'right', a face or an offset plane. The callback draws with the sketch builder.", ".sketch('front', s => s.rect(w, h))"),
  M('part', 'extrude', "extrude(depth, {mid, flip, draft, thin})", 'Extrude (add) the last sketch.', ".extrude(expr('t'), { mid: true })"),
  M('part', 'cut', "cut(depth | through(), {...})", 'Extrude (cut) the last sketch. Same options as extrude.', ".sketch(face('>Z'), s => s.circle(4)).cut(through())"),
  M('part', 'revolve', "revolve(angle = 360, {op, thin, axis})", "Revolve the last sketch about the sketch's Y axis (a construction line is added) or axis: {from:[x,y], to:[x,y]}.", ".sketch('front', s => s.polygon(pts)).revolve(360)"),
  M('part', 'thin', 'thin(t)', 'Make the previous extrude / revolve thin-walled.'),
  M('part', 'hole', "hole(face, [x, y], {diameter, depth?, flip?})", 'Sketch with a point plus a simple hole. Through unless depth is given. The hole drills into the material from the face.', ".hole(face('>Z'), [-15, 0], { diameter: 8 })"),
  M('part', 'fillet', 'fillet(edges, r)', 'Round the selected edges.', ".fillet(edges('|Z'), 4)"),
  M('part', 'chamfer', 'chamfer(edges, d)', 'Chamfer the selected edges.'),
  M('part', 'holes.polar', "holes.polar(face, {center, radius, count, startAngle = 0}, {diameter, depth?})", 'ONE hole feature at count points on a circle (sketch-plane coordinates).'),
  M('part', 'holes.grid', "holes.grid(face, {origin, pitch: [dx, dy], count: [nx, ny]}, {diameter, depth?})", 'ONE hole feature at a grid of points.'),
  M('part', 'holes.points', "holes.points(face, [[x, y], ...], {diameter, depth?})", 'ONE hole feature at the listed points.'),
  M('part', 'shell', 'shell(face, t)', 'Hollow the body; the face is opened.', ".shell(face('>Z'), 2)"),
  M('part', 'linearPattern', "linearPattern({count, spacing, axis})", "Pattern of the last feature along 'x' | 'y' | 'z'."),
  M('part', 'circularPattern', "circularPattern({count, axis, angle})", "Pattern of the last feature about 'x' | 'y' | 'z'."),
  M('sketch', 's.rect', 's.rect(w, h, [cx, cy]?)', 'Centred rectangle.'),
  M('sketch', 's.circle', 's.circle(radius, [cx, cy]?)', 'Circle by RADIUS.'),
  M('sketch', 's.polygon', 's.polygon(pts)', 'Closed polygon from [[x, y], ...].'),
  M('sketch', 's.polyline', 's.polyline(pts)', 'Open polyline.'),
  M('sketch', 's.line', 's.line(a, b)', 'One line segment.'),
  M('sketch', 's.arc', 's.arc(centre, start, end)', 'Counter-clockwise arc from start to end point.'),
  M('sketch', 's.point', 's.point(at)', 'One point feature.'),
  M('sketch', 's.axis', 's.axis()', 'Construction axis for revolve.'),
  M('sketch', 's.axisAt', 's.axisAt(from, to)', 'Construction line used as the revolve axis.'),
  M('sketch', 's.points', 's.points([[x, y], ...])', 'One point per entry.'),
  M('sketch', 's.polarPoints', 's.polarPoints(center, radius, n, startAngle = 0)', 'n points on a circle.'),
  M('sketch', 's.grid', 's.grid(origin, [dx, dy], [nx, ny])', 'A grid of points.'),
];

const GUIDE = `Script API (JavaScript; the script must call part("Name")). Every chain call adds ONE normal feature to the history.
Units are millimetres. Planes: 'front' (extrudes +Z), 'top' (+Y), 'right' (+X). A sketch must come before extrude/cut/revolve.
Selectors (face(), edges()) resolve against the body just before that step; an unsupported or empty selector reports "Line N".
Use run_script mode 'new' to start a part, 'attach' to add to the open document (hand-made features stay).
Loop: run_script -> facts / tree -> probe / section / snapshot to check against the plan -> fix by editing the script and re-running.`;

export function defaultRegistry(): Registry {
  const recipes = EXAMPLES.filter((e) => !e.id.startsWith('matx')).map((e) => ({ id: e.id, title: e.title, code: e.code }));
  return {
    methods: () => METHODS,
    recipes: () => recipes,
    get: (name) => METHODS.find((m) => m.name === name || m.name.endsWith(`.${name}`)),
    search(query, limit = 10) {
      const terms = query.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
      if (!terms.length) return METHODS.slice(0, limit);
      const scored = METHODS.map((m) => {
        const hay = `${m.name} ${m.signature} ${m.summary} ${m.notes ?? ''} ${m.group}`.toLowerCase();
        let s = 0;
        for (const t of terms) { if (m.name.toLowerCase().includes(t)) s += 5; if (hay.includes(t)) s += 1; }
        return { m, s };
      }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
      return scored.slice(0, limit).map((x) => x.m);
    },
    guide: () => GUIDE,
  };
}
