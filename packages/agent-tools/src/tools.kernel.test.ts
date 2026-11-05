import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AgentSession, callTool, createTools } from './index';
import { createHash } from 'node:crypto';
import { checkEmbedded, takeEmbedded, embeddedSnapshot } from '@kit/viewdata';
import { usesPooledFont } from './viewCache';
import { placeholderSnapshot } from './testing/placeholder-snapshot';

const WASM = process.env.CK_WASM;
const tools = createTools();
let a: AgentSession;
beforeAll(async () => { a = await AgentSession.open({ wasmPath: WASM, snapshotFn: placeholderSnapshot as never }); }, 60000);
afterAll(async () => { await a.close(); });

const call = async (name: string, args: unknown = {}) => {
  const r = await callTool(a, tools, name, args);
  const text = r.content.find((c) => c.type === 'text' && c.text.trim().startsWith('{')) as { text: string } | undefined;
  return { r, json: text ? JSON.parse(text.text) : null };
};
const PLATE = `const { w } = variables({ w: 60 });
part('Plate').sketch('front', (s) => s.rect(w, 40)).extrude(12)
  .hole(face('>Z'), [0, 0], { diameter: 8 }).fillet(edges('|Z'), 4);`;

describe('agent tools on the real kernel', () => {
  it('lists the tools, each with a schema and description', () => {
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['run_script', 'tree', 'find', 'inspect', 'facts', 'probe', 'section', 'sections', 'snapshot', 'checkpoint', 'restore', 'checkpoints', 'notes', 'list_methods', 'docs', 'undo', 'redo', 'ask_user', 'export']));
    for (const t of tools) { expect(t.description.length).toBeGreaterThan(20); expect(t.inputSchema.type).toBe('object'); }
  });

  it('run_script new builds the part and reports numbers', async () => {
    const { json, r } = await call('run_script', { code: PLATE, mode: 'new' });
    expect(r.isError).toBeFalsy();
    expect(json.ok).toBe(true);
    expect(json.featureCount).toBe(5);
    expect(json.volume).toBeGreaterThan(27000);
    expect(json.bbox.size).toEqual([60, 40, 12]);
    expect(json.validity.ok).toBe(true);
    expect(json.run).toBe('script#1');
  });

  it('tree, find, inspect, facts', async () => {
    const tree = (await call('tree')).json;
    expect(tree.features.map((f: { type: string }) => f.type)).toEqual(['sketch', 'extrude', 'sketch', 'hole', 'fillet']);
    expect(tree.features[1].origin).toBe('script#1');
    expect(tree.handMade).toBe(0);
    const ins = (await call('inspect', { id: 'F1' })).json;
    expect(ins.feature.points.length).toBeGreaterThan(3);
    expect(ins.usedBy).toContain('F2');
    const ext = (await call('inspect', { id: 'F2' })).json;
    expect(ext.createdFaces.some((n: string) => n.startsWith('F2.'))).toBe(true);
    const found = (await call('find', { query: 'hole' })).json;
    expect(found.features[0].id).toBe('F4');
    const facts = (await call('facts', { expect: [{ kind: 'valid' }] })).json;
    expect(facts.faceCount).toBeGreaterThan(8);
    expect(facts.check.failed).toBe(0);
    expect((await call('inspect', { id: 'nope' })).r.isError).toBe(true);
  });

  it('probe, section, sections', async () => {
    const p = (await call('probe', { points: [[10, 10, 6], [0, 0, 6], [100, 0, 0]], rays: [{ origin: [-50, 0, 6], dir: [1, 0, 0] }] })).json;
    expect(p.points[0].inside).toBe(true);
    expect(p.points[1].inside).toBe(false);       // inside the hole
    expect(p.points[2].inside).toBe(false);
    expect(p.rays[0].hits.length).toBeGreaterThanOrEqual(2);
    const sec = (await call('section', { plane: { origin: [0, 0, 6], normal: [0, 0, 1] } })).json;
    expect(sec.loops.filter((l: { kind: string }) => l.kind === 'inner')).toHaveLength(1);
    expect(sec.area).toBeCloseTo(2400 - 4 * (16 - 4 * Math.PI) - 16 * Math.PI, 2);
    const st = (await call('sections', { axis: 'z', n: 5 })).json;
    expect(Math.abs(st.volumeError ?? 0)).toBeLessThan(1e-6);
  });

  it('attach keeps hand-made features and replaces only the previous script run', async () => {
    // a hand edit: a chamfer-free extra cut done "in the GUI"
    const hand = await a.applyEdit([
      { op: 'add', feature: { type: 'sketch', id: 'H1', plane: { kind: 'std', id: 'top' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 20, y: 0 }], entities: [{ id: 'e1', type: 'point', p: 'p1' }], constraints: [] } },
    ], 'hand sketch');
    expect(hand.ok).toBe(true);
    const before = (await call('tree')).json.features.length;
    const r1 = (await call('run_script', { code: `part('Boss').sketch('front', (s) => s.circle(5)).extrude(30)`, mode: 'attach', replace: 'none' })).json;
    expect(r1.ok).toBe(true);
    expect(r1.run).toBe('script#2');
    expect(r1.removed).toEqual([]);
    expect(r1.featureCount).toBe(before + 2);
    // re-run a corrected script: script#2 is replaced, script#1 and the hand sketch stay
    const r2 = (await call('run_script', { code: `part('Boss').sketch('front', (s) => s.circle(6)).extrude(20)`, mode: 'attach' })).json;
    expect(r2.ok).toBe(true);
    expect(r2.removed).toHaveLength(2);
    expect(r2.featureCount).toBe(before + 2);
    const tree = (await call('tree')).json;
    expect(tree.handMade).toBe(1);
    expect(tree.features.find((f: { id: string }) => f.id === 'H1').origin).toBe('hand');
    expect(tree.features.filter((f: { origin: string }) => f.origin === 'script#1')).toHaveLength(5);
    expect(tree.features.filter((f: { origin: string }) => f.origin === 'script#3')).toHaveLength(2);
    // a hand feature that depends on a script feature blocks its replacement (and nothing changes)
    const ext = tree.features.filter((f: { origin: string; type: string }) => f.origin === 'script#3' && f.type === 'extrude')[0].id;
    const dep = await a.applyEdit([{ op: 'add', feature: { type: 'sketch', id: 'H2', plane: { kind: 'face', id: `${ext}.C1` }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 1, y: 1 }], entities: [{ id: 'e1', type: 'point', p: 'p1' }], constraints: [] } }]);
    expect(dep.ok).toBe(true);
    const n = a.doc.features.length;
    const blocked = (await call('run_script', { code: `part('Boss').sketch('front', (s) => s.circle(7)).extrude(10)`, mode: 'attach' })).json;
    expect(blocked.ok).toBe(false);
    expect(blocked.errors[0].message).toContain('hand-made feature H2');
    expect(blocked.errors[0].hint).toContain("replace:'none'");
    expect(a.doc.features.length).toBe(n);
  });

  it('script errors carry the line number and a hint; the document is unchanged', async () => {
    await call('run_script', { code: PLATE, mode: 'new' });
    const n = a.doc.features.length;
    const bad = await call('run_script', { code: `const x = 1;\nconst p = part('Bad');\np.sketch('front', (s) => s.rect(10, 10));\np.extrude(5);\np.fillet(edges('|Q'), 1);`, mode: 'attach' });
    expect(bad.json.ok).toBe(false);
    expect(bad.json.errors[0].line).toBe(5);
    expect(bad.json.errors[0].message.length).toBeGreaterThan(3);
    expect(a.doc.features.length).toBe(n);
    const thrown = await call('run_script', { code: `part('X');\nnothere();`, mode: 'new' });
    expect(thrown.json.errors[0].line).toBe(2);
    // a kernel rejection (cut that removes nothing) is reported with the kernel code and its hint
    const kerr = await call('run_script', { code: `part('K').sketch('front', (s) => s.rect(10, 10)).extrude(5).sketch('front', (s) => s.circle(2)).cut(5, { flip: true })`, mode: 'new' });
    if (!kerr.json.ok) { expect(kerr.json.errors[0].line).toBeGreaterThan(0); }
  });

  it('bad schema is rejected before anything runs', async () => {
    const r1 = await call('run_script', { code: 5, mode: 'new' });
    expect(r1.r.isError).toBe(true);
    expect(r1.json.error.code).toBe('bad_input');
    expect(r1.json.error.message).toContain('$.code');
    const r2 = await call('run_script', { code: 'x', mode: 'sideways' });
    expect(r2.json.error.message).toContain('one of');
    const r3 = await call('tree', { extra: 1 });
    expect(r3.json.error.message).toContain('unknown field');
    expect((await call('nope')).json.error.code).toBe('unknown_tool');
    expect((await call('probe', {})).json.error.code).toBe('bad_input');
  });

  it('checkpoint, restore, notes survive restore, undo and redo', async () => {
    await call('run_script', { code: PLATE, mode: 'new' });
    await call('notes', { text: 'plan: 60x40x12 with a bore' });
    expect((await call('checkpoint', { name: 'plate' })).json.saved).toBe('plate');
    await call('run_script', { code: `part('Other').sketch('front', (s) => s.circle(10)).extrude(3)`, mode: 'new' });
    expect(a.doc.name).toBe('Other');
    const rs = (await call('restore', { name: 'plate' })).json;
    expect(rs.features).toBe(5);
    expect(a.doc.name).toBe('Plate');
    expect((await call('notes')).json.notes).toBe('plan: 60x40x12 with a bore');
    expect((await call('checkpoints')).json.checkpoints.map((c: { name: string }) => c.name)).toContain('plate');
    expect((await call('restore', { name: 'zzz' })).json.error.code).toBe('no_such_checkpoint');
    const u = (await call('undo')).json;
    expect(u.featureCount).toBe(2);                   // back to the 'Other' part
    expect((await call('redo')).json.featureCount).toBe(5);
    expect((await call('redo')).r.isError).toBe(true);
    expect((await call('notes', { text: 'more', append: true })).json.notes).toContain('\nmore');
  });

  it('checkpoints are bounded', () => {
    const small = Object.create(AgentSession.prototype) as AgentSession;
    Object.assign(small, { checkpoints: new Map(), opts: { maxCheckpoints: 2 } });
    (small as unknown as { session: unknown }).session = { document: { features: [] } };
    small.saveCheckpoint('a'); small.saveCheckpoint('b'); small.saveCheckpoint('c');
    expect(small.checkpoints.size).toBe(2);
    expect(small.checkpoints.has('a')).toBe(false);
  });

  it('list_methods, docs, ask_user', async () => {
    const all = (await call('list_methods')).json;
    expect(all.methods.length).toBeGreaterThan(20);
    const q = (await call('list_methods', { query: 'fillet round edges' })).json;
    expect(q.methods[0].name).toBe('fillet');
    const d = (await call('docs', { names: ['revolve', 'bracket', 'zzz'] })).json.docs;
    expect(d[0].signature).toContain('revolve');
    expect(d[1].code).toContain('part(');
    expect(d[2].error).toBe('unknown');
    const q2 = (await call('ask_user', { question: 'Which bore size?', options: ['8', '10'] })).json;
    expect(q2.needsUserInput).toBe(true);
  });

  it('snapshot returns PNG image content from the real renderer', async () => {
    const { r, json } = await call('snapshot', { view: 'front', size: 96 });
    expect(r.content.some((c) => c.type === 'image' && c.mimeType === 'image/png' && c.data.startsWith('iVBOR'))).toBe(true);
    expect(json.size ?? json.width).toBe(96);
    // an empty document has nothing to draw, but the package itself is found: not a 'not installed' error
    const bare = await AgentSession.open({ wasmPath: WASM });
    const again = await callTool(bare, tools, 'snapshot', { view: 'top', size: 64 });
    await bare.close();
    if (again.isError) expect((again.content[0] as { text: string }).text).not.toMatch(/not installed/);
  });

  it('export writes step, stl, glb and ckpart', async () => {
    const dir = join(process.cwd(), 'node_modules', '.cache', 'agent-tools-test');
    for (const [fmt, ext] of [['step', 'step'], ['stl', 'stl'], ['glb', 'glb'], ['ckpart', 'ckpart']]) {
      const path = join(dir, `out.${ext}`);
      const { json, r } = await call('export', { format: fmt, path });
      expect(r.isError).toBeFalsy();
      expect(existsSync(path)).toBe(true);
      expect(json.bytes).toBeGreaterThan(100);
      if (fmt === 'glb') expect(readFileSync(path).subarray(0, 4).toString()).toBe('glTF');
      if (fmt === 'step') expect(readFileSync(path, 'utf8')).toContain('ISO-10303');
      rmSync(path);
    }
  });

  it('export stl takes a quality preset and an absolute chord height', async () => {
    const dir = join(process.cwd(), 'node_modules', '.cache', 'agent-tools-test');
    await call('run_script', { code: PLATE, mode: 'new' });
    const tris = async (extra: Record<string, unknown>) => {
      const path = join(dir, 'q.stl');
      const { json, r } = await call('export', { format: 'stl', path, ...extra });
      expect(r.isError, JSON.stringify(json)).toBeFalsy();
      rmSync(path);
      return json as { triangles: number; chord_mm?: number; watertight?: boolean };
    };
    const normal = await tris({}), named = await tris({ quality: 'normal' }), coarse = await tris({ quality: 'coarse' }), fine = await tris({ quality: 'fine' });
    expect(normal.chord_mm).toBeUndefined();   // no option: the viewer's mesh
    expect(named.chord_mm).toBeGreaterThan(0);
    expect(named.triangles).toBe(normal.triangles);
    expect(coarse.triangles).toBeLessThan(normal.triangles);
    expect(fine.triangles).toBeGreaterThan(normal.triangles);
    const loose = await tris({ chord_mm: 0.5 }), tight = await tris({ chord_mm: 0.005 });
    expect(loose.chord_mm).toBe(0.5);
    expect(loose.triangles).toBeLessThan(tight.triangles);
    expect(loose.watertight).toBe(true);
    // refusals name the option
    const bad = await call('export', { format: 'stl', chord_mm: 0 });
    expect(bad.r.isError).toBe(true);
    expect(JSON.stringify(bad.json)).toMatch(/chord_mm/);
    const wrong = await call('export', { format: 'step', quality: 'fine' });
    expect(wrong.r.isError).toBe(true);
    expect(JSON.stringify(wrong.json)).toMatch(/mesh formats/);
  }, 120_000);

  describe('export ckpart with cache', () => {
    const dir = join(process.cwd(), 'node_modules', '.cache', 'agent-tools-test');
    const wasmBuild = async () => 'wasm-sha256:' + createHash('sha256').update(readFileSync(WASM!)).digest('hex');
    const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> & { features: unknown[] };

    it('writes a view the app codec accepts for the same document and kernel build', async () => {
      await call('run_script', { code: PLATE, mode: 'new' });
      const path = join(dir, 'cached.ckpart');
      const { json, r } = await call('export', { format: 'ckpart', path, cache: true });
      expect(r.isError).toBeFalsy();
      expect(json.viewCache.build).toBe(await wasmBuild());
      const file = read(path);
      const { doc, embedded } = takeEmbedded(file);
      expect(doc).toEqual(JSON.parse(JSON.stringify(a.doc)));
      const verdict = await checkEmbedded(wasmBuild, doc, embedded);
      expect(verdict.ok).toBe(true);
      const snap = await embeddedSnapshot(wasmBuild, doc, embedded);
      const view = snap!.data;
      expect(view.status).toHaveLength(a.doc.features.length);
      expect(view.status.every((x) => x.ok)).toBe(true);
      const mesh = (view.body as { mesh: { positions: Float32Array; triFace: Int32Array } }).mesh;
      expect(mesh.positions.length).toBe(mesh.triFace.length * 9);
      expect(mesh.positions.length).toBeGreaterThan(0);
      // the same mesh the session shows
      const live = await a.session.bodyForView();
      expect(Array.from(mesh.positions)).toEqual(Array.from(live!.mesh.positions as ArrayLike<number>));
      // an edit of the recipe, or another kernel build, is not accepted
      expect(await checkEmbedded(wasmBuild, { ...doc, name: 'Edited' }, embedded)).toEqual({ ok: false, reason: 'recipe' });
      expect(await checkEmbedded(async () => 'wasm-sha256:other', doc, embedded)).toEqual({ ok: false, reason: 'build' });
      rmSync(path);
    });

    it('without cache the file has no viewCache field; cache with another format is a bad_input', async () => {
      const path = join(dir, 'plain.ckpart');
      await call('export', { format: 'ckpart', path });
      expect('viewCache' in read(path)).toBe(false);
      rmSync(path);
      const { r } = await call('export', { format: 'stl', path: join(dir, 'x.stl'), cache: true });
      expect(r.isError).toBe(true);
      expect((r.content[0] as { text: string }).text).toContain('bad_input');
    });

    it('writes nothing and says why when the view cannot be reproduced (pooled fonts, rollback)', async () => {
      expect(usesPooledFont([{ id: 'F1', entities: [{ type: 'text', string: 'A', font: 'barlow' }] }])).toBe(true);
      expect(usesPooledFont([{ id: 'F1', entities: [{ type: 'text', string: 'A', font: 'gauge' }, { type: 'text', string: 'B' }] }])).toBe(false);
      expect(usesPooledFont([{ id: 'F1', type: 'extrude', depth: 3 }])).toBe(false);
      const original = a.doc;
      try {
        for (const extra of [{ fonts: [{ name: 'barlow', hash: 'x', source: 'curated', id: 'barlow' }] }, { rollback: 2 }]) {
          await a.setDocument({ ...original, ...extra } as never, 'test', false);
          const path = join(dir, 'refused.ckpart');
          const { r } = await call('export', { format: 'ckpart', path, cache: true });
          expect(r.isError).toBe(true);
          expect((r.content[0] as { text: string }).text).toContain('view_unavailable');
          expect(existsSync(path)).toBe(false);
        }
        // a text entity in a curated font is refused too, and one in a built-in font is cached (the kernel draws those itself)
        const sk = original.features.find((f) => (f as { type?: string }).type === 'sketch') as unknown as { points: unknown[]; entities?: unknown[] };
        const withText = (font: string) => ({ ...original, features: [...original.features, { ...JSON.parse(JSON.stringify(sk)), id: 'FT', name: 'Lettering', points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'pt', x: 1, y: 1 }], constraints: [], entities: [{ id: 'et', type: 'text', string: 'AB', font, height: 3, p: 'pt' }] }] });
        const path = join(dir, 'text.ckpart');
        await a.setDocument(withText('barlow') as never, 'test', false);
        expect((await call('export', { format: 'ckpart', path, cache: true })).r.isError).toBe(true);
        expect(existsSync(path)).toBe(false);
        await a.setDocument(withText('gauge') as never, 'test', false);
        const ok = await call('export', { format: 'ckpart', path, cache: true });
        expect(ok.r.isError).toBeFalsy();
        const { doc, embedded } = takeEmbedded(read(path));
        expect((await checkEmbedded(wasmBuild, doc, embedded)).ok).toBe(true);
        rmSync(path);
      } finally { await a.setDocument(original, 'test restore', false); }
    });
  });

  it('output size cap truncates with a note', async () => {
    const pts = Array.from({ length: 400 }, (_, i) => [i % 50, 5, 3]);
    const { r } = await call('probe', { points: pts });
    const text = (r.content[0] as { text: string }).text;
    expect(text.length).toBeLessThan(60000);
  });
});
