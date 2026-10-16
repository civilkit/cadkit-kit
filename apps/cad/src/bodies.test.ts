import { describe, expect, it } from 'vitest';
import { SelModel } from './select/model';
import { box, meshOf } from './select/fixtures';
import { cleanLook, faceVolumes, hideOthers, keyOf, listBodies, lookFor, originOf, readBodyFields, rowOfName, setHidden, solo, toggleHidden, viewSpec, withLook, withName } from './bodies';

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
  });
  it('merges a patch into the body entry and drops an emptied entry', () => {
    const a = withLook({}, rows[0], { opacity: 0.3 });
    expect(a).toEqual({ [rows[0].key]: { opacity: 0.3 } });
    const b = withLook({ appearance: a }, { key: rows[0].key, look: { opacity: 0.3 } }, { opacity: undefined });
    expect(b).toEqual({});
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
