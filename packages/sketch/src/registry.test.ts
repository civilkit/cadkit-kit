import { describe, expect, it } from 'vitest';
import { sketchTools, toolById } from './registry';

describe('sketch tool registry', () => {
  it('lists every tool once, with a unique id and shortcut', () => {
    const ids = sketchTools().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = sketchTools().flatMap((t) => (t.key ? [t.key] : []));
    expect(new Set(keys).size).toBe(keys.length);
    expect(ids.length).toBeGreaterThanOrEqual(30);
  });
  it('every tool starts and steps without a document', () => {
    for (const t of sketchTools()) {
      const s = t.tool.start();
      const out = t.tool.step(s, { type: 'key', key: 'Escape' }, { id: 'F1', plane: {}, points: [], entities: [], constraints: [], temp: [] }, { autoConstraints: true, arcSwitch: 'hover', onViewValues: 'dimensions' });
      expect(out.draft.entities).toEqual([]);
    }
  });
  it('finds a tool by id', () => {
    expect(toolById('line')?.group).toBe('draw');
    expect(toolById('nope')).toBeUndefined();
  });
});
