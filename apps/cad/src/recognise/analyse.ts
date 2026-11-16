// Feature recognition from a STEP file: what quiddity finds, what of it we can rebuild as a script, and whether the rebuild is the same solid.
// `analyseStep` is pure apart from the recogniser it is given (the browser worker, or a fake in tests); `verdictOf` is the trust gate.
import { convert, type Box, type ConvertResult } from './convert.mjs';
import { meshVolume, prismStock, turnedLevels } from './slices';
import type { Recogniser } from './quiddityClient';

export interface Analysis {
  /** the kit script, or null when nothing could be rebuilt */
  script: string | null;
  /** the recognised feature each line of the script stands for (`stock`, `turned`, `holes/3`...), so a line the kernel rejects can be dropped */
  lineIds: string[];
  /** what was recognised, by family (`holes: 24`) */
  found: Record<string, number>;
  handled: string[];
  skipped: ConvertResult['skipped'];
  /** how the stock was built: the bounding box, an outline extruded, or a plate with a turned body */
  stock: 'box' | 'prism' | 'turned' | null;
  /** volume of the imported solid, from its mesh (square millimetres of tessellation error: about a tenth of a percent) */
  fileVolume: number;
  version: string;
}

export interface Imported { stepText: string; positions: ArrayLike<number>; box: Box }

export async function analyseStep(i: Imported, recognise: Recogniser): Promise<Analysis> {
  const { json, version } = await recognise(new TextEncoder().encode(i.stepText));
  const q = JSON.parse(json) as { document?: { records?: Array<{ family: string }> }; records?: Array<{ family: string }> };
  const records = q.document?.records ?? q.records ?? [];
  const found: Record<string, number> = {};
  for (const r of records) found[r.family] = (found[r.family] ?? 0) + 1;
  // the stock candidates come from the mesh: an outline prism, and radii by height for a turned body (axis Y)
  const prism = prismStock(i.positions, i.box);
  const turned = turnedLevels(i.positions, i.box, 1, 36);
  const out = convert(q, { stock: i.box, prism, turned });
  const stock = !out.base ? null : out.base.turned ? 'turned' : out.base.prism ? 'prism' : 'box';
  // a pattern of holes is described by the holes already rebuilt: it counts as rebuilt, not as left out
  const folded = out.skipped.filter((s) => s.code === 'folded');
  return { script: out.script, lineIds: out.lineIds ?? [], found, handled: [...out.handled, ...folded.map((s) => s.id)], skipped: out.skipped.filter((s) => s.code !== 'folded'), stock, fileVolume: meshVolume(i.positions), version };
}

export type Verdict = 'match' | 'close' | 'differs' | 'invalid';
/** Same solid within 0.5 %: `match` (the line the app uses for a rebuilt part lying on its original); within 2 %: `close`; else `differs`. */
export function verdictOf(rebuilt: number, file: number, valid: boolean): { verdict: Verdict; difference: number; /** rebuilt over imported: above 1 the rebuild is the larger */ ratio: number } {
  const difference = file > 0 ? Math.abs(rebuilt - file) / file : 1;
  const ratio = file > 0 ? rebuilt / file : 0;
  if (!valid) return { verdict: 'invalid', difference, ratio };
  return { verdict: difference <= 0.005 ? 'match' : difference <= 0.02 ? 'close' : 'differs', difference, ratio };
}
