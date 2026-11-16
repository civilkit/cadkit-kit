import { describe, expect, it } from 'vitest';
import { RIBBON_LAYOUT, SLOTS, pluginCommandId, withGearIds } from './toolbarModel';
import { buildCommands } from './commands';
import './i18n';

describe('installed generators in the Gear menu', () => {
  it('adds ids to the gear slot only, leaving the shared table untouched', () => {
    const id = pluginCommandId('tomasdjo.woodwork', 'cabinet');
    expect(id).toBe('plugin:tomasdjo.woodwork:cabinet');
    const layout = withGearIds(RIBBON_LAYOUT, [id]);
    const gears = Object.values(layout).flat().flatMap((g) => g.entries).filter((e) => typeof e === 'object' && (e as { slot?: string }).slot === 'gear') as Array<{ ids: string[] }>;
    expect(gears.length).toBeGreaterThan(0);
    for (const g of gears) { expect(g.ids.at(-1)).toBe(id); expect(g.ids.slice(0, -1)).toEqual(SLOTS.gear); }
    expect(SLOTS.gear).not.toContain(id);
    expect(withGearIds(RIBBON_LAYOUT, [])).toBe(RIBBON_LAYOUT);
  });
  it('a generator becomes a command that runs it', () => {
    let ran = 0;
    const cmds = buildCommands({ hasDocument: () => true, layer: () => false, pluginGenerators: [{ id: 'plugin:a.b:c', label: 'Cabinet', tip: 'x', run: () => { ran++; } }] } as never);
    const c = cmds.find((x) => x.id === 'plugin:a.b:c')!;
    expect(c.label).toBe('Cabinet');
    c.run();
    expect(ran).toBe(1);
  });
});
