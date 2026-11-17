// pressPull made known to the part model's structural check. The kernel (wasm) builds it, but the TypeScript part-model package that
// Session.edit checks an `add` against lists only the types it was published with (FEATURE_TYPES), so until it carries pressPull `add`
// answers `unknown feature type "pressPull"`. Registering is idempotent and does nothing once the package lists it.
import { FEATURE_TYPES } from '@ck/part-model';

/** Add the types FEATURE_TYPES lacks; returns the ones added (empty when the package already knows them). */
export function registerPressPullType(): string[] {
  const list = FEATURE_TYPES as unknown as string[];
  const added = ['pressPull'].filter((t) => !list.includes(t));
  list.push(...added);
  return added;
}
registerPressPullType();
