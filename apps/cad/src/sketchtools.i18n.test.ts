import { describe, expect, it } from 'vitest';
import { sketchTools } from '@kit/sketch';
import { en } from './locales/en';

// Every tool in the strip has its name, and every group its heading, in the English catalogue.
describe('sketch tool text', () => {
  it('names every registered tool and group', () => {
    const keys = new Set(Object.keys(en));
    const missing = [
      ...sketchTools().map((t) => `app.sketch.tool.${t.id}`),
      ...['draw', 'dimension', 'constrain', 'edit'].map((g) => `app.sketch.group.${g}`),
    ].filter((k) => !keys.has(k));
    expect(missing).toEqual([]);
  });

  it('has the prompts of every constraint tool (shown in the status bar while picking)', () => {
    const keys = new Set(Object.keys(en));
    const kinds = ['horizontal', 'vertical', 'coincident', 'equal', 'parallel', 'perpendicular', 'collinear', 'midpoint', 'tangent', 'symmetric', 'fix', 'concentric'];
    // a tool asks `.pick` before the first click and `.more` after it; a one-click tool (fix) never asks `.more` after a pick but may on Escape
    const missing = kinds.flatMap((k) => [`app.sketch.hint.${k}.pick`, `app.sketch.hint.${k}.more`]).filter((k) => !keys.has(k));
    expect(missing).toEqual([]);
  });
});
