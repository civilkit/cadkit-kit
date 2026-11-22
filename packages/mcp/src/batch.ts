// app_batch: several app_ tools in one call. The whole batch is checked before anything runs (unknown step keys, unknown or non-batchable
// tools, bad arguments, missing edit permission), so a mistake in step 7 never leaves steps 1 to 6 applied.
import { validate, type Schema } from '@kit/agent-tools';
import { BridgeError, type BridgeOp } from '@kit/agent-link';
import { readAsset, resolveAsset, SCRIPT_EXTENSIONS, type AssetPolicy } from './assetPolicy';

/** The app_ tools a batch may hold, by the app op each one asks for. (Files, jobs and the pairing tools are not steps.) */
export const BATCH_OPS: Readonly<Record<string, BridgeOp>> = {
  app_state: 'state', app_selection: 'selection', app_settings: 'settings', app_screenshot: 'screenshot', app_section: 'section', app_plugin_list: 'plugin_list', app_plugin_run: 'plugin_run',
  app_run_script: 'run_script', app_edit: 'edit', app_undo: 'undo', app_redo: 'redo',
  app_bodies: 'bodies', app_measure: 'measure', app_clearance: 'clearance', app_interference: 'interference', app_thickness: 'thickness', app_draft: 'draft', app_dfm: 'dfm', app_interfaces: 'interfaces',
};
export const MAX_BATCH_STEPS = 20;

export interface BatchStep { index: number; tool: string; op: BridgeOp; args: Record<string, unknown>; label?: string }

/** The input schema of app_batch. A step is `{tool, args?, label?}`: the parameters of the tool go inside `args`. */
export const BATCH_INPUT: Schema & { type: 'object' } = {
  type: 'object', additionalProperties: false, required: ['steps'],
  properties: {
    steps: {
      type: 'array', minItems: 1, maxItems: MAX_BATCH_STEPS,
      items: {
        type: 'object', additionalProperties: false, required: ['tool'], unknownHint: 'a step is {tool, args?, label?}: the tool\'s parameters go inside "args"',
        properties: { tool: { type: 'string', maxLength: 40 }, args: { type: 'object', description: 'the tool\'s parameters; app_run_script also takes file (a script file below an allowed folder, .ckscript or .js) instead of code' }, label: { type: 'string', maxLength: 60 } },
      },
    },
    stopOnError: { type: 'boolean', description: 'stop at the first step that fails (default true); the steps after it are reported as skipped' },
  },
};

/** The shape of the batch (keys, step count) alone: throws bad_input before anything is read or run. */
export function checkShape(input: Record<string, unknown>): void {
  const problems = validate(BATCH_INPUT, input);
  if (problems.length) throw new BridgeError('bad_input', problems.join('; '), 'nothing ran; steps look like {"tool": "app_state", "args": {"limit": 5}}');
}

/** A step app_run_script {file} runs the script in that file: it is read here (only below a folder the user allowed, as for app_open_asset) and becomes {code}. Returns the steps with the files read; nothing is run. */
export async function readScriptFiles(input: Record<string, unknown>, policy: AssetPolicy): Promise<Record<string, unknown>> {
  const steps = await Promise.all((input.steps as Array<Record<string, unknown>>).map(async (st, n) => {
    const a = st.args as Record<string, unknown> | undefined;
    if (st.tool !== 'app_run_script' || !a || a.file === undefined) return st;
    if (a.code !== undefined) throw new BridgeError('bad_input', `steps[${n}].args: give code or file, not both`);
    const { file, ...rest } = a;
    const r = await resolveAsset(policy, file, SCRIPT_EXTENSIONS);
    const code = Buffer.from(await readAsset(r, policy)).toString('utf8');
    if (code.length > 40000) throw new BridgeError('bad_input', `steps[${n}].args.file: the script is ${code.length} characters; the limit is 40000`);
    return { ...st, args: { ...rest, code } };
  }));
  return { ...input, steps };
}

/** Check the whole batch and return its steps, or throw a bad_input that lists every problem. `schemaOf` gives a batchable tool's input schema; `check` throws when the app is not linked or a step needs the edit permission. */
export function planBatch(input: Record<string, unknown>, schemaOf: (tool: string) => (Schema & { type: 'object' }) | undefined, check: (op: BridgeOp) => void): BatchStep[] {
  checkShape(input);
  const problems: string[] = [];
  const steps: BatchStep[] = [];
  for (const [index, raw] of (input.steps as Array<Record<string, unknown>>).entries()) {
    const tool = String(raw.tool);
    const op = BATCH_OPS[tool];
    const at = `steps[${index}]`;
    const schema = op ? schemaOf(tool) : undefined;
    if (!op || !schema) { problems.push(`${at}.tool: ${tool} cannot be a batch step`); continue; }
    const args = (raw.args ?? {}) as Record<string, unknown>;
    // inside a batch an edit takes the revision the batch has reached, so expectedRevision is optional there
    const s = tool === 'app_edit' ? { ...schema, required: (schema.required ?? []).filter((k) => k !== 'expectedRevision') } : schema;
    for (const p of validate(s, args, `${at}.args`)) problems.push(p);
    steps.push({ index, tool, op, args, ...(typeof raw.label === 'string' ? { label: raw.label } : {}) });
  }
  if (problems.length) throw new BridgeError('bad_input', problems.join('; '), `nothing ran. Batchable tools: ${Object.keys(BATCH_OPS).join(', ')}`);
  for (const st of steps) check(st.op);
  return steps;
}
