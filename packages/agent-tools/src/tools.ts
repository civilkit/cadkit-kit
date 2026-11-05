// The tool definitions: name, description, JSON schema, handler. Transport independent (the MCP server and the in-app agent
// both call `callTool`). ONE tool changes the model (`run_script`); the others read, prove, show or document.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { meshToStl } from '@kit/io';
import type { AgentSession } from './agent-session';
import { ToolError } from './errors';
import { listBodies } from './bodies';
import { meshToGlb } from './exporters';
import { viewCacheField } from './viewCache';
import type { Schema } from './schema';

export interface ToolOutput {
  data: unknown;
  images?: Array<{ data: string; mimeType: string }>;
  /** One line of text shown before the JSON. */
  summary?: string;
}
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Schema & { type: 'object' };
  handler(input: Record<string, unknown>, a: AgentSession): Promise<ToolOutput>;
}

/** The sheets @kit/snapshot renders (a test keeps this in step with its SHEET_NAMES). */
export const SHEET_NAMES = ['single', 'orthos', 'drawing-third-angle', 'drawing-first-angle', 'ab', 'section'] as const;
const SHEET_HELP_TEXT = 'single (default) | orthos (front, top, right, iso panels) | drawing-third-angle | drawing-first-angle (projected views, overall dimensions, title block) | ab (two views side by side) | section (needs `section`)';
const vec3: Schema = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema & { type: 'object' } => ({ type: 'object', properties, required, additionalProperties: false });
const round = (x: number | null | undefined, d = 4): number | null => (typeof x === 'number' && Number.isFinite(x) ? Number(x.toFixed(d)) : null);

/** Volume, area, bbox, counts and validity of the open document. */
export async function summarize(a: AgentSession) {
  const s = a.session;
  const t0 = performance.now();
  const facts = await s.facts().catch(() => null);
  let mass: { volume?: number; area?: number; com?: number[]; principal?: number[]; axes?: number[][]; firstMoment?: number[]; inertia?: number[][]; inertiaOrigin?: number[][] } | null = null;
  try { mass = await s.massProps(); } catch { mass = null; }
  let validity: { ok: boolean | null; issues: unknown[] } = { ok: null, issues: [] };
  if (facts && facts.solids > 0) {
    try { const v = await s.validate(); validity = { ok: v.ok, issues: v.issues.slice(0, 10) }; } catch { /* no body */ }
  }
  // exact bounding box from the kernel's check (the facts box comes from the display mesh and is a little smaller on curved parts)
  let exact: { min: number[]; max: number[] } | null = null;
  if (facts && facts.solids > 0) {
    try { exact = ((await s.check([{ kind: 'valid' }])) as { measured?: { bbox?: { min: number[]; max: number[] } } }).measured?.bbox ?? null; } catch { exact = null; }
  }
  const box = exact ?? facts?.box ?? null;
  return {
    featureCount: a.doc.features.length,
    solids: facts?.solids ?? 0,
    volume: round(mass?.volume ?? facts?.volume ?? null),
    area: round(mass?.area ?? null),
    centerOfMass: mass?.com ? mass.com.map((x) => round(x) as number) : null,
    // unit density (volume-weighted: mm^4 first moment, mm^5 inertia), world axes, tensors as rows; multiply by the density in g/mm3 for g mm / g mm2
    firstMoment: mass?.firstMoment ? mass.firstMoment.map((x) => round(x) as number) : null,
    inertia: mass?.inertia ? mass.inertia.map((r) => r.map((x) => round(x) as number)) : null,
    inertiaOrigin: mass?.inertiaOrigin ? mass.inertiaOrigin.map((r) => r.map((x) => round(x) as number)) : null,
    principalMoments: mass?.principal ? mass.principal.map((x) => round(x) as number) : null,
    principalAxes: mass?.axes ? mass.axes.map((a) => a.map((x) => round(x, 6) as number)) : null,
    bbox: box ? { min: box.min.map((x) => round(x)), max: box.max.map((x) => round(x)), size: box.max.map((x, i) => round(x - box.min[i])) } : null,
    faceCount: facts?.faces.length ?? 0,
    edgeCount: facts?.edges.length ?? 0,
    validity,
    summaryMs: Math.round(performance.now() - t0),
  };
}

const KEY_SKIP = new Set(['id', 'type', 'name', 'origin']);
function keyParams(f: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (KEY_SKIP.has(k)) continue;
    if (v === null || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.length > 60 ? `${v.slice(0, 60)}...` : v;
    else if (Array.isArray(v)) out[k] = f.type === 'sketch' ? `${v.length} items` : (JSON.stringify(v).length <= 80 ? v : `${v.length} items`);
    else if (typeof v === 'object') { const j = JSON.stringify(v); out[k] = j.length <= 80 ? v : '{...}'; }
  }
  return out;
}

async function errorMap(a: AgentSession): Promise<Map<string, { code?: string; message: string; hint: string }>> {
  const m = new Map<string, { code?: string; message: string; hint: string }>();
  try {
    const r = await a.session.regenReport();
    r.errors.forEach(([fid, e], i) => m.set(fid, { code: e.code, message: (e as { message?: string }).message ?? e.code ?? 'error', hint: r.hints[i]?.hint ?? '' }));
  } catch { /* none */ }
  return m;
}

const featureRow = (a: AgentSession, f: Record<string, unknown>, i: number, errs: Map<string, { code?: string; message: string; hint: string }>) => ({
  index: i, id: f.id, type: f.type, name: f.name ?? null, origin: a.originOf(f as never) ?? 'hand', params: keyParams(f), ...(errs.has(String(f.id)) ? { error: errs.get(String(f.id)) } : {}),
});

function planeInput(p: Record<string, unknown>): { origin: number[]; normal: number[] } {
  return { origin: (p.origin as number[]) ?? [0, 0, 0], normal: p.normal as number[] };
}

function img(data: unknown): string | null {
  if (typeof data === 'string') return data.replace(/^data:image\/png;base64,/, '');
  if (data instanceof Uint8Array) return Buffer.from(data).toString('base64');
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString('base64');
  return null;
}

export type SnapshotFn = (session: unknown, opts: Record<string, unknown>) => Promise<unknown>;
export async function loadSnapshotFn(): Promise<SnapshotFn> {
  const spec = '@kit/snapshot';
  let mod: Record<string, unknown>;
  try { mod = await import(/* @vite-ignore */ spec); } catch {
    throw new ToolError('snapshot_unavailable', 'snapshot package not installed', 'the @kit/snapshot package is not part of this build; use section / sections / probe for numeric checks instead');
  }
  const fn = (mod.snapshotOf ?? mod.renderSnapshot) as SnapshotFn | undefined;
  if (typeof fn !== 'function') throw new ToolError('snapshot_unavailable', 'snapshot package not installed', '@kit/snapshot has no snapshotOf / renderSnapshot export');
  return fn;
}

export function createTools(): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: 'run_script',
      description: "THE tool that changes the model. Runs a script (see list_methods / docs) that builds a normal feature tree. mode 'new' replaces the whole document with the script's part. mode 'attach' APPENDS the script's features to the open document, leaving hand-made features untouched; by default it first removes the features of the previous script run (replace:'last') so re-running a corrected script does not duplicate it ('all' replaces every script feature, 'none' only appends). Atomic: on any error nothing changes. Returns errors with the script line and a repair hint, warnings (e.g. an ambiguous face('>Z') after a boss, a cut direction flipped automatically: read them), feature count, volume, area, bbox and validity. The script may `await part.volume()` / `.bbox()` / `.faces()` mid-script and assert with `.expectVolume(v)` / `.expectValid()` / `.expectBBox(...)` (failures are errors with their line); each read costs a rebuild.",
      inputSchema: obj({
        code: { type: 'string', maxLength: 40000, description: 'The script text. Must call part("Name") and chain features.' },
        mode: { type: 'string', enum: ['new', 'attach'], description: "'new' replaces the document; 'attach' adds to it." },
        name: { type: 'string', maxLength: 120, description: "Part name for mode 'new' (default: the name given to part())." },
        replace: { type: 'string', enum: ['last', 'all', 'none'], description: "attach only: which earlier script features to replace (default 'last')." },
      }, ['code', 'mode']),
      async handler(i, a) {
        const rep = await a.runScript(String(i.code), i.mode as 'new' | 'attach', { name: i.name as string | undefined, replace: i.replace as never });
        const sum = rep.ok ? await summarize(a) : null;
        const { ok, errors, warnings } = rep;
        return {
          summary: ok ? `script#${rep.run} (${rep.mode}) built ${rep.created.length} features, volume ${sum?.volume}` : `script failed: ${errors[0]?.line ? `line ${errors[0].line}: ` : ''}${errors[0]?.message}`,
          data: { ok, run: `script#${rep.run}`, mode: rep.mode, errors, warnings, created: rep.created, removed: rep.removed, regenMs: Math.round(rep.regenMs), ...(sum ?? { featureCount: a.doc.features.length }) },
        };
      },
    },
    {
      name: 'tree',
      description: 'The feature list in order: id, type, name, origin (script#N or hand), key parameters and regeneration errors with hints.',
      inputSchema: obj({}),
      async handler(_i, a) {
        const errs = await errorMap(a);
        const rows = (a.doc.features as unknown as Array<Record<string, unknown>>).map((f, i) => featureRow(a, f, i, errs));
        return { data: { name: a.doc.name, featureCount: rows.length, handMade: rows.filter((r) => r.origin === 'hand').length, features: rows, errorCount: errs.size } };
      },
    },
    {
      name: 'find',
      description: 'Search features (by id, type, name, origin or any text in their JSON) and the face / edge persistent names. Returns short rows; use inspect for one feature in full.',
      inputSchema: obj({ query: { type: 'string', maxLength: 200 } }, ['query']),
      async handler(i, a) {
        const q = String(i.query).toLowerCase().trim();
        const errs = await errorMap(a);
        const feats = (a.doc.features as unknown as Array<Record<string, unknown>>).map((f, idx) => ({ f, idx })).filter(({ f }) => `${f.id} ${f.type} ${f.name ?? ''} ${a.originOf(f as never) ?? 'hand'} ${JSON.stringify(f)}`.toLowerCase().includes(q));
        const facts = await a.session.facts().catch(() => null);
        const faces = (facts?.faces ?? []).filter((n) => n.toLowerCase().includes(q));
        const edges = (facts?.edges ?? []).filter((n) => n.toLowerCase().includes(q));
        return { data: { features: feats.slice(0, 50).map(({ f, idx }) => featureRow(a, f, idx, errs)), faces: faces.slice(0, 100), edges: edges.slice(0, 100), totals: { features: feats.length, faces: faces.length, edges: edges.length } } };
      },
    },
    {
      name: 'inspect',
      description: 'One feature in full: its JSON (sketch points and entities included), the faces and edges it created with their persistent names, what depends on it, and its error if any.',
      inputSchema: obj({ id: { type: 'string', maxLength: 80 } }, ['id']),
      async handler(i, a) {
        const id = String(i.id);
        const feats = a.doc.features as unknown as Array<Record<string, unknown>>;
        const idx = feats.findIndex((f) => f.id === id);
        if (idx < 0) throw new ToolError('no_such_feature', `no feature with id ${id}`, `ids in order: ${feats.map((f) => f.id).join(', ')}`);
        const f = feats[idx];
        const errs = await errorMap(a);
        const facts = await a.session.facts().catch(() => null);
        const own = (n: string) => n.split('|').some((p) => p === id || p.startsWith(`${id}.`));
        const { referencers } = await import('@ck/session');
        return {
          data: {
            index: idx, feature: { ...f, origin: a.originOf(f as never) ?? 'hand' },
            createdFaces: (facts?.faces ?? []).filter(own),
            touchedEdges: (facts?.edges ?? []).filter(own).slice(0, 200),
            usedBy: referencers(a.doc, id),
            ...(errs.has(id) ? { error: errs.get(id) } : {}),
          },
        };
      },
    },
    {
      name: 'facts',
      description: 'Mass properties, bounding box, face / edge / solid counts and validity of the open document. Optional `expect` runs the kernel check grammar (volume, bbox, counts, valid) and returns pass / fail per item.',
      inputSchema: obj({ expect: { type: 'array', items: { type: 'object' }, description: "e.g. [{kind:'volume', value:1200, tol:0.01}, {kind:'valid'}]" } }),
      async handler(i, a) {
        const sum = await summarize(a);
        const check = Array.isArray(i.expect) && i.expect.length ? await a.session.check(i.expect as never) : undefined;
        return { data: { ...sum, ...(check ? { check } : {}) } };
      },
    },
    {
      name: 'bodies',
      description: 'One row per body (connected solid lump) of the open document: name, the feature that created it, volume, bounding box, colour / opacity / finish and hidden flag. Use it after run_script when `solids` is not what you expect: it shows WHICH parts fused (touching solids merge into one body unless extrude / revolve / sweep got newBody) or which one a cut sliced.',
      inputSchema: obj({}),
      async handler(_i, a) {
        const rows = await listBodies(a);
        return { summary: `${rows.length} bod${rows.length === 1 ? 'y' : 'ies'}`, data: { count: rows.length, bodies: rows } };
      },
    },
    {
      name: 'probe',
      description: 'Is there material at a point / what does a ray hit. points: [[x,y,z],...] give inside / outside / boundary and the signed distance to the nearest face; rays: [{origin, dir}] give hit lists with face names.',
      inputSchema: obj({
        points: { type: 'array', items: vec3, maxItems: 500 },
        rays: { type: 'array', items: obj({ origin: vec3, dir: vec3 }, ['origin', 'dir']), maxItems: 200 },
      }),
      async handler(i, a) {
        if (!i.points && !i.rays) throw new ToolError('bad_input', 'give points or rays', 'e.g. {"points": [[0,0,5]]}');
        return { data: await a.session.probe({ points: i.points as number[][] | undefined, rays: i.rays as never }) };
      },
    },
    {
      name: 'section',
      description: 'Exact cross-section of the body at a plane: loops (outer / inner), their areas and the plane frame. By default loops are summarised; detail:true adds their polyline points.',
      inputSchema: obj({ plane: obj({ origin: vec3, normal: vec3 }, ['normal']), detail: { type: 'boolean' } }, ['plane']),
      async handler(i, a) {
        const r = await a.session.section(planeInput(i.plane as Record<string, unknown>));
        const loops = (r.loops ?? []).map((l) => ({ kind: l.kind, area: round(l.area), edges: l.edges?.length ?? 0, ...(i.detail ? { pts: l.pts } : {}) }));
        return { data: { frame: r.frame, area: round(r.area), bbox2d: r.bbox2d, openChains: r.openChains ?? 0, loops } };
      },
    },
    {
      name: 'sections',
      description: 'A stack of n cross-sections along an axis (or at explicit positions): areas per slice and the volume they integrate to, compared with the exact volume (an independent cross-check).',
      inputSchema: obj({ axis: { type: 'string', enum: ['x', 'y', 'z'] }, n: { type: 'integer', minimum: 1, maximum: 200 }, positions: { type: 'array', items: { type: 'number' }, maxItems: 200 } }, ['axis']),
      async handler(i, a) {
        const r = await a.session.sections({ axis: i.axis as 'x' | 'y' | 'z', n: i.n as number | undefined, positions: i.positions as number[] | undefined });
        return { data: { ...r, areas: r.areas.map((x) => round(x)) } };
      },
    },
    {
      name: 'snapshot',
      description: "Render the model to a PNG (returned as image content). view: iso | front | back | left | right | top | bottom ('front' looks along the part's -Z); style: shaded | edges | xray | hidden-line | mono; projection: ortho (alias orthographic) | persp (alias perspective); section: {origin?, normal} plane to cut at; sheet: " + SHEET_HELP_TEXT + "; sheet:true means drawing-third-angle; annotate:true draws the overall bounding-box dimensions on a single view; highlight: face names; markers: [{p:[x,y,z], label?}]. For a full engineering drawing (hole callouts, sections, PDF / DXF) use the drawing tool. Needs the @kit/snapshot package.",
      inputSchema: obj({
        view: { type: 'string', maxLength: 40 }, up: { type: 'string', maxLength: 10 },
        size: { type: 'integer', minimum: 64, maximum: 2048 }, style: { type: 'string', maxLength: 40 },
        projection: { type: 'string', enum: ['ortho', 'orthographic', 'persp', 'perspective'] },
        section: obj({ origin: vec3, normal: vec3 }, ['normal']),
        sheet: { oneOf: [{ type: 'boolean' }, { type: 'string', enum: SHEET_NAMES }] },
        highlight: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 100 },
        markers: { type: 'array', items: { type: 'object' }, maxItems: 100 },
        frame: { type: 'boolean', description: 'ignored (the framing is automatic)' }, annotate: { type: 'boolean' }, background: { type: 'string', maxLength: 20 },
      }),
      async handler(i, a) {
        const fn = a.snapshotFn ?? (await loadSnapshotFn());
        const { frame: _frame, ...snapOpts } = i;   // `frame` is a pinned-framing object in the renderer; a boolean here is not one
        void _frame;
        const raw = await fn(a.session, { size: 768, ...snapOpts }) as unknown;
        let png: string | null = img(raw);
        let extra: Record<string, unknown> = {};
        if (!png && raw && typeof raw === 'object') {
          const r = raw as Record<string, unknown>;
          png = img(r.png) ?? img(r.data) ?? img(r.image) ?? img((r.image as Record<string, unknown> | undefined)?.data);
          const { png: _p, data: _d, image: _i, rgba: _px, ...rest } = r;
          // what stays is a short summary (sizes, counts): anything bulky, such as pixel arrays, is left out of the text block
          extra = Object.fromEntries(Object.entries(rest).filter(([, v]) => (JSON.stringify(v) ?? '').length <= 2000));
        }
        if (!png) throw new ToolError('snapshot_failed', 'the snapshot renderer returned no image', 'try another view or a smaller size');
        return { summary: `snapshot ${String(i.view ?? 'iso')} ${i.size ?? 768}px`, images: [{ data: png, mimeType: 'image/png' }], data: { view: i.view ?? 'iso', size: i.size ?? 768, bytes: Math.floor(png.length * 0.75), ...extra } };
      },
    },
    {
      name: 'drawing',
      description: "Make an engineering drawing sheet of the open document with the app's drawing layer: standard views (front, top, right, iso ...), automatic dimensions (overall size, diameters), hole callouts, an optional section view, title block. Returns the SVG text (and a PNG-free summary of what was drawn); with `path` it also writes <path>.pdf and <path>.dxf (or the exact file given with .pdf / .dxf / .svg). Hole callouts such as 'M2.5 TAPPED DEPTH 2' appear only for real hole features (hole, holes.points / polar / grid), not for a sketch circle plus a cut. Options: views (first must be 'front'), sheet (A4 A3 A2 A1 A0, ANSI A-E), orientation, scale ('2:1', default: best fit), projection (third | first), hidden (hidden lines, default false), dimensions (default true), section (true or {dir:'v'|'h', at}), tidy (default true: callout leaders point away from the view centre, tiny diameters are dropped; minDiameter mm).",
      inputSchema: obj({
        views: { type: 'array', items: { type: 'string', enum: ['front', 'top', 'right', 'left', 'bottom', 'back', 'iso'] }, minItems: 1, maxItems: 7 },
        sheet: { type: 'string', enum: ['A4', 'A3', 'A2', 'A1', 'A0', 'ANSI A', 'ANSI B', 'ANSI C', 'ANSI D', 'ANSI E'] },
        orientation: { type: 'string', enum: ['landscape', 'portrait'] },
        scale: { type: 'string', maxLength: 12 },
        projection: { type: 'string', enum: ['third', 'first'] },
        hidden: { type: 'boolean' }, dimensions: { type: 'boolean' }, tidy: { type: 'boolean' }, minDiameter: { type: 'number', minimum: 0, maximum: 1000 },
        section: { oneOf: [{ type: 'boolean' }, obj({ dir: { type: 'string', enum: ['v', 'h'] }, at: { type: 'number' } })] },
        title: obj({ title: { type: 'string', maxLength: 120 }, partNo: { type: 'string', maxLength: 60 }, material: { type: 'string', maxLength: 60 }, author: { type: 'string', maxLength: 60 }, revision: { type: 'string', maxLength: 10 }, company: { type: 'string', maxLength: 80 } }),
        path: { type: 'string', maxLength: 500, description: 'where to write the files: <path>.pdf and <path>.dxf, or a file name ending .pdf / .dxf / .svg for that one format' },
        includeSvg: { type: 'boolean', description: 'return the SVG text in the result (default true when no path is given)' },
      }),
      async handler(i, a) {
        if (!a.doc.features.length) throw new ToolError('no_body', 'the document is empty', 'run_script first');
        let mod: typeof import('@kit/cad-drawing');
        try { mod = await import('@kit/cad-drawing'); } catch (e) {
          throw new ToolError('drawing_unavailable', `the drawing layer could not be loaded: ${(e as Error).message}`, 'the MCP must run through the repo launcher (vite-node) so the app modules resolve');
        }
        let d;
        try {
          d = await mod.drawHeadless(a.session, { views: i.views as string[] | undefined, sheet: i.sheet as string | undefined, orientation: i.orientation as never, scale: i.scale as string | undefined, projection: i.projection as never, hidden: i.hidden as boolean | undefined, dimensions: i.dimensions as boolean | undefined, section: i.section as never, tidy: i.tidy as boolean | undefined, minDiameter: i.minDiameter as number | undefined, title: i.title as never });
        } catch (e) { throw new ToolError('drawing_failed', (e as Error).message, 'check views / sheet / scale; the document needs a solid'); }
        const written: Array<{ path: string; bytes: number }> = [];
        if (typeof i.path === 'string' && i.path) {
          const base = resolvePath(i.path);
          const m = /\.(pdf|dxf|svg)$/i.exec(base);
          const out: Array<[string, string | Uint8Array]> = m ? [[base, m[1].toLowerCase() === 'pdf' ? d.pdf() : m[1].toLowerCase() === 'dxf' ? d.dxf() : d.svg]] : [[`${base}.pdf`, d.pdf()], [`${base}.dxf`, d.dxf()], [`${base}.svg`, d.svg]];
          for (const [p, bytes] of out) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, bytes); written.push({ path: p, bytes: typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.byteLength }); }
        }
        const withSvg = i.includeSvg ?? !written.length;
        return {
          summary: `drawing ${d.summary.sheet} ${d.summary.scale}, ${d.summary.views.length} views, ${d.summary.dimensions} dimensions`,
          data: { ...d.summary, sheetSize: d.size, warnings: d.warnings, written, ...(withSvg ? { svg: d.svg } : {}) },
        };
      },
    },
    {
      name: 'checkpoint',
      description: 'Save the whole document under a name (in memory, bounded; the oldest is dropped past the limit). Cheap; make one before a risky script.',
      inputSchema: obj({ name: { type: 'string', maxLength: 60 } }, ['name']),
      async handler(i, a) {
        const st = a.saveCheckpoint(String(i.name));
        return { data: { saved: i.name, features: st.doc.features.length, checkpoints: a.checkpoints.size } };
      },
    },
    {
      name: 'restore',
      description: 'Replace the document with a named checkpoint. Notes are NOT restored (they persist). Undoable.',
      inputSchema: obj({ name: { type: 'string', maxLength: 60 } }, ['name']),
      async handler(i, a) {
        const st = a.checkpoints.get(String(i.name));
        if (!st) throw new ToolError('no_such_checkpoint', `no checkpoint named ${i.name}`, `existing: ${[...a.checkpoints.keys()].join(', ') || '(none)'}`);
        await a.setDocument(st.doc, `restore ${i.name}`);
        a.rebuildOrigins();
        return { data: { restored: i.name, features: st.doc.features.length } };
      },
    },
    {
      name: 'checkpoints',
      description: 'List the saved checkpoints.',
      inputSchema: obj({}),
      async handler(_i, a) {
        return { data: { checkpoints: [...a.checkpoints.entries()].map(([name, s]) => ({ name, features: s.doc.features.length, time: new Date(s.time).toISOString() })) } };
      },
    },
    {
      name: 'notes',
      description: 'A scratch notes string that persists across restore and undo. Without `text` it reads; with `text` it replaces (append:true appends).',
      inputSchema: obj({ text: { type: 'string', maxLength: 20000 }, append: { type: 'boolean' } }),
      async handler(i, a) {
        if (typeof i.text === 'string') a.notes = i.append ? `${a.notes}${a.notes ? '\n' : ''}${i.text}` : i.text;
        return { data: { notes: a.notes } };
      },
    },
    {
      name: 'list_methods',
      description: 'Search the script API (every method run_script accepts is listed). Without a query it returns the guide and every method (name, group, signature, summary). Use docs for details.',
      inputSchema: obj({ query: { type: 'string', maxLength: 200 } }),
      async handler(i, a) {
        const list = i.query ? a.registry.search(String(i.query), 20) : a.registry.methods();
        return { data: { guide: i.query ? undefined : a.registry.guide(), methods: list.map((m) => ({ name: m.name, group: m.group, signature: m.signature, summary: m.summary })), recipes: i.query ? undefined : a.registry.recipes().map((r) => ({ id: r.id, title: r.title })) } };
      },
    },
    {
      name: 'docs',
      description: "Full documentation (signature, parameters, notes, example) for method names such as 'extrude', 'holes.polar', 's.arc3', 'appearance', or the code of recipes by id. docs {names:['guide']} returns the full guide (units, plane frames, bodies, workflow, common errors).",
      inputSchema: obj({ names: { type: 'array', items: { type: 'string', maxLength: 80 }, minItems: 1, maxItems: 30 } }, ['names']),
      async handler(i, a) {
        const out: unknown[] = [];
        for (const n of i.names as string[]) {
          if (n === 'guide' || n === 'llms.txt' || n === 'llms') { out.push({ name: n, guide: n === 'guide' ? a.registry.guide() : (a.registry.llmsTxt?.() ?? a.registry.guide()) }); continue; }
          const m = a.registry.get(n);
          const r = a.registry.recipes().find((x) => x.id === n);
          const close = m || r ? [] : (a.registry.suggest?.(n) ?? []);
          out.push(m ?? r ?? { name: n, error: 'unknown', hint: close.length ? `did you mean: ${close.join(', ')}? (list_methods {query} searches)` : 'use list_methods {query} to search' });
        }
        return { data: { docs: out } };
      },
    },
    {
      name: 'undo',
      description: 'Undo the last document change (a run_script, restore, ...).',
      inputSchema: obj({}),
      async handler(_i, a) {
        const undone = await a.undo();
        if (undone === null) throw new ToolError('nothing_to_undo', 'nothing to undo', 'the history starts at the empty part');
        a.rebuildOrigins();
        return { data: { undone, featureCount: a.doc.features.length, canUndo: a.canUndo, canRedo: a.canRedo } };
      },
    },
    {
      name: 'redo',
      description: 'Redo the last undone change.',
      inputSchema: obj({}),
      async handler(_i, a) {
        const redone = await a.redo();
        if (redone === null) throw new ToolError('nothing_to_redo', 'nothing to redo');
        a.rebuildOrigins();
        return { data: { redone, featureCount: a.doc.features.length, canUndo: a.canUndo, canRedo: a.canRedo } };
      },
    },
    {
      name: 'ask_user',
      description: 'There is no UI on this route: returns a structured "needs user input" result. Ask the user the question in your own reply and wait for the answer before continuing.',
      inputSchema: obj({ question: { type: 'string', maxLength: 1000 }, options: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 10 } }, ['question']),
      async handler(i) {
        return { summary: 'needs user input', data: { needsUserInput: true, question: i.question, options: i.options ?? [], instruction: 'Stop and put this question to the user in your reply; continue only with their answer.' } };
      },
    },
    {
      name: 'export',
      description: "Write the model to a file: step | stl | glb | ckpart (the document JSON). `path` defaults to ./<part name>.<ext> in the server's working directory. Returns the path and size. `cache: true` (ckpart only) also writes the built view as the file's `viewCache` field, as the app's \"Save geometry in file\" does: the app then shows the part at once on open and rebuilds behind it. It is used only if the recipe and the kernel build match, else ignored. Refused (nothing written, code view_unavailable) for documents it cannot reproduce exactly: a curated or embedded font (text in the built-in fonts is fine), a rolled-back document, a kernel whose wasm cannot be hashed. Mesh formats (stl, glb) take `quality` (coarse | normal | fine, default normal: the viewer's mesh) and/or `chord_mm`, an absolute chord height in mm (the most a facet may sit off the true surface; it replaces the preset's chord; smaller means more triangles); the reply says the chord used and the triangle count.",
      inputSchema: obj({ format: { type: 'string', enum: ['step', 'stl', 'glb', 'ckpart'] }, path: { type: 'string', maxLength: 500 }, cache: { type: 'boolean' }, quality: { type: 'string', enum: ['coarse', 'normal', 'fine'] }, chord_mm: { type: 'number', minimum: 0, maximum: 1000000 } }, ['format']),
      async handler(i, a) {
        const fmt = String(i.format);
        if (i.cache === true && fmt !== 'ckpart') throw new ToolError('bad_input', 'cache applies to the ckpart format only', 'drop cache, or use format ckpart');
        if ((i.quality !== undefined || i.chord_mm !== undefined) && fmt !== 'stl' && fmt !== 'glb') throw new ToolError('bad_input', 'quality and chord_mm apply to the mesh formats stl and glb only', 'drop them, or use format stl or glb');
        const stem = (a.doc.name || 'part').replace(/[^\w\- ]+/g, '_').trim() || 'part';
        const path = resolvePath(typeof i.path === 'string' && i.path ? i.path : `${stem}.${fmt === 'ckpart' ? 'ckpart' : fmt}`);
        let bytes: Uint8Array | string;
        let extra: Record<string, unknown> = {};
        if (fmt === 'ckpart') {
          const doc = a.doc;
          if (i.cache === true) {
            const view = await viewCacheField(a, doc);
            bytes = JSON.stringify({ ...doc, viewCache: view }, null, 1);
            extra = { viewCache: { build: view.build, key: view.key, base64Bytes: view.data.length } };
          } else bytes = JSON.stringify(doc, null, 1);
        }
        else if (fmt === 'step') bytes = await a.session.step(stem);
        else {
          const v = await a.session.bodyForView();
          if (!v || !v.mesh.positions.length) throw new ToolError('no_body', 'the document has no solid to export', 'run_script first');
          let mesh: { positions: Float32Array } = v.mesh;
          if (i.quality !== undefined || i.chord_mm !== undefined) {
            let rep;
            try { rep = await a.session.exportMesh({ ...(i.quality !== undefined ? { quality: i.quality as 'coarse' | 'normal' | 'fine' } : {}), ...(i.chord_mm !== undefined ? { chord_mm: Number(i.chord_mm) } : {}) }); }
            catch (e) { throw new ToolError('bad_input', (e as Error).message, 'quality is coarse, normal or fine; chord_mm is a positive number of millimetres'); }
            mesh = rep.mesh;
            extra = { chord_mm: rep.chord, ...(rep.chordRaised ? { chordRaised: true } : {}), ...(rep.failed.length ? { unmeshedFaces: rep.failed } : {}) };
          }
          if (fmt === 'stl') { const r = meshToStl(mesh, { name: stem }); bytes = r.data; extra = { ...extra, triangles: r.triangles, watertight: (r.check as { watertight?: boolean }).watertight }; }
          else { bytes = meshToGlb(mesh.positions, stem); extra = { ...extra, triangles: mesh.positions.length / 9 }; }
        }
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, bytes);
        return { data: { format: fmt, path, bytes: typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.byteLength, ...extra } };
      },
    },
  ];
  return tools;
}
