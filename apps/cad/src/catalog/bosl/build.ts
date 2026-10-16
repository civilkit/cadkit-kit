// Turns a parts-library entry into the edit that places it: the entry's script text is run in ATTACH mode on the open document
// (so the features are added after the ones already there and face() selectors see the existing body), without touching the
// document. The result is either plain ops (a preview, parameters as numbers) or a DocPatch that adds the variables and the
// features together as one undo step.
import { runScript, type ScriptHost } from '@kit/script';
import type { PartDoc } from '@ck/part-model';
import type { EditOp } from '@ck/session';
import type { DocPatch } from '../../docFields';
import type { PlaceTarget } from '../shapes';
import { boslEntry, type BoslEntry, type Params, type Place } from './entries';

export interface BoslItem { entryId: string; params: Params }
export interface BoslBuilt {
  ops: EditOp[];
  mainId: string;
  sketchId: string;
  helpers: string[];
  size: number;
  /** Present for a linked build: variables + features as one step. */
  patch?: DocPatch;
  script: string;
}
export type BoslFailure = { error: 'planarOnly' | 'invalid' | 'scriptFailed' | 'noFrame'; hint?: string };

/** Variable prefix not yet used in the document: `cuboid1_`, `cuboid2_`... */
export function freePrefix(doc: Pick<PartDoc, 'features'> & { variables?: unknown[] }, entry: BoslEntry): string {
  const names = new Set(((doc.variables ?? []) as Array<{ name: string }>).map((v) => v.name));
  for (let k = 1; ; k++) {
    const pfx = `${entry.id.replace(/[^a-z0-9]/gi, '')}${k}_`;
    if (![...names].some((n) => n.startsWith(pfx))) return pfx;
  }
}

/** Where the entry goes: the ground plane (first body) or a flat face with its sketch frame. */
export function placeFor(target: PlaceTarget, prefix: string | null): Place | BoslFailure {
  if (target.kind === 'ground') return { plane: "'front'", ground: true, at: [Math.round(target.point[0]), Math.round(target.point[1])], prefix };
  if (!target.planar) return { error: 'planarOnly' };
  if (!target.frame) return { error: 'noFrame' };
  const f = target.frame, d = [target.point[0] - f.o[0], target.point[1] - f.o[1], target.point[2] - f.o[2]];
  const u = d[0] * f.x[0] + d[1] * f.x[1] + d[2] * f.x[2], v = d[0] * f.y[0] + d[1] * f.y[1] + d[2] * f.y[2];
  return { plane: `face(${JSON.stringify(target.face)})`, ground: false, hostFace: target.face, at: [+u.toFixed(6), +v.toFixed(6)], prefix };
}

const isPlace = (x: Place | BoslFailure): x is Place => !('error' in x);
const SHAPE_TYPES = new Set(['extrude', 'revolve', 'loft', 'sweep']);

export async function buildBosl(host: ScriptHost, doc: PartDoc | null, item: BoslItem, target: PlaceTarget, linked: boolean): Promise<BoslBuilt | BoslFailure> {
  const entry = boslEntry(item.entryId);
  if (!entry) return { error: 'invalid', hint: `unknown entry ${item.entryId}` };
  const bad = entry.check(item.params);
  if (bad) return { error: 'invalid', hint: bad };
  const prefix = linked && doc ? freePrefix(doc as never, entry) : null;
  const pl = placeFor(target, prefix);
  if (!isPlace(pl)) return pl;
  const script = entry.script(item.params, pl);
  const features = (doc?.features ?? []) as unknown as Array<Record<string, unknown>>;
  const seq = doc?.seq ?? 1;
  const r = await runScript(script, host, {}, { prefix: { features, seq } });
  if (r.errors.length || !r.document) return { error: 'scriptFailed', hint: r.errors.map((e) => `line ${e.line}: ${e.message}`).join('; ') };
  const made = r.ops.map((o) => o.feature as Record<string, unknown>);
  const main = [...made].reverse().find((f) => SHAPE_TYPES.has(String(f.type))) ?? made[made.length - 1];
  const sketchId = String(main.sketch ?? (made.find((f) => f.type === 'sketch')?.id ?? ''));
  const helpers = made.filter((f) => f.type === 'plane' || (f.type === 'sketch' && String(f.id) !== sketchId && (f.entities as Array<{ construction?: boolean }>).every((e) => e.construction))).map((f) => String(f.id));
  const built: BoslBuilt = { ops: r.ops, mainId: String(main.id), sketchId, helpers, size: 0, script };
  if (linked) {
    const vars = [...(((doc as unknown as { variables?: unknown[] })?.variables) ?? []), ...(((r.document as { variables?: unknown[] }).variables) ?? [])];
    built.patch = { variables: vars, append: made, seq: Number(r.document.seq) };
  }
  return built;
}
