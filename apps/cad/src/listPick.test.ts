import { describe, expect, it } from 'vitest';
import { edgesOnBefore, listPick, selectionInField, toggleRefs } from './listPick';
import { roundPickOf } from './roundChain';

const edges = [
  { key: 'A|B#0', faces: ['A', 'B'], mid: [1, 2, 3] },
  { key: 'A|C#1', faces: ['A', 'C'], mid: [4, 5, 6] },
  { key: 'B|C#2', faces: ['B', 'C'], mid: [7, 8, 9] },
];
const AB = { faces: ['A', 'B'], at: [1, 2, 3] };
const AC = { faces: ['A', 'C'], at: [4, 5, 6] };
const BC = { faces: ['B', 'C'], at: [7, 8, 9] };

describe('picking into an active edges field (no modifier key)', () => {
  it('each tap adds the edge to what the field already has', () => {
    const one = listPick('edges', [AB], [], ['A|C#1'], edges)!;
    expect(one.value).toEqual([AB, AC]);
    expect(one.selection).toEqual(['A|C#1']);
    const two = listPick('edges', one.value, one.selection, ['B|C#2'], edges)!;
    expect(two.value).toEqual([AB, AC, BC]);
    expect(two.selection).toEqual(['A|C#1', 'B|C#2']);
  });
  it('a tap on an edge already in the field takes it out, and it is no longer lit', () => {
    const r = listPick('edges', [AB, AC], ['A|B#0', 'A|C#1'], ['A|B#0'], edges)!;
    expect(r.value).toEqual([AC]);
    expect(r.selection).toEqual(['A|C#1']);
  });
  it('matches a stored edge by its faces in either order and a point within rounding', () => {
    const stored = { faces: ['B', 'A'], at: [1, 2, 3 + 1e-9] };
    expect(listPick('edges', [stored], [], ['A|B#0'], edges)!.value).toEqual([]);
  });
  it('a tap on empty space or on something the field does not take changes nothing', () => {
    expect(listPick('edges', [AB], ['A|B#0'], [], edges)).toBeNull();
    expect(listPick('edges', [AB], ['A|B#0'], ['A'], edges)).toBeNull();   // one face is not an edge
  });
  it('a box selection only adds', () => {
    const r = listPick('edges', [AB], ['A|B#0'], ['A|B#0', 'A|C#1'], edges, false, true)!;
    expect(r.value).toEqual([AB, AC]);
  });
  it('a face list toggles face names the same way', () => {
    expect(listPick('faces', ['A'], [], ['B'], edges)!.value).toEqual(['A', 'B']);
    expect(listPick('faces', ['A', 'B'], ['A', 'B'], ['A'], edges)!).toEqual({ value: ['B'], selection: ['B'] });
  });
});

describe('with the tangent chain on', () => {
  const line = [
    { key: 'k1', faces: ['T', 'A'], pts: [[0, 0, 0], [5, 0, 0]], mid: [2.5, 0, 0] },
    { key: 'k2', faces: ['T', 'B'], pts: [[5, 0, 0], [9, 0, 0]], mid: [7, 0, 0] },
    { key: 'k3', faces: ['T', 'C'], pts: [[9, 0, 0], [9, 4, 0]], mid: [9, 2, 0] },
  ];
  const k1 = { faces: ['T', 'A'], at: [2.5, 0, 0] }, k2 = { faces: ['T', 'B'], at: [7, 0, 0] }, k3 = { faces: ['T', 'C'], at: [9, 2, 0] };
  it('a tap adds the edge with the ones that continue it, and the field still knows what was picked', () => {
    const r = listPick('edges', [k3], [], ['k1'], line, true)!;
    expect(r.value).toEqual([k3, k1, k2]);
    expect(roundPickOf(r.value)).toEqual({ seeds: [k3, k1], all: [k3, k1, k2] });
    expect(listPick('edges', r.value, r.selection, ['k1'], line, true)!.value).toEqual([k3]);   // a second tap takes the chain out again
  });
});

describe('toggleRefs', () => {
  it('adds only what is missing, once', () => {
    expect(toggleRefs([AB], [AB, AC, AC])).toEqual({ value: [AB, AC], removed: false });
    expect(toggleRefs([AB, AC], [AB, AC])).toEqual({ value: [], removed: true });
  });
});

describe('selectionInField', () => {
  it('drops a lit edge whose chip was removed, keeps names the body on screen no longer has', () => {
    expect(selectionInField('edges', ['A|B#0', 'A|C#1', 'X|Y#7'], [AC], edges)).toEqual(['A|C#1', 'X|Y#7']);
  });
});

describe('an edges field of a saved feature, read on the body before it', () => {
  // before: one rim edge T|A from x 0 to 10. On screen (the feature applied) the rim is cut into a long piece and a stub, and the
  // feature made an edge T|R of its own.
  const before = [
    { key: 'T|A#0', faces: ['T', 'A'], pts: [[0, 0, 0], [10, 0, 0]], mid: [5, 0, 0] },
    { key: 'T|B#1', faces: ['T', 'B'], pts: [[10, 0, 0], [10, 6, 0]], mid: [10, 3, 0] },
  ];
  const shown = [
    { key: 'T|A#5', faces: ['T', 'A'], pts: [[0.5, 0, 0], [9.5, 0, 0]], mid: [5, 0, 0] },
    { key: 'T|A#9', faces: ['T', 'A'], pts: [[-0.4, 0, 0], [0.5, 0, 0]], mid: [0.05, 0, 0] },
    { key: 'T|R#7', faces: ['T', 'R'], pts: [[0, 1, 0], [0, 2, 0]], mid: [0, 1.5, 0] },
    { key: 'B~1|T#8', faces: ['T', 'B~1'], pts: [[10, 0.5, 0], [10, 6, 0]], mid: [10, 3.2, 0] },
  ];
  const TA = { faces: ['T', 'A'], at: [5, 0, 0] }, TB = { faces: ['T', 'B'], at: [10, 3, 0] };
  it('both pieces of a cut edge are the one edge it was; an edge the feature made is dropped; a split face is the face it came from', () => {
    expect(edgesOnBefore(['T|A#5'], shown, before)).toEqual(['T|A#0']);
    expect(edgesOnBefore(['T|A#9', 'T|A#5'], shown, before)).toEqual(['T|A#0']);
    expect(edgesOnBefore(['T|R#7'], shown, before)).toEqual([]);
    expect(edgesOnBefore(['B~1|T#8'], shown, before)).toEqual(['T|B#1']);
  });
  it('a pick adds the edge as it was before the feature, once, and a second pick of either piece takes it out', () => {
    const r = listPick('edges', [TB], [], ['T|A#9'], shown, false, false, before)!;
    expect(r.value).toEqual([TB, TA]);
    expect(r.selection).toEqual(['T|A#9']);
    expect(listPick('edges', r.value, r.selection, ['T|A#5'], shown, false, false, before)!.value).toEqual([TB]);
    expect(listPick('edges', [TB], [], ['T|R#7'], shown, false, false, before)).toBeNull();
  });
  it('two references to one edge are one: a field that names it twice keeps it once', () => {
    const stub = { faces: ['A', 'T'], at: [0.05, 0, 0] };
    expect(toggleRefs([TA, stub], [TB], false, before).value).toEqual([TA, TB]);
    expect(toggleRefs([TA], [stub], false, before)).toEqual({ value: [], removed: true });
    expect(toggleRefs([TA], [stub]).value).toEqual([TA, stub]);   // without the body: compared as written
  });
});
