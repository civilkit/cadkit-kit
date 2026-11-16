// The rules of the Tray wizard: the parameter record with its defaults, the drawer-fit calculation, the checks that need no kernel, the numbers shown under the fields and the ops.
// The ops come from the script helper gridTray() (packages/script/src/features/tray.ts), so the wizard and the Script tab build the same tray: a block of grid units with a scooped
// cavity along its length, open at the ends (a tray) or closed (a bin). Nothing here touches the DOM or the kernel.
import type { EditOp } from '@ck/session';
import { t } from './i18n';
import { groupOps, wizardGroupName } from './wizardGroup';
import type { GridBaseplateOpts } from '@kit/script';
import { trayEditOps, baseplateEditOps, baseplateGeometry, trayGeometry, FOOT_HEIGHT, FOOT_MIN_CORNER, MAGNET_FLOOR, type GridTrayOpts, type TrayEnds } from '@kit/script';

export const TRAY_ENDS = ['none', 'front', 'back', 'both'] as const;
export type { TrayEnds };

/** Printers the bed-size field starts from (X x Y of the build plate, mm). 'custom' leaves the number as typed. */
export const PRINTERS = [
  { id: 'bambu-x1c', name: 'Bambu X1 Carbon', bed: 256 },
  { id: 'creality-k1-max', name: 'Creality K1 Max', bed: 300 },
  { id: 'custom', name: 'Custom', bed: 0 },
] as const;
export type PrinterId = (typeof PRINTERS)[number]['id'];

export const TRAY_KINDS = ['tray', 'baseplate'] as const;
export type TrayKind = (typeof TRAY_KINDS)[number];
export interface TrayParams {
  /** what to make: a tray or bin, or the Gridfinity baseplate it seats in */
  kind: TrayKind;
  /** baseplate: the plate under the pockets, and how much bigger each pocket is than the foot all round, mm */
  base: number;
  clearance: number;
  /** baseplate: make a plate longer than the printer bed as several pieces that fit it */
  split: boolean;
  /** the tray's size in grid units; half units allowed */
  widthUnits: number;
  lengthUnits: number;
  heightUnits: number;
  scoopRadius: number;
  wall: number;
  floor: number;
  cornerRadius: number;
  endWalls: TrayEnds;
  /** the Gridfinity foot under every grid cell, so the tray seats in a baseplate; the floor is then measured above it */
  foot: boolean;
  magnets: boolean;
  /** one grid unit and one height unit, mm */
  pitch: number;
  unitHeight: number;
  /** each outside size is this much under whole units, mm */
  tolerance: number;
  /** the drawer's inside size, mm; 0 = not given */
  drawerWidth: number;
  drawerDepth: number;
  drawerHeight: number;
  /** half units in the drawer fit */
  halfUnits: boolean;
  /** printer bed, mm (the longer side of the part is checked against it); `printer` is the preset it came from */
  printer: PrinterId;
  bed: number;
  name: string;
  /** the centre of the bottom face */
  origin: [number, number, number];
}

/** A 1 x 4 unit tray 4 units (28 mm) tall: Gridfinity units, 8 mm scoop, 1.2 mm walls and floor, open ends, a 256 mm bed. */
export const DEFAULT_TRAY: TrayParams = {
  kind: 'tray', base: 1.2, clearance: 0.1, split: true,
  widthUnits: 1, lengthUnits: 4, heightUnits: 4, scoopRadius: 8, wall: 1.2, floor: 1.2, cornerRadius: 3.75, endWalls: 'none', foot: true, magnets: false,
  pitch: 42, unitHeight: 7, tolerance: 0.5, drawerWidth: 0, drawerDepth: 0, drawerHeight: 0, halfUnits: true, printer: 'bambu-x1c', bed: 256, name: 'Tray', origin: [0, 0, 0],
};
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** The parameters after a change: choosing a printer sets the bed from the preset (Custom keeps the typed number); typing a bed makes the printer Custom. */
export function withChange(p: TrayParams, patch: Partial<TrayParams>): TrayParams {
  const n = { ...p, ...patch };
  if (patch.kind !== undefined && patch.name === undefined) { const own = (k: TrayKind): string => (k === 'tray' ? 'Tray' : 'Baseplate'); if (p.name === own(p.kind)) n.name = own(patch.kind); }
  if (patch.printer !== undefined && patch.bed === undefined) { const pr = PRINTERS.find((x) => x.id === patch.printer); if (pr && pr.bed > 0) n.bed = pr.bed; }
  if (patch.bed !== undefined && patch.printer === undefined) n.printer = PRINTERS.find((x) => x.bed === patch.bed && x.id !== 'custom')?.id ?? 'custom';
  return n;
}

/** The helper's options for these parameters. */
export function trayOpts(p: TrayParams): GridTrayOpts {
  return {
    widthUnits: p.widthUnits, lengthUnits: p.lengthUnits, heightUnits: p.heightUnits, pitch: p.pitch, unitHeight: p.unitHeight, tolerance: p.tolerance, wall: p.wall, floor: p.floor,
    scoopRadius: p.scoopRadius, cornerRadius: p.cornerRadius, endWalls: p.endWalls, foot: p.foot, magnets: p.magnets, name: p.name.trim(), origin: p.origin,
  };
}

/** What a drawer of this inside size takes: the most whole (or half) units of the grid that fit across and along it, and how much of each size is left over. */
export interface DrawerFit { widthUnits: number; lengthUnits: number; heightUnits: number; leftWidth: number; leftDepth: number; leftHeight: number }
/** The fit of the drawer in the parameters, or null while its width or depth is not given. A part of n units is n x pitch less the tolerance, so the most that fits is floor((size + tolerance) / pitch). */
export function drawerFit(p: TrayParams): DrawerFit | null {
  if (!(p.drawerWidth > 0) || !(p.drawerDepth > 0) || !(p.pitch > 0) || !(p.unitHeight > 0)) return null;
  const k = p.halfUnits ? 2 : 1;
  const tol = p.kind === 'baseplate' ? 0 : p.tolerance;   // plates butt: a baseplate is whole units
  const units = (size: number): number => Math.floor(((size + tol) / p.pitch) * k + 1e-9) / k;
  const wu = units(p.drawerWidth), lu = units(p.drawerDepth);
  const hu = p.drawerHeight > 0 ? Math.floor(p.drawerHeight / p.unitHeight + 1e-9) : 0;
  return {
    widthUnits: wu, lengthUnits: lu, heightUnits: hu,
    leftWidth: r3(p.drawerWidth - (wu * p.pitch - tol)), leftDepth: r3(p.drawerDepth - (lu * p.pitch - tol)), leftHeight: hu > 0 ? r3(p.drawerHeight - hu * p.unitHeight) : 0,
  };
}
/** The parameters with the tray made as long as the drawer (and as tall as it allows, when its height is given); the width is kept. Unchanged when there is no fit. */
export function fillDrawerLength(p: TrayParams): TrayParams {
  const f = drawerFit(p);
  if (!f || !(f.lengthUnits > 0)) return p;
  return { ...p, lengthUnits: f.lengthUnits, heightUnits: f.heightUnits > 0 ? f.heightUnits : p.heightUnits };
}

export type TrayIssueCode = 'size' | 'half' | 'wall' | 'wallThick' | 'floor' | 'scoop' | 'scoopDeep' | 'corner' | 'magnetFloor' | 'footCorner' | 'pitch' | 'name' | 'kernel';
export interface TrayIssue { code: TrayIssueCode; params: Record<string, string | number>; message: string }
const bad = (code: TrayIssueCode, message: string, params: Record<string, string | number> = {}): TrayIssue => ({ code, params, message });
const isHalf = (v: number): boolean => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9;

/** The first problem with the parameters (none when the ops can be made). */
export function trayIssue(p: TrayParams): TrayIssue | null {
  if (p.kind === 'baseplate') return plateIssue(p);
  if (!(p.widthUnits > 0) || !(p.lengthUnits > 0) || !(p.heightUnits > 0)) return bad('size', 'The width, length and height must be more than 0');
  if (!isHalf(p.widthUnits) || !isHalf(p.lengthUnits)) return bad('half', 'The width and length are whole or half grid units (1, 1.5, 2, ...)');
  if (!(p.pitch > 0) || !(p.unitHeight > 0) || !(p.tolerance >= 0 && p.tolerance < p.pitch / 2)) return bad('pitch', 'The grid unit and the height unit must be more than 0, and the tolerance less than half a unit');
  const w = p.widthUnits * p.pitch - p.tolerance, l = p.lengthUnits * p.pitch - p.tolerance, h = p.heightUnits * p.unitHeight;
  if (!(p.wall >= 0.4)) return bad('wall', 'The wall must be at least 0.4 mm', { min: 0.4 });
  if (!(2 * p.wall < Math.min(w, l))) return bad('wallThick', 'The two walls must be thinner than the smallest outside size', { max: r3(Math.min(w, l) / 2) });
  if (!(p.floor >= 0.4 && p.floor < h)) return bad('floor', 'The floor must be at least 0.4 mm and less than the height', { height: r3(h) });
  const fh = p.foot ? FOOT_HEIGHT : 0;
  if (p.foot && !(p.floor < h - fh)) return bad('floor', 'The floor must be at least 0.4 mm and less than the height above the foot', { height: r3(h - fh) });
  const inner = w - 2 * p.wall;
  if (!(p.scoopRadius >= 0) || !(2 * p.scoopRadius <= inner)) return bad('scoop', 'The scoop radius must be 0 or more and at most half of the inside width', { max: r3(inner / 2) });
  if (!(p.scoopRadius <= h - fh - p.floor)) return bad('scoopDeep', 'The scoop radius is more than the depth of the cavity: use a smaller radius, a thinner floor or a taller tray', { depth: r3(h - fh - p.floor) });
  if (!(p.cornerRadius >= 0 && 2 * p.cornerRadius <= Math.min(w, l))) return bad('corner', 'The corner radius must be 0 or more and at most half of the smallest outside size', { max: r3(Math.min(w, l) / 2) });
  if (p.foot && !(p.cornerRadius >= FOOT_MIN_CORNER)) return bad('footCorner', 'The foot needs a corner radius of at least 3.1 mm', { min: FOOT_MIN_CORNER });
  if (p.magnets && !(p.floor + fh >= 2 + MAGNET_FLOOR)) return bad('magnetFloor', `The floor must be at least ${r3(2 + MAGNET_FLOOR)} mm for the magnet holes`, { need: r3(2 + MAGNET_FLOOR) });
  if (!p.name.trim()) return bad('name', 'Give the tray a name');
  try { trayGeometry(trayOpts(p)); } catch (e) { return bad('kernel', (e as Error).message.replace(/^gridTray\(\): /, '')); }
  return null;
}

export function plateOpts(p: TrayParams): GridBaseplateOpts {
  return { widthUnits: p.widthUnits, lengthUnits: p.lengthUnits, pitch: p.pitch, base: p.base, clearance: p.clearance, cornerRadius: p.cornerRadius, ...(p.split && p.bed > 0 ? { bed: p.bed } : {}), name: p.name.trim(), origin: p.origin };
}
function plateIssue(p: TrayParams): TrayIssue | null {
  if (!(p.widthUnits > 0) || !(p.lengthUnits > 0)) return bad('size', 'The width and length must be more than 0');
  if (!isHalf(p.widthUnits) || !isHalf(p.lengthUnits)) return bad('half', 'The width and length are whole or half grid units (1, 1.5, 2, ...)');
  if (!(p.pitch > 0)) return bad('pitch', 'The grid unit and the height unit must be more than 0, and the tolerance less than half a unit');
  if (!(p.base >= 0.4)) return bad('wall', 'The plate must be at least 0.4 mm thick', { min: 0.4 });
  if (!p.name.trim()) return bad('name', 'Give the baseplate a name');
  try { baseplateGeometry(plateOpts(p)); } catch (e) { return bad('kernel', (e as Error).message.replace(/^gridBaseplate\(\): /, '')); }
  return null;
}

/** What the panel shows under the fields: the outside size, the cavity, the volume (the plastic, about) and whether it fits the bed and the drawer. */
export function traySummary(p: TrayParams): { width: number; length: number; height: number; inner: number; depth: number; volume: number; tooLong: boolean; longest: number; fit: DrawerFit | null; fitsDrawer: boolean | null; pieces: number; pieceWidth: number; pieceLength: number } {
  if (p.kind === 'baseplate') {
    const b = baseplateGeometry(plateOpts(p));
    const f = drawerFit(p);
    const ok = !f ? null : b.width <= p.drawerWidth + 1e-9 && b.length <= p.drawerDepth + 1e-9;
    const lg = Math.max(b.width, b.length);
    return { width: r3(b.width), length: r3(b.length), height: r3(b.height), inner: 0, depth: 0, volume: 0, tooLong: !b.split && p.bed > 0 && lg > p.bed, longest: r3(lg), fit: f, fitsDrawer: ok, pieces: b.split ? b.pieces.length : 1, pieceWidth: r3(Math.max(...b.pieces.map((q) => q.w)) * b.pitch), pieceLength: r3(Math.max(...b.pieces.map((q) => q.l)) * b.pitch) };
  }
  const g = trayGeometry(trayOpts(p));
  const fit = drawerFit(p);
  const fitsDrawer = !fit ? null : g.width <= p.drawerWidth + 1e-9 && g.length <= p.drawerDepth + 1e-9 && (!(p.drawerHeight > 0) || g.height <= p.drawerHeight + 1e-9);
  const longest = Math.max(g.width, g.length);
  return { width: r3(g.width), length: r3(g.length), height: r3(g.height), inner: r3(g.innerWidth), depth: r3(g.cavityDepth), volume: Math.round(g.volume), tooLong: p.bed > 0 && longest > p.bed, longest: r3(longest), fit, fitsDrawer, pieces: 1, pieceWidth: r3(g.width), pieceLength: r3(g.length) };
}

type Doc = { features: Array<{ id?: string; group?: unknown }>; seq?: number };
function nextSeq(doc: Doc): number {
  let n = doc.seq ?? 1;
  for (const f of doc.features) { const m = /^F(\d+)$/.exec(String(f.id ?? '')); if (m) n = Math.max(n, Number(m[1]) + 1); }
  return n;
}
/** The ops that append the tray to the document (one tree folder named after the wizard, see wizardGroup.ts), numbered from the document's next feature id. Throws with the helper's message. */
export function trayOps(doc: Doc, p: TrayParams): EditOp[] {
  if (p.kind === 'baseplate') return groupOps(baseplateEditOps(plateOpts(p), nextSeq(doc)) as unknown as EditOp[], wizardGroupName(doc.features, t('tray.plateTitle')));
  return groupOps(trayEditOps(trayOpts(p), nextSeq(doc)) as unknown as EditOp[], wizardGroupName(doc.features, t('tray.title')));
}
