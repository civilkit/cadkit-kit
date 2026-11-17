import { describe, expect, it } from 'vitest';
import { friendlyPluginError } from './errors';

const wrap = (e: unknown) => `plugin error: ${JSON.stringify(e)}`;

describe('a plugin failure as a sentence', () => {
  it('invalid input: just the reason, capitalised', () => {
    expect(friendlyPluginError(wrap({ tag: 'invalid-input', val: { field: 'first', reason: 'select two bodies, the first one first, or type both names (0 selected)' } }))).toBe('Select two bodies, the first one first, or type both names (0 selected)');
  });
  it('a failed command names the command and the kernel\'s answer', () => {
    expect(friendlyPluginError(wrap({ tag: 'command-failed', val: { command: 'inspect.measure', reason: 'kernel refused: cutNoEffect' } }))).toBe('Inspect.measure failed: the kernel refused it: cutNoEffect');
  });
  it('limits, permissions, traps and cancel', () => {
    expect(friendlyPluginError(wrap({ tag: 'limit-exceeded', val: 'deadline' }))).toMatch(/over its limit: deadline/);
    expect(friendlyPluginError(wrap({ tag: 'permission-denied', val: 'solid.cut' }))).toMatch(/may not do: solid.cut/);
    expect(friendlyPluginError(wrap({ tag: 'trap', val: 'unreachable' }))).toMatch(/stopped with an error: unreachable/);
    expect(friendlyPluginError(wrap({ tag: 'cancelled' }))).toBe('The plugin run was cancelled.');
  });
  it('anything else is left as it is', () => {
    expect(friendlyPluginError('no such generator')).toBe('no such generator');
    expect(friendlyPluginError('plugin error: {not json}')).toBe('plugin error: {not json}');
    expect(friendlyPluginError(`the deadline passed; ${wrap({ tag: 'invalid-input', val: { reason: 'bad' } })}`)).toBe('Bad');
  });
});
