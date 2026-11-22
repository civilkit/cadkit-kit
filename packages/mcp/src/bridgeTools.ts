// The MCP tools of the agent link: they reach the document the user has OPEN in the browser app (docs/agent-bridge.md), not the
// daemon's own scratch document. They are added beside the headless tools; nothing here works until the user pairs the app.
import { createHash } from 'node:crypto';
import { budgetJson, clampBudget, fetchResult, ResultStore, validate, DEFAULT_BUDGET_CHARS, MAX_BUDGET_CHARS, MIN_BUDGET_CHARS, type CallResult, type Schema } from '@kit/agent-tools';
import { BridgeError, type Bridge, type BridgeOp } from '@kit/agent-link';
import { APP_READBACK_TOOLS } from '@kit/readback';
import type { Backend } from './protocol';
import { loadAssetPolicy, readAsset, resolveAsset, type AssetPolicy } from './assetPolicy';
import { JobRunner, type JobContext, type JobOutcome } from './jobs';
import { BATCH_INPUT, BATCH_OPS, checkShape, planBatch, readScriptFiles, type BatchStep } from './batch';
import { CHECK_TOOLS, bindParams, judge, listRecipes, recipeEntry, runKey, substitute, type Recipe, type RecipeCheck } from './recipes';

/** What a bridge tool may use besides the bridge: the user's rules for which files may be opened, and the output budget of this call. */
export interface ToolContext {
  assetPolicy(): AssetPolicy;
  jobs: JobRunner;
  /** The last successful run of each recipe, so an identical run on an unchanged document is not repeated. */
  recipeCache: Map<string, { key: string; documentId: string; revision: number; outcome: JobOutcome }>;
  /** The JSON result of a tool as text content: whole when it fits the call's `maxChars` (default 4000), otherwise a summary with a handle for fetch_result. */
  text(data: unknown, summary?: string): CallResult;
  /** Just the JSON text (for a result that carries an image too). */
  json(data: unknown): string;
}
interface BridgeTool {
  name: string;
  description: string;
  inputSchema: Schema & { type: 'object' };
  run(input: Record<string, unknown>, bridge: Bridge, ctx: ToolContext): Promise<CallResult>;
}
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema & { type: 'object' } => ({ type: 'object', properties, required, additionalProperties: false });
const NEEDS_APP = ' Works only while the user has linked the app (Settings, Agent link): see app_status.';

const VEC3: Schema = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };

/** app_open_asset: the permission, then the policy, then the bytes staged for the app to fetch. Shared with the open_asset job. */
async function openAssetViaApp(bridge: Bridge, policy: AssetPolicy, i: Record<string, unknown>): Promise<Record<string, unknown>> {
  bridge.check('open_asset');                              // permission first: a refused call reads no file
  const a = await resolveAsset(policy, i.path);
  const bytes = await readAsset(a, policy);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const handle = bridge.stageAsset(bytes);
  try { return await viaApp('open_asset', bridge, { handle, name: a.name, kind: a.kind, bytes: bytes.length, sha256, ...(i.unit ? { unit: i.unit } : {}) }); }
  finally { bridge.unstageAsset(handle); }
}


/** A small picture of the open document for a finished job (best effort: a document with no solid has none). */
async function previewOf(bridge: Bridge): Promise<string | null> {
  try { const r = await bridge.request('screenshot', { size: 512 }) as { png?: unknown }; return typeof r.png === 'string' ? r.png : null; } catch { return null; }
}

/** A batch of read-only checks: each is a measuring op and a verdict. A check that errors or fails its expectation counts as an error. */
async function runChecks(bridge: Bridge, checks: RecipeCheck[], c: JobContext): Promise<JobOutcome> {
  const rows: Array<Record<string, unknown>> = [];
  let errors = 0;
  for (const [n, chk] of checks.entries()) {
    if (c.signal.aborted) break;
    c.progress(n, checks.length, chk.tool);
    try {
      const result = await bridge.request(chk.tool as BridgeOp, chk.args ?? {}) as Record<string, unknown>;
      const v = judge(chk, result);
      if (!v.ok) errors++;
      rows.push({ tool: chk.tool, ...(chk.label ? { label: chk.label } : {}), ok: v.ok, ...(v.why ? { why: v.why } : {}), result });
    } catch (e) { errors++; rows.push({ tool: chk.tool, ...(chk.label ? { label: chk.label } : {}), ok: false, error: { code: (e as { code?: string }).code ?? 'error', message: String((e as Error).message) } }); }
  }
  const state = await bridge.request('state', { limit: 1 }).catch(() => ({})) as { revision?: number };
  return { revision: state.revision ?? null, changedCount: 0, errorCount: errors, warningCount: 0, report: { checks: rows } };
}

/** A recipe: ONE app_edit transaction from its steps (placeholders filled from the typed parameters), then its checks. The edit is atomic; a failed check leaves it committed, says so, and the job is not ok. */
async function runRecipe(bridge: Bridge, policy: AssetPolicy, r: Recipe, params: Record<string, string | number | boolean>, c: JobContext, cache: ToolContext['recipeCache']): Promise<JobOutcome> {
  const { key } = await runKey(r, params, policy);
  const st = await bridge.request('state', { limit: 1 }) as { revision: number; documentId: string };
  const hit = cache.get(r.id);
  if (hit && hit.key === key && hit.documentId === st.documentId && hit.revision === st.revision) return { ...hit.outcome, cached: true };   // same recipe, parameters and sources on the document as the last run left it
  c.progress(0, 1 + r.checks.length, 'edit');
  const ops = substitute(r.steps, params, r.file) as unknown[];
  const edit = await bridge.request('edit', { expectedRevision: st.revision, ops, reason: `Recipe ${r.id}`.slice(0, 120) }) as { revision: number; documentId: string; changedIds: string[]; validation: { errorCount: number; warnings: number } };
  const rows: Array<Record<string, unknown>> = [];
  let failed = 0;
  for (const [n, chk] of r.checks.entries()) {
    if (c.signal.aborted) break;
    c.progress(1 + n, 1 + r.checks.length, chk.tool);
    try {
      const result = await bridge.request(chk.tool as BridgeOp, substitute(chk.args ?? {}, params, r.file) as Record<string, unknown>) as Record<string, unknown>;
      const v = judge(chk, result);
      if (!v.ok) failed++;
      rows.push({ tool: chk.tool, ...(chk.label ? { label: chk.label } : {}), ok: v.ok, ...(v.why ? { why: v.why } : {}), result });
    } catch (e) { failed++; rows.push({ tool: chk.tool, ...(chk.label ? { label: chk.label } : {}), ok: false, error: { code: (e as { code?: string }).code ?? 'error', message: String((e as Error).message) } }); }
  }
  const errorCount = edit.validation.errorCount + failed;
  const outcome: JobOutcome = {
    revision: edit.revision, changedCount: edit.changedIds.length, errorCount, warningCount: edit.validation.warnings,
    report: { recipe: r.id, version: r.version, params, key, committed: true, edit, checks: rows, ...(errorCount ? { note: 'the edit is committed as one undo step; app_undo takes it back' } : {}), },
    previewPng: await previewOf(bridge),
  };
  if (errorCount === 0) cache.set(r.id, { key, documentId: edit.documentId, revision: edit.revision, outcome });   // a failed run is never remembered as a good one
  return outcome;
}

/** One step of a batch as the agent sees it. An image (a screenshot) is moved out of the JSON into `images`. */
interface StepResult { step: number; tool: string; label?: string; ok: boolean; result?: Record<string, unknown>; error?: { code: string; message: string; hint?: string }; skipped?: true }

/** Run a checked batch one step at a time, asking the app once per step (the revision an edit needs is carried from the step before). Only for an app too old to know the batch op. */
async function runBatchSteps(bridge: Bridge, steps: BatchStep[], stopOnError: boolean): Promise<StepResult[]> {
  const out: StepResult[] = [];
  let revision: number | null = null;
  let stopped = false;
  for (const st of steps) {
    const head = { step: st.index, tool: st.tool, ...(st.label ? { label: st.label } : {}) };
    if (stopped) { out.push({ ...head, ok: false, skipped: true }); continue; }
    try {
      let args = st.args;
      if (st.op === 'edit' && args.expectedRevision === undefined) {
        revision ??= ((await bridge.request('state', { limit: 1 })) as { revision?: number }).revision ?? 0;
        args = { ...args, expectedRevision: revision };
      }
      const result = await bridge.request(st.op, args) as Record<string, unknown>;
      if (typeof result.revision === 'number' && (st.op === 'edit' || st.op === 'run_script' || st.op === 'plugin_run')) revision = result.revision; else if (st.op === 'undo' || st.op === 'redo' || st.op === 'run_script' || st.op === 'plugin_run') revision = null;
      out.push({ ...head, ok: true, result });
    } catch (e) {
      out.push({ ...head, ok: false, error: { code: (e as { code?: string }).code ?? 'error', message: String((e as Error).message), ...((e as { hint?: string }).hint ? { hint: (e as { hint?: string }).hint } : {}) } });
      if (stopOnError) stopped = true;
    }
  }
  return out;
}

/** Run a checked batch with ONE request to the app (one round trip, whatever the number of steps); an older app that does not know `batch` gets the steps one by one. */
async function runBatch(bridge: Bridge, steps: BatchStep[], stopOnError: boolean): Promise<StepResult[]> {
  let reply: { results?: Array<{ ok: boolean; result?: Record<string, unknown>; error?: StepResult['error']; skipped?: true }> };
  try { reply = await bridge.request('batch', { steps: steps.map((s) => ({ op: s.op, args: s.args })), stopOnError }, { timeoutMs: Math.min(10 * 60_000, 60_000 * steps.length) }) as typeof reply; }
  catch (e) { if (e instanceof BridgeError && e.code === 'unknown_op') return runBatchSteps(bridge, steps, stopOnError); throw e; }
  return steps.map((s, n) => ({ step: s.index, tool: s.tool, ...(s.label ? { label: s.label } : {}), ...(reply.results?.[n] ?? { ok: false, skipped: true as const }) }));
}

/** The MCP result of a batch: one JSON of every step, with each screenshot's PNG attached as an image after it. */
function batchResult(results: StepResult[], ctx: ToolContext): CallResult {
  const images: Array<{ type: 'image'; data: string; mimeType: string }> = [];
  const rows = results.map((r) => {
    const png = r.result && typeof r.result.png === 'string' ? r.result.png : null;
    if (!png) return r;
    images.push({ type: 'image', data: png, mimeType: 'image/png' });
    const { png: _p, ...rest } = r.result!;
    return { ...r, result: { ...rest, image: `attached as image ${images.length}` } };
  });
  const failed = results.filter((r) => !r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  return { ...(failed ? { isError: true } : {}), content: [{ type: 'text', text: ctx.json({ ok: failed === 0, steps: results.length, failed, ...(skipped ? { skipped } : {}), results: rows }) }, ...images] };
}

const viaApp = (op: BridgeOp, bridge: Bridge, args: Record<string, unknown>) => bridge.request(op, args) as Promise<Record<string, unknown>>;

export const BRIDGE_TOOLS: BridgeTool[] = [
  {
    name: 'bridge_pair',
    description: 'Start linking the user\'s open browser app to this server: returns a one-time pairing code (valid 10 minutes). Tell the user to open Settings, Agent link in the app, paste the code and turn the link on. They choose whether you may only look or also change the document. Calling it again replaces the code and ends any current link.',
    inputSchema: obj({}),
    async run(_i, bridge, ctx) {
      const c = bridge.newCode();
      return ctx.text({ ok: true, code: c.code, expiresInSeconds: Math.round((c.expiresAt - Date.now()) / 1000), tellTheUser: `Open the app, Settings, Agent link, paste ${c.code} and turn the link on. Tick "Allow the agent to change this document" only if you want me to edit; otherwise I can only look.` });
    },
  },
  {
    name: 'app_status',
    description: 'Is the user\'s browser app linked, may the agent change its document, and is a pairing code open? Cheap; call it before the other app_ tools.',
    inputSchema: obj({}),
    async run(_i, bridge, ctx) { return ctx.text({ ok: true, ...bridge.status() }); },
  },
  {
    name: 'app_state',
    description: 'The document open in the user\'s browser app. Default: a compact, paged list (id, type, name, status per feature) with documentId, revision, units, bounds, totalCount / returnedCount / nextCursor. Narrow it with ids, query, types, fields, limit + cursor; sinceRevision returns only what changed since that revision. detail "summary" / "full" are the earlier larger shapes ("full" adds the document JSON).' + NEEDS_APP,
    inputSchema: obj({
      detail: { type: 'string', enum: ['compact', 'summary', 'full'] },
      ids: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 200 },
      query: { type: 'string', maxLength: 200, description: 'matches id, type or name' },
      types: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 40 },
      fields: { type: 'array', items: { type: 'string', enum: ['type', 'name', 'status', 'suppressed', 'error', 'params'] }, maxItems: 6, description: 'row fields besides id (default type, name, status)' },
      limit: { type: 'integer', minimum: 1, maximum: 500, description: 'rows per page (default 50)' },
      cursor: { type: 'string', maxLength: 200, description: 'nextCursor of the previous page' },
      sinceRevision: { type: 'integer', minimum: 0 },
      includeBlobs: { type: 'boolean', description: 'with fields params: keep long values instead of {blob: chars}' },
    }),
    async run(i, bridge, ctx) { return ctx.text({ ok: true, ...(await viaApp('state', bridge, i)) }); },
  },
  {
    name: 'app_selection',
    description: 'What the user has selected in the app right now, resolved: each entry is {id, kind: feature | face_or_edge | unresolved, feature: {id, type, name?, error?}} (a face or edge belongs to the feature its name starts with). Reads only (no edit permission needed). limit caps the entries (default 50, at most 200); count is the whole selection.' + NEEDS_APP,
    inputSchema: obj({ limit: { type: 'integer', minimum: 1, maximum: 200 } }),
    async run(i, bridge, ctx) { return ctx.text({ ok: true, ...(await viaApp('selection', bridge, i)) }); },
  },
  {
    name: 'app_settings',
    description: 'The user\'s app preferences (sketch input and display, navigation) as a list sorted by key, each {key, value} with dotted keys such as sketch.show.dimensions or nav.orbitMode. query keeps the keys that contain that text; limit caps the list (default 200). Reads only: an agent cannot change settings. No edit permission needed.' + NEEDS_APP,
    inputSchema: obj({ query: { type: 'string', maxLength: 80 }, limit: { type: 'integer', minimum: 1, maximum: 500 } }),
    async run(i, bridge, ctx) { return ctx.text({ ok: true, ...(await viaApp('settings', bridge, i)) }); },
  },
  {
    name: 'app_screenshot',
    description: 'A PNG of the model open in the user\'s browser app, drawn from its current geometry (view: iso | front | back | left | right | top | bottom). With section {origin?, normal} the model is cut at that plane and the exact cut loops are drawn (look along the plane with a matching view, e.g. normal [0,0,1] and view front). It is a rendering of the document, not a capture of the user\'s screen: panels and the camera they have set are not in it.' + NEEDS_APP,
    inputSchema: obj({ view: { type: 'string', enum: ['iso', 'front', 'back', 'left', 'right', 'top', 'bottom'] }, size: { type: 'integer', minimum: 64, maximum: 1536 }, section: obj({ origin: VEC3, normal: VEC3 }, ['normal']) }),
    async run(i, bridge, ctx) {
      const r = await viaApp('screenshot', bridge, i);
      const png = typeof r.png === 'string' ? r.png : '';
      if (!png) throw new BridgeError('snapshot_failed', 'the app returned no image', 'the document may have no solid yet');
      const { png: _p, ...rest } = r;
      return { content: [{ type: 'text', text: `app screenshot ${String(r.view ?? 'iso')} ${String(r.size ?? '')}px` }, { type: 'text', text: ctx.json({ ok: true, ...rest }) }, { type: 'image', data: png, mimeType: 'image/png' }] };
    },
  },
  {
    name: 'app_section',
    description: 'Exact cross-section of the document open in the user\'s browser app at a plane: loops (outer / inner), their areas and the plane frame; detail:true adds the loop points. Reads only (no edit permission needed). For a picture of the cut use app_screenshot with section.' + NEEDS_APP,
    inputSchema: obj({ plane: obj({ origin: VEC3, normal: VEC3 }, ['normal']), detail: { type: 'boolean' } }, ['plane']),
    async run(i, bridge, ctx) { return ctx.text({ ok: true, ...(await viaApp('section', bridge, i)) }); },
  },
  {
    name: 'app_plugin_list',
    description: 'The plugin generators of the user\'s browser app: built-in ones and the ones the user installed (for example a woodwork Cabinet). Each has a JSON schema for its parameters, the same one the app\'s form is made from. Run one with app_plugin_run. Reads only.' + NEEDS_APP,
    inputSchema: obj({}),
    async run(_i, bridge, ctx) { return ctx.text({ ok: true, ...(await viaApp('plugin_list', bridge, {})) }); },
  },
  {
    name: 'app_plugin_run',
    description: 'Run a plugin generator on the document open in the user\'s browser app: adds its features as ONE tree folder and ONE undo step (the user can undo it, and later right-click the folder, Edit parameters). Give plugin (id), generator (id) and params as listed by app_plugin_list; parameters left out take their defaults and a parameter hidden by another one is dropped. Position fields (place_x, place_y, place_z, mm) put the result where you want it. Needs the edit permission.' + NEEDS_APP,
    inputSchema: obj({ plugin: { type: 'string', description: 'the plugin id, e.g. tomasdjo.woodwork' }, generator: { type: 'string', description: 'the generator id, e.g. cabinet' }, params: { type: 'object', description: 'parameter values by name' } }, ['plugin', 'generator']),
    async run(i, bridge, ctx) { return ctx.text({ ok: true, ...(await viaApp('plugin_run', bridge, i)) }); },
  },
  {
    name: 'app_run_script',
    description: 'Run a script on the document open in the user\'s browser app, in attach mode: its features are added after the existing ones, as ONE undo step the user can undo, with a notice in the app. The same script language as run_script. Needs the user to have ticked "Allow the agent to change this document".' + NEEDS_APP,
    inputSchema: obj({ code: { type: 'string', maxLength: 40000 } }, ['code']),
    async run(i, bridge, ctx) { return ctx.text({ ok: true, ...(await viaApp('run_script', bridge, i)) }); },
  },
  {
    name: 'app_open_asset',
    description: 'Open a file in the user\'s browser app by PATH, without sending its bytes through this conversation: a .ckpart, .solidcraft, STEP, or a mesh (stl, obj, glb, 3mf; a mesh becomes a reference mesh in the open part, `unit` says its units). Only files below a folder the user allowed on this computer (CK_MCP_ASSET_ROOTS); a relative path is below the first one. The part opens in a NEW tab, so the user\'s current part is untouched. Returns the document id, revision and counts. Needs the edit permission.' + NEEDS_APP,
    inputSchema: obj({ path: { type: 'string', maxLength: 1024, description: 'file path below an allowed folder, e.g. parts/bracket.ckpart' }, unit: { type: 'string', enum: ['mm', 'cm', 'm', 'in'], description: 'units of a mesh file (default: guessed)' } }, ['path']),
    async run(i, bridge, ctx) { return ctx.text({ ok: true, ...(await openAssetViaApp(bridge, ctx.assetPolicy(), i)) }); },
  },
  {
    name: 'app_edit',
    description: 'Change the document open in the user\'s browser app in ONE atomic transaction (one undo step): ops add {feature, index?} | replace {id, feature} | remove {id, cascade?} | transform {id, translate?, rotate?} (a moveBody feature) | setParam {id, path, value}. Send expectedRevision from app_state: a stale one is refused (stale_revision). Every op is checked first and the model is rebuilt before anything is committed, so one failure changes nothing. Ids never change. Returns revision, changedIds, addedIds, removedIds, validation. dryRun only checks. Needs the edit permission.' + NEEDS_APP,
    inputSchema: obj({
      expectedRevision: { type: 'integer', minimum: 0, description: 'revision of the app_state you based this on' },
      ops: { type: 'array', minItems: 1, maxItems: 50, items: obj({
        op: { type: 'string', enum: ['add', 'replace', 'remove', 'transform', 'setParam'] },
        id: { type: 'string', maxLength: 80 }, feature: { type: 'object' }, index: { type: 'integer', minimum: 0 }, cascade: { type: 'boolean' },
        translate: VEC3, rotate: { type: 'object', description: '{axis: [x,y,z] | "x"|"y"|"z", angle: degrees, origin?: [x,y,z]}' },
        path: { type: 'string', maxLength: 200, description: 'e.g. depth or entities.0.r' }, value: {},
      }, ['op']) },
      reason: { type: 'string', maxLength: 120 }, dryRun: { type: 'boolean' },
    }, ['expectedRevision', 'ops']),
    async run(i, bridge, ctx) { return ctx.text({ ok: true, ...(await viaApp('edit', bridge, i)) }); },
  },
  {
    name: 'app_batch',
    description: 'Run several app tools in ONE call: steps [{tool, args?, label?}], each tool one of ' + Object.keys(BATCH_OPS).join(', ') + '. The parameters of a tool go inside "args" (a step with any other key is refused). The whole batch is checked first (tool names, arguments, edit permission): if anything is wrong nothing runs. Steps then run in order; stopOnError (default true) stops at the first failure and reports the rest as skipped. An app_run_script step may give file (a .ckscript or .js file below a folder the user allowed, as for app_open_asset) instead of code. An app_edit step may leave out expectedRevision: it uses the revision the batch has reached. Returns one result per step; screenshots come back as images.' + NEEDS_APP,
    inputSchema: BATCH_INPUT,
    async run(i, bridge, ctx) {
      checkShape(i);                                           // keys first: a misplaced parameter is named before any file is read
      const steps = planBatch(await readScriptFiles(i, ctx.assetPolicy()), (n) => BRIDGE_TOOLS.find((t) => t.name === n)?.inputSchema, (op) => bridge.check(op));
      return batchResult(await runBatch(bridge, steps, i.stopOnError !== false), ctx);
    },
  },
  {
    name: 'app_job_start',
    description: 'Start a long operation and return a job id at once (poll app_job_status). kind "open_asset" {path, unit?} opens a big file (as app_open_asset, without the 60 s wait); "recipe" {id, params?} runs a saved declarative recipe (app_recipe_list); "checks" {checks: [{tool, args?, expect?}]} runs measuring checks in one batch. Finished: {ok, revision, changedCount, errorCount, warningCount, reportUri, previewUri?}; ok is false if anything failed validation.' + NEEDS_APP,
    inputSchema: obj({ kind: { type: 'string', enum: ['open_asset', 'recipe', 'checks'] }, args: { type: 'object' } }, ['kind', 'args']),
    async run(i, bridge, ctx) {
      const args = (i.args ?? {}) as Record<string, unknown>;
      const policy = ctx.assetPolicy();
      if (i.kind === 'open_asset') {
        bridge.check('open_asset');
        if (typeof args.path !== 'string') throw new BridgeError('bad_input', 'args.path is required for kind open_asset');
        return ctx.text({ ok: true, ...ctx.jobs.start('open_asset', async () => {
          const r = await openAssetViaApp(bridge, policy, args) as { revision: number; counts?: { features?: number }; errorCount?: number };
          return { revision: r.revision ?? null, changedCount: r.counts?.features ?? 0, errorCount: r.errorCount ?? 0, warningCount: 0, report: r, previewPng: await previewOf(bridge) };
        }) });
      }
      if (i.kind === 'recipe') {
        bridge.check('edit');
        if (typeof args.id !== 'string') throw new BridgeError('bad_input', 'args.id is required for kind recipe', 'app_recipe_list shows the ids');
        const found = listRecipes(policy).recipes.find((r) => r.id === args.id);
        if (!found) throw new BridgeError('recipe_not_found', `no recipe ${String(args.id)}`, `recipes: ${listRecipes(policy).recipes.map((r) => r.id).join(', ') || 'none; the user puts *.ckrecipe.json files in a recipes folder inside an allowed folder'}`);
        const params = bindParams(found, args.params);          // refused now, not inside the job
        return ctx.text({ ok: true, ...ctx.jobs.start('recipe', (c) => runRecipe(bridge, policy, found, params, c, ctx.recipeCache)) });
      }
      const checks = args.checks;
      if (!Array.isArray(checks) || !checks.length || checks.length > 20) throw new BridgeError('bad_input', 'args.checks must be a list of 1 to 20 checks');
      for (const [n, c] of checks.entries()) if (!c || typeof c !== 'object' || !(CHECK_TOOLS as readonly string[]).includes(String((c as { tool?: unknown }).tool))) throw new BridgeError('bad_input', `check ${n}: tool must be one of ${CHECK_TOOLS.join(', ')}`);
      return ctx.text({ ok: true, ...ctx.jobs.start('checks', (c) => runChecks(bridge, checks as RecipeCheck[], c)) });
    },
  },
  {
    name: 'app_job_status',
    description: 'State of a job: running (with elapsedMs, progress), done (the result: ok, revision, changedCount, errorCount, warningCount, reportUri, previewUri), failed (error code and message) or cancelled. Small and cheap; the report is the resource named by reportUri (fetch_result).',
    inputSchema: obj({ jobId: { type: 'string', maxLength: 40 } }, ['jobId']),
    async run(i, _bridge, ctx) {
      const j = ctx.jobs.status(String(i.jobId));
      if (!j) throw new BridgeError('no_such_job', `no job ${String(i.jobId)}`, 'jobs are kept for the last 50 starts of this server');
      return ctx.text({ ok: j.state !== 'failed' && (j.state !== 'done' || j.result!.ok), ...j });
    },
  },
  {
    name: 'app_job_cancel',
    description: 'Stop waiting for a running job and mark it cancelled. Work already sent to the app cannot be recalled: if it still finishes, app_job_status shows it as lateResult. Check app_state after a cancel.',
    inputSchema: obj({ jobId: { type: 'string', maxLength: 40 } }, ['jobId']),
    async run(i, _bridge, ctx) {
      const j = ctx.jobs.cancel(String(i.jobId));
      if (!j) throw new BridgeError('no_such_job', `no job ${String(i.jobId)}`);
      return ctx.text({ ok: true, ...j });
    },
  },
  {
    name: 'app_recipe_list',
    description: 'The saved recipes: declarative JSON files (*.ckrecipe.json) the user put in a recipes folder inside an allowed folder. Each has an id, title, typed parameters with limits and the source files it depends on. Run one with app_job_start {kind: "recipe", args: {id, params}}. Files that are not valid recipes are listed under problems.',
    inputSchema: obj({}),
    async run(_i, _bridge, ctx) { const r = listRecipes(ctx.assetPolicy()); return ctx.text({ ok: true, recipes: r.recipes.map(recipeEntry), problems: r.problems }); },
  },
  {
    name: 'app_undo',
    description: 'Undo the last step in the user\'s browser app (any step, not only the agent\'s). Needs the edit permission.' + NEEDS_APP,
    inputSchema: obj({}),
    async run(i, bridge, ctx) { return ctx.text({ ok: true, ...(await viaApp('undo', bridge, i)) }); },
  },
  {
    name: 'app_redo',
    description: 'Redo the last undone step in the user\'s browser app. Needs the edit permission.' + NEEDS_APP,
    inputSchema: obj({}),
    async run(i, bridge, ctx) { return ctx.text({ ok: true, ...(await viaApp('redo', bridge, i)) }); },
  },
  // the read-only measurement tools: the same list the headless server answers from (@kit/readback), asked of the document open in the app
  ...APP_READBACK_TOOLS.map((t): BridgeTool => ({
    name: `app_${t.name}`,
    description: `${t.description} Reads the document open in the user's browser app (no edit permission needed).${NEEDS_APP}`,
    inputSchema: t.inputSchema,
    async run(i, bridge, ctx) { const { summary, ...r } = await viaApp(t.name as BridgeOp, bridge, i); return ctx.text({ ok: true, ...r }, typeof summary === 'string' ? summary : undefined); },
  })),
];

const failure = (code: string, message: string, hint?: string): CallResult => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code, message, ...(hint ? { hint } : {}) } }, null, 1) }] });

const MAX_CHARS: Schema = { type: 'integer', minimum: MIN_BUDGET_CHARS, maximum: MAX_BUDGET_CHARS, description: `most characters of result (default ${DEFAULT_BUDGET_CHARS}); a larger result comes back as a summary with a handle for fetch_result` };
/** Tools whose answer is a few lines whatever happens: no budget argument. */
const NO_BUDGET = new Set(['bridge_pair', 'app_status']);
/** Each bridge tool as listed (and validated): its schema plus the budget argument. Built once. */
const LISTED = BRIDGE_TOOLS.map((t) => (NO_BUDGET.has(t.name) ? t : { ...t, inputSchema: { ...t.inputSchema, properties: { ...(t.inputSchema.properties ?? {}), maxChars: MAX_CHARS } } as BridgeTool['inputSchema'] }));
const FETCH_RESULT: { name: string; description: string; inputSchema: Schema & { type: 'object' } } = {
  name: 'fetch_result',
  description: 'The rest of a result that came back as a summary (its _budget.handle): `path` (dot path, e.g. features.12) gives one part, with offset + limit an array is paged by items; without a path the text is paged by characters (offset, limit). Handles last 30 minutes.',
  inputSchema: obj({ handle: { type: 'string', maxLength: 40 }, path: { type: 'string', maxLength: 200 }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: MAX_BUDGET_CHARS }, maxChars: MAX_CHARS }, ['handle']),
};
const RESULT_URI = /^ck:\/\/result\/([A-Za-z0-9]+)$/;

/** The backend with the app_ tools added. Names, validation and error shape follow the headless tools. Results over their budget are kept in `store` (made here when not given). */
export function withBridge(inner: Backend, bridge: Bridge, opts: { assetPolicy?: () => AssetPolicy; store?: ResultStore } = {}): Backend {
  const store = opts.store ?? new ResultStore();
  const jobs = new JobRunner({ store });
  const recipeCache: ToolContext['recipeCache'] = new Map();
  const policy = opts.assetPolicy ?? (() => loadAssetPolicy());
  const meta = [...LISTED.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })), FETCH_RESULT];
  const contextFor = (input: Record<string, unknown>): ToolContext => {
    const max = clampBudget(input.maxChars);
    const json = (data: unknown) => budgetJson(data, { max, store }).text;
    return { assetPolicy: policy, jobs, recipeCache, json, text: (data, summary) => ({ content: [...(summary ? [{ type: 'text' as const, text: summary }] : []), { type: 'text', text: json(data) }] }) };
  };
  return {
    ...inner,
    tools: () => [...inner.tools(), ...meta],
    resources: () => [...inner.resources(), ...store.list().map((r) => ({ uri: `ck://result/${r.id}`, name: `Result ${r.id}`, description: `A full tool result (${r.chars} characters) kept behind a handle`, mimeType: 'application/json' }))],
    async read(uri) {
      const m = RESULT_URI.exec(uri);
      if (!m) return inner.read(uri);
      const r = store.get(m[1]);
      return r ? { uri, mimeType: 'application/json', text: r.text } : null;
    },
    async call(name, args) {
      const input = args === undefined || args === null ? {} : args;
      if (name === 'fetch_result') {
        const problems = validate(FETCH_RESULT.inputSchema, input);
        if (problems.length) return failure('bad_input', problems.join('; '), 'see the input schema of fetch_result');
        try {
          const i = input as { handle: string; path?: string; offset?: number; limit?: number; maxChars?: number };
          const max = clampBudget(i.maxChars);
          const r = fetchResult(store, i, max);
          const out = r.paged ? JSON.stringify(r.data) : budgetJson(r.data, { max, store }).text;
          return { content: [{ type: 'text', text: out }] };
        } catch (e) {
          const x = e as { code?: string; message?: string; hint?: string };
          return failure(x.code ?? 'internal_error', String(x.message ?? e), x.hint);
        }
      }
      const tool = LISTED.find((t) => t.name === name);
      if (!tool) return inner.call(name, args);
      const problems = validate(tool.inputSchema, input);
      if (problems.length) return failure('bad_input', problems.join('; '), `see the input schema of ${name}`);
      const { maxChars: _m, ...rest } = input as Record<string, unknown>;   // the budget is ours: the app never sees it
      try { return await tool.run(rest, bridge, contextFor(input as Record<string, unknown>)); }
      catch (e) {
        if (e instanceof BridgeError) return failure(e.code, e.message, e.hint);
        return failure('internal_error', String((e as Error)?.message ?? e));
      }
    },
  };
}
