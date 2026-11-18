import { describe, expect, it } from 'vitest';
import { PluginRegistry } from './registry';
import { checkDefs, previewValues, type ParamDef } from './params';

const defs: ParamDef[] = [
  { name: 'w', type: 'number', default: 10 },
  { name: 'labels', type: 'boolean', title: 'Labels', default: false, previewOff: true },
  { name: 'pins', type: 'boolean', title: 'Shelf pin holes', default: false, previewOff: true },
  { name: 'quick', type: 'boolean', default: true },
];

describe('previewOff', () => {
  it('turns the marked switches that are on off for a preview, and names them', () => {
    const r = previewValues(defs, { w: 5, labels: true, pins: false, quick: true });
    expect(r.values).toEqual({ w: 5, labels: false, pins: false, quick: true });
    expect(r.skipped).toEqual(['labels']);
    expect(previewValues(defs, { w: 5 }).skipped).toEqual([]);
  });
  it('is only for a boolean switch', () => {
    expect(checkDefs([{ name: 'n', type: 'number', default: 1, previewOff: true }])).toEqual(['param "n": previewOff is for a boolean switch']);
    expect(checkDefs(defs)).toEqual([]);
  });
  it('the registry runs a preview with them off and returns what it left out', async () => {
    const seen: unknown[] = [];
    const reg = new PluginRegistry();
    reg.add({ id: 't.p', name: 'T', version: '1.0.0', contributes: { generators: [{ id: 'g', title: 'G', params: defs }] } }, { g: (v) => { seen.push(v); return 'x'; } });
    const live = await reg.prepare('t.p', 'g', { labels: true, pins: true }, { used: [], uniqueName: (b: string) => b, preview: true });
    expect(live.ok && live.record.meta).toEqual({ previewSkipped: ['labels', 'shelf pin holes'] });
    expect(seen[0]).toMatchObject({ labels: false, pins: false });
    const final = await reg.prepare('t.p', 'g', { labels: true, pins: true }, { used: [], uniqueName: (b: string) => b });
    expect(seen[1]).toMatchObject({ labels: true, pins: true });
    expect(final.ok && final.record.meta).toBeUndefined();
  });
});
