// DXF reader: the ASCII group-code format (R12 up to current) turned into plain geometry records. No sketch knowledge
// here; dxfImport.ts turns these into sketch points and entities, and the tests use it to read back what dxfWrite wrote.
// Binary DXF and DWG are refused. Entities in an OCS flipped to -Z (extrusion 0 0 -1, which mirrors X) are mirrored back.

export type DxfV = { x: number; y: number };
export interface DxfVertex extends DxfV { bulge: number }

export type DxfEntity =
  | { type: 'LINE'; layer: string; a: DxfV; b: DxfV }
  | { type: 'CIRCLE'; layer: string; c: DxfV; r: number }
  /** Counter-clockwise from `a0` to `a1`, degrees. */
  | { type: 'ARC'; layer: string; c: DxfV; r: number; a0: number; a1: number }
  | { type: 'POLYLINE'; layer: string; closed: boolean; verts: DxfVertex[] }
  | { type: 'SPLINE'; layer: string; closed: boolean; degree: number; rational: boolean; knots: number[]; controls: DxfV[]; fit: DxfV[] }
  | { type: 'POINT'; layer: string; p: DxfV };

export interface DxfFile {
  /** `$INSUNITS` as written (0 when absent). */
  insunits: number;
  entities: DxfEntity[];
  /** Entity types in the ENTITIES section that are not read, with their counts (INSERT, TEXT, HATCH, ELLIPSE, 3D types...). */
  unsupported: Record<string, number>;
}

export class DxfError extends Error {
  constructor(public readonly code: 'binary' | 'empty' | 'notDxf', message: string) { super(message); }
}

type Pair = [number, string];

function pairs(text: string): Pair[] {
  if (text.startsWith('AutoCAD Binary DXF')) throw new DxfError('binary', 'binary DXF is not supported');
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code)) throw new DxfError('notDxf', `line ${i + 1}: expected a group code, got "${lines[i].slice(0, 20)}"`);
    out.push([code, lines[i + 1].trim()]);
  }
  return out;
}

const num = (s: string) => { const v = Number(s); return Number.isFinite(v) ? v : 0; };
const normalLine = (a: number) => ((a % 360) + 360) % 360;

interface Raw { type: string; layer: string; codes: Pair[] }

/** Parse the text of a DXF file. */
export function parseDxf(text: string): DxfFile {
  const all = pairs(text);
  if (!all.some(([c, v]) => c === 0 && (v === 'SECTION' || v === 'EOF'))) throw new DxfError('notDxf', 'not a DXF file');
  let insunits = 0;
  const raws: Raw[] = [];
  let section = '';
  let i = 0;
  while (i < all.length) {
    const [code, val] = all[i];
    if (code === 0 && val === 'SECTION') { section = all[i + 1]?.[0] === 2 ? all[i + 1][1] : ''; i += 2; continue; }
    if (code === 0 && val === 'ENDSEC') { section = ''; i++; continue; }
    if (section === 'HEADER') {
      if (code === 9 && val === '$INSUNITS') { const nx = all[i + 1]; if (nx && nx[0] === 70) insunits = Math.round(num(nx[1])); }
      i++; continue;
    }
    if (section === 'ENTITIES' && code === 0) {
      const codes: Pair[] = [];
      let j = i + 1;
      while (j < all.length && all[j][0] !== 0) codes.push(all[j++]);
      raws.push({ type: val, layer: codes.find(([c]) => c === 8)?.[1] ?? '0', codes });
      i = j; continue;
    }
    i++;
  }

  const entities: DxfEntity[] = [];
  const unsupported: Record<string, number> = {};
  const skip = (t: string) => { unsupported[t] = (unsupported[t] ?? 0) + 1; };
  const first = (r: Raw, c: number, d = 0) => { const p = r.codes.find(([k]) => k === c); return p ? num(p[1]) : d; };
  /** x mirror when the entity's extrusion axis points to -Z */
  const flipped = (r: Raw) => first(r, 230, 1) < 0;

  for (let k = 0; k < raws.length; k++) {
    const r = raws[k];
    const mx = flipped(r) ? -1 : 1;
    switch (r.type) {
      case 'LINE':
        entities.push({ type: 'LINE', layer: r.layer, a: { x: first(r, 10), y: first(r, 20) }, b: { x: first(r, 11), y: first(r, 21) } });
        break;
      case 'CIRCLE':
        entities.push({ type: 'CIRCLE', layer: r.layer, c: { x: mx * first(r, 10), y: first(r, 20) }, r: first(r, 40) });
        break;
      case 'ARC': {
        let a0 = first(r, 50), a1 = first(r, 51);
        if (mx < 0) [a0, a1] = [180 - a1, 180 - a0];
        entities.push({ type: 'ARC', layer: r.layer, c: { x: mx * first(r, 10), y: first(r, 20) }, r: first(r, 40), a0: normalLine(a0), a1: normalLine(a1) });
        break;
      }
      case 'POINT':
        entities.push({ type: 'POINT', layer: r.layer, p: { x: mx * first(r, 10), y: first(r, 20) } });
        break;
      case 'LWPOLYLINE': {
        const verts: DxfVertex[] = [];
        for (const [c, v] of r.codes) {
          if (c === 10) verts.push({ x: mx * num(v), y: 0, bulge: 0 });
          else if (c === 20 && verts.length) verts[verts.length - 1].y = num(v);
          else if (c === 42 && verts.length) verts[verts.length - 1].bulge = mx * num(v);
        }
        entities.push({ type: 'POLYLINE', layer: r.layer, closed: (first(r, 70) & 1) === 1, verts });
        break;
      }
      case 'POLYLINE': {
        const flags = first(r, 70);
        const verts: DxfVertex[] = [];
        // the VERTEX records follow up to SEQEND
        while (k + 1 < raws.length && raws[k + 1].type === 'VERTEX') {
          const v = raws[++k];
          // spline-frame control vertices (flag 16) are not on the outline
          if ((first(v, 70) & 16) === 0) verts.push({ x: mx * first(v, 10), y: first(v, 20), bulge: mx * first(v, 42) });
        }
        if (raws[k + 1]?.type === 'SEQEND') k++;
        if (flags & (16 | 64)) { skip('POLYLINE (mesh)'); break; }
        entities.push({ type: 'POLYLINE', layer: r.layer, closed: (flags & 1) === 1, verts });
        break;
      }
      case 'SPLINE': {
        const flags = first(r, 70);
        const controls: DxfV[] = [], fit: DxfV[] = [], knots: number[] = [];
        for (const [c, v] of r.codes) {
          if (c === 10) controls.push({ x: num(v), y: 0 });
          else if (c === 20 && controls.length) controls[controls.length - 1].y = num(v);
          else if (c === 11) fit.push({ x: num(v), y: 0 });
          else if (c === 21 && fit.length) fit[fit.length - 1].y = num(v);
          else if (c === 40) knots.push(num(v));
        }
        entities.push({ type: 'SPLINE', layer: r.layer, closed: (flags & 1) === 1 || (flags & 2) === 2, degree: first(r, 71, 3), rational: (flags & 4) === 4, knots, controls, fit });
        break;
      }
      case 'VERTEX': case 'SEQEND': break;
      default: skip(r.type);
    }
  }
  return { insunits, entities, unsupported };
}

/** Millimetres per drawing unit for a `$INSUNITS` value (0 = unitless, taken as millimetres); null for a unit we do not convert. */
export function unitScale(insunits: number): number | null {
  switch (insunits) {
    case 0: case 4: return 1;
    case 1: return 25.4;       // inches
    case 2: return 304.8;      // feet
    case 3: return 1609344;    // miles
    case 5: return 10;         // centimetres
    case 6: return 1000;       // metres
    case 7: return 1e6;        // kilometres
    case 8: return 25.4e-6;    // microinches
    case 9: return 0.0254;     // mils
    case 10: return 914.4;     // yards
    case 13: return 1e-3;      // microns
    case 14: return 100;       // decimetres
    default: return null;
  }
}
