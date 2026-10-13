/**
 * Sketch fillet. Pick two lines that share an end point (or click that corner point), then click, press
 * Enter or commit the radius field to replace the corner with a tangent arc. A radius committed before the
 * picks applies as soon as the corner is complete and is kept as a `radius` constraint on the arc; an
 * uncommitted radius only previews. The arc is `{c,p1,p2}` counter-clockwise p1 -> p2, with `tangent`
 * constraints to both lines. Refuses with a hint key for parallel lines or a radius larger than the shorter
 * line allows. Conventions and edit rules: see corner.ts.
 */
import { makeCornerTool } from './corner';
export const filletTool = makeCornerTool('fillet');
