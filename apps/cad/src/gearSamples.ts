// The gear samples, built from the same parameter records the Gear editor uses (so opening one in the editor works).
import { DEFAULT_GEAR, defaultPair, gearOps, type GearParams } from './gearData';

export const SPUR_SAMPLE: GearParams = { ...DEFAULT_GEAR, teeth: 24, faceWidth: 12, boreDia: 10, keyway: true, hubDia: 24, hubLength: 20 };
export const PAIR_SAMPLE: GearParams = defaultPair({ faceWidth: 10, boreDia: 8, mate: { teeth: 40, boreDia: 10, hubDia: 0, hubLength: 0 } });

export function samplePart(name: string, p: GearParams): Record<string, unknown> {
  const doc = { format: 'ck-part', version: 1, name, features: [] as Array<Record<string, unknown>>, seq: 1, rollback: null, material: 'steel', counters: {} };
  for (const op of gearOps(doc as never, p)) doc.features.push((op as { feature: Record<string, unknown> }).feature);
  doc.seq = doc.features.length + 1;
  return doc;
}
