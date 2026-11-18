import { describe, it, expect } from 'vitest';
import { RIBBON_LAYOUT, withPluginSlots, slotGroup, PLUGINS_TAB } from './toolbarModel';

const item = (plugin: string, id: string, ...slots: Array<['menu' | 'ribbon', string]>) => ({ plugin, id, slots: slots.map(([kind, name]) => ({ kind, name })) });

describe('plugin slots', () => {
  it('a ribbon slot named for one of our tabs adds a group named for the plugin there, in any letter case', () => {
    const l = withPluginSlots(RIBBON_LAYOUT, [item('Woodwork', 'plugin:a:cabinet', ['ribbon', 'FEATURES']), item('Woodwork', 'plugin:a:corner', ['ribbon', 'features'])]);
    const g = l.Features.at(-1)!;
    expect(g).toEqual({ id: 'Woodwork', entries: ['plugin:a:cabinet', 'plugin:a:corner'] });
    expect(l.Features.length).toBe(RIBBON_LAYOUT.Features.length + 1);
    expect(RIBBON_LAYOUT.Features.some((x) => x.id === 'Woodwork')).toBe(false);   // the table itself is not changed
  });
  it('SolidCraft\'s tab names land on ours', () => {
    const l = withPluginSlots(RIBBON_LAYOUT, [item('P', 'plugin:p:x', ['ribbon', 'Inspect']), item('P', 'plugin:p:y', ['ribbon', 'Assemble']), item('P', 'plugin:p:z', ['ribbon', 'Model'])]);
    expect(l.Evaluate.at(-1)).toEqual({ id: 'P', entries: ['plugin:p:x'] });
    expect(l.Assembly.at(-1)).toEqual({ id: 'P', entries: ['plugin:p:y'] });
    expect(l.Home.at(-1)).toEqual({ id: 'P', entries: ['plugin:p:z'] });
  });
  it('any other ribbon name gets one Plugins tab with a group per plugin', () => {
    const l = withPluginSlots(RIBBON_LAYOUT, [item('A', 'plugin:a:x', ['ribbon', 'Gears']), item('B', 'plugin:b:y', ['ribbon', 'Whatever']), item('A', 'plugin:a:z', ['ribbon', 'Gears'])]);
    expect(l[PLUGINS_TAB]).toEqual([{ id: 'A', entries: ['plugin:a:x', 'plugin:a:z'] }, { id: 'B', entries: ['plugin:b:y'] }]);
  });
  it('a menu slot, or no slot, places nothing on the ribbon; the layout comes back as it is', () => {
    expect(withPluginSlots(RIBBON_LAYOUT, [item('A', 'plugin:a:x', ['menu', 'File']), item('A', 'plugin:a:y')])).toBe(RIBBON_LAYOUT);
    expect(withPluginSlots(RIBBON_LAYOUT, [])).toBe(RIBBON_LAYOUT);
  });
  it('File and Help menu slots set the palette group; any other menu keeps the Create group', () => {
    expect(slotGroup([{ kind: 'menu', name: 'File' }])).toBe('File');
    expect(slotGroup([{ kind: 'menu', name: ' help ' }])).toBe('Help');
    expect(slotGroup([{ kind: 'menu', name: 'Cabinet' }])).toBe('Create');
    expect(slotGroup([{ kind: 'ribbon', name: 'File' }])).toBe('Create');
    expect(slotGroup(undefined)).toBe('Create');
  });
});
