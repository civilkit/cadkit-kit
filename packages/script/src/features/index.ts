// Feature mixins: PartBuilder / SketchBuilder methods that live outside recorder.ts (so concurrent work on recorder.ts does not collide).
// recorder.ts calls installFeatures() once; packages/skill/tools/generate.mjs reads `partFeatures` and `sketchFeatures` here for the registry.
import type { PartBuilder, SketchBuilder } from '../recorder';
import { bindHelpers, type Helpers } from './h';
import { bearingFeatures } from './bearing';
import { knurlFeatures } from './knurl';
import { miscFeatures } from './misc';
import { screwFeatures } from './screw';
import { washerFeatures } from './washer';
import { sheetFeatures } from './sheet';
import { shapeFeatures } from './shapes';
import { sketchCurves } from './sketchCurves';
import { sketchOffset } from './sketchOffset';
import { sketchPattern } from './sketchPattern';

export const partFeatures = { ...shapeFeatures, ...miscFeatures, ...knurlFeatures, ...screwFeatures, ...washerFeatures, ...bearingFeatures, ...sheetFeatures };
export const sketchFeatures = { ...sketchCurves, ...sketchPattern, ...sketchOffset };

declare module '../recorder' {
  interface PartBuilder extends PartMixin {}
  interface SketchBuilder extends SketchMixin {}
}
type PartMixin = typeof partFeatures;
type SketchMixin = typeof sketchFeatures;

export function installFeatures(helpers: Helpers, Part: typeof PartBuilder, Sketch: typeof SketchBuilder): void {
  bindHelpers(helpers);
  Object.assign(Part.prototype, partFeatures);
  Object.assign(Sketch.prototype, sketchFeatures);
}
export { holeOps } from './holes';
export type { SketchSpec } from './h';
