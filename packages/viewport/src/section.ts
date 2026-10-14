// Section view maths: a cutting plane through the part, no three.js. The plane is "n . x = offset"; by default the
// side the normal points to is cut away (so a Front section, normal +Z, shows the cut face to a viewer in front).
export interface SectionSpec {
  /** unit normal of the plane */
  normal: [number, number, number];
  /** distance of the plane from the origin along the normal (mm) */
  offset: number;
  /** keep the other side */
  flip?: boolean;
}

export type StdSectionPlane = 'front' | 'top' | 'right';
/** The three standard planes by the view that looks at them: Front is XY (normal +Z), Top is XZ (+Y), Right is YZ (+X). */
export const STD_SECTION_NORMAL: Record<StdSectionPlane, [number, number, number]> = { front: [0, 0, 1], top: [0, 1, 0], right: [1, 0, 0] };

/** three.js `Plane` parameters for the part that stays: three keeps `normal . x + constant >= 0`. */
export function clipPlane(s: SectionSpec): { normal: [number, number, number]; constant: number } {
  const [x, y, z] = s.normal;
  return s.flip ? { normal: [x, y, z], constant: -s.offset } : { normal: [-x, -y, -z], constant: s.offset };
}

/** The cap quad that closes the cut: centred on the plane under the box centre, large enough for any cut of the box. */
export function capFrame(s: SectionSpec, box: { min: number[]; max: number[] }): { center: [number, number, number]; size: number } {
  const c = [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2);
  const k = s.offset - (c[0] * s.normal[0] + c[1] * s.normal[1] + c[2] * s.normal[2]);
  const diag = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  return { center: [c[0] + s.normal[0] * k, c[1] + s.normal[1] * k, c[2] + s.normal[2] * k], size: Math.max(diag * 1.2, 1e-3) };
}

/** Which side of the plane a point is on after clipping: true when it is still drawn. */
export function kept(s: SectionSpec, p: number[]): boolean {
  const d = p[0] * s.normal[0] + p[1] * s.normal[1] + p[2] * s.normal[2] - s.offset;
  return s.flip ? d >= 0 : d <= 0;
}
