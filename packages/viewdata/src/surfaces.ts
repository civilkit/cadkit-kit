// The pure part of the surface bodies in the view (the app adds the kernel request and the picking helpers in surfaceView.ts).
// `Session.bodyForView` hands the viewer only the solid: the kernel's regen reply also carries `surfaces` (one sheet body per
// feature id, same face and edge records as the solid), which the Session reports as `regenReport().surfaces`.
import { meshFromBody } from '@ck/mesh';
import { mergedBox, type ViewSurface } from '../../viewport/src/surfaces';

type Feat = { type?: string; surface?: unknown; solid?: unknown };

/** Feature types that leave a surface body registered under their id. */
export const SURFACE_TYPES = ['surfacePlanar', 'surfaceExtrude', 'surfaceRevolve', 'surfaceOffset', 'trimSurface', 'fill', 'extend', 'pipeCut'];

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

/** A view body with its surface bodies attached (the box then also covers them). Without surfaces the body is returned as it is. */
export function withSurfaces<B extends { mesh: { triFace: ArrayLike<number> }; box: { min: number[]; max: number[] } }>(body: B | null, surfaces: ViewSurface[]): (B & { surfaces?: ViewSurface[] }) | null {
  if (!body || !surfaces.length) return body;
  return { ...body, surfaces, box: mergedBox(body.box, body.mesh.triFace.length > 0, surfaces) };
}
