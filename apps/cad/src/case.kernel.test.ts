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
    await c.undo();
    expect(feats(c)).toHaveLength(0);
  }, 300000);

  it('into a document with a body, twice (rounded, tongue on the base): own folders, the other body untouched, names as given', async () => {
    const block = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'o', x: 0, y: 0, fixed: true }], entities: [{ type: 'circle', id: 'e1', c: 'o', r: 15 }], constraints: [] };
    const c = await world({ ...emptyPart('Block'), features: [block, { type: 'extrude', id: 'F2', op: 'newBody', body: 'Block', sketch: 'F1', end: 'blind', depth: 12 }] } as never);
    const before = feats(c).length;
    const a = await c.commit(caseOps(c.document() as never, { ...GUIDE, origin: [100, 0, 0] }), 'case');
    expect(a.ok, fail(a)).toBe(true);
    const b2 = withChange(GUIDE, { radius: 5, tongueOn: 'base', baseName: 'Tray', lidName: 'Cover', origin: [-100, 0, 0] });
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
});
