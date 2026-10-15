import { describe, it, expect } from 'vitest';
import { hasIcon } from '@kit/ui';
import { buildCommands, type Actions } from './commands';

/** An Actions object whose every member (nested too) exists, so buildCommands emits every optional command. */
export const fullActions = (): Actions => {
  const deep = (): unknown => new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : deep()), apply: () => deep() });
  return deep() as Actions;
};

describe('icon audit', () => {
  const cmds = buildCommands(fullActions());
  it('collects the whole command table (guard against the stub silently dropping commands)', () => {
    expect(cmds.length).toBeGreaterThan(110);
    for (const id of ['add-extrude', 'add-gear', 'add-loft', 'measure', 'mate', 'style-shaded', 'export-stl', 'select-all', 'triball']) expect(cmds.some((c) => c.id === id), id).toBe(true);
  });
  it('every command has an icon in packages/ui/src/icons.tsx', () => {
    expect(cmds.filter((c) => !hasIcon(c.id)).map((c) => c.id)).toEqual([]);
  });
  it('every command has a label', () => {
    expect(cmds.filter((c) => !c.label.trim()).map((c) => c.id)).toEqual([]);
  });
});
