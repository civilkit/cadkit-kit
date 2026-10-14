// Surface bodies in the view. `Session.bodyForView` hands the viewer only the solid: the kernel's regen reply also carries
// `surfaces` (one sheet body per feature id, same face and edge records as the solid), which the Session drops. Like the
// thread markers, they are asked from the kernel directly, and only when the document has a feature that makes a sheet.
import { meshFromBody } from '@ck/mesh';
import { mergeBodies, mergedBox, surfaceOwners, type BodyMesh, type SurfaceEdge, type ViewSurface } from '@kit/viewport';
import { SURFACE_TYPES } from './featureCreators';

type Feat = { type?: string; surface?: unknown; solid?: unknown };
type Transport = { request(m: unknown): Promise<{ ok?: boolean; result?: unknown }> };

/** Feature types that can leave a surface body (knit and sweep / loft only when they are asked for a sheet). */
export function makesSurface(f: Feat): boolean {
  if (SURFACE_TYPES.includes(f.type ?? '')) return true;
  if (f.type === 'knit') return f.solid !== true;
  if (f.type === 'sweep' || f.type === 'loft') return f.surface === true;
  return f.type === 'deleteFace' || f.type === 'freeform';
}
export const hasSurfaceFeatures = (features: Feat[]): boolean => features.some(makesSurface);

/** The kernel's `surfaces` ([id, body] pairs) as view surfaces; anything malformed is skipped. */
export function toViewSurfaces(raw: unknown): ViewSurface[] {
  if (!Array.isArray(raw)) return [];
  const out: ViewSurface[] = [];
  for (const pair of raw) {
    if (!Array.isArray(pair) || typeof pair[0] !== 'string' || !pair[1] || typeof pair[1] !== 'object') continue;
    const b = pair[1] as { faces?: Array<{ id: string }>; edges?: Array<{ key?: string; pts: number[][] }>; mesh?: unknown; box?: { min: number[]; max: number[] } };
    try {
      const mesh = meshFromBody({ faces: b.faces ?? [], mesh: b.mesh as never });
      out.push({ id: pair[0], mesh, edges: (b.edges ?? []).filter((e) => Array.isArray(e.pts)), box: b.box ?? null });
    } catch { /* a body that does not decode is not shown */ }
  }
  return out;
}

/** Ask the kernel for the surface bodies of `doc` (optionally only its first `upTo` features). [] on any failure or error. */
export async function fetchSurfaces(kernel: Transport | undefined, doc: unknown, tag: string, upTo?: number | null): Promise<ViewSurface[]> {
  if (!kernel) return [];
  try {
    const r = await kernel.request({ type: 'regen', tag, part: doc, ...(upTo != null ? { opts: { upTo } } : {}) });
    const res = (r?.ok ? r.result : null) as { errors?: unknown[]; surfaces?: unknown } | null;
    return res ? toViewSurfaces(res.surfaces) : [];
  } catch { return []; }
}

/** A view body with its surface bodies attached (the box then also covers them). Without surfaces the body is returned as it is. */
export function withSurfaces<B extends { mesh: { triFace: ArrayLike<number> }; box: { min: number[]; max: number[] } }>(body: B | null, surfaces: ViewSurface[]): (B & { surfaces?: ViewSurface[] }) | null {
  if (!body || !surfaces.length) return body;
  return { ...body, surfaces, box: mergedBox(body.box, body.mesh.triFace.length > 0, surfaces) };
}

/** Everything on screen as one mesh and edge list (solid plus surface bodies), for the queries that read the view: picking
 *  lists, measure, section. */
export function mergedView<B extends { mesh: BodyMesh; edges: SurfaceEdge[]; surfaces?: ViewSurface[] }>(body: B): B {
  if (!body.surfaces?.length) return body;
  const m = mergeBodies({ mesh: body.mesh, edges: body.edges }, body.surfaces);
  return { ...body, mesh: m.mesh, edges: m.edges };
}

/** Face and edge names -> id of the surface body that owns them. */
export const surfaceNames = (body: { surfaces?: ViewSurface[] } | null): Map<string, string> => surfaceOwners(body?.surfaces ?? []);
