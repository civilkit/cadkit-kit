import { describe, expect, it } from 'vitest';
import { runScript, type ScriptHost } from './index';

// a host with no kernel: build() accepts everything; load() keeps the document it is given
const mock = (loaded: Array<Record<string, unknown>>): ScriptHost => ({
  load: async (d) => { loaded.push(d); },
  edit: async () => ({ ok: true }),
  geometry: () => ({ mesh: null, edges: [], box: null }),
  build: async () => ({ errors: [] }),
  release: async () => {},
});
const run = async (code: string) => {
  const loaded: Array<Record<string, unknown>> = [];
  const r = await runScript(code, mock(loaded), {}, { yieldToUi: async () => {} });
  return { r, loaded };
};
const BASE = `const p = part('x');
p.sketch('front', (s) => s.circle(20, [0, 0])).extrude(3);
const lens = p.handle();
p.sketch('front', (s) => s.circle(5, [40, 0])).extrude(3);
const cap = p.handle();
`;

describe('appearance() and bodyName()', () => {
  it('records a look per feature and writes it into the document the app loads, once the handle ids are known', async () => {
    const { r, loaded } = await run(BASE + `p.appearance({ feature: lens, colour: '#B9C7D6', opacity: 0.18, finish: 'glass' });
p.appearance({ body: cap, color: '#abc', finish: 'chrome' });
p.bodyName(lens, 'Tach lens'); p.bodyName('F4', 'Cap');`);
    expect(r.errors).toEqual([]);
    const want = { appearance: { F2: { color: '#b9c7d6', opacity: 0.18, finish: 'glass' }, F4: { color: '#aabbcc', finish: 'chrome' } }, bodyNames: { F2: 'Tach lens', F4: 'Cap' } };
    expect(r.document).toMatchObject(want);
    expect(loaded[0]).toMatchObject(want);   // the document that is loaded carries it, not only the one returned
  });
  it('later calls win field by field; opacity 1 is the default and is not stored', async () => {
    const { r } = await run(BASE + `p.appearance({ feature: lens, colour: '#ff0000', opacity: 0.5 }); p.appearance({ feature: lens, opacity: 1, finish: 'plastic' });`);
    expect((r.document as { appearance: unknown }).appearance).toEqual({ F2: { color: '#ff0000', opacity: 0.5, finish: 'plastic' } });
  });
  it('face looks go to faceAppearance: a name, a prefix, or every face of a feature (handle)', async () => {
    const { r } = await run(BASE + `p.appearance({ face: 'F2.S1', colour: '#111111' }); p.appearance({ face: cap, colour: '#222222', finish: 'matte' });`);
    expect((r.document as { faceAppearance: unknown }).faceAppearance).toEqual({ 'F2.S1': { color: '#111111' }, 'F4.*': { color: '#222222', finish: 'matte' } });
    expect((r.document as { appearance?: unknown }).appearance).toBeUndefined();
  });
  it('a script with no appearance adds no fields', async () => {
    const { r } = await run(BASE);
    expect(Object.keys(r.document!)).not.toContain('appearance');
    expect(Object.keys(r.document!)).not.toContain('bodyNames');
  });
  it.each([
    [`p.appearance({ feature: lens })`, 'give a colour, an opacity or a finish'],
    [`p.appearance({ colour: '#fff' })`, 'exactly one of feature, body or face'],
    [`p.appearance({ feature: lens, colour: 'red' })`, 'colour must be'],
    [`p.appearance({ feature: lens, opacity: 0 })`, 'opacity must be between 0.05 and 1'],
    [`p.appearance({ feature: lens, finish: 'wood' })`, 'finish must be one of'],
    [`p.appearance({ face: 'top', colour: '#fff' })`, 'persistent face name'],
    [`p.bodyName(lens, ' ')`, 'non-empty'],
  ])('rejects %s with a clear message', async (call, msg) => {
    const { r } = await run(BASE + call);
    expect(r.errors[0]?.message).toContain(msg);
    expect(r.errors[0]?.line).toBeGreaterThan(0);
  });
});
