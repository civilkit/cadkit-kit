// A lofted bottle (0.8.10): a part written from plain feature records opens, every feature builds, Errors stay as the status bar says. The clip turns the view and scrolls the feature tree to its end (stem, bottom round, shell, rim round). Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

// The part is written here from plain feature records (own dimensions, in mm); no file is loaded.
const rrect = (id, name, plane, hw, hh, r) => {
  const P = (n, x, y) => ({ id: n, x, y });
  const points = [{ id: 'O', x: 0, y: 0, fixed: true },
    P('p5', -(hw - r), hh), P('p6', -hw, hh - r), P('p7', -(hw - r), hh - r), P('p8', hw, hh - r), P('p9', hw - r, hh), P('p10', hw - r, hh - r),
    P('p11', hw - r, -hh), P('p12', hw, -(hh - r)), P('p13', hw - r, -(hh - r)), P('p14', -(hw - r), -hh), P('p15', -hw, -(hh - r)), P('p16', -(hw - r), -(hh - r))];
  const entities = [
    { id: 'e1', type: 'line', p1: 'p14', p2: 'p11' }, { id: 'e2', type: 'line', p1: 'p12', p2: 'p8' }, { id: 'e3', type: 'line', p1: 'p9', p2: 'p5' }, { id: 'e4', type: 'line', p1: 'p6', p2: 'p15' },
    { id: 'e5', type: 'arc', c: 'p7', p1: 'p5', p2: 'p6' }, { id: 'e6', type: 'arc', c: 'p10', p1: 'p8', p2: 'p9' }, { id: 'e7', type: 'arc', c: 'p13', p1: 'p11', p2: 'p12' }, { id: 'e8', type: 'arc', c: 'p16', p1: 'p15', p2: 'p14' }];
  return { type: 'sketch', id, name, plane, points, entities, constraints: [] };
};
const circ = (id, name, plane, r) => ({ type: 'sketch', id, name, plane, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [{ id: 'e1', type: 'circle', c: 'O', r }], constraints: [] });
const off = (id, z) => ({ type: 'plane', mode: 'offset', base: { kind: 'std', id: 'front' }, offset: z, name: `Plane ${z}`, autoName: true, id });
const on = (id) => ({ kind: 'feature', id });
const HW = 30, HH = 37, BR = 8, FR = 4, Z_TOP = 230, STEM = 12, STEM_R = 12.5;
const d = Math.SQRT1_2 * BR, ax = HW - BR + d, ay = HH - BR + d;
const bottomEdges = [['e1', 0, -HH], ['e2', HW, 0], ['e3', 0, HH], ['e4', -HW, 0], ['e5', -ax, ay], ['e6', ax, ay], ['e7', ax, -ay], ['e8', -ax, -ay]]
  .map(([e, x, y]) => ({ faces: ['F8.C0', `F8.S.${e}`], at: [x, y, 0] }));
const FEATURES = [
  rrect('F1', 'Base profile', { kind: 'std', id: 'front' }, HW, HH, BR),
  off('F2', 100), rrect('F5', 'Shoulder profile', on('F2'), 36, 45, 14),
  off('F13', 125), rrect('F14', 'Blend profile', on('F13'), 27, 33, 22),
  off('F3', 150), circ('F6', 'Neck circle', on('F3'), 19),
  off('F11', 190), circ('F12', 'Mid neck circle', on('F11'), 15),
  off('F4', Z_TOP), circ('F7', 'Top circle', on('F4'), 14),
  { type: 'loft', op: 'add', sketches: ['F1', 'F5'], id: 'F8' },
  { type: 'loft', op: 'add', sketches: ['F5', 'F14', 'F6'], id: 'F9' },
  { type: 'loft', op: 'add', sketches: ['F6', 'F12', 'F7'], id: 'F10' },
  circ('F15', 'Stem sketch', on('F4'), STEM_R),
  { type: 'extrude', id: 'F16', name: 'Stem', op: 'add', sketch: 'F15', end: 'blind', depth: STEM },
  { type: 'fillet', id: 'F17', name: 'Bottom fillet', radius: FR, edges: bottomEdges },
  { type: 'shell', id: 'F18', name: 'Shell 2 mm', faces: ['F16.C1'], thickness: 2 },
  { type: 'fillet', id: 'F19', name: 'Top rim fillet', radius: 2, edges: [{ faces: ['F16.C1', 'F16.S.e1'], at: [STEM_R, 0, Z_TOP + STEM] }] },
];
export const doc = () => ({ ...newDoc('Bottle', FEATURES), upAxis: 'z' });   // built along Z: a document without upAxis opens Y-up and the bottle would lie on its side

export default {
  id: 'lofted-bottle',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: undefined, name: 'Bottle' });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('72a-bottle');
    await rec.begin();
    rec.x = 1000; rec.y = 620;
    await k.caption('A bottle built from three lofts, a stem, a shell and two rounds', 1);
    rec.mark('poster');
    await hold(2500);
    await k.caption('Turn the view', 2);
    for (let i = 0; i < 3; i++) { await k.clickEl(`document.querySelector('.vn-turn.vn-right')`, 'left', 700); }
    await k.snap('72b-turned');
    await hold(1500);
    await k.caption('The tree ends with the stem, bottom round, shell and rim round', 3);
    await rec.skip(() => page.eval(`(() => { const t = document.querySelector('.tree'); let e = t; while (e && e.scrollHeight <= e.clientHeight + 4) e = e.parentElement; (e || t).scrollTop = 1e6; return 0; })()`));
    await rec.paint();
    await k.snap('72c-tree');
    await hold(3000);
    await k.caption('Errors 0 in the status bar', 4);
    await hold(2500);
    if (process.env.CLIP_DRY) return { id: 'lofted-bottle', dry: true };
    return rec.finish('lofted-bottle', ctx.outDir, ctx.posterDir);
  },
};
