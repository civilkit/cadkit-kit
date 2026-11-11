// The sheet metal feature types, made known to the part model's structural check. The kernel (wasm) builds them already; the TypeScript
// part-model package that Session.edit checks an `add` against lists only the types it was published with, so until its FEATURE_TYPES
// carries these, `add` answers `unknown feature type "edgeFlange"`. Registering is idempotent and does nothing once the package lists them.
import { FEATURE_TYPES } from '@ck/part-model';
import { SHEET_FEATURES } from './model';

/** Add the sheet metal types FEATURE_TYPES lacks; returns the ones added (empty when the package already knows them all). */
export function registerSheetTypes(): string[] {
  const list = FEATURE_TYPES as unknown as string[];
  const added = SHEET_FEATURES.filter((t) => !list.includes(t));
  list.push(...added);
  return [...added];
}
registerSheetTypes();
