// Recipes: typed worked examples. Each `script` / `features` recipe is EXECUTED against the real kernel by test/recipes.kernel.test.ts
// and must produce `expected` (volume, validity, feature count), so an example here cannot silently rot.
import type { Recipe } from './types';

const PI = Math.PI;
const pi = (x: number) => x * PI;
// area of the 4 x 8 keyway rectangle (x -2..2, y 2..10) that lies INSIDE the r = 5 bore: integral of (sqrt(25 - x^2) - 2) over x in -2..2
const KEY_OVERLAP = 2 * (Math.sqrt(21) + 12.5 * Math.asin(0.4)) - 8;
// tapered boss: frustum of height 20 from r 15 narrowing at 5 degrees, minus the 1.5 chamfer ring (Pappus: triangle area x 2 pi x centroid radius)
const TAPER = Math.tan((5 * PI) / 180);
const R_TOP = 15 - 20 * TAPER;
const FRUSTUM = (PI * 20 / 3) * (15 * 15 + 15 * R_TOP + R_TOP * R_TOP);
const CH_AREA = 0.5 * 1.5 * 1.5 * Math.sin(((90 + 5) * PI) / 180);
const CH_CENTROID = (R_TOP + (R_TOP - 1.5) + (R_TOP + 1.5 * Math.sin((5 * PI) / 180))) / 3;

export const RECIPES: Recipe[] = [
  {
    id: 'boss-by-feature-verified',
    title: 'Plate with a boss: pick faces by feature and verify with read-backs',
    intent: ['boss', 'face selection', 'select face', 'which face', 'handle', 'of feature', 'ambiguous', 'warning', 'verify', 'expect', 'read back', 'volume check', 'await'],
    description: 'After a boss, face(">Z") is the boss top and the plate top faces the same way; the run warns about that. Take a handle right after each feature and pass { of: handle } to choose the face on purpose. The script then reads the bore faces back and asserts the volume with expectVolume, so a wrong face or a missing cut shows up as an error with a line number.',
    kind: 'script',
    code: `// 60 x 40 x 10 plate, a 24 mm boss 15 tall on top of it, a bore through everything, a blind hole on the PLATE top
const p = part('Plate with boss')
  .sketch('front', (s) => s.rect(60, 40)).extrude(10);
const plate = p.handle();
p.sketch(face('>Z'), (s) => s.circle(12)).extrude(15);
const boss = p.handle();
p.hole(face('>Z', { of: boss }), [0, 0], { diameter: 8 })          // the boss top, on purpose (no warning)
  .hole(face('>Z', { of: plate }), [22, 0], { diameter: 6, depth: 6 });   // the plate top, beside the boss

const bores = (await p.faces()).filter((f) => f.kind === 'cylinder' && Math.abs(f.radius - 4) < 1e-3);
if (bores.length !== 1) throw new Error('expected one R4 bore, found ' + bores.length);
p.expectVolume(60 * 40 * 10 + Math.PI * 144 * 15 - Math.PI * 16 * 25 - Math.PI * 9 * 6, { tol: 1e-6 })
  .expectValid();`,
    expected: { volume: 24000 + pi(144 * 15 - 16 * 25 - 9 * 6), volumeTol: 1e-6, features: 8, valid: true },
  },
  {
    id: 'flanged-bushing',
    title: 'Flanged bushing (revolved profile)',
    intent: ['bushing', 'bush', 'sleeve', 'flange', 'revolve', 'lathe', 'turned part', 'spacer'],
    description: 'A half cross-section polygon (x = radius, y = height along the axis) revolved 360 degrees. Draw the profile on one side of the axis only. Bore 10, body 15, flange 25 x 6, total height 30.',
    kind: 'script',
    code: `// profile: [radius, height]; bore radius 10, body radius 15, flange radius 25 and 6 thick
const { bore, body, fl, ft, h } = variables({ bore: 10, body: 15, fl: 25, ft: 6, h: 30 });
part('Flanged bushing')
  .sketch('front', (s) => s.polygon([[bore, 0], [fl, 0], [fl, ft], [body, ft], [body, h], [bore, h]]))
  .revolve(360);`,
    expected: { volume: pi((25 ** 2 - 10 ** 2) * 6 + (15 ** 2 - 10 ** 2) * 24), volumeTol: 1e-4, features: 2, valid: true },
  },
  {
    id: 'bolt-circle-plate',
    title: 'Round plate with a centre bore and a bolt circle',
    intent: ['bolt circle', 'bolt pattern', 'pcd', 'holes on a circle', 'flange plate', 'polar holes', 'hole', 'bore'],
    description: 'A disc, one centre bore and ONE holes.polar feature for the bolt circle (not six hole() calls). Centres are given in the face sketch plane; [0, 0] is the disc centre.',
    kind: 'script',
    code: `const { R, t } = variables({ R: 40, t: 8 });
part('Bolt circle plate')
  .sketch('front', (s) => s.circle(R))
  .extrude(expr('t'))
  .hole(face('>Z'), [0, 0], { diameter: 20 })
  .holes.polar(face('>Z'), { center: [0, 0], radius: 28, count: 6 }, { diameter: 6 });`,
    expected: { volume: 8 * pi(40 ** 2 - 10 ** 2 - 6 * 3 ** 2), volumeTol: 1e-4, features: 6, valid: true },
  },
  {
    id: 'l-bracket',
    title: 'L-bracket with filleted corners and mounting holes',
    intent: ['bracket', 'l bracket', 'angle bracket', 'fillet', 'round corners', 'mount', 'polygon profile', 'extrude'],
    description: 'An L profile drawn as a polygon and extruded; the corner edges parallel to the extrusion are rounded with ONE fillet (edges(|Z)). Fillet before adding holes near the corners.',
    kind: 'script',
    code: `// L profile in XY (leg 50 x 6 and 40 high), 30 wide along Z; r = 1.5 on the corner edges
part('L bracket')
  .sketch('front', (s) => s.polygon([[0, 0], [50, 0], [50, 6], [6, 6], [6, 40], [0, 40]]))
  .extrude(30)
  .fillet(edges('|Z'), 1.5)
  .holes.points(face('<X'), [[15, 20]], { diameter: 6 });`,
    expected: { volume: (504 - 4 * (1 - PI / 4) * 1.5 ** 2) * 30 - PI * 9 * 6, volumeTol: 1e-4, features: 5, valid: true },
  },
  {
    id: 'hollow-box-lid',
    title: 'Hollow box: shell the walls, then close it with a lid',
    intent: ['hollow', 'shell', 'box', 'enclosure', 'lid', 'cover', 'thin wall', 'case', 'wall thickness'],
    description: 'Extrude a block, shell it open at the top, then sketch the lid on the rim face (the ring face is still face(>Z)) and extrude it: the box is closed and keeps an internal cavity. For a lid that must come off, build it as a second part in a second script.',
    kind: 'script',
    code: `const { w, d, h, t } = variables({ w: 60, d: 40, h: 25, t: 2 });
part('Closed box')
  .sketch('front', (s) => s.rect(w, d))
  .extrude(expr('h'))
  .shell(face('>Z'), expr('t'))
  .sketch(face('>Z'), (s) => s.rect(w, d))
  .extrude(expr('t'));`,
    expected: { volume: 60 * 40 * 27 - 56 * 36 * 23, volumeTol: 1e-4, features: 5, valid: true },
  },
  {
    id: 'pulley',
    title: 'Pulley: revolved groove profile plus lightening holes',
    intent: ['pulley', 'sheave', 'wheel', 'revolve', 'groove', 'lathe', 'holes', 'bolt circle', 'lightening holes'],
    description: 'Revolve the profile on the right plane (axis is world Y), then drill ONE hole feature through the web with holes.polar from the face on top (face(>Y)).',
    kind: 'script',
    code: `// BenchCAD-style pulley: bore 17.5, rim 62.4, flange 70, width +-12.6, groove half width 5
const { bore, rim, flange, w, gw } = variables({ bore: 17.5, rim: 62.4, flange: 70, w: 12.6, gw: 5 });
part('Pulley')
  .sketch('right', (s) => s.polygon([
    [bore, -w], [rim, -w], [rim, -gw], [flange, -gw],
    [flange, gw], [rim, gw], [rim, w], [bore, w],
  ]))
  .revolve(360)
  .holes.polar(face('>Y'), { center: [0, 0], radius: 40, count: 6 }, { diameter: 6 });`,
    expected: { volume: 315628.4374 - 6 * PI * 9 * 25.2, volumeTol: 1e-4, features: 4, valid: true },
  },
  {
    id: 'spur-gear-blank',
    title: 'Spur gear blank: disc, hub, bore and keyway (no teeth)',
    intent: ['gear', 'spur gear', 'blank', 'hub', 'bore', 'keyway', 'slot', 'pinion', 'disc'],
    description: 'Disc, a hub boss on its face, a through bore, a keyway cut. The tooth form is NOT available from the script API (the kernel has a gear feature, see docs/gears.md): cut the teeth in the GUI or leave the blank.',
    kind: 'script',
    code: `// disc R30 x 10, hub R12 x 6 on the front face, bore dia 10, keyway 4 wide
part('Gear blank')
  .sketch('front', (s) => s.circle(30))
  .extrude(10)
  .sketch(face('>Z'), (s) => s.circle(12))
  .extrude(6)
  .sketch(face('>Z'), (s) => { s.circle(5); })
  .cut(through())
  .sketch(face('>Z'), (s) => s.rect(4, 8, [0, 6]))
  .cut(through());`,
    expected: { volume: PI * 900 * 10 + PI * 144 * 6 - PI * 25 * 16 - 16 * (32 - KEY_OVERLAP), volumeTol: 1e-4, features: 8, valid: true },
    gap: 'no gear (tooth) feature in the script API',
  },
  {
    id: 'rib-plate',
    title: 'Plate reinforced with ribs (ribs as thin extrudes)',
    intent: ['rib', 'web', 'gusset', 'stiffener', 'reinforce', 'plate', 'pattern', 'linear pattern'],
    description: 'There is no rib helper in the script API: a rib is a narrow rectangle sketched on the plate face and extruded, then repeated with linearPattern. The pattern repeats the LAST feature, so sketch + extrude the first rib, then pattern.',
    kind: 'script',
    code: `// plate 80 x 60 x 6, two ribs 60 long, 3 thick, 15 high, 20 apart
part('Ribbed plate')
  .sketch('front', (s) => s.rect(80, 60))
  .extrude(6)
  .sketch(face('>Z'), (s) => s.rect(60, 3))
  .extrude(15)
  .linearPattern({ count: 2, spacing: 20, axis: 'y' });`,
    expected: { volume: 80 * 60 * 6 + 2 * 60 * 3 * 15, volumeTol: 1e-4, features: 5, valid: true },
    gap: 'no rib feature in the script API (the kernel has one)',
  },
  {
    id: 'tapered-boss-chamfer',
    title: 'Tapered boss on a plate with a chamfered top edge',
    intent: ['boss', 'taper', 'tapered', 'draft', 'chamfer', 'bevel', 'cone', 'pad', 'protrusion'],
    description: 'A boss is an extrude sketched on a face; the draft option tapers the sides (degrees). edges(>Z) after the boss selects only the boss top circle because it is the only edge in the highest plane.',
    kind: 'script',
    code: `part('Tapered boss')
  .sketch('front', (s) => s.rect(60, 60))
  .extrude(8)
  .sketch(face('>Z'), (s) => s.circle(15))
  .extrude(20, { draft: 5 })
  .chamfer(edges('>Z'), 1.5);`,
    expected: { volume: 60 * 60 * 8 + FRUSTUM - CH_AREA * 2 * PI * CH_CENTROID, volumeTol: 1e-4, features: 5, valid: true },
  },
  {
    id: 'pocket-grid',
    title: 'Grid of rectangular pockets in one feature',
    intent: ['pocket', 'grid', 'pockets', 'cutout', 'array', 'pattern', 'recess', 'perforated', 'holes.grid', 'loop'],
    description: 'Draw all the pockets in ONE sketch with a JavaScript loop, then ONE cut. That is a single feature in the tree and one boolean. For round holes use holes.grid. linearPattern repeats along one axis only.',
    kind: 'script',
    code: `// 80 x 60 x 10 plate, 5 x 3 grid of 8 x 8 pockets, 4 deep
part('Pocket grid')
  .sketch('front', (s) => s.rect(80, 60))
  .extrude(10)
  .sketch(face('>Z'), (s) => {
    for (let j = 0; j < 3; j++) for (let i = 0; i < 5; i++) s.rect(8, 8, [-30 + i * 15, -20 + j * 20]);
  })
  .cut(4);`,
    expected: { volume: 80 * 60 * 10 - 15 * 8 * 8 * 4, volumeTol: 1e-4, features: 4, valid: true },
  },
  {
    id: 'boat-hull-loft',
    title: 'Boat hull: loft through four spline stations to a point bow',
    intent: ['loft', 'hull', 'boat', 'sections', 'stations', 'spline', 'blend sections', 'organic', 'transition', 'point', 'bow', 'apex'],
    description: 'One closed-spline section per station on an offset "right" plane (at(\'right\', x): the sketch x axis points to -Z, y is up), then loft(). The last section is a single point, so the bow tapers to a true point (ends.last: "point"). Only the first or last section can be a point; sections need the same outline kind. Stations are [x, half beam, depth, deck height].',
    kind: 'script',
    code: `const STATIONS = [[-60, 6, 5, 3], [-35, 15, 9, 4], [0, 18, 12, 5], [30, 13, 9, 5.5]];   // [x, half beam, depth, deck height]
const section = ([x, w, d, h]) => ({
  on: at('right', x),
  draw: (s) => s.spline([[0, h], [0.55 * w, h + 0.4], [w, h - 1], [0.97 * w, -0.3 * d], [0.6 * w, -0.8 * d], [0, -d], [-0.6 * w, -0.8 * d], [-0.97 * w, -0.3 * d], [-w, h - 1], [-0.55 * w, h + 0.4]], { closed: true }),
});
part('Boat hull').loft([...STATIONS.map(section), { on: at('right', 62), point: [0, 2] }], { ends: { last: 'point' } });`,
    expected: { volume: 40107.43494071, volumeTol: 1e-4, features: 11, valid: true, notes: 'regression value, cross-checked with the integrated sections volume' },
  },
  {
    id: 'swept-pipe',
    title: 'Swept pipe along an arc path',
    intent: ['sweep', 'pipe', 'tube', 'hose', 'bend', 'elbow', 'rail', 'path', 'profile along a curve'],
    description: 'A ring profile (two circles) on the plane the path starts on, swept along an open path sketch. The path must leave the profile plane perpendicular to it: here the profile is on front (normal Z) and the path on right starts along -Z. Volume = ring area x path length (Pappus for the quarter-circle bend).',
    kind: 'script',
    code: `// outer radius 8, wall 2, a quarter circle bend of radius 30
part('Bent pipe').sweep(
  { on: 'front', draw: (s) => { s.circle(8); s.circle(6); } },
  { on: 'right', draw: (s) => s.arc3([0, 0], [30 * Math.sin(Math.PI / 4), 30 * (1 - Math.cos(Math.PI / 4))], [30, 30]) },
);`,
    expected: { volume: 28 * PI * 30 * (PI / 2), volumeTol: 1e-4, features: 3, valid: true },
  },
  {
    id: 'counterbored-plate',
    title: 'Plate with a centre bore and four counterbored screw holes',
    intent: ['counterbore', 'cbore', 'socket head', 'screw holes', 'countersink', 'mounting plate', 'tapped', 'thread', 'hole kinds'],
    description: 'ONE holes.grid feature with kind: "cbore" and an ISO size M6: the kernel takes the clearance diameter 6.6 and the ISO 4762 counterbore (11 x 6.4). The kernel cuts counterbores and countersinks only for standard sizes (give size, or a diameter that is a standard clearance hole); override the head with cboreDiameter and cboreDepth together. For a tapped hole use kind: "tapped", thread: "M6" instead.',
    kind: 'script',
    code: `const { w, d, t } = variables({ w: 80, d: 50, t: 12 });
part('Counterbored plate')
  .sketch('front', (s) => s.rect(w, d))
  .extrude(expr('t'))
  .hole(face('>Z'), [0, 0], { diameter: 20 })
  .holes.grid(face('>Z'), { origin: [-30, -15], pitch: [60, 30], count: [2, 2] }, { kind: 'cbore', size: 'M6' });`,
    expected: { volume: 80 * 50 * 12 - PI * 100 * 12 - 4 * (PI * 3.3 ** 2 * 12 + PI * (5.5 ** 2 - 3.3 ** 2) * 6.4), volumeTol: 1e-4, features: 6, valid: true },
  },
  {
    id: 'mirrored-bracket',
    title: 'Channel bracket: build half, mirror the body',
    intent: ['mirror', 'symmetric', 'symmetry', 'channel', 'u bracket', 'copy', 'half', 'reflect'],
    description: 'Model one half including its hole, then mirror(\'right\', { body: true }) reflects the whole body about the YZ plane and unites the copy: the halves share the face on the plane. Without body: true only the last feature is mirrored. The kernel always keeps the original. On the <Y face the sketch x runs along X and y along +Z.',
    kind: 'script',
    code: `// half of a U channel: base 40 x 6, wall 6 x 24 above it, 25 long (Z); one 6 mm hole in the base
part('Channel bracket')
  .sketch('front', (s) => s.polygon([[0, 0], [40, 0], [40, 6], [6, 6], [6, 30], [0, 30]]))
  .extrude(25)
  .holes.points(face('<Y'), [[28, 12.5]], { diameter: 6 })
  .mirror('right', { body: true });`,
    expected: { volume: 2 * (9600 - PI * 9 * 6), volumeTol: 1e-4, features: 5, valid: true },
  },
  {
    id: 'verification',
    title: 'How to verify a part (numbers first, then eyes)',
    intent: ['verify', 'check', 'validate', 'volume', 'probe', 'section', 'snapshot', 'facts', 'inspect', 'measure', 'test'],
    description: 'The order of checks after run_script. Cheap exact numbers first; a picture last. Tool names are those of the agent layer (docs/plan-agent-layer.md).',
    kind: 'guide',
    code: `1. run_script returns { ok, features, errors: [{ line, feature, message }], volume }. errors must be empty. A feature that regenerated with an error is listed with its code.
2. facts: volume, bounding box, face / edge counts, validity. Compare each to the plan: volume within 1 percent of the hand calculation (plate - holes + bosses), the box equal to the stated overall size, the hole count equal to the faces you expect.
3. probe: points the plan says are inside material (probe at the centre of a boss) and points it says are empty (probe at the centre of a hole, expect outside). Probe BOTH sides of every cut: a pocket cut from the wrong side leaves the volume plausible and the probes wrong.
4. section / sections: the exact outline where a plane cuts the part (a section at a hole axis shows the bore diameter and depth); sections over an axis integrate to a volume that cross-checks facts independently.
5. snapshot: named views (front, top, right, iso) as the last step, to catch what numbers cannot: orientation mirrored, feature on the wrong face, a missing chamfer.
6. If anything is off, edit the script and re-run: do not patch the numbers. State what you checked and what you did not.`,
  },
  {
    id: 'common-errors',
    title: 'Common errors and what to do about them',
    intent: ['error', 'fail', 'booleanFailed', 'offsetUnsupported', 'loftFailed', 'nothingToCut', 'shellFailed', 'fix', 'problem', 'invalid', 'hint'],
    description: 'Kernel error codes you will see in run_script errors, with the fix that works. Codes come from docs/spec-agent-interface.md; most carry a hint field, read it first.',
    kind: 'guide',
    code: `booleanFailed        The union / cut could not be assembled. The report has faces, at (a point on the bad edge) and a hint. Fix: move the tool by about 0.01 mm so faces are not exactly coincident (or make near-coincident faces exactly coincident); unite bodies that touch each other first; avoid a cut whose wall is tangent to the host wall.
cutNoEffect          The cut sketch removed nothing (script error message "cutNoEffect"). A cut left on direction 'auto' is flipped once automatically (warning 'cut direction flipped automatically'); if it still reports this the sketch does not overlap the material. A cut runs AGAINST the sketch normal: sketch on the face you cut from (face('>Z')) so it goes into the body; a sketch on the front plane at z = 0 of a body that extends to +Z cuts away from it, so pass flip: true. Also check the plane offset and that the sketch overlaps the body.
nothingToCut         There is no solid yet to cut (the first feature was a cut).
missingReference     A face / edge the feature used no longer exists (you changed an earlier feature). Re-run the whole script; select by direction (face('>Z')) rather than by remembered names.
noClosedProfile      The sketch is open. Use polygon() or rect() / circle(), or close the chain; for a thin wall use the thin option.
blendOverflow / blendUnsupported   The fillet or chamfer is too big for the neighbouring faces. Halve the radius, fillet before adding small features, or fillet a smaller edge set.
shellTooThick / shellFailed   The wall is thicker than the smallest feature or curvature allows; the error gives maxThickness. Use at most that, or round the sharp inner corners first.
offsetUnsupported    A shell or offset hit a face kind that cannot be offset yet (free-form sheets, some surfaces). Open a different face, shell before adding free-form features, or model the wall as a second sketch + cut instead.
loftFailed           Loft sections are incompatible. Hint: sections must be simple closed curves with the same orientation; a point section may only be the FIRST or LAST (not both, not in the middle); guide curves with a point end are not supported; curved centre lines are not supported. Give every station the same number of spline points and the same start.
loftProfileSelfIntersect / loftSectionTooSmall   A section outline crosses itself or is tiny against the loft length: make it a simple closed curve or use a point section.
selector errors (Line N)   face('..') / edges('..') matched nothing: check the direction letter, that the body exists at that step, and that the face is planar.`,
  },
];
