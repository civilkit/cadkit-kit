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
      expect(schemaToParams({ properties: { x: sel({}, ['edge', 'face']) } })[0].accept).toEqual(['face']);
      expect(() => schemaToParams({ properties: { edges: sel({}, ['edge']) } })).toThrow(/edge, which this app cannot pick yet/);
      expect(() => schemaToParams({ properties: { p: sel({}, ['profile', 'sketch_point']) } })).toThrow(/cannot pick yet/);
    });
    it('knows the reserved lists without the annotation', () => {
      const [bodies, targets] = schemaToParams({ properties: { bodies: { type: 'array', items: { type: 'string' } }, targets: { type: 'array' } } });
      expect(bodies).toMatchObject({ type: 'selection', accept: ['body'], asNames: true });
      expect(targets).toMatchObject({ type: 'selection', accept: ['face', 'body'] });
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
