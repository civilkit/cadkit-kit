// Sheet metal tools: sheet_reference (the catalogue: every feature with fields, defaults, units and a worked example), sheet_info (rules, flat
// pattern, bend table and roles of the open document), sheet_export (flat pattern DXF and the bend table). Features are written with run_script
// (the sheet methods of the part chain) or the raw feature(); these tools read what they made.
//
// Why a tool of its own and not the `export` tool: `export` writes the 3D model in a model format (step, stl, glb, ckpart) and takes no options
// about layers, units or DXF versions; the flat pattern is a different product (a 2D cutting file with bend data) of the sheet features.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { SHEET_CATALOG, SHEET_COMING_TYPES, SHEET_ERROR_CODES, SHEET_REQUESTS, ruleAdvice } from '@kit/script';
import { SHEET_COMING, SHEET_RECIPE } from '@kit/skill';
import type { AgentSession, FlatPattern, SheetEntry } from './agent-session';
import { ToolError } from './errors';
import type { Schema } from './schema';
import type { ToolDef } from './tools';

const obj = (properties: Record<string, Schema>, required: string[] = []): Schema & { type: 'object' } => ({ type: 'object', properties, required, additionalProperties: false });
const r4 = (x: number): number => Number(x.toFixed(4));
const r6 = (x: number): number => Number(x.toFixed(6));

/** The entry of sheet feature `id`, or the latest one that has a flat pattern. */
async function pick(a: AgentSession, id?: string): Promise<{ entries: SheetEntry[]; entry: SheetEntry & { flatPattern: FlatPattern } }> {
  const entries = await a.sheetMetal();
  if (!entries.length) throw new ToolError('no_sheet', 'the document has no sheet metal features', 'run_script a sheet part first: sheetRules, a sketch, baseFlange (see sheet_reference)');
  let entry: SheetEntry | undefined;
  if (id) {
    entry = entries.find((e) => e.id === id);
    if (!entry) throw new ToolError('no_such_feature', `no sheet feature with id ${id}`, `sheet features: ${entries.map((e) => `${e.id} (${e.type})`).join(', ')}`);
    if (!entry.flatPattern) throw new ToolError('no_flat_pattern', `${id} is a ${entry.type}: it has no flat pattern`, `use a base flange or flange feature: ${entries.filter((e) => e.flatPattern).map((e) => e.id).join(', ')}`);
  } else entry = [...entries].reverse().find((e) => e.flatPattern);
  if (!entry?.flatPattern) throw new ToolError('no_flat_pattern', 'the document has sheet rules but no base flange yet', 'add a sketch and baseFlange after sheetRules');
  return { entries, entry: entry as SheetEntry & { flatPattern: FlatPattern } };
}

const bendRow = (b: FlatPattern['bends'][number]) => ({ bend: b.bend, role: b.role, feature: b.feature, direction: b.direction, angleDeg: b.angleDeg, radius: b.radius, allowance: r6(b.allowance), length: r4(b.length), start: b.start.map(r4), end: b.end.map(r4) });

export function sheetInfo(entries: SheetEntry[], entry: SheetEntry & { flatPattern: FlatPattern }, o: { outline?: boolean; roles?: boolean }) {
  const fp = entry.flatPattern;
  const rules = entries.filter((e) => e.type === 'sheetRules').map((e) => ({ id: e.id, ...e.rule }));
  const loops = fp.outline.map((l, i) => {
    const xs = l.map((p) => p[0]), ys = l.map((p) => p[1]);
    return { kind: i === 0 ? 'outer' : 'hole', points: l.length, bbox: [r4(Math.min(...xs)), r4(Math.min(...ys)), r4(Math.max(...xs)), r4(Math.max(...ys))], ...(o.outline ? { pts: l.map((p) => p.map(r4)) } : {}) };
  });
  return {
    feature: entry.id,
    featureType: entry.type,
    rule: entry.rule,
    rules,
    flatPattern: {
      rule: fp.rule, thickness: fp.thickness, kFactor: fp.kFactor,
      flatSize: { width: r4(fp.flatSize[0]), length: r4(fp.flatSize[1]), thickness: r4(fp.flatSize[2]) },
      unfolded: fp.unfolded,
      bendCount: fp.bends.length,
      bends: fp.bends.map(bendRow),
      bendZones: fp.bendZones.map((z) => z.map(r4)),
      loops,
    },
    features: entries.map((e) => ({ id: e.id, type: e.type, rule: e.rule.name, ...(e.flatPattern ? { flatSize: e.flatPattern.flatSize.slice(0, 2).map(r4), bends: e.flatPattern.bends.length } : {}) })),
    advice: [...new Set(rules.flatMap((r) => ruleAdvice(r)))],
    ...(o.roles ? { roles: entry.roles ?? null } : {}),
  };
}

export function sheetTools(): ToolDef[] {
  return [
    {
      name: 'sheet_reference',
      description: "The sheet metal catalogue, no document needed. Without `feature` it lists every sheet feature (sheetRules, baseFlange, edgeFlange, hem, fold, contourFlange, unfold, refold, and the requests sheetDxf / sheetBendTable) with its status ('available' or 'coming'), summary and the script method that writes it, plus the kernel error kinds and the recipe rules -> base flange -> flanges / hems -> flat pattern -> DXF. With `feature` (a wire type or script method name) it returns that entry in full: every field with type, default, unit and meaning, errors it can raise, a worked wire example and a worked script example. Features marked 'coming' are not in the kernel yet.",
      inputSchema: obj({ feature: { type: 'string', maxLength: 60, description: "e.g. 'edgeFlange', 'hem', 'sheetDxf'" } }),
      async handler(i) {
        const reqs = SHEET_REQUESTS as unknown as Array<{ type: string; summary: string; fields: unknown[] }>;
        if (typeof i.feature === 'string' && i.feature) {
          const q = i.feature.toLowerCase();
          const hit = SHEET_CATALOG.find((f) => f.type.toLowerCase() === q || f.scriptMethod?.toLowerCase() === q) ?? reqs.find((r) => r.type.toLowerCase() === q);
          if (!hit) throw new ToolError('unknown_feature', `no sheet metal feature named ${i.feature}`, `known: ${[...SHEET_CATALOG.map((f) => f.type), ...reqs.map((r) => r.type)].join(', ')}`);
          return { data: hit };
        }
        return {
          data: {
            features: SHEET_CATALOG.map((f) => ({ type: f.type, status: f.status, scriptMethod: f.scriptMethod, summary: f.summary })),
            requests: reqs.map((r) => ({ type: r.type, summary: r.summary, tool: 'sheet_export' })),
            tools: { sheet_info: 'rules, flat pattern, bends, roles of the open document', sheet_export: 'flat pattern DXF and bend table CSV / JSON', bodies: 'the sheet metal summary of the base body', run_script: 'writes the features' },
            errorKinds: SHEET_ERROR_CODES,
            comingFeatures: SHEET_COMING_TYPES,
            limits: SHEET_COMING,
            recipe: SHEET_RECIPE,
          },
        };
      },
    },
    {
      name: 'sheet_info',
      description: "Sheet metal results of the open document: the sheet rules (thickness, k-factor, bend radius, relief, gap), and the flat pattern with the bend table after a sheet feature (default the last one; `feature` picks another, e.g. the flat pattern before a hem): flatSize {width, length, thickness}, each bend (number, role B1.., direction up / down, angle, inside radius, bend allowance, bend line start / end, length), bend zones, outline loops (outer and holes; `outline: true` adds the points) and whether the sheet is unfolded. `advice` flags rule values that build but are poor practice (bend radius or relief below the thickness). `roles: true` adds the role names (P0.front, P0.side.e2, B1.back ...) and the body face each names, for {role} picks. Errors: no_sheet (no sheet features), no_flat_pattern.",
      inputSchema: obj({ feature: { type: 'string', maxLength: 80, description: 'id of a sheet feature (default: the last one with a flat pattern)' }, outline: { type: 'boolean', description: 'include the outline points of each loop (default: size and bbox only)' }, roles: { type: 'boolean', description: 'include the role -> face / edge table' } }),
      async handler(i, a) {
        const { entries, entry } = await pick(a, i.feature as string | undefined);
        const data = sheetInfo(entries, entry, { outline: i.outline === true, roles: i.roles === true });
        const fs = data.flatPattern.flatSize;
        return { summary: `${entry.id} ${entry.type}: flat ${fs.width} x ${fs.length} x ${fs.thickness} mm, ${data.flatPattern.bendCount} bends${data.flatPattern.unfolded ? ' (unfolded)' : ''}`, data };
      },
    },
    {
      name: 'sheet_export',
      description: "Export the flat pattern of the sheet metal part. format 'dxf' writes a DXF (to `path`, default ./<part name>-flat.dxf) and returns the path, size, bounds, bend count and the entity count per layer; layers CUT_OUTER (outer contour), CUT_INNER (holes), BEND_UP / BEND_DOWN (bend centre lines, dashed), BEND_TANGENT, BEND_NOTES. Options: version R2000 (default) | R12; units mm (default) | cm | m | in | ft; bendLines (default true); tangentLines (default false); bendNotes (a TEXT like 'B1 UP 90%%d R2' per bend); noteHeight mm; layers roles | single; layerNames cadkit | reference. format 'csv' or 'json' returns the bend table text (one row per bend: angle, direction, radius, allowance, length, start / end), also written to `path` when given. `feature` picks the sheet feature whose flat pattern is exported (default the last). To export the 3D model use export; for a drawing sheet use drawing.",
      inputSchema: obj({
        format: { type: 'string', enum: ['dxf', 'csv', 'json'] },
        feature: { type: 'string', maxLength: 80 },
        path: { type: 'string', maxLength: 500 },
        version: { type: 'string', enum: ['R2000', 'R12'] },
        units: { type: 'string', enum: ['mm', 'cm', 'm', 'in', 'ft'] },
        bendLines: { type: 'boolean' }, tangentLines: { type: 'boolean' }, bendNotes: { type: 'boolean' },
        noteHeight: { type: 'number', minimum: 0.1, maximum: 1000 },
        layers: { type: 'string', enum: ['roles', 'single'] },
        layerNames: { type: 'string', enum: ['cadkit', 'reference'] },
        body: { type: 'string', maxLength: 80, description: 'body name written into the bend table (default Body1)' },
      }, ['format']),
      async handler(i, a) {
        const { entry } = await pick(a, i.feature as string | undefined);
        const fmt = String(i.format);
        const stem = (a.doc.name || 'part').replace(/[^\w\- ]+/g, '_').trim() || 'part';
        const write = (ext: string, text: string) => {
          const path = resolvePath(typeof i.path === 'string' && i.path ? i.path : `${stem}-flat.${ext}`);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, text);
          return { path, bytes: Buffer.byteLength(text) };
        };
        if (fmt === 'dxf') {
          const opt: Record<string, unknown> = {};
          for (const k of ['version', 'units', 'bendLines', 'tangentLines', 'bendNotes', 'noteHeight', 'layers', 'layerNames']) if (i[k] !== undefined) opt[k] = i[k];
          const r = await a.sheetRequest({ type: 'sheetDxf', flatPattern: entry.flatPattern, ...opt }) as { dxf: string; bends: number; bounds: number[]; entities: Record<string, number> };
          const w = write('dxf', r.dxf);
          return { summary: `flat pattern DXF ${w.path}`, data: { format: 'dxf', feature: entry.id, ...w, bends: r.bends, bounds: r.bounds.map(r4), units: i.units ?? 'mm', version: i.version ?? 'R2000', entities: r.entities } };
        }
        const r = await a.sheetRequest({ type: 'sheetBendTable', flatPattern: entry.flatPattern, format: fmt, ...(i.body ? { body: i.body } : {}) }) as { format: string; text: string; bends: number };
        const w = typeof i.path === 'string' && i.path ? write(fmt, r.text) : null;
        return { summary: `bend table (${fmt}), ${r.bends} bends`, data: { format: fmt, feature: entry.id, bends: r.bends, ...(w ?? {}), text: r.text } };
      },
    },
  ];
}
