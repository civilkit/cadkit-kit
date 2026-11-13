// The MCP tools of the agent link: they reach the document the user has OPEN in the browser app (docs/agent-bridge.md), not the
// daemon's own scratch document. They are added beside the headless tools; nothing here works until the user pairs the app.
import { capJson, validate, type CallResult, type Schema } from '@kit/agent-tools';
import { BridgeError, type Bridge, type BridgeOp } from '@kit/agent-link';
import { APP_READBACK_TOOLS } from '@kit/readback';
import type { Backend } from './protocol';

interface BridgeTool {
  name: string;
  description: string;
  inputSchema: Schema & { type: 'object' };
  run(input: Record<string, unknown>, bridge: Bridge): Promise<CallResult>;
}
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema & { type: 'object' } => ({ type: 'object', properties, required, additionalProperties: false });
const text = (data: unknown, summary?: string): CallResult => ({ content: [...(summary ? [{ type: 'text' as const, text: summary }] : []), { type: 'text', text: capJson(data).text }] });
const NEEDS_APP = ' Works only while the user has linked the app (Settings, Agent link): see app_status.';

const viaApp = (op: BridgeOp, bridge: Bridge, args: Record<string, unknown>) => bridge.request(op, args) as Promise<Record<string, unknown>>;

export const BRIDGE_TOOLS: BridgeTool[] = [
  {
    name: 'bridge_pair',
    description: 'Start linking the user\'s open browser app to this server: returns a one-time pairing code (valid 10 minutes). Tell the user to open Settings, Agent link in the app, paste the code and turn the link on. They choose whether you may only look or also change the document. Calling it again replaces the code and ends any current link.',
    inputSchema: obj({}),
    async run(_i, bridge) {
      const c = bridge.newCode();
      return text({ ok: true, code: c.code, expiresInSeconds: Math.round((c.expiresAt - Date.now()) / 1000), tellTheUser: `Open the app, Settings, Agent link, paste ${c.code} and turn the link on. Tick "Allow the agent to change this document" only if you want me to edit; otherwise I can only look.` });
    },
  },
  {
    name: 'app_status',
    description: 'Is the user\'s browser app linked, may the agent change its document, and is a pairing code open? Cheap; call it before the other app_ tools.',
    inputSchema: obj({}),
    async run(_i, bridge) { return text({ ok: true, ...bridge.status() }); },
  },
  {
    name: 'app_state',
    description: 'Read the document open in the user\'s browser app: name, features (id, type, name, suppressed, error), variables, the current selection, counts and whether it has unsaved changes. detail "full" adds the whole document JSON.' + NEEDS_APP,
    inputSchema: obj({ detail: { type: 'string', enum: ['summary', 'full'], description: 'summary (default) or the whole document JSON' } }),
    async run(i, bridge) { return text({ ok: true, ...(await viaApp('state', bridge, i)) }); },
  },
  {
    name: 'app_screenshot',
    description: 'A PNG of the model open in the user\'s browser app, drawn from its current geometry (view: iso | front | back | left | right | top | bottom). It is a rendering of the document, not a capture of the user\'s screen: panels and the camera they have set are not in it.' + NEEDS_APP,
    inputSchema: obj({ view: { type: 'string', enum: ['iso', 'front', 'back', 'left', 'right', 'top', 'bottom'] }, size: { type: 'integer', minimum: 64, maximum: 1536 } }),
    async run(i, bridge) {
      const r = await viaApp('screenshot', bridge, i);
      const png = typeof r.png === 'string' ? r.png : '';
      if (!png) throw new BridgeError('snapshot_failed', 'the app returned no image', 'the document may have no solid yet');
      const { png: _p, ...rest } = r;
      return { content: [{ type: 'text', text: `app screenshot ${String(r.view ?? 'iso')} ${String(r.size ?? '')}px` }, { type: 'text', text: capJson({ ok: true, ...rest }).text }, { type: 'image', data: png, mimeType: 'image/png' }] };
    },
  },
  {
    name: 'app_run_script',
    description: 'Run a script on the document open in the user\'s browser app, in attach mode: its features are added after the existing ones, as ONE undo step the user can undo, with a notice in the app. The same script language as run_script. Needs the user to have ticked "Allow the agent to change this document".' + NEEDS_APP,
    inputSchema: obj({ code: { type: 'string', maxLength: 40000 } }, ['code']),
    async run(i, bridge) { return text({ ok: true, ...(await viaApp('run_script', bridge, i)) }); },
  },
  {
    name: 'app_undo',
    description: 'Undo the last step in the user\'s browser app (any step, not only the agent\'s). Needs the edit permission.' + NEEDS_APP,
    inputSchema: obj({}),
    async run(i, bridge) { return text({ ok: true, ...(await viaApp('undo', bridge, i)) }); },
  },
  {
    name: 'app_redo',
    description: 'Redo the last undone step in the user\'s browser app. Needs the edit permission.' + NEEDS_APP,
    inputSchema: obj({}),
    async run(i, bridge) { return text({ ok: true, ...(await viaApp('redo', bridge, i)) }); },
  },
  // the read-only measurement tools: the same list the headless server answers from (@kit/readback), asked of the document open in the app
  ...APP_READBACK_TOOLS.map((t): BridgeTool => ({
    name: `app_${t.name}`,
    description: `${t.description} Reads the document open in the user's browser app (no edit permission needed).${NEEDS_APP}`,
    inputSchema: t.inputSchema,
    async run(i, bridge) { const { summary, ...r } = await viaApp(t.name as BridgeOp, bridge, i); return text({ ok: true, ...r }, typeof summary === 'string' ? summary : undefined); },
  })),
];

const failure = (code: string, message: string, hint?: string): CallResult => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code, message, ...(hint ? { hint } : {}) } }, null, 1) }] });

/** The backend with the app_ tools added. Names, validation and error shape follow the headless tools. */
export function withBridge(inner: Backend, bridge: Bridge): Backend {
  return {
    ...inner,
    tools: () => [...inner.tools(), ...BRIDGE_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))],
    async call(name, args) {
      const tool = BRIDGE_TOOLS.find((t) => t.name === name);
      if (!tool) return inner.call(name, args);
      const input = args === undefined || args === null ? {} : args;
      const problems = validate(tool.inputSchema, input);
      if (problems.length) return failure('bad_input', problems.join('; '), `see the input schema of ${name}`);
      try { return await tool.run(input as Record<string, unknown>, bridge); }
      catch (e) {
        if (e instanceof BridgeError) return failure(e.code, e.message, e.hint);
        return failure('internal_error', String((e as Error)?.message ?? e));
      }
    },
  };
}
