import { describe, expect, it } from 'vitest';
import {
  bomCsv, bomItems, bomTotal, componentOfName, componentRows, deleteComponentOps, explodeOffsets, instanceOfName, insertFeature, insertIds, placementOps, readExplode, suffixIds,
} from './model';

const part = (name: string, material = 'steel') => ({ format: 'ck-part', version: 1, name, material, features: [{ type: 'sketch', id: 'F1' }] });
const doc = {
  features: [
    { id: 'F1', type: 'insertPart', name: 'Block', part: part('Block 40', 'aluminium'), fixed: true },
    { id: 'F2', type: 'insertPart', name: 'Bolt', part: part('Bolt'), dx: 5 },
    { id: 'F3', type: 'insertPart', name: 'Bolt 2', part: part('Bolt') },
    { id: 'F4', type: 'mate', kind: 'coincident', a: 'F2.C0@F2.1', b: 'F2.C1@F1.1' },
    { id: 'F5', type: 'cpattern', bodies: [{ face: 'F4.S.e1@F2.1' }], count: 4 },
  ],
};

describe('names to components', () => {
  const ins = insertIds(doc);
  it('reads the last insert suffix; pattern copies and nested patterns keep the component', () => {
    expect(componentOfName('F2.C0@F2.1', ins)).toBe('F2');
    expect(componentOfName('F4.C0@F2.1@F5.1', ins)).toBe('F2');          // copy by pattern F5
    expect(componentOfName('F8.S.h1@F9.1@F1.1', ins)).toBe('F1');         // pattern nested in the part
    expect(componentOfName('F2.C0', ins)).toBeNull();                      // the root part
    expect(componentOfName('F2.S.e1@F1.1|F2.S.e2@F1.1#0', ins)).toBe('F1'); // edge key
    expect(suffixIds('F4.C0@F6.1@F12.1')).toEqual(['F6', 'F12']);
  });
  it('gives pattern copies an instance key of their own', () => {
    expect(instanceOfName('F4.C0@F2.1@F5.2', ins)).toEqual({ comp: 'F2', key: 'F2@F5.2' });
    expect(instanceOfName('F4.C0@F2.1', ins)).toEqual({ comp: 'F2', key: 'F2' });
  });
});

describe('components', () => {
  it('rows carry placement, fixed and dof', () => {
    const rows = componentRows(doc as never, new Map([['F2', 1]]));
    expect(rows.map((r) => [r.id, r.fixed, r.dof, r.dx])).toEqual([['F1', true, null, 0], ['F2', false, 1, 5], ['F3', false, null, 0]]);
  });
  it('insertFeature keeps the part, leaves out a zero placement and sets the axis only with an angle', () => {
    const f = insertFeature(part('P'), { dx: 0, dy: 10, dz: 0, axis: 'y', angle: 45 }, { source: 'p' });
    expect(f).toMatchObject({ type: 'insertPart', name: 'P', dy: 10, axis: { kind: 'axis', axis: 'y' }, angle: 45, source: 'p' });
    expect('dx' in f).toBe(false);
    expect('axis' in insertFeature(part('P'), { dx: 1, dy: 0, dz: 0, axis: 'x', angle: 0 })).toBe(false);
  });
  it('placementOps sets only what changed', () => {
    const r = componentRows(doc as never)[1];
    expect(placementOps('F2', r, { dx: 5, dy: 3, dz: 0, axis: null, angle: 90 })).toEqual([{ op: 'set', id: 'F2', path: 'dy', value: 3 }]);
    expect(placementOps('F2', r, { dx: 5, dy: 0, dz: 0, axis: 'z', angle: 30 }).map((o) => (o as { path: string }).path)).toEqual(['axis', 'angle']);
  });
  it('deleting a component removes the mates and patterns that name it', () => {
    expect(deleteComponentOps(doc as never, 'F2').map((o) => (o as { id: string }).id)).toEqual(['F4', 'F5', 'F2']);
    expect(deleteComponentOps(doc as never, 'F3').map((o) => (o as { id: string }).id)).toEqual(['F3']);
  });
});

describe('bill of materials', () => {
  const vol = (p: unknown) => ((p as { name: string }).name === 'Bolt' ? 2000 : 30000);
  it('lists the same inserted part once with a quantity, with mass from the material density', () => {
    const items = bomItems(doc as never, vol);
    expect(items.map((i) => [i.no, i.part, i.qty])).toEqual([[1, 'Block 40', 1], [2, 'Bolt', 2 + 3]]);   // Bolt: F2 and F3, plus 3 pattern copies of F2
    expect(items[0].massEach).toBeCloseTo(30000 * 2.7 / 1000);
    expect(items[1].massTotal).toBeCloseTo(5 * 2000 * 7.85 / 1000);
    expect(bomTotal(items)).toBeCloseTo(81 + 78.5);
  });
  it('leaves out suppressed components and shows no mass without a density', () => {
    const d = { features: [{ id: 'F1', type: 'insertPart', part: part('X', 'unobtainium') }, { id: 'F2', type: 'insertPart', suppressed: true, part: part('Y') }] };
    const items = bomItems(d as never, () => 10);
    expect(items).toHaveLength(1);
    expect(items[0].massEach).toBeNull();
    expect(bomTotal(items)).toBeNull();
  });
  it('writes CSV with quoting and a total row', () => {
    const items = bomItems(doc as never, vol);
    const csv = bomCsv(items);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('No.,Part,Qty,Material,Mass each (g),Mass total (g)');
    expect(lines[1]).toBe('1,Block 40,1,aluminium,81,81');
    expect(lines.at(-1)).toBe(',Total,6,,,159.5');
    expect(bomCsv([{ no: 1, part: 'A "big", part', qty: 1, components: [], massEach: null, massTotal: null, material: '' }])).toContain('"A ""big"", part"');
  });
});

describe('exploded view', () => {
  const centres = new Map<string, [number, number, number]>([['A', [0, 0, 0]], ['B', [10, 4, 0]]]);
  it('moves components away from the middle by the spread', () => {
    const o = explodeOffsets(centres, [5, 2, 0], { spread: 2, dir: 'auto', manual: {} });
    expect(o.get('B')).toEqual([10, 4, 0]);
    expect(o.get('A')).toEqual([-10, -4, 0]);
  });
  it('an axis direction keeps only that axis, and a drag adds to it (also for pattern copies)', () => {
    const o = explodeOffsets(new Map([...centres, ['B@F9.1', [10, 4, 0] as [number, number, number]]]), [5, 2, 0], { spread: 1, dir: 'x', manual: { B: [0, 0, 7] } });
    expect(o.get('B')).toEqual([5, 0, 7]);
    expect(o.get('B@F9.1')).toEqual([5, 0, 7]);
  });
  it('reads a saved value defensively', () => {
    expect(readExplode(undefined)).toEqual({ spread: 0, dir: 'auto', manual: {} });
    expect(readExplode({ spread: 99, dir: 'q', manual: { F2: [1, 2, 3], F3: [1] } })).toEqual({ spread: 5, dir: 'auto', manual: { F2: [1, 2, 3] } });
  });
});
