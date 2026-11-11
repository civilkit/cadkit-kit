import { describe, expect, it } from 'vitest';
import { SelModel } from './select/model';
import { box, meshOf } from './select/fixtures';
import { cleanLook, faceVolumes, hideOthers, keyOf, listBodies, lookFor, originOf, readBodyFields, rowOfName, setHidden, solo, toggleHidden, viewSpec, withLook, withLooks, withName, visibleMesh, splitBodies } from './bodies';
import { exportStl } from './exportFiles';

// two separate boxes: F1 (10 x 10 x 10 at the origin) and F5 (20 x 5 x 5 apart from it)
const model = (): SelModel => {
  const a = box('F1.', [0, 0, 0], [10, 10, 10]), b = box('F5.', [50, 0, 0], [20, 5, 5]);
  return new SelModel({ mesh: meshOf([...a.quads, ...b.quads]), edges: [...a.edges, ...b.edges] });
};

describe('body keys', () => {
  it('a body is keyed by its lowest face name and owned by the lowest feature number among its faces', () => {
    expect(keyOf(['F5.+x', 'F5.-x', 'F12.a'])).toBe('@body:F12.a');   // plain string order
    expect(originOf(['F12.a', 'F5.+x', 'F9.b'])).toBe('F5');           // numeric order for the owner
    expect(originOf(['x', 'y'])).toBeNull();
  });
  it('lists the lumps ordered by creating feature with default names, volumes and the hidden flag', () => {
    const rows = listBodies(model().bodies(), { view: { hiddenBodies: ['@body:F5.+x'] } }, { volumes: faceVolumes(model().data.mesh) });
    expect(rows.map((r) => [r.name, r.origin, r.hidden])).toEqual([['Body 1', 'F1', false], ['Body 2', 'F5', true]]);
    expect(rows[0].volume).toBeCloseTo(1000, 3);
    expect(rows[1].volume).toBeCloseTo(500, 3);
  });
  it('the feature name is the default body name; a stored name wins; several bodies of one feature are numbered', () => {
    const m = model();
    const r1 = listBodies(m.bodies(), {}, { featureName: (id) => (id === 'F5' ? 'Tach lens' : null) });
    expect(r1.map((r) => r.name)).toEqual(['Body 1', 'Tach lens']);
    const r2 = listBodies(m.bodies(), { bodyNames: { '@body:F5.+x': 'Lens', F1: 'Plate' } }, {});
    expect(r2.map((r) => r.name)).toEqual(['Plate', 'Lens']);
  });
  it('a script entry keyed by a feature covers every body that feature created; a body entry overrides it field by field', () => {
    const f = { appearance: { F1: { color: '#112233', opacity: 0.5, finish: 'glass' as const }, '@body:F1.+x': { color: '#ffffff' } } };
    const r = listBodies(model().bodies(), f, {});
    expect(r[0].look).toEqual({ color: '#ffffff', opacity: 0.5, finish: 'glass' });
    expect(r[1].look).toEqual({});
  });
  it('keeps the same key and look when an unrelated feature changes the other body', () => {
    const before = listBodies(model().bodies(), { appearance: { '@body:F5.+x': { opacity: 0.2 } } }, {});
    // F5 is rebuilt bigger and a new F9 body appears: F1 keeps its key, F5 keeps its face names so its look stays
    const a = box('F1.', [0, 0, 0], [10, 10, 10]), b = box('F5.', [50, 0, 0], [40, 9, 9]), c = box('F9.', [0, 50, 0], [3, 3, 3]);
    const after = listBodies(new SelModel({ mesh: meshOf([...a.quads, ...b.quads, ...c.quads]), edges: [...a.edges, ...b.edges, ...c.edges] }).bodies(), { appearance: { '@body:F5.+x': { opacity: 0.2 } } }, {});
    expect(after.map((r) => r.key)).toEqual([before[0].key, before[1].key, '@body:F9.+x']);
    expect(after[1].look).toEqual({ opacity: 0.2 });
    expect(after[0].look).toEqual({});
  });
});

describe('look edits', () => {
  const rows = listBodies(model().bodies(), {}, {});
  it('cleans a look: hex colour, opacity 0.05 to 1, known finish; British spelling accepted', () => {
    expect(cleanLook({ colour: '#ABCDEF', opacity: 0, finish: 'chrome' })).toEqual({ color: '#abcdef', opacity: 0.05, finish: 'chrome' });
    expect(cleanLook({ color: 'red', opacity: 9, finish: 'wood' })).toEqual({ opacity: 1 });
    expect(cleanLook({ clearcoat: 3, texture: { source: 'polyhaven', id: 'oak_plank', scale: 9e9, relief: -1, junk: 1 } })).toEqual({ clearcoat: 1, texture: { source: 'polyhaven', id: 'oak_plank', scale: 5000, relief: 0 } });
    expect(cleanLook({ clearcoat: 0, texture: { source: 'polyhaven', id: '../x' } })).toEqual({});
    expect(cleanLook({ texture: { source: 'other', id: 'x' } })).toEqual({});
  });
  it('a clear coat and a texture are saved in the body entry and removed with undefined, and reach the view spec', () => {
    const tex = { source: 'polyhaven' as const, id: 'oak_plank', name: 'Oak Plank' };
    const a = withLook({}, rows[0], { clearcoat: 0.6, texture: tex });
    expect(a[rows[0].key]).toEqual({ clearcoat: 0.6, texture: tex });
    const r0 = { ...rows[0], look: a[rows[0].key] };
    expect(viewSpec([r0]).looks[rows[0].key]).toEqual({ clearcoat: 0.6, texture: tex });
    expect(withLook({ appearance: a }, r0, { clearcoat: undefined, texture: undefined })).toEqual({});
  });
  it('merges a patch into the body entry and drops an emptied entry', () => {
    const a = withLook({}, rows[0], { opacity: 0.3 });
    expect(a).toEqual({ [rows[0].key]: { opacity: 0.3 } });
    const b = withLook({ appearance: a }, { key: rows[0].key, look: { opacity: 0.3 } }, { opacity: undefined });
    expect(b).toEqual({});
  });
  it('applies one patch to several bodies, each keeping the rest of its own look', () => {
    const next = withLooks({ appearance: { [rows[0].key]: { color: '#101010' } } }, [{ key: rows[0].key, look: { color: '#101010' } }, { key: rows[1].key, look: {} }], { opacity: 0.5 });
    expect(next).toEqual({ [rows[0].key]: { color: '#101010', opacity: 0.5 }, [rows[1].key]: { opacity: 0.5 } });
  });
  it('editing a body that takes its look from a feature entry writes its own entry and leaves the feature entry alone', () => {
    const f = { appearance: { F1: { color: '#101010' } } };
    const row = listBodies(model().bodies(), f, {})[0];
    const next = withLook(f, row, { opacity: 0.4 });
    expect(next.F1).toEqual({ color: '#101010' });
    expect(next[row.key]).toEqual({ color: '#101010', opacity: 0.4 });
    expect(lookFor({ appearance: next }, row.key, 'F1')).toEqual({ color: '#101010', opacity: 0.4 });
  });
  it('renames and clears a name', () => {
    const n = withName({}, '@body:a', '  Lens ');
    expect(n).toEqual({ '@body:a': 'Lens' });
    expect(withName({ bodyNames: n }, '@body:a', ' ')).toEqual({});
  });
});

describe('visibility', () => {
  const rows = listBodies(model().bodies(), {}, {});
  it('toggles, hides and shows one body', () => {
    expect(toggleHidden({}, 'k')).toEqual(['k']);
    expect(toggleHidden({ view: { hiddenBodies: ['k'] } }, 'k')).toEqual([]);
    expect(setHidden({ view: { hiddenBodies: ['k'] } }, 'k', true)).toEqual(['k']);
  });
  it('solo hides every other body; soloing the only visible body shows all; hide others keeps the selection', () => {
    expect(solo(rows, rows[0].key)).toEqual([rows[1].key]);
    const only = listBodies(model().bodies(), { view: { hiddenBodies: [rows[1].key] } }, {});
    expect(solo(only, rows[0].key)).toEqual([]);
    expect(hideOthers(rows, [rows[1].key])).toEqual([rows[0].key]);
  });
  it('gives the viewport the bodies, the looks that exist and the hidden keys', () => {
    const r = listBodies(model().bodies(), { appearance: { F5: { opacity: 0.2 } }, view: { hiddenBodies: ['@body:F1.+x'] } }, {});
    const v = viewSpec(r);
    expect(v.bodies.map((b) => b.key)).toEqual(['@body:F1.+x', '@body:F5.+x']);
    expect(v.looks).toEqual({ '@body:F5.+x': { opacity: 0.2 } });
    expect(v.hidden).toEqual(['@body:F1.+x']);
  });
  it('finds the row of a face, an edge or a body name', () => {
    expect(rowOfName(rows, 'F5.+z')?.key).toBe(rows[1].key);
    expect(rowOfName(rows, rows[0].key)?.key).toBe(rows[0].key);
    expect(rowOfName(rows, 'nope')).toBeUndefined();
  });
  it('reads the document fields defensively', () => {
    expect(readBodyFields({ appearance: { a: { color: 'zzz' }, b: { opacity: 0.5 } }, bodyNames: { a: '', b: 'B' }, view: { hiddenBodies: ['x', 3] } }))
      .toEqual({ appearance: { b: { opacity: 0.5 } }, bodyNames: { b: 'B' }, view: { hiddenBodies: ['x'] } });
    expect(readBodyFields(null)).toEqual({});
  });
});

import { bodyKey as snapKey, bodyOrigin as snapOrigin, faceLooks as snapLooks } from '@kit/snapshot';
describe('the app and the snapshot renderer agree on keys', () => {
  it('same body key, same origin feature, same resolved looks', () => {
    const m = model();
    const fields = { appearance: { F1: { color: '#101010' }, '@body:F5.+x': { opacity: 0.3, finish: 'glass' as const } } };
    const rows = listBodies(m.bodies(), fields, {});
    expect(rows.map((r) => snapKey(r.faces))).toEqual(rows.map((r) => r.key));
    expect(rows.map((r) => snapOrigin(r.faces))).toEqual(rows.map((r) => r.origin));
    const edges = m.data.edges.map((e) => ({ faces: e.faces }));
    const { looks } = snapLooks(m.data.mesh as never, edges, fields);
    for (const r of rows) for (const f of r.faces) expect(looks.get(f) ?? {}).toEqual(r.look);
  });
});

describe('metallic and roughness of a body, and bodies hidden by their feature', () => {
  it('cleanLook keeps metallic and roughness in 0..1', () => {
    expect(cleanLook({ color: '#112233', metallic: 2, roughness: 0.3 })).toEqual({ color: '#112233', metallic: 1, roughness: 0.3 });
    expect(cleanLook({ metallic: 'x' })).toEqual({});
  });
  it('a feature id in hiddenBodies hides every body that feature made, and showing one keeps its siblings hidden', () => {
    const bodies = [{ faces: ['F3.S1'], edges: [], surface: false }, { faces: ['F3.S9'], edges: [], surface: false }, { faces: ['F4.S1'], edges: [], surface: false }] as never;
    const fields = { view: { hiddenBodies: ['F3'] } };
    const rows = listBodies(bodies, fields);
    expect(rows.map((r) => r.hidden)).toEqual([true, true, false]);
    const next = setHidden(fields, rows[0].key, false, rows);
    expect(next).toEqual([rows[1].key]);
    expect(listBodies(bodies, { view: { hiddenBodies: next } }).map((r) => r.hidden)).toEqual([false, true, false]);
  });
});

describe('bodies of the components of an assembly', () => {
  it('a face of an inserted part has the origin feature@insert, not the root feature of the same number', () => {
    expect(originOf(['F2.S.e12@F6.1', 'F7.S.e1@F6.1'])).toBe('F2@F6');
    expect(originOf(['F2.S.e1', 'F2.S.e1@F6.1'])).toBe('F2');
    expect(originOf(['F9.S1@F30.1', 'F2.S1@F31.1'])).toBe('F9@F30');   // components sort by their insert
  });
  it('a look keyed feature@insert colours that component body only, and the row is named after the insert', () => {
    const bodies = [{ faces: ['F2.S1'], edges: [], surface: false }, { faces: ['F2.S1@F6.1'], edges: [], surface: false }] as never;
    const rows = listBodies(bodies, { appearance: { 'F2@F6': { color: '#ff0000', metallic: 0.5 } } }, { featureName: (id) => (id === 'F6' ? 'Wheel' : id === 'F2' ? 'Plate' : null) });
    expect(rows.map((r) => [r.name, r.look.color])).toEqual([['Plate', undefined], ['Wheel', '#ff0000']]);
  });
});

describe('visibleMesh (export only visible bodies)', () => {
  // two single-triangle faces, F1.a and F2.a, one per body
  const mesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0], triFace: [0, 1], faceIds: ['F1.a', 'F2.a'] };
  const rows = (hideSecond: boolean) => [{ hidden: false, faces: ['F1.a'] }, { hidden: hideSecond, faces: ['F2.a'] }];
  it('is the mesh itself when nothing is hidden or it carries no face ids', () => {
    expect(visibleMesh(mesh, rows(false))).toBe(mesh);
    const bare = { positions: mesh.positions };
    expect(visibleMesh(bare, rows(true))).toBe(bare);
    expect(visibleMesh(null, rows(true))).toBeNull();
  });
  it('drops the triangles of hidden bodies, so the exported file has only the visible ones', () => {
    const v = visibleMesh(mesh, rows(true))!;
    expect(Array.from(v.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const r = exportStl(v, 'P');
    expect(r.notices.find((n) => n.key === 'io.done')?.params?.triangles).toBe(1);
  });
  it('is null when every body is hidden', () => {
    expect(visibleMesh(mesh, [{ hidden: true, faces: ['F1.a'] }, { hidden: true, faces: ['F2.a'] }])).toBeNull();
  });
});

describe('splitBodies (3MF and GLB: one object per body)', () => {
  const mesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0, 9, 0, 0, 10, 0, 0, 9, 1, 0], triFace: [0, 1, 2], faceIds: ['F1.a', 'F2.a', 'F9.a'] };
  const rows = [
    { name: 'Plate', hidden: false, faces: ['F1.a'], look: { color: '#ff0000', opacity: 0.5, metallic: 1 } },
    { name: 'Lens', hidden: true, faces: ['F2.a'], look: {} },
  ];
  it('splits by body with names and looks; triangles of no body go to the fallback body', () => {
    const b = splitBodies(mesh, rows, 'Part', false);
    expect(b.map((x) => x.name)).toEqual(['Plate', 'Lens', 'Part']);
    expect(b[0]).toMatchObject({ color: '#ff0000', opacity: 0.5, metallic: 1 });
    expect(Array.from(b[1].positions)).toEqual([5, 0, 0, 6, 0, 0, 5, 1, 0]);
    expect(b[1].color).toBeUndefined();
    expect(b.reduce((s, x) => s + x.positions.length, 0)).toBe(27);
  });
  it('leaves hidden bodies out when asked', () => {
    expect(splitBodies(mesh, rows, 'Part', true).map((x) => x.name)).toEqual(['Plate', 'Part']);
  });
  it('is one body when the mesh has no face ids or there are no rows; nothing for no mesh', () => {
    expect(splitBodies({ positions: mesh.positions }, rows, 'Part', true).map((x) => x.name)).toEqual(['Part']);
    expect(splitBodies(mesh, [], 'Part', true)).toHaveLength(1);
    expect(splitBodies(null, rows, 'Part', true)).toEqual([]);
  });
  it('carries per-corner normals along', () => {
    const normals = mesh.positions.map((_, i) => (i % 3 === 2 ? 1 : 0));
    const b = splitBodies({ ...mesh, normals }, rows, 'Part', false);
    expect(b[0].normals).toHaveLength(9);
    expect(Array.from(b[0].normals!).slice(0, 3)).toEqual([0, 0, 1]);
  });
});
