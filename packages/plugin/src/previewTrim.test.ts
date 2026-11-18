import { describe, it, expect } from 'vitest';
import { trimForPreview, REPEAT_MIN } from './previewTrim';

const board = 'p.sketch(at(\'front\', 9), (s) => s.rect(564, 542, [0, -9])).extrude(18, { name: "Side", newBody: "Side" }); H["Side"] = p.handle();';
const label = (n: string) => [
  `  p.workplane({ origin: [0,0,18], normal: [0,0,1], xdir: [1,0,0] }, 0, { name: "${n} label plane" });`,
  `  p.sketch(at(p.handle()), (s) => s.text("${n}", [0, 0], { height: 20, anchor: ['center', 'middle'] })).cut(0.3, { name: "${n} label", from: ["${n}"], direction: 'into' });`,
];
const pin = (i: number, from = 'Side') => `  p.sketch(at("right", -282), (s) => s.circle(2.5, [-${82 + i * 32}, 225])).cut(12, { name: "${from} pin ${i}", from: ["${from}"], direction: 'into' });`;
const groove = (from: string) => `  p.sketch(at('front', 9), (s) => s.rect(582, 6, [0, 265])).cut(702, { name: "groove @ ${from}", from: ["${from}"] });`;
const script = (...l: string[]) => ['p.run(() => {', ...l, '});'].join('\n');

describe('trimForPreview', () => {
  it('leaves out engraved text, with the plane made for it', () => {
    const s = script('  ' + board, ...label('Side'));
    const t = trimForPreview(s);
    expect(t.script).toContain('Side');
    expect(t.script).not.toMatch(/s\.text\(/);
    expect(t.script).not.toMatch(/label plane/);
    expect(t.script).toContain('newBody: "Side"');   // the board stays
    expect(t.skipped).toEqual([{ what: 'engraved text', count: 1 }]);
  });
  it('leaves out a row of identical holes into one body, but not a few', () => {
    const rows = Array.from({ length: REPEAT_MIN }, (_, i) => pin(i));
    const t = trimForPreview(script('  ' + board, ...rows));
    expect(t.script).not.toMatch(/pin \d/);
    expect(t.skipped).toEqual([{ what: 'repeated holes', count: REPEAT_MIN }]);
    const few = trimForPreview(script('  ' + board, ...rows.slice(0, REPEAT_MIN - 1)));
    expect(few.skipped).toEqual([]);
    expect(few.script).toContain('pin 0');
  });
  it('counts holes per body and per size: a hinge row on each of two boards is not one big row', () => {
    const t = trimForPreview(script(...Array.from({ length: 5 }, (_, i) => pin(i, 'Door L')), ...Array.from({ length: 5 }, (_, i) => pin(i, 'Door R'))));
    expect(t.skipped).toEqual([]);
  });
  it('keeps ordinary cuts (grooves) and anything it does not fully understand', () => {
    const cuts = [groove('Side L'), groove('Side R'), groove('Top')];
    const kept = trimForPreview(script('  ' + board, ...cuts));
    expect(kept.skipped).toEqual([]);
    expect(kept.script).toBe(script('  ' + board, ...cuts));
    // two statements on one line, a handle kept, or a cut that makes its own body: never dropped
    const odd = [
      '  p.sketch(at("front", 1), (s) => s.text("A", [0, 0], { height: 5 })).cut(1, { from: ["X"] }); p.foo();',
      '  p.sketch(at("front", 1), (s) => s.text("B", [0, 0], { height: 5 })).cut(1, { from: ["X"], newBody: "B" });',
      '  p.sketch(at("front", 1), (s) => s.text("C", [0, 0], { height: 5 })).cut(1, { from: ["X"] }); H["C"] = p.handle();',
      '  p.sketch(at("front", 1), (s) => s.text("D", [0, 0], { height: 5 }))',
      '    .cut(1, { from: ["X"] });',
    ];
    expect(trimForPreview(script(...odd)).skipped).toEqual([]);
  });
  it('is the same script back when there is nothing to leave out', () => {
    const s = script('  ' + board);
    expect(trimForPreview(s)).toEqual({ script: s, skipped: [] });
  });
});
