import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { defaultShapeIds, regionsFor, sketchShapes } from '../shapes';
import { ringPetals } from './petals-fixture';
import { closeSessions, sessions } from './kernel-fixtures';

afterEach(closeSessions);

// A ring of radius 20 with six stadium petals out to 30 whose ends sit on it, an outer circle of radius 40 and a hole of radius 4.
const sketch = { id: 'F1', type: 'sketch', plane: { kind: 'std', id: 'top' }, ...ringPetals(), constraints: [] };
const DEPTH = 5;

async function area(regions: string[] | null): Promise<number> {
  const doc = { ...emptyPart('Ring petals'), features: [sketch, { type: 'extrude', op: 'add', sketch: 'F1', end: 'blind', depth: DEPTH, id: 'F2', ...(regions ? { regions } : {}) }], seq: 9 } as unknown as PartDoc;
  const s = await Session.open(doc);
  sessions.push(s);
  const r = await s.preview([], { sketchStatus: true });
  expect(r.errors).toEqual([]);
  return (await s.facts()).volume! / DEPTH;
}

describe('the Shapes ticks of a ring with petals mean what the kernel extrudes', { skip: !process.env.CK_WASM }, () => {
  const near = (got: number, want: number) => expect(Math.abs(got - want) / want).toBeLessThan(0.002);
  it('default ticks = no regions; every box = the whole disc; all but the hole = the disc less the hole', async () => {
    const shapes = sketchShapes(sketch as never);
    const all = shapes.map((x) => x.id);
    const defaults = defaultShapeIds(shapes);
    const sent = (ticked: string[]) => regionsFor(shapes, new Set(ticked), defaults);
    // the default ticks send nothing, and the kernel's default is exactly those shapes (even-odd: the band outside the flower, plus the hole's disc)
    expect(sent(defaults)).toBeNull();
    const byDefault = await area(null);
    near(await area(defaults), byDefault);
    // every box ticked: listed, the hole is filled
    near(await area(sent(all)), Math.PI * 40 ** 2);
    // every box but the hole: the hole stays open
    near(await area(sent(all.filter((x) => x !== 'hole'))), Math.PI * (40 ** 2 - 4 ** 2));
  }, 240000);
});
