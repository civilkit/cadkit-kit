// The Case wizard's ops on a real kernel: committed into an empty document and into one that already holds a body, one folder and one undo step each, valid bodies,
// the guide volume for the guide numbers, and the other body untouched.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from './controller';
import './i18n';
import { DEFAULT_CASE, caseOps, withChange } from './case';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function world(doc: PartDoc = emptyPart('Case') as never) {
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load(doc);
  return c;
}
type Feat = { id: string; group?: string };
const feats = (c: Controller) => (c.document()?.features ?? []) as unknown as Feat[];
const fail = (r: unknown) => JSON.stringify((r as { errors?: unknown }).errors ?? r);
async function bodies(): Promise<{ total: number; valid: boolean; list: Array<{ name?: string; volume: number }> }> {
  const s = sessions.at(-1)!;
  const m = (await s.massProps({ bodies: true })) as { volume: number; bodies?: Array<{ name?: string; volume: number }> };
  const valid = ((await s.validate().catch(() => ({ ok: false }))) as { ok: boolean }).ok;
  return { total: m.volume, valid, list: m.bodies ?? [] };
}
const GUIDE = withChange(DEFAULT_CASE, { lidHeight: 15, tongueHeight: 1.5 });

describe('Case wizard ops', () => {
  it('into an empty document: one folder, two valid bodies, 28 882.24 mm3 (the guide number), one undo step takes it all back', async () => {
    const c = await world();
    const r = await c.commit(caseOps(c.document() as never, GUIDE), 'case');
    expect(r.ok, fail(r)).toBe(true);
    expect([...new Set(feats(c).map((f) => f.group))]).toEqual(['Case']);
    const b = await bodies();
    expect(b.valid).toBe(true);
    expect(b.list.map((x) => x.name).sort()).toEqual(['Base', 'Lid']);
    expect(Math.abs(b.total - 28882.24)).toBeLessThan(0.5);   // 29 104 + 378 - 599.76, worked out in caseBox.kernel.test.ts
    const box = c.bodyBox()!;   // stands on the Top plane: floor at y = 0, lid on top at y = 30, x and z centred on the origin
    expect(box.min.map((v) => Math.round(v * 1e3) / 1e3)).toEqual([-40, 0, -25]);
    expect(box.max.map((v) => Math.round(v * 1e3) / 1e3)).toEqual([40, 30, 25]);
    await c.undo();
    expect(feats(c)).toHaveLength(0);
  }, 300000);

  it('the sketches the wizard builds with are construction: the controller reports them (and only them) to be hidden in the view', async () => {
    const c = await world();
    const seen: string[][] = [];
    c.onWizardSketches = (ids) => seen.push(ids);
    const r = await c.commit(caseOps(c.document() as never, GUIDE), 'case');
    expect(r.ok, fail(r)).toBe(true);
    const sketches = (c.document()!.features as unknown as Array<{ id: string; type: string }>).filter((f) => f.type === 'sketch').map((f) => f.id);
    expect(sketches.length).toBeGreaterThan(4);
    expect(seen).toEqual([sketches]);
    const own = { type: 'sketch', id: 'F90', plane: { kind: 'std', id: 'front' }, points: [{ id: 'o', x: 0, y: 0, fixed: true }], entities: [{ type: 'circle', id: 'e1', c: 'o', r: 3 }], constraints: [] };
    await c.commit([{ op: 'add', feature: own } as never], 'sketch');
    expect(seen).toHaveLength(1);   // a sketch of the user's own is not reported
  }, 300000);

  it('axis z (the old orientation) lies on the Front plane: rises along +z', async () => {
    const c = await world();
    const r = await c.commit(caseOps(c.document() as never, { ...GUIDE, axis: 'z' }), 'case');
    expect(r.ok, fail(r)).toBe(true);
    const box = c.bodyBox()!;
    expect(box.min.map((v) => Math.round(v * 1e3) / 1e3)).toEqual([-40, -25, 0]);
    expect(box.max.map((v) => Math.round(v * 1e3) / 1e3)).toEqual([40, 25, 30]);
    expect(Math.abs((await bodies()).total - 28882.24)).toBeLessThan(0.5);
  }, 300000);

  it('into a document with a body, twice (rounded, tongue on the base): own folders, the other body untouched, names as given', async () => {
    const block = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'o', x: 0, y: 0, fixed: true }], entities: [{ type: 'circle', id: 'e1', c: 'o', r: 15 }], constraints: [] };
    const c = await world({ ...emptyPart('Block'), features: [block, { type: 'extrude', id: 'F2', op: 'newBody', body: 'Block', sketch: 'F1', end: 'blind', depth: 12 }] } as never);
    const before = feats(c).length;
    const a = await c.commit(caseOps(c.document() as never, { ...GUIDE, origin: [100, 0, 0] }), 'case');
    expect(a.ok, fail(a)).toBe(true);
    const b2 = withChange(GUIDE, { round: 'side', radius: 5, tongueOn: 'base', baseName: 'Tray', lidName: 'Cover', origin: [-100, 0, 0] });
    const b = await c.commit(caseOps(c.document() as never, b2), 'case');
    expect(b.ok, fail(b)).toBe(true);
    expect([...new Set(feats(c).slice(before).map((f) => f.group))]).toEqual(['Case', 'Case 2']);
    const m = await bodies();
    expect(m.valid).toBe(true);
    expect(m.list.map((x) => x.name).sort()).toEqual(['Base', 'Block', 'Cover', 'Lid', 'Tray']);
    expect(m.list.find((x) => x.name === 'Block')!.volume).toBeCloseTo(Math.PI * 225 * 12, 0);
    const tray = m.list.find((x) => x.name === 'Tray')!.volume, cover = m.list.find((x) => x.name === 'Cover')!.volume;
    expect(tray).toBeGreaterThan(cover);   // the tongue is on the base
    await c.undo();
    expect(feats(c).some((f) => f.group === 'Case 2')).toBe(false);
    expect(feats(c).some((f) => f.group === 'Case')).toBe(true);
  }, 300000);

  it('Round the edges: side only, top only and both commit as valid Base and Lid; the volume is the hand formula; the live preview builds the same fillets and shows more faces than the plain case', async () => {
    // top round of radius r takes (1 - pi/4) r2 x the centroid path off each half (Pappus; the centroid of the removed profile is r (5/6 - pi/4) / (1 - pi/4) in from both faces),
    // the side radius and the whole formula with it are in caseBox.kernel.test.ts; here the top-only total and the both-minus-side-only difference must follow it
    const top = (w: number, d: number, R: number, r: number): number => {
      const c = r * (5 / 6 - Math.PI / 4) / (1 - Math.PI / 4);
      return (1 - Math.PI / 4) * r * r * (R > 0 ? 2 * (w - 2 * R) + 2 * (d - 2 * R) + 2 * Math.PI * (R - c) : 2 * (w + d) - 8 * c);
    };
    const plain = (await (async () => { const c = await world(); const r = await c.commit(caseOps(c.document() as never, GUIDE), 'case'); expect(r.ok, fail(r)).toBe(true); return (await bodies()).total; })());
    expect(Math.abs(plain - 28882.24)).toBeLessThan(0.5);
    for (const [round, R, r] of [['top', 0, 3], ['both', 6, 3], ['both', 6, 4]] as const) {
      const c = await world();
      const p = withChange(GUIDE, { round, radius: R || 5, topRadius: r });
      const res = await c.commit(caseOps(c.document() as never, p), 'case');
      expect(res.ok, fail(res)).toBe(true);
      const b = await bodies();
      expect(b.valid).toBe(true);
      expect(b.list.map((x) => x.name).sort()).toEqual(['Base', 'Lid']);
      expect(b.total).toBeLessThan(plain);
      if (round === 'top') expect(Math.abs(b.total - (28882.24 - 2 * top(80, 50, 0, r)))).toBeLessThan(1.5);
    }
    // side only: the same as the old corner radius
    const cs = await world();
    const rs = await cs.commit(caseOps(cs.document() as never, withChange(GUIDE, { round: 'side', radius: 5 })), 'case');
    expect(rs.ok, fail(rs)).toBe(true);
    const side = (await bodies()).total;
    // both = side only less the top rounds of the rounded outline
    const cb = await world();
    const rb = await cb.commit(caseOps(cb.document() as never, withChange(GUIDE, { round: 'both', radius: 5, topRadius: 4 })), 'case');
    expect(rb.ok, fail(rb)).toBe(true);
    expect(Math.abs((await bodies()).total - (side - 2 * top(80, 50, 5, 4)))).toBeLessThan(1.5);
    // live preview: the same ops through the controller's preview
        const kernel: KernelFactory = { async open(x) { const k = await Session.open(x); sessions.push(k); return k; } };
    const cp = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
    await cp.load(emptyPart('Case') as never);
    const pOff = await cp.preview(caseOps(cp.document() as never, GUIDE), 0);
    const pBoth = await cp.preview(caseOps(cp.document() as never, withChange(GUIDE, { round: 'both', radius: 5, topRadius: 4 })), 0);
    expect(pOff.ok).toBe(true);
    expect(pBoth.ok, JSON.stringify(pBoth.errors)).toBe(true);
    const faces = (b: unknown) => ((b as { mesh?: { faceIds?: string[] } } | null)?.mesh?.faceIds ?? []).length;
    expect(faces(pOff.body)).toBeGreaterThan(10);
    expect(faces(pBoth.body)).toBeGreaterThan(faces(pOff.body) + 8);   // the rounds are faces of their own: a cylinder piece per edge and a torus piece per corner, on both halves
  }, 600000);
});
