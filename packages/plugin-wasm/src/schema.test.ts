import { describe, expect, it } from 'vitest';
import { schemaToParams } from './schema';

describe('schemaToParams', () => {
  it('reads a oneOf list of const values as a dropdown, titles as labels', () => {
    const [place, width] = schemaToParams({ properties: { place: { type: 'string', title: 'Place', default: 'origin', oneOf: [{ const: 'origin', title: 'At the origin' }, { const: 'right', title: 'Right of the selected' }] }, width: { type: 'number', default: 600 } } });
    expect(place).toMatchObject({ name: 'place', type: 'enum', default: 'origin', options: [{ value: 'origin', label: 'At the origin' }, { value: 'right', label: 'Right of the selected' }] });
    expect(width.type).toBe('number');
  });
  it('still reads enum', () => {
    const [p] = schemaToParams({ properties: { a: { type: 'string', enum: ['x', 'y'], default: 'x' } } });
    expect(p).toMatchObject({ type: 'enum', options: [{ value: 'x' }, { value: 'y' }] });
  });
  describe('selection fields', () => {
    const sel = (extra: object = {}, accept: string[] = ['body']) => ({ type: 'array', title: 'Body', 'x-solidcraft-selection': { version: 1, accept }, ...extra });
    it('reads x-solidcraft-selection with its counts; required means a pick when minItems says so', () => {
      const [a, b] = schemaToParams({ properties: { body: sel({ minItems: 1, maxItems: 1 }), faces: sel({}, ['face', 'body']) }, required: ['body'] });
      expect(a).toMatchObject({ name: 'body', type: 'selection', title: 'Body', accept: ['body'], minItems: 1, maxItems: 1 });
      expect(a.optional).toBeUndefined();
      expect(b).toMatchObject({ type: 'selection', accept: ['face', 'body'], optional: true });
    });
    it('keeps only what this app can pick, and says so when nothing is left', () => {
      expect(schemaToParams({ properties: { x: sel({}, ['sketch_curve', 'face']) } })[0].accept).toEqual(['face']);
      expect(schemaToParams({ properties: { holes: sel({ minItems: 1 }, ['edge']) }, required: ['holes'] })[0]).toMatchObject({ type: 'selection', accept: ['edge'], minItems: 1 });   // edges are picked in the view
      expect(() => schemaToParams({ properties: { edges: sel({}, ['sketch_curve']) }, required: ['edges'] })).toThrow(/sketch_curve, which this app cannot pick yet/);
      expect(() => schemaToParams({ properties: { p: sel({}, ['profile', 'sketch_point']) }, required: ['p'] })).toThrow(/cannot pick yet/);
      expect(() => schemaToParams({ properties: { p: sel({ minItems: 1 }, ['profile']) } })).toThrow(/cannot pick yet/);   // asking for at least one is as good as required
    });
    it('an optional selection of things this app cannot pick is left out with a note, so the entry still installs', () => {
      const notes: string[] = [];
      const ps = schemaToParams({ properties: { size: { type: 'string', enum: ['a', 'b'] }, placement: { ...sel({ maxItems: 32 }, ['profile', 'sketch_point', 'sketch_curve']), title: 'Placement' } }, required: ['size'] }, notes);
      expect(ps.map((x) => x.name)).toEqual(['size']);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatch(/^Placement: it takes profile, sketch_point, sketch_curve, which this app cannot pick yet; it is left out and the plugin uses its default$/);
    });
    it('knows the reserved lists without the annotation', () => {
      const [bodies, targets] = schemaToParams({ properties: { bodies: { type: 'array', items: { type: 'string' } }, targets: { type: 'array' } } });
      expect(bodies).toMatchObject({ type: 'selection', accept: ['body'], asNames: true });
      expect(targets).toMatchObject({ type: 'selection', accept: ['edge', 'face', 'body'] });
      expect(() => schemaToParams({ properties: { tags: { type: 'array', items: { type: 'string' } } } })).toThrow(/not a selection is not supported/);
    });
    it('refuses what the annotation does not allow', () => {
      expect(() => schemaToParams({ properties: { x: sel({ uniqueItems: true }) } })).toThrow(/"uniqueItems"/);
      expect(() => schemaToParams({ properties: { x: sel({ items: { type: 'object', properties: {} } }) } })).toThrow(/"items"/);
      expect(() => schemaToParams({ properties: { x: { type: 'array', 'x-solidcraft-selection': { version: 2, accept: ['body'] } } } })).toThrow(/exactly/);
      expect(() => schemaToParams({ properties: { x: { type: 'array', 'x-solidcraft-selection': { version: 1, accept: ['body'], more: 1 } } } })).toThrow(/exactly/);
      expect(() => schemaToParams({ properties: { x: { type: 'array', 'x-solidcraft-selection': { version: 1, accept: ['wire'] } } } })).toThrow(/exactly/);
    });
  });
});
