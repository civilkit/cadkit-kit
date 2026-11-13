// The read-only measurement tools: measure, clearance, interference, thickness, draft, dfm (and bodies for the open app). Each one asks the
// kernel's own query and shapes the answer for a caller that cannot see the screen: the numbers, where they are, which bodies and faces
// they name, and a plain verdict. They never change the document. The headless MCP tools (@kit/agent-tools) and the app link's app_ tools
// (@kit/mcp) are both made from this list, so the two routes answer the same way.
import type { Session } from '@ck/session';
import { bodyList, faceOwners, resolveEntity, type BodyRef } from './entities';
import { ReadbackError } from './errors';
import { checkWithMould, withMouldRule, MOULD_RULE, type InlineRule, type MouldLabels, type ProfileReport } from './mould';
import type { Schema } from './schema';

export type KernelQueries = Pick<Session, 'distance' | 'clearance' | 'thickness' | 'angles' | 'checkProfile' | 'profiles'>;
export interface Interference { bodies: number; pairs: Array<{ a: string; b: string; aName?: string; bName?: string; volume?: number; com?: number[]; box?: { min: number[]; max: number[] }; error?: string }> }
export interface ReadbackHost {
  kernel: KernelQueries;
  /** The kernel's `interference` request for the open document (null: no solid). */
  interference(): Promise<Interference | null>;
  /** The bodies of the open document with their faces. */
  bodies(): Promise<BodyRef[]>;
  /** Translated words for the kit's mould rule (the app passes them). */
  labels?: MouldLabels;
}
export interface ToolResult { data: unknown; summary?: string }
export interface ReadbackTool {
  name: string;
  description: string;
  inputSchema: Schema & { type: 'object' };
  run(input: Record<string, unknown>, host: ReadbackHost): Promise<ToolResult>;
}

const obj = (properties: Record<string, Schema>, required: string[] = []): Schema & { type: 'object' } => ({ type: 'object', properties, required, additionalProperties: false });
const vec3: Schema = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };
const ENTITY: Schema = {
  description: 'A body (its name or 1-based number from `bodies`), a face name such as F2.C1, an edge key, a vertex V3, a point [x, y, z], or a list of face / edge names.',
  oneOf: [{ type: 'string', maxLength: 200 }, { type: 'integer', minimum: 1 }, vec3, { type: 'array', items: { type: 'string', maxLength: 200 }, minItems: 1, maxItems: 200 }],
};
const AXES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'] as const;
const PULL: Schema = { description: "A direction: [x, y, z] or one of '+X' '-X' '+Y' '-Y' '+Z' '-Z' (world axes; the kernel's front plane faces +Z).", oneOf: [vec3, { type: 'string', enum: AXES }] };

const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;
const r2 = (x: number): number => Math.round(x * 100) / 100;
const rv = (v: readonly number[] | undefined | null): number[] | null => (v ? v.map(r4) : null);

/** Run a kernel query: an Error from the kernel becomes a ReadbackError that says what to try; "empty result" is a document without a solid. */
async function ask<T>(go: () => Promise<T>, what: string): Promise<T> {
  try { return await go(); } catch (e) {
    const m = String((e as Error)?.message ?? e);
    if (/empty result/.test(m)) throw new ReadbackError('no_body', 'the document has no solid body to measure', 'build something first (run_script), then check `facts`');
    throw new ReadbackError('measure_failed', `${what}: ${m}`, 'check the names: bodies lists the bodies; find / facts list face and edge names (F2.C1, F2.S.e1|F4.S.e0#3, V3)');
  }
}

function pullVector(p: unknown, fallback: number[]): number[] {
  if (p === undefined) return fallback;
  if (typeof p === 'string') { const s = p.startsWith('-') ? -1 : 1; const i = 'XYZ'.indexOf(p.slice(-1)); const v = [0, 0, 0]; v[i] = s; return v; }
  const v = p as number[];
  if (Math.hypot(v[0], v[1], v[2]) < 1e-9) throw new ReadbackError('bad_input', 'the direction is the zero vector', "give a direction such as '+Z' or [0, 0, 1]");
  return v;
}

const needBodies = (bodies: BodyRef[], n: number): void => {
  if (bodies.length < n) throw new ReadbackError('need_bodies', `this needs ${n} bodies and the document has ${bodies.length}`, 'touching solids merge into one body unless the feature has newBody: true (extrude / revolve / sweep); check `bodies`');
};

// ---------------------------------------------------------------- measure

const measure: ReadbackTool = {
  name: 'measure',
  description: 'Distance between two things you name: bodies, faces, edges, vertices or points. Returns the minimum distance, the two closest points and the face / edge each lies on, the offset vector between them, and whether they touch or intersect. For two faces it adds the angle between them. Exact for planes and quadrics. Names: `bodies` (bodies), `facts` / `find` (faces, edges). For the gap between two bodies with a pass / fail against a required clearance use `clearance`.',
  inputSchema: obj({ a: ENTITY, b: ENTITY, samples: { type: 'integer', minimum: 3, maximum: 40, description: 'grid per face for curved pairs (default 7)' } }, ['a', 'b']),
  async run(i, h) {
    const bodies = await h.bodies();
    const A = resolveEntity(i.a, bodies), B = resolveEntity(i.b, bodies);
    const d = await ask(() => h.kernel.distance(A.entity, B.entity, i.samples ? { samples: i.samples as number } : undefined), 'distance');
    const out: Record<string, unknown> = {
      ok: true, a: A.label, b: B.label, distance: r4(d.distance), pointA: rv(d.pointA), pointB: rv(d.pointB),
      onA: d.a, onB: d.b, offset: d.pointA && d.pointB ? d.pointB.map((x, k) => r4(x - d.pointA[k])) : null, direction: rv(d.direction),
      intersects: d.intersects, ...(d.intersection ? { intersection: d.intersection } : {}),
      ...(d.boundaryDistance !== undefined ? { boundaryDistance: r4(d.boundaryDistance) } : {}),
    };
    const faceName = /^F\d+[.:\w@|#-]*$/;
    if (A.kind === 'name' && B.kind === 'name' && typeof A.entity === 'string' && typeof B.entity === 'string' && faceName.test(A.entity) && faceName.test(B.entity) && !A.entity.includes('|') && !B.entity.includes('|')) {
      try {
        const an = await h.kernel.angles({ faces: [A.entity, B.entity] });
        if (an.between) out.faceAngle = { angle: an.between.angle !== undefined ? r2(an.between.angle) : null, normalAngle: r2(an.between.normalAngle), parallel: an.between.parallel ?? null, ...(an.between.sharedEdge ? { sharedEdge: an.between.sharedEdge } : {}) };
      } catch { /* not two faces: the distance stands alone */ }
    }
    if (d.intersects) out.note = d.intersection?.kind === 'containment' ? 'one solid lies inside the other' : 'the two touch or cross: the minimum distance is 0';
    return { data: out, summary: d.intersects ? `${A.label} and ${B.label} touch or intersect (distance 0)` : `${A.label} to ${B.label}: ${r4(d.distance)} mm` };
  },
};

// ---------------------------------------------------------------- clearance

const clearance: ReadbackTool = {
  name: 'clearance',
  description: 'The minimum gap between two bodies (or any two things `measure` takes) with the closest points, the face pairs that are closest, and a verdict: clear or in contact, and pass / fail when you give the clearance you need (`required`, mm). With no a and b and exactly two bodies in the document it compares those two. Use it to check a lid against its box, a pin against its hole, a part against its neighbour. For how much two bodies overlap use `interference`.',
  inputSchema: obj({
    a: ENTITY, b: ENTITY,
    required: { type: 'number', minimum: 0, maximum: 100000, description: 'the clearance the design needs (mm): the result says whether the gap meets it' },
    within: { type: 'number', minimum: 0, maximum: 100000, description: 'list face pairs closer than this (mm); default a little above the gap, or the required clearance' },
    limit: { type: 'integer', minimum: 1, maximum: 100, description: 'most face pairs listed (default 10)' },
  }),
  async run(i, h) {
    const bodies = await h.bodies();
    let a = i.a, b = i.b;
    if (a === undefined && b === undefined) {
      needBodies(bodies, 2);
      if (bodies.length !== 2) throw new ReadbackError('ambiguous', `the document has ${bodies.length} bodies: say which two`, `give a and b: bodies are ${bodyList(bodies)}`);
      a = 1; b = 2;
    } else if (a === undefined || b === undefined) throw new ReadbackError('bad_input', 'give both a and b, or neither', `bodies: ${bodyList(bodies)}`);
    const A = resolveEntity(a, bodies), B = resolveEntity(b, bodies);
    const d = await ask(() => h.kernel.distance(A.entity, B.entity), 'distance');
    const gap = r4(d.distance);
    const need = i.required as number | undefined;
    const within = (i.within as number | undefined) ?? Math.max(need ?? 0, d.distance * 1.5, d.distance + 1);
    let pairs: Array<{ a: string; b: string; distance: number; kind: string; pointA: number[] | null; pointB: number[] | null }> = [];
    let truncated = false;
    try {
      const c = await h.kernel.clearance({ min: within, a: A.entity, b: B.entity, include: 'gap', limit: (i.limit as number | undefined) ?? 10 });
      truncated = c.truncated || c.count > c.pairs.length;
      pairs = c.pairs.slice(0, (i.limit as number | undefined) ?? 10).map((p) => ({ a: p.a, b: p.b, distance: r4(p.distance), kind: p.kind, pointA: rv(p.pointA), pointB: rv(p.pointB) }));
    } catch { /* the closest points above stand alone */ }
    // the kernel says "intersects" for faces that touch and for solids that cross; interference tells those two apart
    const state = d.intersects ? 'contact' : 'clear';
    const verdict = state === 'clear' ? (need === undefined ? `clear: gap ${gap} mm` : gap >= need ? `pass: gap ${gap} mm is at least the required ${need} mm` : `fail: gap ${gap} mm is under the required ${need} mm (short by ${r4(need - gap)} mm)`)
      : `contact: the two touch or overlap (gap 0)${need ? `, so the required ${need} mm is not met` : ''}; interference says which and by how much`;
    const pass = need === undefined ? null : state === 'clear' && gap >= need;
    return {
      summary: `${A.label} to ${B.label}: ${verdict}`,
      data: {
        ok: true, a: A.label, b: B.label, state, gap, ...(need !== undefined ? { required: need, pass } : {}), verdict,
        pointA: rv(d.pointA), pointB: rv(d.pointB), onA: d.a, onB: d.b, direction: rv(d.direction),
        closePairs: pairs, ...(pairs.length ? { pairsWithin: within } : {}), ...(truncated ? { more: 'more face pairs are closer than `within`: raise limit or lower within' } : {}),
        ...(state !== 'clear' ? { hint: 'use interference for the overlap volume; if the two should be separate parts, check that they are separate bodies (bodies)' } : {}),
      },
    };
  },
};

// ---------------------------------------------------------------- interference

const interference: ReadbackTool = {
  name: 'interference',
  description: 'Do bodies overlap, and by how much. Lists every pair of bodies that share volume with the volume of the overlap (mm3), its centre and bounding box, and the share of the smaller body that is inside the other. Optional a / b limit it to pairs that involve those bodies. Note that touching solids made by one feature chain merge into a single body (no interference is possible inside a body): a part that must stay separate needs newBody: true. Use `clearance` for the gap between bodies that do not overlap.',
  inputSchema: obj({ a: { ...ENTITY, description: 'only pairs that involve this body (name or number)' }, b: { ...ENTITY, description: 'with a: only the pair of these two bodies' } }),
  async run(i, h) {
    const [bodies, r] = [await h.bodies(), await ask(() => h.interference(), 'interference')];
    if (!r) throw new ReadbackError('no_body', 'the document has no solid body to check', 'build something first (run_script)');
    const owners = faceOwners(bodies);
    const want = (s: unknown): BodyRef | undefined => (s === undefined ? undefined : resolveEntity(s, bodies).body ?? (() => { throw new ReadbackError('bad_input', 'a and b must be bodies here', `bodies: ${bodyList(bodies)}`); })());
    const wa = want(i.a), wb = want(i.b);
    let pairs = r.pairs.map((p) => {
      const ba = owners.get(p.a), bb = owners.get(p.b);
      const small = Math.min(ba?.volume ?? Infinity, bb?.volume ?? Infinity);
      return {
        a: ba?.name ?? p.aName ?? p.a, b: bb?.name ?? p.bName ?? p.b, faceA: p.a, faceB: p.b,
        ...(p.error ? { error: p.error } : { volume: r4(p.volume ?? 0), centre: rv(p.com), box: p.box ? { min: rv(p.box.min), max: rv(p.box.max) } : null, ...(Number.isFinite(small) && small > 0 ? { shareOfSmaller: r4((p.volume ?? 0) / small) } : {}) }),
        _ba: ba, _bb: bb,
      };
    });
    if (wa) pairs = pairs.filter((p) => (p._ba === wa || p._bb === wa) && (!wb || p._ba === wb || p._bb === wb));
    const rows = pairs.map(({ _ba, _bb, ...p }) => p);
    const total = rows.reduce((s, p) => s + ('volume' in p && typeof p.volume === 'number' ? p.volume : 0), 0);
    const failed = rows.filter((p) => 'error' in p).length;
    const overlapping = rows.some((p) => 'volume' in p && (p.volume as number) > 1e-6);
    return {
      summary: r.bodies < 2 ? 'one body: nothing to interfere with' : overlapping ? `${rows.length} overlapping pair${rows.length === 1 ? '' : 's'}, ${r4(total)} mm3 in all` : failed ? `no overlap found, ${failed} pair(s) could not be computed` : 'no interference',
      data: {
        ok: true, bodies: r.bodies, overlapping, pairCount: rows.length, totalOverlapVolume: r4(total), pairs: rows,
        ...(failed ? { incomplete: `${failed} pair(s) failed in the boolean: the answer for them is unknown` } : {}),
        ...(r.bodies < 2 ? { note: 'the document has one body: solids that touch or overlap inside one feature chain are merged. Give a part newBody: true to keep it separate, then check again.' } : {}),
      },
    };
  },
};

// ---------------------------------------------------------------- thickness

const thickness: ReadbackTool = {
  name: 'thickness',
  description: 'Wall thickness of the solid: the thinnest place with where it is (the point, the two faces it lies between), the mean, and the thinnest few places apart from each other. Rays go along the inward normal from sampled points on every face; method "sphere" refines the thinnest places with inscribed balls (slower, never above the ray value). Give `min` (mm) for pass / fail against the wall you need; give `body` to look at one body. The ray method reports the straight distance along the face normal, so the tip of a sharp wedge reads as the distance across.',
  inputSchema: obj({
    min: { type: 'number', minimum: 0, maximum: 100000, description: 'the thinnest wall allowed (mm): the result says whether it is met and lists places under it' },
    body: { ...ENTITY, description: 'only places on this body (name or number)' },
    top: { type: 'integer', minimum: 1, maximum: 50, description: 'how many thin places to list (default 5)' },
    method: { type: 'string', enum: ['ray', 'sphere'] },
    samples: { type: 'integer', minimum: 50, maximum: 20000, description: 'surface samples (default 2500)' },
  }),
  async run(i, h) {
    const bodies = await h.bodies();
    const body = i.body === undefined ? undefined : resolveEntity(i.body, bodies).body;
    if (i.body !== undefined && !body) throw new ReadbackError('bad_input', 'body must name a body', `bodies: ${bodyList(bodies)}`);
    const top = (i.top as number | undefined) ?? 5;
    const r = await ask(() => h.kernel.thickness({ top: body ? 50 : top, ...(i.method ? { method: i.method as 'ray' | 'sphere' } : {}), ...(i.samples ? { samples: i.samples as number } : {}), }), 'thickness');
    const own = body ? new Set(body.faces) : null;
    const thin = r.thin.filter((t) => !own || own.has(t.face) || own.has(t.farFace));
    const loc = own ? thin[0] : r.location;
    const min = own ? (thin.length ? Math.min(...thin.map((t) => t.thickness)) : null) : r.minThickness;
    const row = (t: typeof r.thin[number]) => ({ thickness: r4(t.thickness), point: rv(t.point), farPoint: rv(t.farPoint), face: t.face, farFace: t.farFace, direction: rv(t.direction) });
    const need = i.min as number | undefined;
    const under = need === undefined ? [] : thin.filter((t) => t.thickness < need);
    const pass = need === undefined || min === null ? null : min >= need;
    if (min === null) throw new ReadbackError('no_thickness', own ? 'no thickness sample landed on that body' : 'no wall thickness could be measured', r.noExit ? 'no ray found an exit: the shell may be open (see facts / validity)' : 'the body may be a sheet or surface: thickness needs a closed solid');
    return {
      summary: `thinnest wall ${r4(min)} mm${loc ? ` at (${loc.point.map(r2).join(', ')}) between ${loc.face} and ${loc.farFace}` : ''}${need !== undefined ? (pass ? `, meets ${need} mm` : `, under the required ${need} mm`) : ''}`,
      data: {
        ok: true, method: r.method, samples: r.samples, scope: body ? body.name : 'all bodies', minThickness: r4(min), ...(loc ? { where: row(loc) } : {}),
        ...(r.meanThickness !== undefined && !body ? { meanThickness: r4(r.meanThickness) } : {}), thin: thin.slice(0, top).map(row),
        ...(need !== undefined ? { required: need, pass, ...(under.length ? { under: under.slice(0, top).map(row) } : {}) } : {}),
        ...(r.noExit ? { noExit: r.noExit, warning: `${r.noExit} sample ray(s) found no exit (open shell or lost ray): those places are not measured` } : {}),
      },
    };
  },
};

// ---------------------------------------------------------------- draft

const draft: ReadbackTool = {
  name: 'draft',
  description: "Draft angles of the faces against a pull direction (how a moulded or cast part leaves the tool): per face the angle, asin(normal . pull) in degrees, and a class: ok, vertical (no draft), undercut (negative: it locks the part in), parting (faces along the pull). Walls under `min` degrees are the violations. Default pull +Z and min 1 degree. Pass `faces` or `body` to limit it. Look at undercuts with `dfm` (process injection) for faces that no mould half can form.",
  inputSchema: obj({
    pull: PULL,
    min: { type: 'number', minimum: 0, maximum: 90, description: 'the least draft allowed on a wall, degrees (default 1)' },
    faces: { type: 'array', items: { type: 'string', maxLength: 200 }, minItems: 1, maxItems: 500, description: 'only these faces' },
    body: { ...ENTITY, description: 'only the faces of this body (name or number)' },
  }),
  async run(i, h) {
    const bodies = await h.bodies();
    const pull = pullVector(i.pull, [0, 0, 1]);
    const min = (i.min as number | undefined) ?? 1;
    let faces: 'all' | string[] = 'all';
    if (Array.isArray(i.faces)) faces = i.faces as string[];
    if (i.body !== undefined) {
      const b = resolveEntity(i.body, bodies).body;
      if (!b) throw new ReadbackError('bad_input', 'body must name a body', `bodies: ${bodyList(bodies)}`);
      faces = b.faces;
    }
    const r = await ask(() => h.kernel.angles({ draft: { pull, faces, min } }), 'draft');
    // the kernel calls a face looking straight against the pull (the floor of a box) an undercut at -90 degrees; for a mould that is a parting face, the other half's side
    const rows = (r.draft ?? []).map((f) => (f.draft <= -89.99 ? { ...f, class: 'parting' as const } : f));
    const byFace = new Map(rows.map((f) => [f.face, f]));
    const byClass = (face: string) => byFace.get(face)?.class;
    const counts = { ok: 0, vertical: 0, undercut: 0, parting: 0 };
    for (const f of rows) counts[f.class] = (counts[f.class] ?? 0) + 1;
    const viol = new Set((r.violations ?? []).filter((f) => byClass(f) !== 'parting'));
    const violations = [...viol].map((f) => byFace.get(f)).filter((f): f is NonNullable<typeof f> => !!f).sort((x, y) => x.draft - y.draft).map((f) => ({ face: f.face, draft: r2(f.draft), class: f.class }));
    const walls = rows.filter((f) => f.class !== 'parting');
    const worst = walls.length ? walls.reduce((m, f) => (f.draft < m.draft ? f : m)) : null;
    const sorted = [...rows].sort((x, y) => x.draft - y.draft);
    const pass = violations.length === 0;
    return {
      summary: rows.length ? `${pass ? 'every wall has at least' : `${violations.length} wall(s) under`} ${min} degrees of draft${worst ? `; least ${r2(worst.draft)} on ${worst.face}` : ''}${counts.undercut ? `; ${counts.undercut} undercut face(s)` : ''}` : 'no faces to check',
      data: {
        ok: true, pull: rv(pull), min, pass, facesChecked: rows.length, counts, ...(worst ? { least: { face: worst.face, draft: r2(worst.draft), class: worst.class } } : {}),
        violations: violations.slice(0, 100), faces: sorted.slice(0, 60).map((f) => ({ face: f.face, draft: r2(f.draft), min: r2(f.min), max: r2(f.max), class: f.class })),
        ...(rows.length > 60 ? { moreFaces: rows.length - 60 } : {}),
        ...(counts.undercut ? { hint: 'undercut faces tilt back against the pull: tilt them the other way, or pull from the other side (-pull). Faces no mould half can see at all are listed by dfm (injection)' } : {}),
      },
    };
  },
};

// ---------------------------------------------------------------- dfm

export const DFM_PROCESSES: Record<string, string> = { injection: 'injection', cnc: 'cnc-3axis', printing: 'fdm-print' };
const PROCESS_NAME: Record<string, string> = { injection: 'injection moulding', cnc: 'CNC 3-axis milling', printing: 'FDM 3D printing' };

const dfm: ReadbackTool = {
  name: 'dfm',
  description: "Design-for-manufacture checks for one process: injection (draft, uniform and minimum wall, and faces no two-part mould half can form), cnc (internal corner radius, minimum wall, faces a 3-axis tool cannot reach) or printing (FDM: watertight, single solid, minimum wall, overhang, bridges, small features, bed contact). Each issue names the faces, says what is wrong with the numbers and how far off it is. Same rules as the Check tab. Override limits with `params` ({minWall: {min: 1.5}}), set the pull / tool / build direction for every rule that has one with `direction`, or run only some `rules`. Omit all of them for the defaults, which `limits` in the result lists.",
  inputSchema: obj({
    process: { type: 'string', enum: ['injection', 'cnc', 'printing'] },
    direction: { ...PULL, description: 'pull direction (injection), tool axis (cnc) or build-up direction (printing) for every rule that has one; defaults are +Z for injection and cnc, +Y for printing' },
    params: { type: 'object', description: 'per rule limit overrides, e.g. {"draft": {"minAngle": 2}, "minWall": {"min": 1.2}}; rule ids and parameters are in `limits` of a result' },
    rules: { type: 'array', items: { type: 'string', maxLength: 40 }, minItems: 1, maxItems: 20, description: 'run only these rules' },
    maxIssues: { type: 'integer', minimum: 1, maximum: 100, description: 'most issues listed per rule (default 10)' },
  }, ['process']),
  async run(i, h) {
    const proc = String(i.process);
    const profileId = DFM_PROCESSES[proc];
    const list = withMouldRule(await ask(() => h.kernel.profiles(), 'profiles'), h.labels);
    const profile = list.profiles.find((p) => p.id === profileId);
    if (!profile) throw new ReadbackError('no_profile', `the kernel has no ${profileId} profile`, `profiles: ${list.profiles.map((p) => p.id).join(', ')}`);
    const ruleIds = profile.rules.map((r) => r.id);
    const only = Array.isArray(i.rules) ? (i.rules as string[]) : null;
    for (const r of only ?? []) if (!ruleIds.includes(r)) throw new ReadbackError('unknown_rule', `${proc} has no rule ${r}`, `rules for ${proc}: ${ruleIds.join(', ')}`);
    const over = (i.params ?? {}) as Record<string, unknown>;
    for (const [rid, ps] of Object.entries(over)) {
      const rule = profile.rules.find((r) => r.id === rid);
      if (!rule) throw new ReadbackError('unknown_rule', `${proc} has no rule ${rid}`, `rules for ${proc}: ${ruleIds.join(', ')}`);
      if (!ps || typeof ps !== 'object' || Array.isArray(ps)) throw new ReadbackError('bad_input', `params.${rid} must be an object of parameter values`, `${rid} takes: ${rule.params.map((p) => p.name).join(', ') || 'no parameters'}`);
      for (const [k, v] of Object.entries(ps)) {
        const def = rule.params.find((p) => p.name === k);
        if (!def) throw new ReadbackError('unknown_param', `rule ${rid} has no parameter ${k}`, `${rid} takes: ${rule.params.map((p) => `${p.name} (${def ? '' : p.type}${p.unit ? ' ' + p.unit : ''})`).join(', ') || 'no parameters'}`);
        const good = def.type === 'number' ? typeof v === 'number' && Number.isFinite(v) : Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number');
        if (!good) throw new ReadbackError('bad_input', `params.${rid}.${k} must be ${def.type === 'number' ? 'a number' : 'an [x, y, z] array'}`);
      }
    }
    const dir = i.direction === undefined ? null : pullVector(i.direction, [0, 0, 1]);
    const inline: InlineRule[] = profile.rules.filter((r) => !only || only.includes(r.id)).map((r) => {
      const params: Record<string, number | number[]> = {};
      for (const p of r.params) params[p.name] = (p.value ?? p.default) as number | number[];
      if (dir && r.params.some((p) => p.name === 'direction')) params.direction = dir;
      Object.assign(params, over[r.id] as Record<string, number | number[]> | undefined);
      return { id: r.id, severity: r.severity as InlineRule['severity'], params };
    });
    const report = await ask(() => checkWithMould((p) => h.kernel.checkProfile(p, { maxIssues: 100 }), { id: profile.id, name: profile.name, rules: inline }, h.labels), 'checkProfile') as ProfileReport;
    const cap = (i.maxIssues as number | undefined) ?? 10;
    const titles = new Map(profile.rules.map((r) => [r.id, r.title]));
    const per = new Map<string, number>();
    const issues = report.issues.filter((x) => { const n = (per.get(x.rule) ?? 0) + 1; per.set(x.rule, n); return n <= cap; }).map((x) => ({
      rule: x.rule, severity: x.severity, message: x.message, faces: x.faces, ...(x.edges?.length ? { edges: x.edges } : {}), ...(x.value !== null && x.value !== undefined ? { value: r4(x.value), limit: x.limit === null ? null : r4(x.limit as number), unit: x.unit } : {}), ...(x.at ? { at: rv(x.at) } : {}),
    }));
    const rules = report.summary.rules.map((r) => ({ rule: r.rule, title: titles.get(r.rule) ?? r.rule, severity: r.severity, issues: r.issues, passed: r.passed }));
    const s = report.summary;
    const limits = inline.map((r) => ({ rule: r.id, params: r.params }));
    return {
      summary: `${PROCESS_NAME[proc]}: ${s.errors} error${s.errors === 1 ? '' : 's'}, ${s.warnings} warning${s.warnings === 1 ? '' : 's'}, ${s.infos} note${s.infos === 1 ? '' : 's'}`,
      data: {
        ok: true, process: proc, profile: profile.id, passed: report.ok, errors: s.errors, warnings: s.warnings, notes: s.infos, rules, issues,
        ...(report.issues.length > issues.length ? { moreIssues: report.issues.length - issues.length, hint: 'raise maxIssues, or narrow with rules' } : {}),
        ...(s.skippedFaces?.length ? { skippedFaces: s.skippedFaces.slice(0, 20), warning: 'some faces could not be triangulated: the sampled rules do not see them' } : {}),
        limits,
        ...((proc === 'injection' && !only) || only?.includes(MOULD_RULE) ? { note: `${MOULD_RULE} flags only faces that neither mould half can form (hidden from the pull direction and from its opposite)` } : {}),
      },
    };
  },
};

// ---------------------------------------------------------------- bodies (the open app)

const bodiesTool: ReadbackTool = {
  name: 'bodies',
  description: 'The bodies of the document: number, name, key, volume (mm3), face count and the first face names. The names and numbers are what measure, clearance, interference, thickness and draft take.',
  inputSchema: obj({ faces: { type: 'integer', minimum: 0, maximum: 500, description: 'how many face names to list per body (default 40)' } }),
  async run(i, h) {
    const bodies = await h.bodies();
    const n = (i.faces as number | undefined) ?? 40;
    return {
      summary: `${bodies.length} bod${bodies.length === 1 ? 'y' : 'ies'}`,
      data: { ok: true, count: bodies.length, bodies: bodies.map((b, k) => ({ index: k + 1, name: b.name, key: b.key, volume: b.volume === null || b.volume === undefined ? null : r4(b.volume), faceCount: b.faces.length, faces: b.faces.slice(0, n) })) },
    };
  },
};

/** The measurement tools, in the order they are listed. */
export const READBACK_TOOLS: ReadbackTool[] = [measure, clearance, interference, thickness, draft, dfm];
/** Plus `bodies`, for the app link (the headless server has its own, richer, `bodies`). */
export const APP_READBACK_TOOLS: ReadbackTool[] = [bodiesTool, ...READBACK_TOOLS];
