import { describe, expect, it } from 'vitest';
import { combineBodyOps, copyBodyOps, freeBodyName, refOf, removeBodyOps, renameBodyOps, usedBodyNames } from './bodyOps';
import { matchLumps } from './bodies';

describe('body edits', () => {
  it('a body is referred to by its document name, or by one of its faces', () => {
    expect(refOf({ docName: 'Case', face: 'F2.C0' })).toEqual({ body: 'Case' });
    expect(refOf({ face: 'F2.C0' })).toEqual({ face: 'F2.C0' });
  });
  it('names: the first free one', () => {
    const used = usedBodyNames([{ id: 'F2', body: 'Case' }, { id: 'F3' }, { id: 'F4', body: 'Case 2' }], ['Lid']);
    expect([...used].sort()).toEqual(['Case', 'Case 2', 'Lid']);
    expect(freeBodyName(used, 'Case')).toBe('Case 3');
    expect(freeBodyName(used, 'Peg')).toBe('Peg');
  });
  it('copy, remove and combine are the features the importer makes', () => {
    expect(copyBodyOps({ docName: 'Peg', face: 'F4.C0' }, 'Peg 2')).toEqual([{ op: 'add', feature: { type: 'moveBody', bodies: [{ body: 'Peg' }], translate: [0, 0, 0], copy: true, body: 'Peg 2' } }]);
    expect(removeBodyOps([{ face: 'F2.C0' }, { docName: 'Peg', face: 'F4.C0' }])).toEqual([{ op: 'add', feature: { type: 'deleteBody', mode: 'delete', bodies: [{ face: 'F2.C0' }, { body: 'Peg' }] } }]);
    expect(combineBodyOps('cut', { docName: 'Block', face: 'F2.C0' }, [{ face: 'F4.C0' }])).toEqual([{ op: 'add', feature: { type: 'combine', op: 'cut', target: { body: 'Block' }, tools: [{ face: 'F4.C0' }] } }]);
    expect((combineBodyOps('union', { face: 'a' }, [{ face: 'b' }], true)[0] as { feature: { keepTools?: boolean } }).feature.keepTools).toBe(true);
  });
  it('a rename follows the body into every feature that refers to it, and only that body', () => {
    const features = [
      { id: 'F2', type: 'extrude', op: 'newBody', body: 'Block' },
      { id: 'F4', type: 'extrude', op: 'newBody', body: 'Peg' },
      { id: 'F5', type: 'moveBody', bodies: [{ body: 'Peg' }], copy: true, body: 'Peg2', translate: [1, 0, 0] },
      { id: 'F6', type: 'combine', op: 'cut', target: { body: 'Block' }, tools: [{ body: 'Peg' }, { body: 'Peg2' }] },
      { id: 'F7', type: 'fillet', edges: ['F2.S.e1'] },
    ];
    const ops = renameBodyOps(features, 'Peg', 'Pin') as Array<{ op: string; id: string; feature: Record<string, unknown> }>;
    expect(ops.map((o) => o.id)).toEqual(['F4', 'F5', 'F6']);
    expect(ops[0].feature.body).toBe('Pin');
    expect(ops[1].feature).toMatchObject({ bodies: [{ body: 'Pin' }], body: 'Peg2' });
    expect(ops[2].feature).toMatchObject({ target: { body: 'Block' }, tools: [{ body: 'Pin' }, { body: 'Peg2' }] });
    expect(features[3].tools).toEqual([{ body: 'Peg' }, { body: 'Peg2' }]);   // the document is not changed in place
    expect(renameBodyOps(features, 'Peg', 'Block')).toBeNull();   // taken
    expect(renameBodyOps(features, 'Peg', '  ')).toBeNull();
    expect(renameBodyOps(features, 'Nope', 'X')).toBeNull();
  });
});

describe('matching the kernel lumps to the rows of the list', () => {
  const lump = (name: string | undefined, volume: number, com: number[]) => ({ name, volume, com });
  it('by volume and centre, a fraction of a percent off, in any order', () => {
    const rows = [{ key: 'a', volume: 464341, com: [-0.7, 64.5, 99.6] }, { key: 'b', volume: 5483845, com: [-0.5, 46, 99.4] }];
    const m = matchLumps(rows, [lump('Battery', 5483844.8, [-0.5, 46, 99.4]), lump('Case', 464406, [-0.7, 64.5, 99.6])]);
    expect(Object.fromEntries(m)).toEqual({ a: 'Case', b: 'Battery' });
  });
  it('two copies of one body are told apart by where they are', () => {
    const rows = [{ key: 'x', volume: 1000, com: [30, 0, 0] }, { key: 'y', volume: 1000, com: [0, 0, 0] }];
    const m = matchLumps(rows, [lump('Peg', 1000, [0, 0, 0]), lump('Peg 2', 1000, [30, 0, 0])]);
    expect(Object.fromEntries(m)).toEqual({ x: 'Peg 2', y: 'Peg' });
  });
  it('a row that matches nothing gets no name, and a sheet or an unnamed lump gives none', () => {
    const m = matchLumps([{ key: 'a', volume: 1000, com: [0, 0, 0] }, { key: 's', volume: null, com: null }, { key: 'u', volume: 50, com: [9, 9, 9] }], [lump('Far', 1000, [90, 0, 0]), lump(undefined, 50, [9, 9, 9])]);
    expect(m.size).toBe(0);
  });
});
