import { describe, expect, it } from 'vitest';
import type { PartDoc } from '@ck/part-model';
import { applyConfig, configOf, firstProblem, freshName, matchesConfig, renameIn, renamePatch, usesOf } from './variables';
import { patched } from './docFields';
import { setConstraintValue, annotate, type SketchDraft } from '@kit/sketch';

const doc = {
  format: 'ck-part', version: 1, name: 'P', seq: 4, rollback: null, material: 'steel', counters: {},
  variables: [{ name: 'w', expr: '40' }, { name: 'half', expr: 'w/2' }, { name: 'wide', expr: 'w2+1' }, { name: 'w2', expr: '3' }],
  features: [
    { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [{ id: 'c1', type: 'distance', refs: ['a', 'b'], value: 40, expr: 'w' }] },
    { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: '=w*2+w2', radii: ['=w', 3] },
  ],
} as unknown as PartDoc;

describe('renaming', () => {
  it('replaces whole names only', () => {
    expect(renameIn('w*2+w2+Tw+1e3', 'w', 'x')).toBe('x*2+w2+Tw+1e3');
    expect(renameIn('w/w', 'w', 'width')).toBe('width/width');
  });
  it('rewrites variables, configurations and every expression in the features', () => {
    const d = { ...doc, configurations: [{ name: 'A', values: { w: '10', half: 'w/2' } }] } as unknown as PartDoc;
    const p = renamePatch(d, 'w', 'width');
    expect(p.variables.map((v) => [v.name, v.expr])).toEqual([['width', '40'], ['half', 'width/2'], ['wide', 'w2+1'], ['w2', '3']]);
    expect(p.configurations[0].values).toEqual({ width: '10', half: 'width/2' });
    expect(Object.keys(p.features)).toEqual(['F1', 'F2']);
    expect((p.features.F2 as { depth: string; radii: unknown[] }).depth).toBe('=width*2+w2');
    expect((p.features.F2 as { radii: unknown[] }).radii).toEqual(['=width', 3]);
    expect((p.features.F1 as { constraints: Array<{ expr: string }> }).constraints[0].expr).toBe('width');
  });
  it('the original document is not touched', () => {
    renamePatch(doc, 'w', 'width');
    expect((doc.features[1] as unknown as { depth: string }).depth).toBe('=w*2+w2');
  });
});

describe('uses', () => {
  it('lists the fields, dimensions and variables that use a name', () => {
    expect(usesOf(doc, 'w')).toEqual(['F1.constraints.0.expr', 'F2.depth', 'F2.radii.0', 'half']);
    expect(usesOf(doc, 'w2')).toEqual(['F2.depth', 'wide']);
    expect(usesOf(doc, 'nothing')).toEqual([]);
  });
});

describe('checking and configurations', () => {
  it('finds the first problem of a list', () => {
    expect(firstProblem([{ name: 'a', expr: '1' }, { name: 'b', expr: 'a+1' }])).toBeNull();
    expect(firstProblem([{ name: 'a', expr: '1' }, { name: 'a', expr: '2' }])).toMatchObject({ code: 'duplicateName', at: 1 });
    expect(firstProblem([{ name: 'a b', expr: '1' }])).toMatchObject({ code: 'badName' });
    expect(firstProblem([{ name: 'a', expr: 'b' }, { name: 'b', expr: 'a' }])).toMatchObject({ code: 'cyclicVariables', name: 'a' });
    expect(firstProblem([{ name: 'a', expr: '1+' }])).toMatchObject({ code: 'badExpression' });
  });
  it('fresh names skip taken ones', () => { expect(freshName([{ name: 'var1', expr: '1' }])).toBe('var2'); });
  it('a configuration applies its expressions and knows when the variables drifted', () => {
    const vars = [{ name: 'w', expr: '40' }, { name: 't', expr: '5' }];
    const small = { name: 'Small', values: { w: '20' } };
    expect(applyConfig(vars, small)).toEqual([{ name: 'w', expr: '20' }, { name: 't', expr: '5' }]);
    expect(matchesConfig(applyConfig(vars, small), small)).toBe(true);
    expect(matchesConfig(vars, small)).toBe(false);
    expect(configOf(vars, 'Now')).toEqual({ name: 'Now', values: { w: '40', t: '5' } });
  });
});

describe('document patch', () => {
  it('sets and clears the fields, keeps the rest', () => {
    const a = patched(doc, { configurations: [{ name: 'A', values: {} }], activeConfig: 'A' }) as unknown as Record<string, unknown>;
    expect(a.activeConfig).toBe('A');
    expect(a.variables).toEqual((doc as unknown as { variables: unknown[] }).variables);
    const b = patched(a as unknown as PartDoc, { variables: [], configurations: [], activeConfig: null }) as unknown as Record<string, unknown>;
    expect('variables' in b || 'configurations' in b || 'activeConfig' in b).toBe(false);
  });
});

describe('sketch dimension expressions', () => {
  const draft = {
    id: 'F1', plane: {}, points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 40, y: 0 }], entities: [], temp: [],
    constraints: [{ id: 'c1', type: 'distance', refs: ['a', 'b'], value: 40 }],
  } as unknown as SketchDraft;
  it('an expression is kept on the constraint; a plain number unlinks it', () => {
    const linked = setConstraintValue(draft, 'c1', 63, '=w*2+3')!;
    expect(linked.constraints[0]).toMatchObject({ value: 63, expr: 'w*2+3' });
    expect(annotate(linked)[0]).toMatchObject({ value: 63, expr: 'w*2+3' });
    const plain = setConstraintValue(linked, 'c1', 50)!;
    expect(plain.constraints[0]).toEqual({ id: 'c1', type: 'distance', refs: ['a', 'b'], value: 50 });
  });
});
