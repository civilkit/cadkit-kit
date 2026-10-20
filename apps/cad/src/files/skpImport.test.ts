import { describe, expect, it, vi } from 'vitest';
import { hexOfRgb, skpFaceIndex, skpLook, skpRefusal, skpSummary, importSkpView, SKP_DEFAULT_ORIENT, nextSkpOrient, skpImportOpts, skpNotices, type SkpOrient } from './skpImport';
import { t } from '../i18n';
import './strings';
import { dropKind } from './names';
import { planDrop } from './drop';

describe('SketchUp file routing', () => {
  it('.skp is its own kind, in any case; a backup copy is not', () => {
    expect(['a.skp', 'B.SKP', 'c.Skp'].map(dropKind)).toEqual(['skp', 'skp', 'skp']);
    expect(dropKind('a.skp~')).toBe('unknown');
    expect(dropKind('a.skb')).toBe('unknown');
  });
  it('a dropped .skp opens as skp, two files are refused', () => {
    expect(planDrop(['model.skp'])).toEqual({ action: 'open', kind: 'skp', name: 'model.skp' });
    expect(planDrop(['a.skp', 'b.skp'])).toEqual({ action: 'multiple' });
  });
});

describe('SketchUp colours', () => {
  const mats = [
    { color: [92, 64, 42] as [number, number, number], opacity: 1 },
    { color: [120, 150, 190] as [number, number, number], opacity: 0.4, doubleSided: true },
  ];
  it('formats colours as #rrggbb and clamps', () => {
    expect(hexOfRgb([92, 64, 42])).toBe('#5c402a');
    expect(hexOfRgb([300, -5, 0.4])).toBe('#ff0000');
  });
  it('reads the face index from the name', () => {
    expect(skpFaceIndex('skp.F12')).toBe(12);
    expect(skpFaceIndex('F12')).toBeNull();
    expect(skpFaceIndex('skp.F1.x')).toBeNull();
  });
  it('opaque faces get their colour; translucent faces go to one group per material with the opacity', () => {
    const l = skpLook(['skp.F0', 'skp.F1', 'skp.F2', 'skp.F3'], mats, [0, 1, 0, 1]);
    expect(l.faces).toEqual({ 'skp.F0': { color: '#5c402a' }, 'skp.F2': { color: '#5c402a' } });
    expect(l.bodies).toEqual([{ key: 'skp.m1', faces: ['skp.F1', 'skp.F3'] }]);
    expect(l.looks['skp.m1']).toMatchObject({ color: '#7896be', opacity: 0.4 });
  });
  it('a face with no material entry keeps the default (no entry), whatever the index', () => {
    const l = skpLook(['skp.F0', 'skp.F1', 'other'], mats, [0, 9]);
    expect(Object.keys(l.faces)).toEqual(['skp.F0']);
    expect(l.bodies).toEqual([]);
  });
});

describe('SketchUp summary and refusals', () => {
  it('closed only without open and non-manifold edges', () => {
    const f = { faces: 6, lumps: 1, openEdges: 0, nonManifoldEdges: 0, materials: [], hiddenSkipped: 0 };
    expect(skpSummary(f).closed).toBe(true);
    expect(skpSummary({ ...f, openEdges: 4 }).closed).toBe(false);
    expect(skpSummary({ ...f, nonManifoldEdges: 1 }).closed).toBe(false);
    expect(skpSummary({ ...f, lumps: 3 })).toMatchObject({ pieces: 3, faces: 6 });
  });
  it('a refusal keeps its code and the kernel message', () => {
    expect(skpRefusal([['import', { code: 'limit.faces', params: { message: 'too many faces: 60000 (limit 50000)' } }]])).toEqual({ code: 'limit.faces', message: 'too many faces: 60000 (limit 50000)' });
    expect(skpRefusal([['import', { code: 'body.empty', params: {} }]])).toEqual({ code: 'body.empty', message: 'import: body.empty' });
  });
  it('a refused reply is a failure with the structured code; a thrown call is a trap', async () => {
    const refused = { importSkp: async () => ({ errors: [['import', { code: 'body.empty', params: { message: 'model has no visible faces' } }]] as never, body: null }) };
    expect(await importSkpView(refused, new Uint8Array([1]), 'x')).toEqual({ ok: false, code: 'body.empty', message: 'model has no visible faces' });
    const boom = { importSkp: async () => { throw new Error('wasm trap'); } };
    expect(await importSkpView(boom, new Uint8Array([1]), 'x')).toEqual({ ok: false, code: 'trap', message: 'wasm trap' });
  });
});

describe('SketchUp orientation', () => {
  it('opens upright by default and the kernel option is always sent (its own default is the file axes)', () => {
    expect(SKP_DEFAULT_ORIENT).toBe('y');
    expect(skpImportOpts('y')).toEqual({ up: 'y' });
    expect(skpImportOpts('z', true)).toEqual({ hidden: true, up: 'z' });
    expect(skpImportOpts('yFlip', false)).toEqual({ up: 'yFlip' });
  });
  it('flipping cycles upright, as in the file, upside down, upright', () => {
    const seq: SkpOrient[] = ['y'];
    for (let i = 0; i < 3; i++) seq.push(nextSkpOrient(seq[i]));
    expect(seq).toEqual(['y', 'z', 'yFlip', 'y']);
  });
  it('the choice reaches session.importSkp and the result reports what the kernel applied', async () => {
    const importSkp = vi.fn(async () => ({ errors: [], body: { faces: [{ id: 'skp.F0' }], edges: [], box: { min: [0, 0, 0], max: [1, 1, 1] } }, import: { up: 'yFlip', lumps: 1, openEdges: 0, nonManifoldEdges: 0, materials: [], faceMaterials: [0], hiddenSkipped: 0 } }));
    const r = await importSkpView({ importSkp } as never, new Uint8Array([1, 2, 3]), 'm', skpImportOpts('yFlip', true));
    expect(importSkp).toHaveBeenCalledWith('AQID', 'm', { hidden: true, up: 'yFlip' });
    expect(r.ok && r.up).toBe('yFlip');
  });
  it('without an echo from the kernel the result reports the requested orientation', async () => {
    const importSkp = async () => ({ errors: [], body: { faces: [{ id: 'skp.F0' }], edges: [], box: { min: [0, 0, 0], max: [1, 1, 1] } }, import: {} });
    const r = await importSkpView({ importSkp } as never, new Uint8Array([1]), 'm', { up: 'y' });
    expect(r.ok && r.up).toBe('y');
  });
});

describe('SketchUp import notices', () => {
  const closed = skpSummary({ faces: 6, lumps: 1, openEdges: 0, nonManifoldEdges: 0, materials: [], hiddenSkipped: 0 });
  const open = skpSummary({ faces: 6, lumps: 2, openEdges: 4, nonManifoldEdges: 1, materials: [], hiddenSkipped: 3 });
  it('the first notice names the orientation and carries the Flip orientation control', () => {
    const flip = vi.fn();
    const n = skpNotices(closed, { file: 'a.skp', up: 'y', hidden: false }, t, { flip, showHidden() {} });
    expect(n).toHaveLength(1);
    expect(n[0].text).toMatch(/a\.skp/);
    expect(n[0].text).toMatch(/upright/);
    expect(n[0].action?.label).toBe('Flip orientation');
    n[0].action!.run();
    expect(flip).toHaveBeenCalledOnce();
    expect(skpNotices(closed, { file: 'a.skp', up: 'z', hidden: false }, t, { flip, showHidden() {} })[0].text).toMatch(/lies on its side/);
    expect(skpNotices(closed, { file: 'a.skp', up: 'yFlip', hidden: false }, t, { flip, showHidden() {} })[0].text).toMatch(/upside down/);
  });
  it('hidden faces and open edges get their own notices; the hidden one only while they are left out', () => {
    const showHidden = vi.fn();
    const n = skpNotices(open, { file: 'b.skp', up: 'y', hidden: false }, t, { flip() {}, showHidden });
    expect(n.map((x) => x.level)).toEqual(['warn', 'info', 'warn']);
    expect(n[1].action?.label).toBe('Show hidden geometry');
    n[1].action!.run();
    expect(showHidden).toHaveBeenCalledOnce();
    expect(n[2].text).toMatch(/5 open edges/);
    const again = skpNotices(open, { file: 'b.skp', up: 'y', hidden: true }, t, { flip() {}, showHidden });
    expect(again).toHaveLength(2);
    expect(again.every((x) => x.action === undefined || x.action.label === 'Flip orientation')).toBe(true);
  });
});
