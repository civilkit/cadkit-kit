// The faceted method of knurl(): one `knurlBand` feature, the diamond or pyramid surface built directly as faces by the kernel and cut in a single
// boolean (docs/knurl-band.md in the kernel). Kept apart from knurl.ts, which validates the options and calls this.
import type { PartBuilder } from '../recorder';

/** The checked numbers of a faceted knurl (all plain numbers: knurl() has resolved variables). */
export interface FacetedKnurl {
  axis: 'x' | 'y' | 'z';
  center: [number, number];
  radius: number;
  from: number;
  to: number;
  pattern: 'diamond' | 'pyramid';
  count: number;
  depth: number;
  /** included angle of the V in degrees */
  angle: number;
  helixAngle?: number;
  ringPitch?: number;
}

/** Record the knurlBand feature as one step. */
export function facetedKnurl(part: PartBuilder, line: number, k: FacetedKnurl): PartBuilder {
  part.steps.push({ line, label: 'knurl', run: (ctx) => {
    const id = ctx.nextId();
    const f: Record<string, unknown> = {
      type: 'knurlBand', id, axis: k.axis, center: k.center, radius: k.radius, from: k.from, to: k.to,
      pattern: k.pattern, count: k.count, depth: k.depth, angle: k.angle,
    };
    if (k.pattern === 'diamond') f.helixAngle = k.helixAngle;
    else f.ringPitch = k.ringPitch;
    ctx.lastFeature = id; ctx.lastSketch = null;
    return [{ op: 'add', feature: f }];
  } });
  return part;
}

/** Why the faceted method cannot build these options, or null. */
export function facetedRefusal(pattern: string, profile: string): string | null {
  if (pattern === 'straight') return `method 'faceted' is for diamond and pyramid; straight grooves are one cut already`;
  if (profile !== 'v') return `method 'faceted' builds V grooves only; use method: 'boolean' for round grooves`;
  return null;
}
