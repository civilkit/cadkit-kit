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
});
