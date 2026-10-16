import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from './controller';
import { listBodies, readBodyFields } from './bodies';

const sq = (id: string, x: number, y: number, w: number) => ({ type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x, y }, { id: 'p2', x: x + w, y }, { id: 'p3', x: x + w, y: y + w }, { id: 'p4', x, y: y + w }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] });
const ext = (id: string, sketch: string, depth: number) => ({ type: 'extrude', id, op: 'add', sketch, end: 'blind', depth });
// two separate cubes, F2 (at the origin) and F4 (apart): two lumps of one part
const doc = (extra: Record<string, unknown> = {}): PartDoc => ({ ...emptyPart('Two'), features: [sq('F1', 0, 0, 10), ext('F2', 'F1', 10), sq('F3', 40, 0, 10), ext('F4', 'F3', 10)], seq: 5, ...extra }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function world(d: PartDoc) {
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load(d);
  return c;
}
const rowsOf = (c: Controller) => listBodies(c.selModel()!.bodies(), readBodyFields(c.document()), {});

describe('bodies on the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('finds one body per lump, keeps the stored fields, and orders them by creating feature', async () => {
    const c = await world(doc({ appearance: { F4: { opacity: 0.2, finish: 'glass' } }, bodyNames: { F2: 'Block' }, view: { hiddenBodies: ['@body:nope'] } }));
    const rows = rowsOf(c);
    expect(rows.map((r) => [r.name, r.origin])).toEqual([['Block', 'F2'], ['Body 2', 'F4']]);
    expect(rows[1].look).toEqual({ opacity: 0.2, finish: 'glass' });
    const d = c.document() as unknown as Record<string, unknown>;
    expect(d.appearance).toEqual({ F4: { opacity: 0.2, finish: 'glass' } });
    expect(d.view).toEqual({ hiddenBodies: ['@body:nope'] });
  });
  it('keeps keys and looks when an unrelated feature is edited or a feature is added', async () => {
    const key = '@body:';
    const c = await world(doc());
    const before = rowsOf(c);
    c.setDocExtra('appearance', { [before[0].key]: { color: '#ff0000' } });
    const r = await c.edit([{ op: 'set', id: 'F4', path: 'depth', value: 25 }]);   // the OTHER body gets taller
    expect(r.ok).toBe(true);
    const after = rowsOf(c);
    expect(after.map((x) => x.key)).toEqual(before.map((x) => x.key));
    expect(after[0].look).toEqual({ color: '#ff0000' });
    expect(after[1].look).toEqual({});
    expect(before[0].key.startsWith(key)).toBe(true);
    // a third body appears: the first two keep their keys
    await c.edit([{ op: 'add', feature: sq('F5', 80, 0, 5) as never }, { op: 'add', feature: ext('F6', 'F5', 5) as never }]);
    const third = rowsOf(c);
    expect(third).toHaveLength(3);
    expect(third.map((x) => x.key)).toContain(before[0].key);
    expect(third.find((x) => x.key === before[0].key)!.look).toEqual({ color: '#ff0000' });
  });
  it('the mesh volume of a lump is its volume', async () => {
    const c = await world(doc());
    const { faceVolumes } = await import('./bodies');
    const v = faceVolumes(c.bodyFaces());
    const rows = listBodies(c.selModel()!.bodies(), {}, { volumes: v });
    expect(rows.map((r) => Math.round(r.volume!))).toEqual([1000, 1000]);
  });
  it('the speedboat dash sample opens with 36 named bodies and a glass lens', async () => {
    const d = JSON.parse(readFileSync(join(process.cwd(), 'apps/cad/public/samples/speedboat-dash.ckpart'), 'utf8')) as PartDoc;
    const c = await world(d);
    const rows = rowsOf(c);
    expect(rows).toHaveLength(36);
    const lens = rows.find((r) => r.name === 'Tach lens')!;
    expect(lens.look).toMatchObject({ opacity: 0.18, finish: 'glass' });
    expect(rows.find((r) => r.name === 'Tach bezel')!.look.finish).toBe('chrome');
    expect(rows.filter((r) => r.look.opacity !== undefined && r.look.opacity < 0.35)).toHaveLength(4);
  }, 120000);
});
