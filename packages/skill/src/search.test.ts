import { describe, expect, it } from 'vitest';
import { search } from './index';

// natural-language query -> method ids, at least one of which must be in the top 3
const QUERIES: Array<[string, string[]]> = [
  ['make a hole in the top face', ['part.hole']],
  ['round the sharp edges', ['part.fillet']],
  ['hollow out the part', ['part.shell']],
  ['make a bolt circle', ['part.holes.polar']],
  ['break the edge with a bevel', ['part.chamfer']],
  ['cut a pocket into the face', ['part.cut']],
  ['add a boss on top', ['part.extrude']],
  ['spin a profile around an axis', ['part.revolve']],
  ['lathe turned pulley profile', ['part.revolve']],
  ['repeat a feature in a row', ['part.linearPattern']],
  ['array features around a circle', ['part.circularPattern']],
  ['grid of holes', ['part.holes.grid']],
  ['drill holes at listed coordinates', ['part.holes.points']],
  ['rounded corners on a rectangle', ['sketch.rrect']],
  ['draw a circle', ['sketch.circle']],
  ['arc through three points', ['sketch.arc3']],
  ['select the top face', ['face']],
  ['pick the edges parallel to the Z axis', ['edges']],
  ['sketch on a plane offset from the origin', ['at']],
  ['named parameters and dimensions', ['variables']],
  ['link a dimension to a variable', ['expr']],
  ['thin walled tube', ['part.thin', 'part.extrude']],
  ['cut all the way through', ['through', 'part.cut']],
  ['taper the sides with draft', ['part.extrude']],
  ['make the extrusion symmetric about the sketch plane', ['part.extrude']],
  ['drill a blind hole of a given depth', ['part.hole']],
  ['wall thickness open at the top', ['part.shell']],
  ['closed polygon outline L shape', ['sketch.polygon']],
  ['start a new part', ['part']],
  ['chamfer the rim of the bore', ['part.chamfer']],
  ['filet the edges', ['part.fillet']],
  ['extrud the sketch', ['part.extrude']],
  ['drilling a polar array of holes', ['part.holes.polar']],
  ['revolve a profile 360 degrees', ['part.revolve']],
];

describe('method search', () => {
  it(`${QUERIES.length} natural-language queries find their method in the top 3`, () => {
    const misses: string[] = [];
    for (const [q, want] of QUERIES) {
      const top = search(q, { limit: 3 }).methods.map((h) => h.id);
      if (!want.some((w) => top.includes(w))) misses.push(`${q} -> wanted ${want.join('|')}, got ${top.join(', ')}`);
    }
    expect(misses).toEqual([]);
  });
});
