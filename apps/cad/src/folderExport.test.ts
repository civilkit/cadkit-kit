import { describe, expect, it } from 'vitest';
import { emptyPart, type PartDoc } from '@ck/part-model';
import type { BodyRow } from './bodies';
import { faceFeatures, folderBodyRows, keepOnlyDoc, planExtract, planFolderExport } from './folderExport';

const row = (faces: string[], extra: Partial<BodyRow> = {}): BodyRow => ({ key: '@body:' + faces[0], name: faces[0], named: false, faces, edges: [], origin: null, volume: null, look: {}, hidden: false, ...extra });
const doc = (features: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): PartDoc => ({ ...emptyPart('Dash'), features, seq: 20, ...extra }) as unknown as PartDoc;

describe('which bodies a folder owns', () => {
  it('reads the features out of a face name: the maker and the ones that repeated it', () => {
    expect(faceFeatures('F4.S.e2')).toEqual(['F4']);
    expect(faceFeatures('F4.S.h1@F9.2')).toEqual(['F4', 'F9']);
    expect(faceFeatures('F2.C0~1@F7.1@F3.1')).toEqual(['F2', 'F7', 'F3']);
    expect(faceFeatures('sldprt.F12')).toEqual([]);
  });

  it('takes a body that has a face of a folder feature, made by it or changed by it', () => {
    const made = row(['F4.C0', 'F4.S.e1']), changed = row(['F2.C0', 'F2.S.e1', 'F6.S.e1']), other = row(['F2.C1']);
    expect(folderBodyRows(new Set(['F4', 'F5']), [made, changed, other])).toEqual([made]);
    expect(folderBodyRows(new Set(['F6']), [made, changed, other])).toEqual([changed]);
    expect(folderBodyRows(new Set(['F9']), [row(['F4.S.h1@F9.1'])])).toHaveLength(1);   // a pattern's copy
  });

  it('cuts the others out with one keep step: a free id, the document name when the body has one, no stored view', () => {
    const d = doc([{ type: 'extrude', id: 'F3' }], { viewCache: { x: 1 }, seq: 3 });
    const out = keepOnlyDoc(d, [row(['F4.C0', 'F4.S.e1'], { docName: 'Gauge' }), row(['F8.S.e3', 'F8.C0'])]);
    const last = out.features.at(-1) as unknown as Record<string, unknown>;
    expect(last).toMatchObject({ type: 'deleteBody', mode: 'keep', id: 'F4', bodies: [{ body: 'Gauge' }, { face: 'F8.C0' }] });
    expect((out as unknown as Record<string, unknown>).viewCache).toBeUndefined();
    expect(d.features).toHaveLength(1);   // the open document is not changed
  });
});

describe('what a folder export refuses', () => {
  const f = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, group: 'G', ...extra });
  it('a rolled-back document, a folder with no features, only sketches, only suppressed solids, or no body left', () => {
    const d = doc([f('F1', 'sketch'), f('F2', 'plane'), f('F3', 'extrude', { suppressed: true }), f('F4', 'extrude')]);
    expect(planFolderExport(d, 'G', ['F1', 'F2', 'F3', 'F4'], [row(['F4.C0'])], true)).toMatchObject({ ok: false, reason: 'rolledBack' });
    expect(planFolderExport(d, 'G', [], [], false)).toMatchObject({ ok: false, reason: 'empty' });
    expect(planFolderExport(d, 'G', ['F1', 'F2'], [row(['F1.C0'])], false)).toMatchObject({ ok: false, reason: 'onlySketches', params: { count: 2 } });
    expect(planFolderExport(d, 'G', ['F1', 'F3'], [row(['F3.C0'])], false)).toMatchObject({ ok: false, reason: 'allSuppressed' });
    expect(planFolderExport(d, 'G', ['F1', 'F4'], [row(['F9.C0'])], false)).toMatchObject({ ok: false, reason: 'noBodies' });
  });
  it('counts the bodies that also hold faces of other features, and keeps the document when the folder is every body', () => {
    const d = doc([f('F1', 'sketch'), f('F2', 'extrude'), { id: 'F3', type: 'extrude' }]);
    const a = row(['F2.C0', 'F3.S.e1']), b = row(['F9.C0']);
    const p = planFolderExport(d, 'G', ['F1', 'F2'], [a, b], false);
    expect(p).toMatchObject({ ok: true, whole: false, shared: 1 });
    expect(planFolderExport(d, 'G', ['F1', 'F2'], [a], false)).toMatchObject({ ok: true, whole: true });
  });
});

describe('extract as a part', () => {
  const sketch = (id: string, group?: string, extra: Record<string, unknown> = {}) => ({ type: 'sketch', id, ...(group ? { group } : {}), plane: { kind: 'std', id: 'front' }, ...extra });
  const base = [sketch('F1'), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', depth: 10 }];

  it('a folder that uses only origin planes and variables comes out whole, with the variables it uses and nothing else', () => {
    const d = doc([...base, sketch('F3', 'Gauge', { constraints: [{ id: 'c1', type: 'distance', value: 5, expr: 'r*2' }] }), { type: 'extrude', id: 'F4', group: 'Gauge', op: 'add', sketch: 'F3', depth: '=h' }],
      { variables: [{ name: 'r', expr: 'w/2' }, { name: 'w', expr: '8' }, { name: 'h', expr: '3' }, { name: 'unused', expr: '1' }], appearance: { F2: { color: '#ff0000' } }, material: 'brass' });
    const p = planExtract(d, 'Gauge', ['F3', 'F4'], false);
    if (!p.ok) throw new Error(p.reason);
    expect(p.part.features.map((x) => x.id)).toEqual(['F3', 'F4']);
    expect(p.part.features.some((x) => 'group' in x)).toBe(false);
    expect(p.variables.sort()).toEqual(['h', 'r', 'w']);   // r uses w; `unused` stays behind
    expect(p.part).toMatchObject({ name: 'Gauge', material: 'brass', seq: 20 });
    expect((p.part as unknown as Record<string, unknown>).appearance).toBeUndefined();
    expect(d.features).toHaveLength(4);
  });

  it('lists exactly the outside features, faces and bodies the folder uses', () => {
    const inside = [
      { type: 'sketch', id: 'F3', group: 'G', plane: { kind: 'face', id: 'F2.C1' } },
      { type: 'extrude', id: 'F4', group: 'G', op: 'add', sketch: 'F1', depth: 5, target: { body: 'Housing' } },
      { type: 'fillet', id: 'F5', group: 'G', edges: [{ key: 'F2.S.e1|F2.C0#3' }], radius: 1 },
    ];
    const d = doc([sketch('F1'), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', depth: 10, body: 'Housing' }, ...inside]);
    expect(planExtract(d, 'G', ['F3', 'F4', 'F5'], false)).toMatchObject({ ok: false, reason: 'outsideFeatures', outside: ['F1'] });
    const noF1 = doc([sketch('F1'), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', depth: 10, body: 'Housing' }, inside[0], { ...inside[1], sketch: 'F3' }, inside[2]]);
    expect(planExtract(noF1, 'G', ['F3', 'F4', 'F5'], false)).toMatchObject({ ok: false, reason: 'outsideFaces', outside: ['F2.C1', 'F2.S.e1|F2.C0#3'] });
    const bodyOnly = doc([sketch('F1'), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', depth: 10, body: 'Housing' }, sketch('F3', 'G'), { ...inside[1], sketch: 'F3' }]);
    expect(planExtract(bodyOnly, 'G', ['F3', 'F4'], false)).toMatchObject({ ok: false, reason: 'outsideBodies', outside: ['Housing'] });
  });

  it('refuses a rolled-back document and a folder with no features; a body the folder names itself is not outside', () => {
    const d = doc([sketch('F1', 'G'), { type: 'extrude', id: 'F2', group: 'G', op: 'newBody', sketch: 'F1', depth: 2, body: 'Cap' }, { type: 'moveBody', id: 'F3', group: 'G', bodies: [{ body: 'Cap' }], translate: [1, 0, 0] }]);
    expect(planExtract(d, 'G', ['F1', 'F2', 'F3'], true)).toMatchObject({ ok: false, reason: 'rolledBack' });
    expect(planExtract(d, 'G', [], false)).toMatchObject({ ok: false, reason: 'empty' });
    expect(planExtract(d, 'G', ['F1', 'F2', 'F3'], false)).toMatchObject({ ok: true });
  });
});
