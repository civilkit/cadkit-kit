import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectPackage, PluginManager, PluginRegistry, memoryStore } from '@kit/plugin';
import { isRelease, convertRelease, jcoTranspile, type Transpile } from './convert';

const enc = (s: string) => new TextEncoder().encode(s);
const wasmBytes = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
const release = (over: Record<string, unknown> = {}, extra: Record<string, Uint8Array> = {}): Map<string, Uint8Array> => new Map<string, Uint8Array>([
  ['plugin.json', enc(JSON.stringify({
    id: 'woodwork', name: 'Woodwork', version: '0.1.7', description: 'Cabinets', capabilities: ['commands@0.1'],
    runtime: {
      module: 'woodwork.wasm', commands: ['solid.box', 'parameters.add'], limits: { deadline_ms: 20000 },
      entries: [
        { name: 'cabinet', effect: 'edit', slots: [{ kind: 'menu', name: 'Cabinet…' }], input_schema: { type: 'object', properties: {
          width: { type: 'number', title: 'Width', default: 600 },
          place: { type: 'string', title: 'Place', default: 'none', oneOf: [{ const: 'none', title: 'Origin' }, { const: 'right', title: 'Right of' }] },
          labels: { type: 'boolean', title: 'Labels', default: false },
        } } },
        { name: 'edit', effect: 'edit', slots: [{ kind: 'menu', name: 'Edit cabinet' }], input_schema: { type: 'object', properties: {} } },
        { name: 'cutlist', effect: 'read', slots: [{ kind: 'menu', name: 'Cut list' }], input_schema: { type: 'object', properties: {} } },
      ],
    }, ...over,
  }))],
  ['woodwork.wasm', wasmBytes],
  ['LICENSE', enc('MIT License\n\nCopyright (c) 2026 TomasDJo\n\nPermission is hereby granted, free of charge, to any person')],
  ...Object.entries(extra),
]);
const fake: Transpile = async () => new Map([['component.js', enc('export const instantiate = 1;')], ['component.core.wasm', wasmBytes], ['component.core2.wasm', wasmBytes]]);

describe('author release -> our package', () => {
  it('knows a release from our own package', () => {
    expect(isRelease(release())).toBe(true);
    expect(isRelease(new Map([['plugin.json', enc(JSON.stringify({ id: 'a.b', wasm: {}, contributes: {} }))]]))).toBe(false);
    expect(isRelease(new Map([['plugin.json', enc('{}')]]))).toBe(false);
    expect(isRelease(new Map([['x/plugin.json', enc(JSON.stringify({ runtime: { module: 'a.wasm', entries: [] } }))], ['x/a.wasm', wasmBytes]]))).toBe(true);   // wrapped in one folder
  });

  it('writes a package the installer accepts, with dropdowns, the owner from the LICENSE and a sha256 for every file', async () => {
    const c = await convertRelease(release(), fake);
    if ('error' in c) throw new Error(c.error);
    const ins = await inspectPackage(c.files);
    expect(ins.errors).toEqual([]);
    const m = ins.manifest!;
    expect(m.id).toBe('tomasdjo.woodwork');
    expect(m.license).toBe('MIT');
    expect(m.wasm!.commands).toEqual(['solid.box', 'parameters.add']);
    expect(m.wasm!.limits?.deadlineMs).toBe(20000);
    expect(m.wasm!.cores).toEqual(['component.core.wasm', 'component.core2.wasm']);
    expect(m.contributes.generators.map((g) => g.id)).toEqual(['cabinet', 'cutlist']);   // "edit" is left out; the read entry stays, marked as one
    expect(m.contributes.generators.find((g: { id: string }) => g.id === 'cutlist')!.effect).toBe('read');
    const place = m.contributes.generators[0].params!.find((p) => p.name === 'place')!;
    expect(place.type).toBe('enum');
    expect(place.options).toEqual([{ value: 'none', label: 'Origin' }, { value: 'right', label: 'Right of' }]);
    expect(m.contributes.generators[0].title).toBe('Cabinet');
    expect(c.notes.join(' ')).toMatch(/left out, this app cannot run them yet: Edit cabinet/);
    expect(c.notes.join(' ')).not.toMatch(/Cut list/);
    expect(c.notes.join(' ')).toMatch(/taken from the LICENSE file: TomasDJo/);
  });

  it('pins the author\'s own files, not the converted ones', async () => {
    const a = await convertRelease(release(), fake), b = await convertRelease(release(), async () => new Map([['component.js', enc('different')], ['component.core.wasm', wasmBytes]]));
    if ('error' in a || 'error' in b) throw new Error('conversion failed');
    expect(a.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.sourceHash).toBe(b.sourceHash);
    const c = await convertRelease(release({}, { 'woodwork.wasm': new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 1]) }), fake);
    if ('error' in c) throw new Error(c.error);
    expect(c.sourceHash).not.toBe(a.sourceHash);
  });

  it('says what is wrong instead of installing half a plugin', async () => {
    const noWasm = release(); noWasm.delete('woodwork.wasm');
    expect(await convertRelease(noWasm, fake)).toEqual({ error: expect.stringMatching(/woodwork\.wasm.*not in the zip/) });
    expect(await convertRelease(release(), async () => { throw new Error('bad component'); })).toEqual({ error: expect.stringMatching(/bad component/) });
    expect(await convertRelease(release(), async () => new Map())).toEqual({ error: expect.stringMatching(/no component\.js/) });
    const onlyImporter = release({ runtime: { module: 'woodwork.wasm', entries: [{ name: 'convert', kind: 'importer', effect: 'open' }] } });
    expect(await convertRelease(onlyImporter, fake)).toEqual({ error: expect.stringMatching(/no entry this app can run/) });
    expect(await convertRelease(release({ runtime: { module: 'woodwork.wasm', entries: [{ name: 'a', effect: 'edit', input_schema: { properties: { x: { type: 'array' } } } }] } }), fake))
      .toEqual({ error: expect.stringMatching(/no entry this app can run/) });
  });

  it('carries the slots a host can draw (menu and ribbon with a name) into the manifest, and parseManifest accepts them', async () => {
    const entries = [{ name: 'cabinet', effect: 'edit', slots: [{ kind: 'menu', name: 'Cabinet…' }, { kind: 'ribbon', name: 'Model' }, { kind: 'toolbar', name: 'x' }, { kind: 'menu' }], input_schema: { properties: {} } }];
    const c = await convertRelease(release({ runtime: { module: 'woodwork.wasm', entries } }), fake);
    if ('error' in c) throw new Error(c.error);
    const ins = await inspectPackage(c.files);
    expect(ins.errors).toEqual([]);
    expect(ins.manifest!.contributes.generators[0].slots).toEqual([{ kind: 'menu', name: 'Cabinet' }, { kind: 'ribbon', name: 'Model' }]);
  });
  it('carries the file grants a plugin asks for and warns at install that its files come back as downloads', async () => {
    const c = await convertRelease(release({ runtime: { module: 'woodwork.wasm', permissions: { files: [{ name: 'cutlists', read: false, write: true }, { name: 'Bad Name', write: true }] }, entries: [{ name: 'cabinet', effect: 'edit', input_schema: { properties: {} } }] } }), fake);
    if ('error' in c) throw new Error(c.error);
    const ins = await inspectPackage(c.files);
    expect(ins.errors).toEqual([]);
    expect(ins.manifest!.wasm!.files).toEqual([{ name: 'cutlists', write: true }]);
    expect(ins.warnings.join(' ')).toMatch(/can save files \(cutlists\): each file it makes is offered to you as a download/);
  });
  it('leaves out an importer and an entry with a field it cannot draw, and keeps the rest', async () => {
    const entries = [
      { name: 'cabinet', effect: 'edit', slots: [{ name: 'Cabinet' }], input_schema: { properties: { width: { type: 'number', default: 600 } } } },
      { name: 'seat', effect: 'edit', slots: [{ name: 'Seat…' }], input_schema: { required: ['edges'], properties: { edges: { type: 'array', 'x-solidcraft-selection': { version: 1, accept: ['sketch_curve'] } } } } },
      { name: 'rail', effect: 'edit', slots: [{ name: 'Rail' }], input_schema: { properties: { placement: { type: 'array', title: 'Placement', 'x-solidcraft-selection': { version: 1, accept: ['sketch_point'] } } } } },
      { name: 'convert', kind: 'importer', effect: 'open', extensions: ['smp'], input_schema: { properties: {} } },
    ];
    const c = await convertRelease(release({ capabilities: ['commands@0.2'], runtime: { module: 'woodwork.wasm', entries } }), fake);
    if ('error' in c) throw new Error(c.error);
    const m = JSON.parse(new TextDecoder().decode(c.files.get('plugin.json')!));
    expect(m.contributes.generators.map((g: { id: string }) => g.id)).toEqual(['cabinet', 'rail']);   // rail's only parameter is an optional pick this app cannot do: it stays, without that field
    const notes = c.notes.join(' | ');
    expect(notes).toMatch(/Rail, placement: it takes sketch_point, which this app cannot pick yet; it is left out/);
    expect(notes).toMatch(/left out, this app cannot run them yet: convert/);
    expect(notes).toMatch(/left out Seat: .*sketch_curve, which this app cannot pick yet/);
    expect(notes).toMatch(/built for commands@0\.2; this app has only been tested with commands@0\.1/);
  });

  it('when no entry survives, the error says why', async () => {
    const entries = [{ name: 'seat', effect: 'edit', slots: [{ name: 'Seat…' }], input_schema: { required: ['edges'], properties: { edges: { type: 'array', title: 'Edges', 'x-solidcraft-selection': { version: 1, accept: ['sketch_curve'] } } } } }];
    const c = await convertRelease(release({ capabilities: ['commands@0.2'], runtime: { module: 'woodwork.wasm', entries } }), fake);
    expect('error' in c && c.error).toMatch(/^the plugin has no entry this app can run: Seat: parameter "edges": it takes sketch_curve, which this app cannot pick yet$/);
  });

  it('the manager converts in plan() and tells the dialog where the package came from', async () => {
    const mgr = new PluginManager({ registry: new PluginRegistry(), store: memoryStore(), appVersion: '0.8.2', convert: async (f) => (isRelease(f) ? convertRelease(f, fake) : null) });
    const plan = await mgr.plan(release());
    expect(plan.inspection.ok).toBe(true);
    expect(plan.inspection.manifest!.id).toBe('tomasdjo.woodwork');
    expect(plan.inspection.warnings[0]).toMatch(/converted from the author's own release \(sha256 [0-9a-f]{16}…/);
    const bad = release(); bad.delete('woodwork.wasm');
    const refused = await mgr.plan(bad);
    expect(refused.inspection.ok).toBe(false);
    expect(refused.inspection.errors[0]).toMatch(/not in the zip/);
    // a package of ours passes through untouched
    const own = await convertRelease(release(), fake);
    if ('error' in own) throw new Error(own.error);
    expect((await mgr.plan(own.files)).inspection.warnings.some((w) => /converted from/.test(w))).toBe(false);
  });
});

// The real thing: jco's bindgen on the author's own release. Set CK_WOODWORK_RELEASE to the unzipped folder (woodwork.wasm, plugin.json, LICENSE).
const dir = process.env.CK_WOODWORK_RELEASE;
describe.skipIf(!dir || !existsSync(join(dir, 'plugin.json')))('real transpile of the author\'s release', () => {
  it('converts, installs, and is byte for byte what tools/plugin_wasm_pack.mjs makes', async () => {
    const files = new Map<string, Uint8Array>(['plugin.json', 'woodwork.wasm', 'LICENSE'].map((n) => [n, new Uint8Array(readFileSync(join(dir!, n)))]));
    const c = await convertRelease(files, jcoTranspile);
    if ('error' in c) throw new Error(c.error);
    const ins = await inspectPackage(c.files);
    expect(ins.errors).toEqual([]);
    expect(ins.manifest!.contributes.generators.map((g) => g.id)).toEqual(['cabinet', 'corner', 'joinery', 'material', 'cutlist']);
    const sha = (n: string) => createHash('sha256').update(c.files.get(n)!).digest('hex').slice(0, 12);
    expect(sha('component.core.wasm')).toBe('9bc553efcc3c');
    expect(sha('component.js')).toBe('60a43d5fe6c2');
  }, 60000);
});
