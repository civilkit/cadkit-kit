import { describe, expect, it } from 'vitest';
import { repairHint } from './hints';
import { sheetHint } from './sheetHints';
import { SHEET_CATALOG, SHEET_FEATURE_TYPES, ruleAdvice } from '@kit/script';
import { FEATURE_TYPES } from '@ck/part-model';

const doc = (type: string) => ({ features: [{ id: 'F4', type }] });

describe('sheet metal hints', () => {
  it('quote the kernel params for each real error kind', () => {
    const low = repairHint('F4', 'flangeHeightTooLow', { minHeight: 4, bend: 1, detail: 'the flange height must be at least 4.000 mm for this bend', hint: 'raise the height' }, doc('edgeFlange'));
    expect(low).toContain('at least 4.000 mm');
    expect(low).toContain('radius or the angle');
    const edge = repairHint('F4', 'invalidValue', { field: 'edges', detail: 'the outline has 4 edges, there is no edge 9', hint: 'edge: an index' }, doc('edgeFlange'));
    expect(edge).toContain('no edge 9');
    expect(edge).toContain('centred on the origin');
    expect(repairHint('F4', 'invalidValue', { field: 'angle', detail: 'x' }, doc('hem'))).toContain('below 180');
    expect(repairHint('F4', 'sheetMetalUnsupported', { detail: 'edge 2 already has a flange', hint: 'one flange per edge in this stage' }, doc('edgeFlange'))).toContain('one flange per edge');
    expect(repairHint('F4', 'sheetMetalUnsupported', { detail: 'another feature changed the sheet body' }, doc('edgeFlange'))).toContain('before any hole or cut');
    expect(repairHint('F4', 'nothingToCut', {}, doc('edgeFlange'))).toContain('baseFlange');
    expect(repairHint('F4', 'noClosedProfile', {}, doc('baseFlange'))).toContain('closed outline');
  });
  it('cover the stage 3 and 4 refusals', () => {
    expect(repairHint('F4', 'sheetMetalUnsupported', { detail: 'the region splits a panel' }, doc('sheetCut'))).toContain('flat layout');
    expect(repairHint('F4', 'sheetMetalUnsupported', { detail: 'the corner is not convex' }, doc('sheetCorner'))).toContain('convex');
    expect(repairHint('F4', 'sheetMetalUnsupported', { detail: 'volume differs by 3 %' }, doc('sheetConvert'))).toContain('constant-thickness');
    expect(repairHint('F4', 'invalidValue', { field: 'corners' }, doc('sheetCorner'))).toContain('vertex');
  });
  it('cover partial-width and shaped flanges: start, length, from, to, profile, holes, relief', () => {
    for (const f of ['start', 'length', 'from', 'to', 'profile', 'holes', 'relief']) expect(repairHint('F4', 'invalidValue', { field: f, detail: 'x' }, doc('edgeFlange')), f).toContain(f);
    expect(repairHint('F4', 'invalidValue', { field: 'profile', detail: 'the profile is not closed' }, doc('edgeFlange'))).toContain('closed loop');
    expect(repairHint('F4', 'invalidValue', { field: 'from', detail: 'x' }, doc('hem'))).toContain('pair');
    const span = repairHint('F4', 'sheetMetalUnsupported', { detail: 'the span 3.000 to 5.000 is not on a free part of the edge `e2` (outside it, or a flange is there already)' }, doc('edgeFlange'));
    expect(span).toContain('one free piece');
    expect(span).not.toContain('convex');                                      // "free" must not read as a corner limit
    expect(repairHint('F4', 'sheetMetalUnsupported', { detail: 'the profile does not reach beyond the bend' }, doc('edgeFlange'))).toContain('swap from and to');
    expect(repairHint('F4', 'sheetMetalUnsupported', { detail: 'the edge `e1` of panel 0 is split by a partial flange: give the flange its span (start and length)' }, doc('edgeFlange'))).toContain('give this flange its span');
    expect(repairHint('F4', 'sheetMetalUnsupported', { detail: 'a hole in the flange reaches the bend: keep it beyond the end of the bend' }, doc('edgeFlange'))).toContain('beyond the end of the bend');
  });
  it('the catalogue documents the partial-width and shaped fields of edgeFlange and the span of hem', () => {
    const names = (t: string) => SHEET_CATALOG.find((f) => f.type === t)!.fields.map((x) => x.name);
    for (const f of ['start', 'length', 'from', 'to', 'profile', 'holes', 'relief']) expect(names('edgeFlange')).toContain(f);
    for (const f of ['start', 'from', 'to', 'relief']) expect(names('hem')).toContain(f);
    expect(names('hem')).not.toContain('profile');
  });
  it('leave other features to the generic hints', () => {
    expect(sheetHint('F4', 'extrude', 'nothingToCut', {})).toBeNull();
    expect(repairHint('F4', 'nothingToCut', {}, doc('extrude'))).toContain('Check the sketch frame');
  });
  it('rule advice flags a bend radius or relief below the thickness', () => {
    expect(ruleAdvice({ name: 'A', thickness: 2, bendRadius: 2, reliefWidth: 2, reliefDepth: 1, kFactor: 0.44 })).toEqual([]);
    expect(ruleAdvice({ thickness: 2, bendRadius: 1, reliefWidth: 1.5 })).toHaveLength(2);
  });
  it('the catalogue and the registered types stay in step', () => {
    const cat = SHEET_CATALOG.filter((f) => f.status === 'available').map((f) => f.type);
    expect(SHEET_CATALOG.every((f) => f.status === 'available')).toBe(true);
    expect(cat.sort()).toEqual([...SHEET_FEATURE_TYPES].sort());
    for (const t of SHEET_FEATURE_TYPES) expect((FEATURE_TYPES as readonly string[]).includes(t), t).toBe(true);
    for (const f of SHEET_CATALOG.filter((x) => x.status === 'available')) { expect(f.example, f.type).not.toBeNull(); expect(f.scriptExample, f.type).toContain('part('); }
  });
});
