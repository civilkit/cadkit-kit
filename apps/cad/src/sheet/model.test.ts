import { describe, expect, it } from 'vitest';
import type { PartDoc } from '@ck/part-model';
import { FEATURE_TYPES } from '@ck/part-model';
import { activeRule, defaultRule, hasSheetBase, isSheetFeature, isUnfolded, lastFlat, outlineBounds, panelCount, panelInfo, rulesOf, sheetFeatures, sheetThickness, tabForSheetChange, type FlatPattern, type SheetEntry } from './model';
import { registerSheetTypes } from './register';
import { drawingBounds } from './FlatPatternView';

const doc = (...features: unknown[]): PartDoc => ({ features }) as unknown as PartDoc;
const flat = (over: Partial<FlatPattern> = {}): FlatPattern => ({
  rule: 'Steel2', thickness: 2, kFactor: 0.44, flatSize: [100, 60, 2], outline: [[[0, 0], [100, 0], [100, 60], [0, 60]]], bends: [], bendZones: [], unfolded: false, ...over,
});

describe('sheet metal model helpers', () => {
  it('knows its feature types', () => {
    for (const t of ['sheetRules', 'baseFlange', 'edgeFlange', 'hem', 'fold', 'contourFlange', 'unfold', 'refold']) expect(isSheetFeature(t)).toBe(true);
    for (const t of ['extrude', 'sketch', undefined]) expect(isSheetFeature(t)).toBe(false);
  });
  it('the part model knows the types too (registered when the kernel package does not list them yet)', () => {
    registerSheetTypes();
    const again = registerSheetTypes();
    expect(again).toEqual([]);   // idempotent
    for (const t of ['sheetRules', 'baseFlange', 'edgeFlange', 'hem', 'fold', 'contourFlange', 'unfold', 'refold']) expect((FEATURE_TYPES as readonly string[]).includes(t)).toBe(true);
  });
  it('a first plate is a base flange or a contour flange, and a suppressed one does not count', () => {
    expect(hasSheetBase(doc({ type: 'sketch', id: 'S1' }))).toBe(false);
    expect(hasSheetBase(doc({ type: 'baseFlange', id: 'B1' }))).toBe(true);
    expect(hasSheetBase(doc({ type: 'contourFlange', id: 'C1' }))).toBe(true);
    expect(hasSheetBase(doc({ type: 'baseFlange', id: 'B1', suppressed: true }))).toBe(false);
    expect(hasSheetBase(null)).toBe(false);
    expect(sheetFeatures(doc({ type: 'sketch', id: 'S1' }, { type: 'hem', id: 'H1' })).map((f) => f.id)).toEqual(['H1']);
  });
  it('the sheet is unfolded after an unfold until a refold', () => {
    const base = { type: 'baseFlange', id: 'B1' };
    expect(isUnfolded(doc(base))).toBe(false);
    expect(isUnfolded(doc(base, { type: 'unfold', id: 'U1' }))).toBe(true);
    expect(isUnfolded(doc(base, { type: 'unfold', id: 'U1' }, { type: 'refold', id: 'U2' }))).toBe(false);
    expect(isUnfolded(doc(base, { type: 'unfold', id: 'U1' }, { type: 'refold', id: 'U2', suppressed: true }))).toBe(true);
  });
  it('the active rule is the last one not switched off; the thickness follows it', () => {
    const d = doc({ type: 'sheetRules', id: 'R1', name: 'A', thickness: 1.5 }, { type: 'sheetRules', id: 'R2', name: 'B', thickness: 3, active: false });
    expect(rulesOf(d)).toHaveLength(2);
    expect(activeRule(d)?.id).toBe('R1');
    expect(sheetThickness(d)).toBe(1.5);
    expect(activeRule(doc())).toBeNull();
    expect(sheetThickness(doc())).toBe(2.5);            // the kernel's default thickness
    expect(defaultRule('X')).toMatchObject({ type: 'sheetRules', name: 'X', thickness: 2, active: true });
  });
  it('the last sheet entry is the current flat pattern', () => {
    const e = (id: string): SheetEntry => ({ id, type: 'edgeFlange', flatPattern: flat() });
    expect(lastFlat([e('B1'), e('E1')])?.id).toBe('E1');
    expect(lastFlat([])).toBeNull();
    expect(lastFlat(undefined)).toBeNull();
  });
  it('bounds cover the outline and the bend zones', () => {
    expect(outlineBounds(flat())).toEqual([0, 0, 100, 60]);
    expect(drawingBounds(flat({ bendZones: [[-1, 4, -5, 65]] }))).toEqual([-1, -5, 100, 65]);
    expect(drawingBounds(flat({ outline: [], bendZones: [] }))).toEqual([0, 0, 1, 1]);
  });
  it('the ribbon opens on the Sheet tab when a part gets its first plate and leaves it when it loses it', () => {
    expect(tabForSheetChange(false, true, 'Home')).toBe('Sheet');
    expect(tabForSheetChange(null, true, 'Home')).toBe('Sheet');        // a file that opens as sheet metal
    expect(tabForSheetChange(null, false, 'View')).toBe('View');        // an ordinary part keeps the tab
    expect(tabForSheetChange(true, true, 'View')).toBe('View');         // the user may go elsewhere
    expect(tabForSheetChange(true, false, 'Sheet')).toBe('Home');
    expect(tabForSheetChange(true, false, 'View')).toBe('View');
  });
  it('a solid converted to a sheet is a sheet: it is the first plate, and its thickness sizes the defaults', () => {
    const d = doc({ type: 'sheetRules', id: 'R1', name: 'A', thickness: 1.5 }, { type: 'extrude', id: 'F1' }, { type: 'sheetConvert', id: 'V1', thickness: 3 });
    expect(hasSheetBase(d)).toBe(true);
    expect(isSheetFeature('sheetConvert')).toBe(true);
    expect(isSheetFeature('sheetCut') && isSheetFeature('sheetCorner')).toBe(true);
    expect(sheetThickness(d)).toBe(3);
    expect(sheetThickness(doc({ type: 'sheetConvert', id: 'V1' }))).toBe(2.5);
    expect(sheetFeatures(d).map((f) => f.type)).toEqual(['sheetRules', 'sheetConvert']);
  });
  it('the panels of a sheet are counted from the roles of its faces', () => {
    const e = (faces: string[]): SheetEntry => ({ id: 'E1', type: 'edgeFlange', flatPattern: flat(), roles: { faces: faces.map((role) => ({ role, face: 'x' })) } });
    expect(panelCount(e(['P0.front', 'P0.back', 'B1.front']))).toBe(1);
    expect(panelCount(e(['P0.front', 'P1.back', 'P2.tip', 'B1.front']))).toBe(3);
    expect(panelInfo(e(['P0.front', 'P0.back', 'P0.side.e2', 'B1.front', 'P1.front', 'P1.tip', 'P1.side.start', 'P1.tip']))).toEqual({ count: 2, walls: [['side.e2'], ['tip', 'side.start']] });
    expect(panelCount(e([]))).toBe(0);
    expect(panelCount(null)).toBe(0);
    expect(panelCount({ id: 'x', type: 'x', flatPattern: flat() })).toBe(0);
  });
});
