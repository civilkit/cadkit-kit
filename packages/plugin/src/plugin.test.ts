import { describe, expect, it } from 'vitest';
import { contextOf, effectiveValues, builtinRegistry, caseManifest, generateCase, checkDefs, checkParams, defaultsOf, engineOk, formModel, parseManifest, PluginRegistry, toJsonSchema, type ParamDef } from './index';
import { toolName } from '../../plugin-tools/src';

const defs: ParamDef[] = [
  { name: 'width', type: 'number', unit: 'mm', default: 80, min: 1, max: 100 },
  { name: 'kind', type: 'enum', options: [{ value: 'a' }, { value: 'b' }], default: 'a' },
  { name: 'extra', type: 'number', optional: true, visibleIf: { param: 'kind', equals: 'b' } },
  { name: 'count', type: 'integer', min: 1 },
  { name: 'label', type: 'string', default: 'x', maxLength: 3, group: 'Names' },
];

describe('parameter definitions', () => {
  it('rejects bad definitions, all at once', () => {
    const e = checkDefs([
      { name: '1bad', type: 'number' }, { name: 'a', type: 'enum' }, { name: 'b', type: 'number', min: 5, max: 1 },
      { name: 'c', type: 'number', default: 500, max: 10 }, { name: 'c', type: 'string' }, { name: 'd', type: 'string', visibleIf: { param: 'nope', equals: 1 } },
    ] as ParamDef[]);
    expect(e.join('\n')).toMatch(/1bad.*letters/);
    expect(e.join('\n')).toMatch(/a.*enum needs options/);
    expect(e.join('\n')).toMatch(/b.*min is more than max/);
    expect(e.join('\n')).toMatch(/default 500 is not valid/);
    expect(e.join('\n')).toMatch(/c.*defined twice/);
    expect(e.join('\n')).toMatch(/visibleIf names "nope"/);
    expect(checkDefs(defs)).toEqual([]);
  });

  it('fills defaults, reports required, range, type and unknown names', () => {
    expect(defaultsOf(defs)).toEqual({ width: 80, kind: 'a', label: 'x' });
    const r = checkParams(defs, { width: 500, kind: 'z', bogus: 1, label: 'toolong' });
    expect(r.ok).toBe(false);
    const msg = r.issues.map((i) => `${i.param} ${i.message}`).join('\n');
    expect(msg).toMatch(/width must be at most 100 mm/);
    expect(msg).toMatch(/kind must be one of "a", "b"/);
    expect(msg).toMatch(/bogus unknown parameter/);
    expect(msg).toMatch(/count is required/);
    expect(msg).toMatch(/label longer than 3/);
    expect(checkParams(defs, { count: 2 })).toMatchObject({ ok: true, values: { width: 80, kind: 'a', label: 'x', count: 2 } });
    expect(checkParams(defs, { count: 2.5 }).issues[0].message).toMatch(/whole number/);
  });

  it('a hidden parameter is dropped whatever it holds, a visible optional one may be left out', () => {
    expect(checkParams(defs, { count: 1, extra: 9 }).values).not.toHaveProperty('extra');
    expect(checkParams(defs, { count: 1, kind: 'b', extra: 9 }).values).toHaveProperty('extra', 9);
    expect(checkParams(defs, { count: 1, kind: 'b' }).ok).toBe(true);
  });

  it('the JSON schema and the form come from the same list', () => {
    const s = toJsonSchema(defs);
    expect(s.required).toEqual(['count']);
    expect(s.additionalProperties).toBe(false);
    expect(s.properties!.width).toMatchObject({ type: 'number', minimum: 1, maximum: 100, default: 80 });
    expect(s.properties!.kind.enum).toEqual(['a', 'b']);
    expect(s.properties!.width.description).toContain('unit: mm');
    expect(s.properties!.extra.description).toContain('used only when kind is "b"');
    const form = formModel(defs, defaultsOf(defs));
    expect(form.map((g) => g.title)).toEqual(['', 'Names']);
    const extra = form[0].fields.find((f) => f.def.name === 'extra')!;
    expect(extra.visible).toBe(false);
    expect(form[0].fields.find((f) => f.def.name === 'count')!.error).toBe('is required');
  });
});

describe('manifest', () => {
  const ok = { id: 'acme.boxes', name: 'Boxes', version: '1.2.3', engine: '>=0.7.0', contributes: { generators: [{ id: 'box', title: 'Box', params: [] }] } };
  it('accepts a valid manifest and lists every problem of a bad one', () => {
    expect(parseManifest(ok)).toMatchObject({ ok: true });
    const bad = parseManifest({ id: 'Bad', version: '1', engine: 'x', contributes: { generators: [{ id: 'A', title: '', params: 3 }, { id: 'ok', title: 't', params: [{ name: 'p', type: 'nope' }] }] } });
    expect(bad.ok).toBe(false);
    const e = (bad as { errors: string[] }).errors.join('\n');
    expect(e).toMatch(/name: required/);
    expect(e).toMatch(/id: "Bad" must look like/);
    expect(e).toMatch(/not a semantic version/);
    expect(e).toMatch(/engine: "x"/);
    expect(e).toMatch(/generators\[0\]\.id/);
    expect(e).toMatch(/unknown type "nope"/);
    expect(parseManifest(null)).toEqual({ ok: false, errors: ['the manifest must be a JSON object'] });
    expect((parseManifest({ ...ok, contributes: { generators: [] } }) as { errors: string[] }).errors[0]).toMatch(/non-empty/);
  });
  it('engine ranges', () => {
    expect(engineOk('>=0.7.0', '0.7.4')).toBe(true);
    expect(engineOk('>=0.8.0', '0.7.4')).toBe(false);
    expect(engineOk('^0.7.0', '0.7.9')).toBe(true);
    expect(engineOk('^0.7.0', '0.8.0')).toBe(false);
    expect(engineOk('^1.2.0', '1.9.0')).toBe(true);
    expect(engineOk('~1.2.0', '1.3.0')).toBe(false);
    expect(engineOk(undefined, '0.0.1')).toBe(true);
    expect(engineOk('garbage', '1.0.0')).toBe(false);
  });
});

describe('registry', () => {
  const m = { id: 'acme.boxes', name: 'Boxes', version: '1.0.0', contributes: { generators: [{ id: 'box', title: 'Box', params: [{ name: 'n', type: 'integer', default: 2, min: 1 }] }] } };
  it('refuses missing or undeclared code and duplicates', () => {
    const r = new PluginRegistry();
    expect(() => r.add(m, {})).toThrow(/no code for generator\(s\) box/);
    expect(() => r.add(m, { box: () => '', other: () => '' })).toThrow(/undeclared generator\(s\) other/);
    r.add(m, { box: () => '' });
    expect(() => r.add(m, { box: () => '' })).toThrow(/already registered/);
    expect(() => r.add({ id: 'x' }, {})).toThrow(/invalid plugin manifest/);
  });
  it('prepare checks the parameters, runs the generator and records the run', async () => {
    const r = new PluginRegistry();
    r.add(m, { box: (v) => `part('B').sketch('front', (s) => s.rect(${v.n}, 1)).extrude(1);` });
    const p = await r.prepare('acme.boxes', 'box', { n: 3 });
    expect(p).toMatchObject({ ok: true, record: { plugin: 'acme.boxes@1.0.0', generator: 'box', params: { n: 3 } } });
    expect((p as { script: string }).script).toContain('rect(3, 1)');
    expect(await r.prepare('acme.boxes', 'box', { n: 0 })).toMatchObject({ ok: false, message: 'n must be at least 1' });
    expect(await r.prepare('acme.boxes', 'nope', {})).toMatchObject({ ok: false });
    r.add({ ...m, id: 'acme.boom' }, { box: () => { throw new Error('exploded'); } });
    expect(await r.prepare('acme.boom', 'box', {})).toMatchObject({ ok: false, message: 'the generator failed: exploded' });
  });
  it('the built-in registry holds the Case generator and names its tool', async () => {
    const r = builtinRegistry();
    expect(r.plugins().map((p) => p.manifest.id)).toEqual(['civilkit.enclosures', 'civilkit.springs']);
    expect(toolName('civilkit.enclosures', 'case')).toBe('plugin_civilkit_enclosures_case');
    expect(caseManifest.contributes.generators[0].params.length).toBe(17);
    const p = await r.prepare('civilkit.enclosures', 'case', { lidHeight: 15, tongueHeight: 1.5 });
    expect((p as { script: string }).script).toBe('caseBox({ width: 80, depth: 50, height: 30, wall: 2, radius: 0, topRadius: 0, lidHeight: 15, tongueHeight: 1.5, clearance: 0.2, tongueOn: "lid", names: ["Base", "Lid"], axis: "y", origin: [0, 0, 0] });\n');
  });
});

describe('Spring plugin and dependent parameters', () => {
  const r = builtinRegistry();
  const run = async (input: Record<string, unknown>, used: string[] = []) => await r.prepare('civilkit.springs', 'spring', input, contextOf(used));
  const script = async (input: Record<string, unknown>, used: string[] = []) => { const p = await run(input, used); if (!p.ok) throw new Error(p.message); return p.script; };

  it('kind defaults come from the kind, as in the wizard', async () => {
    expect(await script({})).toBe('spring({ outer: 20, wire: 2, coils: 8, hand: "right", origin: [0, 0, 0], axis: [0, 0, 1], name: "Spring", length: 40, ends: "plain" });\n');
    expect(await script({ kind: 'extension' })).toContain('extensionSpring({ outer: 12, wire: 1, coils: 15,');
    expect(await script({ kind: 'torsion' })).toContain('torsionSpring({ outer: 14, wire: 1.2, coils: 5.25,');
    expect(await script({ kind: 'torsion' })).toContain('leg1: 21, leg2: 21 });');
  });
  it('a parameter hidden by the kind is dropped, and so are the ones that depend on it', async () => {
    // ends is for compression only; closedTurns depends on ends, so it goes too although ends = "closed" was passed
    const e = effectiveValues(r.find('civilkit.springs', 'spring')!.decl.params, { kind: 'extension', ends: 'closed', closedTurns: 3, length: 99 });
    expect([...e.hidden].sort()).toEqual(['closedTurns', 'ends', 'leg1', 'leg2', 'length', 'progression', 'topOuter']);
    expect(await script({ kind: 'extension', ends: 'closed', closedTurns: 3, length: 99 })).not.toMatch(/closed|length|99/);
    expect(await script({ ends: 'ground', closedTurns: 2, topOuter: 30, progression: 0.8 })).toContain('ends: "ground", closedTurns: 2, topOuter: 30, progression: 0.8 });');
    expect(await script({ ends: 'plain', closedTurns: 2 })).not.toContain('closedTurns');
  });
  it('values are checked against the shown parameters only', async () => {
    expect((await run({ kind: 'extension', length: -5 })).ok).toBe(true);                         // length is hidden, so its bad value is not an error
    expect(await run({ kind: 'compression', length: -5 })).toMatchObject({ ok: false, message: 'length must be at least 0.1 mm' });
    expect(await run({ axis: 'up' })).toMatchObject({ ok: false });
  });
  it('names are made unique against the document', async () => {
    expect(await script({}, ['Spring'])).toContain('name: "Spring 2"');
    expect(await script({}, ['Spring', 'Spring 2'])).toContain('name: "Spring 3"');
    expect(await script({ name: 'Valve' }, ['Spring'])).toContain('name: "Valve"');
    expect(await script({ name: '  ' }, [])).toContain('name: "Spring"');
  });
});

describe('case wizard names (#70)', () => {
  it('picks free names when Base and Lid are already used', () => {
    const v = defaultsOf(caseManifest.contributes.generators[0].params);
    const taken = ['Base', 'Lid'];
    const uniqueName = (b: string): string => { let n = b, i = 2; while (taken.includes(n)) n = `${b} ${i++}`; return n; };
    const text = generateCase(v, { used: taken, uniqueName });
    expect(text).toContain('names: ["Base 2", "Lid 2"]');
    expect(generateCase(v, { used: [], uniqueName: (b: string) => b })).toContain('names: ["Base", "Lid"]');
  });
});
