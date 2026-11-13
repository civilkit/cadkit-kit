import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INSERT, DEFAULT_NUT, DEFAULT_STANDOFF, bodyNames, fastenerIssue, fastenerOps, insertDefaults, insertIssue, insertOps, insertOpts, insertSummary, nutIssue, nutOps, nutOpts, nutSizeNames,
  nutSummary, standoffDefaults, standoffIssue, standoffOps, standoffOpts, standoffSummary, type InsertParams, type NutParams, type StandoffParams,
} from './fasteners';

type Op = { op: string; feature: { id: string; type: string; op?: string; body?: string; group?: string; face?: string; modeled?: boolean; clearance?: number; target?: Array<{ body: string }> } };
const ops = (o: unknown) => o as Op[];
const N = (o: Partial<NutParams> = {}): NutParams => ({ ...DEFAULT_NUT, ...o });
const S = (o: Partial<StandoffParams> = {}): StandoffParams => ({ ...DEFAULT_STANDOFF, ...o });
const I = (o: Partial<InsertParams> = {}): InsertParams => ({ ...DEFAULT_INSERT, ...o });

describe('nut wizard rules', () => {
  it('the default record is valid: a hex extrude as a body named after the folder, the bore, the chamfer revolve', () => {
    expect(nutIssue(N())).toBeNull();
    const r = ops(nutOps({ features: [] }, N()));
    expect(r.filter((o) => ['extrude', 'revolve'].includes(o.feature.type)).map((o) => `${o.feature.type}:${o.feature.op}`)).toEqual(['extrude:newBody', 'extrude:cut', 'revolve:cut']);
    expect(r.every((o) => o.feature.group === 'Nut')).toBe(true);
    expect(r.find((o) => o.feature.type === 'extrude' && o.feature.op === 'newBody')?.feature.body).toBe('Nut');
    expect(r.filter((o) => o.feature.op === 'cut').every((o) => o.feature.target?.[0].body === 'Nut')).toBe(true);   // the cuts reach only this nut
    expect(r.some((o) => o.feature.type === 'thread')).toBe(false);
  });
  it('a second nut gets its own folder and body name', () => {
    const first = nutOps({ features: [] }, N());
    const doc = { features: first.map((o) => (o as unknown as Op).feature) };
    const second = ops(nutOps(doc, N()));
    expect(second[0].feature.group).toBe('Nut 2');
    expect(second.find((o) => o.feature.op === 'newBody')?.feature.body).toBe('Nut 2');
    expect(new Set([...doc.features, ...second.map((o) => o.feature)].map((f) => f.id)).size).toBe(doc.features.length + second.length);   // ids do not clash
  });
  it('no chamfer leaves out the revolve; a cosmetic or modelled thread adds the thread feature with the clearance', () => {
    expect(ops(nutOps({ features: [] }, N({ chamfer: false }))).some((o) => o.feature.type === 'revolve')).toBe(false);
    const cos = ops(nutOps({ features: [] }, N({ thread: 'cosmetic' }))).find((o) => o.feature.type === 'thread')!.feature;
    expect(cos).toMatchObject({ modeled: false }); expect(cos.clearance).toBeUndefined();
    const mod = ops(nutOps({ features: [] }, N({ thread: 'modeled', clearance: 0.1 }))).find((o) => o.feature.type === 'thread')!.feature;
    expect(mod).toMatchObject({ modeled: true, clearance: 0.1 });
    expect(nutOpts(N({ thread: 'plain', clearance: 0.3 })).clearance).toBeUndefined();   // a clearance only means something for a modelled thread
  });
  it('maps the axis choice to a vector', () => { expect(nutOpts(N({ axis: 'px' })).axis).toEqual([1, 0, 0]); });
  it('style 2 starts at M5; the size list follows the type', () => {
    expect(nutSizeNames('regular')).toContain('M2'); expect(nutSizeNames('style2')[0]).toBe('M5'); expect(nutSizeNames('style2')).not.toContain('M4');
    expect(nutIssue(N({ type: 'style2', size: 'M4' }))).toMatchObject({ code: 'size', params: { standard: 'ISO 4033' } });
  });
  it('a clearance out of range, or a nut too thin to chamfer, is reported', () => {
    expect(nutIssue(N({ thread: 'modeled', clearance: 1.5 }))?.code).toBe('clearance');
    expect(nutIssue(N({ clearance: 1.5 }))).toBeNull();   // ignored while the thread is not modelled
  });
  it('shows the standard, the sizes and whether the row is a less certain one', () => {
    expect(nutSummary(N())).toMatchObject({ standard: 'ISO 4032', s: 13, m: 6.8, unverified: false });
    expect(nutSummary(N())?.e).toBeCloseTo(15.011, 3);
    expect(nutSummary(N({ size: 'M14' }))?.unverified).toBe(true);
    expect(nutSummary(N({ type: 'thin', size: 'M2' }))?.unverified).toBe(true);
    expect(nutSummary(N({ thread: 'cosmetic', size: 'M8' }))?.bore).toBe(6.8);   // the tap drill
    expect(nutSummary(N())?.bore).toBeCloseTo(6.647, 3);                           // the minor diameter D1
  });
});

describe('standoff wizard rules', () => {
  it('the default is a round female-female standoff: a body and two bores, no stud', () => {
    expect(standoffIssue(S())).toBeNull();
    const r = ops(standoffOps({ features: [] }, S()));
    expect(r.filter((o) => o.feature.type === 'extrude').map((o) => o.feature.op)).toEqual(['newBody', 'cut', 'cut']);
    expect(r.every((o) => o.feature.group === 'Standoff')).toBe(true);
  });
  it('male-female adds the stud as an extrude and, with a cosmetic thread, a thread on the bore and one on the stud', () => {
    const r = ops(standoffOps({ features: [] }, S({ ends: 'male-female', thread: 'cosmetic' })));
    expect(r.filter((o) => o.feature.type === 'extrude').map((o) => o.feature.op)).toEqual(['newBody', 'cut', 'add']);
    expect(r.filter((o) => o.feature.type === 'thread')).toHaveLength(2);
  });
  it('changing the size or the shape brings the table values of the new one', () => {
    expect(standoffDefaults('M3', 'round')).toEqual({ outer: 6, threadLength: 6 });
    expect(standoffDefaults('M3', 'hex')).toEqual({ outer: 5.5, threadLength: 6 });
    expect(standoffDefaults('M6', 'hex').outer).toBe(10);
  });
  it('the threads must not meet, and the wall must be at least half a millimetre', () => {
    expect(standoffIssue(S({ length: 10, threadLength: 6 }))).toMatchObject({ code: 'threadMeet', params: { max: 5 } });   // 2 x 6 > 10
    expect(standoffIssue(S({ length: 12, threadLength: 6 }))?.code).toBe('threadMeet');                                   // equal: nothing left between the bores
    expect(standoffIssue(S({ length: 6, ends: 'male-female', threadLength: 6 }))?.code).toBe('threadLong');
    expect(standoffIssue(S({ length: 7, ends: 'male-female', threadLength: 6 }))).toBeNull();
    expect(standoffIssue(S({ outer: 3.5 }))).toMatchObject({ code: 'outer', params: { min: 4 } });
    expect(standoffIssue(S({ length: 0 }))?.code).toBe('length');
  });
  it('the summary adds the stud to the length and counts the bores out of the volume', () => {
    expect(standoffSummary(S({ ends: 'male-female' }))?.total).toBe(21);
    const ff = standoffSummary(S())!, mf = standoffSummary(S({ ends: 'male-female' }))!;
    const bore = Math.PI * (ff.bore / 2) ** 2 * 6;
    expect(ff.volume).toBeCloseTo(Math.PI * 9 * 15 - 2 * bore, 6);
    expect(mf.volume).toBeCloseTo(Math.PI * 9 * 15 - bore + Math.PI * 1.5 ** 2 * 6, 6);
  });
  it('passes the choices to the helper', () => {
    expect(standoffOpts(S({ kind: 'hex', outer: 5.5, axis: 'nx' }))).toMatchObject({ kind: 'hex', outer: 5.5, axis: [-1, 0, 0], size: 'M3', ends: 'female-female' });
  });
});

describe('heat-set insert wizard rules', () => {
  it('the default insert is one revolve as a body, no hole', () => {
    expect(insertIssue(I())).toBeNull();
    const r = ops(insertOps({ features: [] }, I()));
    expect(r.filter((o) => o.feature.type === 'revolve').map((o) => o.feature.op)).toEqual(['newBody']);
    expect(r.some((o) => o.feature.type === 'extrude')).toBe(false);
    expect(r.every((o) => o.feature.group === 'Heat-set insert')).toBe(true);
  });
  it('with the hole: the cut comes before the insert and reaches every body, or only the named one', () => {
    const all = ops(insertOps({ features: [] }, I({ hole: true })));
    expect(all.map((o) => o.feature.type).filter((t) => t === 'extrude' || t === 'revolve')).toEqual(['extrude', 'revolve']);
    expect(all.find((o) => o.feature.op === 'cut')?.feature.target).toBeUndefined();
    const named = ops(insertOps({ features: [] }, I({ hole: true, holeIn: 'Block' })));
    expect(named.find((o) => o.feature.op === 'cut')?.feature.target).toEqual([{ body: 'Block' }]);
    expect(insertOpts(I({ hole: false, holeIn: 'Block' })).hole).toBeUndefined();
  });
  it('every size has a row, and the table values come with the size', () => {
    expect(insertDefaults('M3')).toEqual({ outer: 4.6, length: 5.7, holeDiameter: 4, holeDepth: 7, rings: 3 });
    expect(insertDefaults('M2').rings).toBe(2); expect(insertDefaults('M6').rings).toBe(4);
  });
  it('the hole must hold the insert and be deep enough', () => {
    expect(insertIssue(I({ holeDiameter: 5 }))).toMatchObject({ code: 'holeDiameter', params: { outer: 4.6 } });
    expect(insertIssue(I({ holeDepth: 5 }))).toMatchObject({ code: 'holeDepth', params: { length: 5.7 } });
    expect(insertIssue(I({ outer: 2.5, holeDiameter: 2 }))?.code).toBe('kernel');   // not enough wall round the bore: the helper says so
  });
  it('the summary gives the press-fit interference per side', () => { expect(insertSummary(I())?.interference).toBe(0.3); });
});

describe('the three as one', () => {
  it('dispatches on the kind', () => {
    expect(fastenerIssue({ kind: 'nut', params: N() })).toBeNull();
    expect(ops(fastenerOps({ features: [] }, { kind: 'standoff', params: S() }))[0].feature.group).toBe('Standoff');
    expect(ops(fastenerOps({ features: [] }, { kind: 'insert', params: I() }))[0].feature.group).toBe('Heat-set insert');
  });
  it('lists the named bodies of a document', () => {
    expect(bodyNames([{ op: 'add' }, { op: 'newBody', body: 'Block' }, { op: 'newBody', body: 'Block' }, { op: 'newBody' }, { op: 'newBody', body: 'Lid' }])).toEqual(['Block', 'Lid']);
  });
});
