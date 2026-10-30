// Surface bodies in the view. `Session.bodyForView` hands the viewer only the solid: the kernel's regen reply also carries
// `surfaces` (one sheet body per feature id, same face and edge records as the solid), which the Session drops. Like the
// thread markers, they are asked from the kernel directly, and only when the document has a feature that makes a sheet.
import { mergeBodies, surfaceOwners, type BodyMesh, type SurfaceEdge, type ViewSurface } from '@kit/viewport';
import { toViewSurfaces } from '@kit/viewdata';

// The pure part (makesSurface, hasSurfaceFeatures, toViewSurfaces, withSurfaces) is shared with the agent tools: @kit/viewdata.
export { makesSurface, hasSurfaceFeatures, toViewSurfaces, withSurfaces } from '@kit/viewdata';

type Transport = { request(m: unknown): Promise<{ ok?: boolean; result?: unknown }> };

/** Ask the kernel for the surface bodies of `doc` (optionally only its first `upTo` features). [] on any failure or error. */
export async function fetchSurfaces(kernel: Transport | undefined, doc: unknown, tag: string, upTo?: number | null): Promise<ViewSurface[]> {
  if (!kernel) return [];
  try {
    const r = await kernel.request({ type: 'regen', tag, part: doc, ...(upTo != null ? { opts: { upTo } } : {}) });
    const res = (r?.ok ? r.result : null) as { errors?: unknown[]; surfaces?: unknown } | null;
    return res ? toViewSurfaces(res.surfaces) : [];
  } catch { return []; }
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
