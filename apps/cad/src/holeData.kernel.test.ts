import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { holeDiameter, HOLE_FITS, ISO_SIZES, ISO_TABLE, KERNEL_CUTS_CUSTOM_DIMS, newHole } from './holeData';

const rect = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: -20, y: -20 }, { id: 'p2', x: 20, y: -20 }, { id: 'p3', x: 20, y: 20 }, { id: 'p4', x: -20, y: 20 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] };
const pts = { type: 'sketch', id: 'F3', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'q1', x: 0, y: 0 }], entities: [{ id: 'pt1', type: 'point', p: 'q1' }], constraints: [] };
const T = 30;
/** A 40 x 40 x 30 block with a point sketch on its (flipped) side; the hole is added per case. */
const block = (): PartDoc => ({ ...emptyPart('Block'), features: [rect, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: T }, pts], seq: 4 }) as unknown as PartDoc;
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function volumeWith(hole: Record<string, unknown> | null, s: Session) {
  void hole;
  const m = (await s.massProps()) as { volume: number };
  return m.volume;
}
const open = async () => { const s = await Session.open(block()); sessions.push(s); return s; };
const removed = async (s: Session, hole: Record<string, unknown>, base: number) => {
  const r = await s.edit([{ op: 'add', feature: { ...hole, id: 'H' } }]);
  const errors = (await s.verify()).regen.errors.map(([id, e]) => `${id}:${e.code}`);
  const vol = await volumeWith(null, s);
  await s.undo();
  return { ok: r.ok, errors, cut: base - vol };
};

describe('hole table against the kernel', { skip: !process.env.CK_WASM }, () => {
  it('every ISO size and fit cuts the diameter holeDiameter() says (simple, through)', async () => {
    const s = await open();
    const base = await volumeWith(null, s);
    const bad: string[] = [];
    for (const size of ISO_SIZES) for (const fit of HOLE_FITS) {
      const hole = { ...newHole('F3', true), size, fit };
      const r = await removed(s, hole, base);
      const d = holeDiameter(hole)!;
      const want = Math.PI * (d / 2) ** 2 * T;
      if (r.errors.length || Math.abs(r.cut - want) > want * 1e-4) bad.push(`${size}/${fit}: cut ${r.cut} want ${want} ${r.errors}`);
    }
    expect(bad).toEqual([]);
  }, 300000);

  it('counterbore: kernel diameters per fit, cbore dims from the table', async () => {
    const s = await open();
    const base = await volumeWith(null, s);
    const bad: string[] = [];
    for (const size of ISO_SIZES) for (const fit of ['close', 'normal', 'loose', 'tap'] as const) {
      const hole = { ...newHole('F3', true), kind: 'cbore', size, fit };
      const row = ISO_TABLE[size];
      const r = await removed(s, hole, base);
      const d = holeDiameter(hole)!;
      const want = Math.PI * (row.cboreD / 2) ** 2 * row.cboreDepth + Math.PI * (d / 2) ** 2 * (T - row.cboreDepth);
      if (r.errors.length || Math.abs(r.cut - want) > want * 1e-4) bad.push(`${size}/${fit}: cut ${r.cut} want ${want} ${r.errors}`);
    }
    expect(bad).toEqual([]);
  }, 300000);

  it('KERNEL_CUTS_CUSTOM_DIMS says whether cboreDiameter / cboreDepth / cskDiameter change the geometry', async () => {
    const s = await open();
    const base = await volumeWith(null, s);
    const plainCbore = await removed(s, { ...newHole('F3', true), kind: 'cbore' }, base);
    const bigCbore = await removed(s, { ...newHole('F3', true), kind: 'cbore', cboreDiameter: 20, cboreDepth: 3 }, base);
    const plainCsk = await removed(s, { ...newHole('F3', true), kind: 'csink' }, base);
    const bigCsk = await removed(s, { ...newHole('F3', true), kind: 'csink', cskDiameter: 20, cskAngle: 90 }, base);
    const changed = Math.abs(bigCbore.cut - plainCbore.cut) > 1 && Math.abs(bigCsk.cut - plainCsk.cut) > 1;
    expect(changed).toBe(KERNEL_CUTS_CUSTOM_DIMS);
  }, 100000);
});
