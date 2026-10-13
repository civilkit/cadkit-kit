/**
 * Sketch chamfer. Same picks as the fillet; the distance field is the length cut from the corner along both
 * lines, and the corner is replaced by a straight line between the two cut points. Refuses with a hint key
 * for parallel lines or a distance that would consume a whole line. Conventions and edit rules: see corner.ts.
 */
import { makeCornerTool } from './corner';
export const chamferTool = makeCornerTool('chamfer');
