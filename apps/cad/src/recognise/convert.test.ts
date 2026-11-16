import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { convert, turnedProfile } from './convert.mjs';

const plate = JSON.parse(readFileSync(resolve(process.cwd(), 'apps/cad/src/recognise/plate.features.json'), 'utf8'));

describe('step features: quiddity records to a kit script', () => {
  it('rebuilds the stock, four corner fillets, five holes and a pocket from the plate records', () => {
    const r = convert(plate);
    expect(r.handled).toEqual(['fillets/0', 'fillets/1', 'fillets/2', 'fillets/3', 'holes/0', 'holes/1', 'holes/2', 'holes/3', 'holes/4', 'pockets/0']);
    expect(r.base!.volume).toBeCloseTo(21715.1328, 3);
    expect(r.script!).toContain("p.sketch(at('front', -20), (s) => s.rect(60, 10, [0, 5])).extrude(40);");
    expect(r.script!.match(/p\.fillet\(/g)).toHaveLength(4);
    expect(r.script!.match(/cut\(through\(\)\)/g)).toHaveLength(4);
    expect(r.script!).toContain('.cut(2);');   // the blind hole
    expect(r.script!).toContain('s.rect(20, 12)).cut(4);');
  });
  it('lists what it does not rebuild instead of guessing, and a pattern as a group of holes already rebuilt', () => {
    const r = convert({ document: { records: [...plate.document.records, { id: 'chamfers/0', family: 'chamfers', parameters: {} }] } });
    expect(r.skipped).toContainEqual({ id: 'chamfers/0', why: "family 'chamfers' is not rebuilt yet", code: 'family', family: 'chamfers' });
    expect(r.skipped.find((s: { id: string }) => s.id === 'hole_patterns/0')?.why).toMatch(/already rebuilt/);
  });
  it('builds nothing when no record carries the stock box', () => {
    const r = convert({ document: { records: [{ id: 'holes/0', family: 'holes', parameters: { axis: [0, 0, 1], location: [0, 0, 0], diameter: 2, bottom: 'through' } }] } });
    expect(r.script!).toBeNull();
    expect(r.skipped[0].why).toMatch(/stock/);
  });
  it('leaves a fillet that is not at a corner of the stock box out', () => {
    const rec = plate.document.records.map((x: { id: string; parameters: Record<string, unknown> }) => x.id === 'fillets/0' ? { ...x, parameters: { ...x.parameters, at: [0, 5, 0] } } : x);
    const r = convert({ document: { records: rec } });
    expect(r.skipped).toContainEqual({ id: 'fillets/0', why: 'the fillet is not at a corner of the stock box', code: 'fillet-corner', family: 'fillets' });
  });
});

describe('prism stock', () => {
  it('builds the outline instead of the box when the body fits a tighter prism', () => {
    const q = { records: [{ id: 'plates/0', family: 'plates', parameters: { body_key: [0, -25, -92.5, 90, 25, 15, 57156.25, 0] } }] };
    const prism = { axis: 1, area: 1143.125, points: [[0, 15], [8, 15], [8, -77.5], [20.5, -90], [90, -90], [90, -92.5], [0, -92.5]], lo: -25, hi: 25 };
    const out = convert(q, { stock: { min: [0, -25, -92.5], max: [90, 25, 15] }, prism: prism as never });
    expect(out.script).toContain('s.polygon([[0,-15]');
    expect(out.script).toContain('.extrude(50)');
  });
  it('keeps the box when the prism is no tighter', () => {
    const q = { records: [{ id: 'plates/0', family: 'plates', parameters: { body_key: [0, 0, 0, 10, 10, 10, 1000, 0] } }] };
    const out = convert(q, { stock: { min: [0, 0, 0], max: [10, 10, 10] }, prism: { axis: 2, area: 100, points: [[0, 0], [10, 0], [10, 10], [0, 10]], lo: 0, hi: 10 } });
    expect(out.script).toContain('s.rect(10, 10');
  });
});

describe('turned profile', () => {
  const lv = (h: number, loops: number[]) => ({ h, loops: loops.map((r) => ({ r, c: [0, 0], round: true })) });
  it('makes a shell from an outer and an inner loop, sharing the point where they meet at the top', () => {
    const levels = [4, 6, 8, 10, 12, 14, 16].map((h) => lv(h, [26 - h * 0.5, 22 - h * 0.5]));
    levels.push(lv(17, [17.5, 17.6]));   // the inner radius has reached the outer one
    const prof = turnedProfile(levels as never, 3, 18);
    expect(prof![0][1]).toBe(3);
    expect(prof!.length).toBeLessThan(8);
  });
  it('is null when a slice is not circular', () => {
    const levels = [4, 6, 8, 10].map((h) => ({ h, loops: [{ r: 20, c: [0, 0], round: false }] }));
    expect(turnedProfile(levels as never, 3, 18)).toBeNull();
  });
});
