// Mass properties: what the kernel returns (volume, area, centre and principal moments for unit density) turned into
// the numbers an engineer reads. Lengths are millimetres, density is g/cm3, mass is grams.
import { densityGcm3 } from '../materials';

export interface MassRaw {
  volume?: number; area?: number; com?: number[];
  /** principal moments for unit density, mm^5 */
  principal?: number[]; axes?: number[][];
  /** first moment about the origin (volume x centre), mm^4 */
  firstMoment?: number[];
  /** inertia tensor for unit density, rows, world axes, mm^5: about the centre of mass and about the origin */
  inertia?: number[][]; inertiaOrigin?: number[][];
  bodies?: Array<{ volume: number; area: number; com: number[]; name?: string }>;
}

/** Densities in g/cm3 for the materials a part can name; the part's `material` is matched ignoring case. */
export const DENSITIES: Record<string, number> = {
  steel: 7.85, 'stainless steel': 8.0, stainless: 8.0, iron: 7.87, aluminium: 2.7, aluminum: 2.7, brass: 8.5, bronze: 8.8, copper: 8.96,
  titanium: 4.5, zinc: 7.14, lead: 11.34, magnesium: 1.74, nickel: 8.9,
  abs: 1.04, pla: 1.24, petg: 1.27, nylon: 1.15, pc: 1.2, polycarbonate: 1.2, pom: 1.41, acetal: 1.41, pp: 0.9, hdpe: 0.95, resin: 1.1,
  wood: 0.7, oak: 0.75, pine: 0.5, glass: 2.5, concrete: 2.4,
};

/** The density of a named material, or null when it is not in the table. */
export function densityOf(material: string | undefined): number | null {
  if (!material) return null;
  return densityGcm3(material) ?? DENSITIES[material.trim().toLowerCase()] ?? null;   // the material catalogue (built-in and custom) first
}

export interface MassView {
  volume: number;      // mm3
  area: number;        // mm2
  mass: number;        // g
  com: number[];
  /** principal moments of inertia, g mm2, ascending */
  principal: number[];
  /** principal axes (unit vectors), same order as `principal`; empty when the kernel did not return them */
  axes: number[][];
  /** mass x centre of mass about the origin, g mm; null when the kernel did not return it */
  firstMoment: number[] | null;
  /** inertia tensor about the centre of mass / about the origin, world axes, g mm2; null when the kernel did not return it */
  inertia: number[][] | null;
  inertiaOrigin: number[][] | null;
  bodies: Array<{ volume: number; area: number; mass: number; com: number[] }>;
}

/** Scale the kernel's unit-density numbers by a density (g/cm3). */
export function massView(raw: MassRaw, density: number): MassView {
  const k = density / 1000;   // g/cm3 -> g/mm3
  const volume = raw.volume ?? 0;
  return {
    volume, area: raw.area ?? 0, mass: volume * k, com: raw.com ?? [0, 0, 0],
    principal: (raw.principal ?? []).map((m) => m * k),
    axes: raw.axes ?? [],
    firstMoment: raw.firstMoment ? raw.firstMoment.map((x) => x * k) : null,
    inertia: raw.inertia ? raw.inertia.map((r) => r.map((x) => x * k)) : null,
    inertiaOrigin: raw.inertiaOrigin ? raw.inertiaOrigin.map((r) => r.map((x) => x * k)) : null,
    bodies: (raw.bodies ?? []).map((b) => ({ ...b, mass: b.volume * k })),
  };
}

/** "12.5 g", "1.25 kg": grams below 1000. */
export function massText(g: number): string {
  const f = (x: number) => String(+x.toPrecision(5));
  return Math.abs(g) >= 1000 ? `${f(g / 1000)} kg` : `${f(g)} g`;
}

/** A 3x3 tensor as three lines "Ixx  Ixy  Ixz" (rows, tab-free, for the panel and the clipboard). */
export function matrixText(m: number[][], digits = 2): string {
  const f = (x: number) => String(+x.toPrecision(digits + 4));
  return m.map((r) => r.map(f).join('   ')).join('\n');
}
