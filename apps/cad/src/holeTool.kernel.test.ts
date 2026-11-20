// The Hole tool against the kernel: centres typed in the Point tool (dimensioned from the origin), a plain diameter
// (a number or a variable), through all / blind / up to next, in a shelled block. Volumes are computed by hand.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { DEFAULT_SETTINGS, fromFeature, pointTool, toFeature, type PointState, type ToolEvent, type ToolOutput } from '@kit/sketch';
import { KERNEL_HOLE_UP_TO_NEXT, newHole } from './holeData';

const L = 100, W = 40, H = 30, T = 3, D = 18, X = 30;
const rect = {
  type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: -L / 2, y: -W / 2 }, { id: 'p2', x: L / 2, y: -W / 2 }, { id: 'p3', x: L / 2, y: W / 2 }, { id: 'p4', x: -L / 2, y: W / 2 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [],
};
/** The hole sketch as the Point tool makes it: Tab, x, y for each centre. */
function centres(xy: Array<[number, number]>): Record<string, unknown> {
  let o: ToolOutput<PointState> = { state: pointTool.start(), draft: fromFeature({ type: 'sketch', id: 'F4', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [] }), preview: [], fields: [] };
  const evs: ToolEvent[] = [{ type: 'key', key: 'Tab' }, ...xy.flatMap(([x, y]): ToolEvent[] => [{ type: 'field', id: 'x', value: x, commit: true }, { type: 'field', id: 'y', value: y, commit: true }])];
  for (const ev of evs) o = pointTool.step(o.state, ev, o.draft, DEFAULT_SETTINGS);
  return { ...toFeature(o.draft), id: 'F4' };
}
/** A 100 x 40 x 30 block on the front plane, shelled 3 mm (open at the top, or closed), with a centre sketch on the bottom face's plane. */
const doc = (openTop: boolean, xy: Array<[number, number]> = [[X, 0]]): PartDoc => ({
  ...emptyPart('Shelled'),
  variables: [{ name: 'd', expr: String(D) }],
  features: [rect, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: H }, { type: 'shell', id: 'F3', faces: openTop ? ['F2.C1'] : [], thickness: T }, centres(xy)],
  seq: 5,
}) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const volume = async (s: Session) => ((await s.massProps()) as { volume: number }).volume;
async function cut(d: PartDoc, hole: Record<string, unknown>) {
  const s = await Session.open(d); sessions.push(s);
  const base = await volume(s);
  const r = await s.edit([{ op: 'add', feature: { ...hole, id: 'F5' } }]);
  const v = await s.verify();
  const valid = await s.validate();
  return { ok: r.ok, errors: v.regen.errors.map(([id, e]) => `${id}:${e.code}`), base, removed: base - await volume(s), valid: valid.ok };
}
const disc = Math.PI * (D / 2) ** 2;
const near = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * 1e-4;

describe('Hole tool in a shelled block', { skip: !process.env.CK_WASM }, () => {
  it('the centre sketch is fully dimensioned from the origin', () => {
    const f = centres([[X, 0], [-X, 5]]) as { constraints: Array<{ type: string; value?: number }> };
    expect(f.constraints.map((k) => `${k.type}=${k.value}`)).toEqual(['hdist=30', 'vdist=0', 'hdist=30', 'vdist=5']);
  });

  it('an 18 mm through hole at x = 30 (open-top shell) cuts the 3 mm floor only: pi * 9^2 * 3', async () => {
    const r = await cut(doc(true), newHole('F4', true, { kind: 'simple', size: 'M6', fit: 'normal', diameter: D }));
    expect(r.errors).toEqual([]);
    expect(near(r.base, L * W * H - (L - 2 * T) * (W - 2 * T) * (H - T))).toBe(true);   // the shell is what the test assumes
    expect(near(r.removed, disc * T)).toBe(true);
    expect(r.valid).toBe(true);
  });

  it('closed shell, diameter from the variable d: through all goes through both walls (2 * pi * 9^2 * 3)', async () => {
    const r = await cut(doc(false), { ...newHole('F4', true, { kind: 'simple', size: 'M6', fit: 'normal', diameter: D }), diameter: '=d' });
    expect(r.errors).toEqual([]);
    expect(near(r.base, L * W * H - (L - 2 * T) * (W - 2 * T) * (H - 2 * T))).toBe(true);
    expect(near(r.removed, 2 * disc * T)).toBe(true);
    expect(r.valid).toBe(true);
  });

  it('several centres in one hole; blind 10 deep stops in the cavity (floor only)', async () => {
    const two = await cut(doc(false, [[X, 0], [-X, 0]]), { ...newHole('F4', true, { kind: 'simple', size: 'M6', fit: 'normal', diameter: D }) });
    expect(two.errors).toEqual([]);
    expect(near(two.removed, 4 * disc * T)).toBe(true);
    const blind = await cut(doc(false), { ...newHole('F4', true, { kind: 'simple', size: 'M6', fit: 'normal', diameter: D }), end: 'blind', depth: 10 });
    expect(blind.errors).toEqual([]);
    expect(near(blind.removed, disc * T)).toBe(true);
  });

  it('KERNEL_HOLE_UP_TO_NEXT says whether upToNext stops at the first wall (the kernel now does: floor only)', async () => {
    const r = await cut(doc(false), { ...newHole('F4', true, { kind: 'simple', size: 'M6', fit: 'normal', diameter: D }), end: 'upToNext' });
    expect(r.errors).toEqual([]);
    const stopsAtNext = near(r.removed, disc * T);
    expect(stopsAtNext).toBe(KERNEL_HOLE_UP_TO_NEXT);
  });
});
