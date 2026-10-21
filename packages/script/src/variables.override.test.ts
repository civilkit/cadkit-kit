import { describe, expect, it } from 'vitest';
import { evaluate } from './run';

const code = "const { d, t } = variables({ d: 74, t: 'd/10' }); part('P').sketch('front', (s) => s.rect(d, t));";

describe('variables overrides', () => {
  it('use the values written in the script by default', () => {
    const { state, errors } = evaluate(code);
    expect(errors).toEqual([]);
    expect(state.vars).toMatchObject({ d: 74, t: 7.4 });
    expect(state.varDefs).toEqual([{ name: 'd', expr: '74' }, { name: 't', expr: 'd/10' }]);
  });
  it('an override replaces the default, and expressions that use it follow', () => {
    const { state, errors } = evaluate(code, { d: '80' });
    expect(errors).toEqual([]);
    expect(state.vars).toMatchObject({ d: 80, t: 8 });
    expect(state.varDefs[0]).toEqual({ name: 'd', expr: '80' });
  });
  it('an override of an expression variable wins over its default expression', () => {
    const { state } = evaluate(code, { t: '3' });
    expect(state.vars).toMatchObject({ d: 74, t: 3 });
  });
});
