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
  it('a look on a pattern also styles the seed body (a look given to the seed itself wins)', async () => {
    const { r } = await run(`const p = part('x');
p.sketch('front', (s) => s.circle(5, [0, 0])).extrude(3);
const seed = p.handle();
p.linearPattern({ count: 3, spacing: 20, direction: 'x' });
const pat = p.handle();
p.appearance({ feature: pat, colour: '#aa5500' });
p.appearance({ feature: seed, finish: 'matte' });`);
    expect(r.errors).toEqual([]);
    expect((r.document as { appearance: unknown }).appearance).toEqual({ F2: { color: '#aa5500', finish: 'matte' }, F3: { color: '#aa5500' } });
  });
});

describe('newBody option', () => {
  it('extrude / revolve / sweep write op newBody (and the body name); a cut refuses it', async () => {
    const { r } = await run(`const p = part('x');
p.sketch('front', (s) => s.rect(20, 20)).extrude(5);
p.sketch('front', (s) => s.rect(5, 5, [40, 0])).extrude(5, { newBody: 'Block' });
p.sketch('front', (s) => s.polygon([[10, 0], [20, 0], [20, 5], [10, 5]])).revolve(360, { newBody: true });
p.sweep({ on: 'front', draw: (s) => s.circle(2) }, { on: 'right', draw: (s) => s.line([0, 0], [0, 20]) }, { newBody: true });`);
    expect(r.errors).toEqual([]);
    const f = (r.document as { features: Array<Record<string, unknown>> }).features.filter((x) => ['extrude', 'revolve', 'sweep'].includes(String(x.type)));
    expect(f.map((x) => x.op)).toEqual(['add', 'newBody', 'newBody', 'newBody']);
    expect(f[1].body).toBe('Block');
    const bad = await run(`part('x').sketch('front', (s) => s.rect(20, 20)).extrude(5).sketch('front', (s) => s.circle(2)).cut(through(), { newBody: true });`);
    expect(bad.r.errors[0].message).toMatch(/newBody applies to material you add/);
  });
});

describe('upAxis()', () => {
  it('writes the view hint into the document the app loads; absent without the call', async () => {
    const { r, loaded } = await run(`part('x').upAxis('z').sketch('front', (s) => s.circle(20, [0, 0])).extrude(3);`);
    expect(r.errors).toEqual([]);
    expect((r.document as { upAxis?: string }).upAxis).toBe('z');
    expect(loaded[0].upAxis).toBe('z');
    const none = await run(BASE);
    expect(Object.keys(none.r.document!)).not.toContain('upAxis');
  });
  it('refuses anything but y or z', async () => {
    const { r } = await run(`part('x').upAxis('w');`);
    expect(r.errors[0].message).toContain("'y' or 'z'");
  });
});

describe('appearance() face roles', () => {
  it('a handle with `only` colours named faces of that feature by role, so no feature id is written by hand', async () => {
    const { r } = await run(BASE + `p.appearance({ face: cap, only: ['S.e1', 'C1'], colour: '#333333' }); p.appearance({ face: lens, only: 'C0', colour: '#444444' });`);
    expect(r.errors).toEqual([]);
    expect((r.document as { faceAppearance: unknown }).faceAppearance).toEqual({ 'F4.S.e1': { color: '#333333' }, 'F4.C1': { color: '#333333' }, 'F2.C0': { color: '#444444' } });
  });
  it('`only` follows the feature when ids move: insert a feature above and the roles still land on the same feature', async () => {
    const a = await run(BASE + `p.appearance({ face: cap, only: 'S.e1', colour: '#333333' });`);
    const b = await run(`const p = part('x');\np.sketch('front', (s) => s.circle(3, [0, 0])).extrude(1);\n` + BASE.replace("const p = part('x');\n", '') + `p.appearance({ face: cap, only: 'S.e1', colour: '#333333' });`);
    const ka = Object.keys((a.r.document as { faceAppearance: Record<string, unknown> }).faceAppearance);
    const kb = Object.keys((b.r.document as { faceAppearance: Record<string, unknown> }).faceAppearance);
    expect(ka).toEqual(['F4.S.e1']);
    expect(kb[0]).not.toBe(ka[0]);          // the feature id moved
    expect(kb[0]).toMatch(/^F\d+\.S\.e1$/);
  });
  it('`only` is refused with anything but a feature handle, and with a malformed role', async () => {
    const a = await run(BASE + `p.appearance({ face: 'F2.S1', only: 'C0', colour: '#111111' });`);
    expect(a.r.errors[0]?.message).toMatch(/only/);
    const b = await run(BASE + `p.appearance({ face: lens, only: 'S e1', colour: '#111111' });`);
    expect(b.r.errors[0]?.message).toMatch(/only/);
  });
});
