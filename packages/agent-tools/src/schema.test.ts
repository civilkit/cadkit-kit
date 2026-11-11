import { describe, expect, it } from 'vitest';
import { validate, type Schema } from './schema';

const s: Schema = { type: 'object', properties: { view: { type: 'string' }, size: { type: 'number' } }, additionalProperties: false };

describe('validate: unknown fields', () => {
  it('names the unknown field, the closest allowed one and where parameters go', () => {
    const [msg] = validate(s, { veiw: 'iso' });
    expect(msg).toContain('$.veiw: unknown field');
    expect(msg).toContain('did you mean view?');
    expect(msg).toContain('parameters go at the top level');
  });
  it('gives no suggestion when nothing is close', () => {
    const [msg] = validate(s, { params: {} });
    expect(msg).not.toContain('did you mean');
    expect(msg).toContain('allowed: view, size');
  });
  it('accepts known fields', () => expect(validate(s, { view: 'iso', size: 5 })).toEqual([]));
});
