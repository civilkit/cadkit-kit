// Repair hints. The kernel driver's hintFor covers most codes; the kit adds the ones agents trip over most, with the facts they need
// (sketch frames for cutNoEffect, the half-profile rule for profileCrossesAxis).
import { hintFor } from '@ck/driver-verify';
import { isOpenChainSketch } from '@kit/viewdata';
import { sheetHint } from './sheetHints';

export const FRAMES: Record<string, string> = {
  front: "'front': sketch x = world +X, sketch y = world +Y, normal +Z",
  top: "'top': sketch x = world +X, sketch y = world -Z (a larger y goes towards the back), normal +Y",
  right: "'right': sketch x = world -Z, sketch y = world +Y, normal +X",
};
const WORKPLANE = 'for a workplane({origin, normal, xdir}) sketch x = xdir (made perpendicular to the normal), sketch y = normal x xdir, origin = the given origin';

/** The sketch frame of the sketch that feature `fid` uses, as text; null when it cannot be told. */
export function sketchFrameText(doc: { features: Array<Record<string, unknown>> } | undefined, fid: string): string | null {
  const f = doc?.features.find((x) => x.id === fid);
  const sk = f && typeof f.sketch === 'string' ? doc?.features.find((x) => x.id === f.sketch) : undefined;
  const plane = sk?.plane as { kind?: string; id?: string } | undefined;
  if (!plane) return null;
  if (plane.kind === 'std' && plane.id && FRAMES[plane.id]) return `its sketch ${f?.sketch} is on ${FRAMES[plane.id]}`;
  return `its sketch ${f?.sketch} is on ${plane.kind === 'face' ? `a face (${plane.id}): sketch x/y follow the face's own frame, origin = the world origin projected on it` : `plane ${plane.id ?? '?'}: ${WORKPLANE}`}`;
}

export function repairHint(feature: string, code: string, params: Record<string, unknown>, doc?: { features: Array<Record<string, unknown>> }): string {
  const sheet = sheetHint(feature, doc?.features.find((x) => x.id === feature)?.type, code, params);
  if (sheet) return sheet;
  if (code === 'noClosedProfile') {
    const f = doc?.features.find((x) => x.id === feature);
    if ((f?.type === 'extrude' || f?.type === 'revolve') && isOpenChainSketch(doc?.features.find((x) => x.id === f.sketch))) {
      return `${feature}: the sketch is ONE open line (or chain), which has no inside to fill. For a web or gusset that grows to the body use rib: .sketch(...line...).rib(thickness); for a thin wall along the line pass thin: thickness to the extrude; or close the outline`;
    }
  }
  if (code === 'profileCrossesAxis') return `${feature}: the revolve profile lies on both sides of the axis. Draw HALF of the profile, from the axis outwards (every point at x >= 0 for the default sketch-y axis, or all on one side of the axis line you gave), and revolve 360 degrees for the other half`;
  if (code === 'cutNoEffect' || code === 'nothingToCut') {
    const base = hintFor(feature, code, params).hint;
    const fr = sketchFrameText(doc, feature);
    return `${base}. Check the sketch frame: ${fr ?? `front: x=X y=Y n=+Z; top: x=X y=-Z n=+Y; right: x=-Z y=Y n=+X; ${WORKPLANE}`}; also try direction: 'into' | 'away' | 'both' and compare with the body bbox (facts)`;
  }
  return hintFor(feature, code, params).hint;
}
