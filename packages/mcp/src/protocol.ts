// A small MCP server core (JSON-RPC 2.0): initialize, ping, tools/list, tools/call, resources/list + read, notifications.
// Transport independent: stdio, the daemon's HTTP endpoint and the tests all feed `handle()` one message at a time.
import { AgentSession, callTool, createTools, type CallResult, type ToolDef } from '@kit/agent-tools';

export interface JsonRpcRequest { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> }
export interface JsonRpcResponse { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } }

export const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const SERVER_INFO = { name: 'ck-cad', version: '0.1.0' };

/** Runs async jobs one at a time, in arrival order. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  pending = 0;
  run<T>(job: () => Promise<T>): Promise<T> {
    this.pending++;
    const p = this.tail.then(job, job);
    this.tail = p.then(() => undefined, () => undefined).then(() => { this.pending--; });
    return p;
  }
}

/** What the protocol needs from the thing behind it. */
export interface Backend {
  tools(): Array<{ name: string; description: string; inputSchema: unknown }>;
  call(name: string, args: unknown): Promise<CallResult>;
  resources(): Array<{ uri: string; name: string; description?: string; mimeType: string }>;
  read(uri: string): Promise<{ uri: string; mimeType: string; text: string } | null>;
}

const INSTRUCTIONS = `ck-cad drives a parametric CAD kernel. run_script is the ONLY tool that changes the model (it writes a normal feature tree); tree, find, inspect, facts, bodies, probe, section(s), snapshot and drawing read, prove and show it, and measure, clearance, interference, thickness, draft and dfm (injection, cnc, printing) answer numeric design questions: how far apart, how much gap, do they overlap, how thin, what draft, what a manufacturing check says (each names the bodies and faces and gives a verdict). Start with list_methods / the ck://docs/guide resource, build with run_script, then check numbers (facts, probe, sections) and look (snapshot). checkpoint before risky changes. Sheet metal (bent flanges, flat pattern, DXF): sheet_reference lists the features and the recipe, run_script writes them (sheetRules, baseFlange, edgeFlange, hem, fold ...), sheet_info reads the flat pattern and bend table, sheet_export writes the DXF / bend table. Use mode 'attach' to add to what the user already has: their hand-made features are kept. The tools above work on this server's own document. To see or change the document the user has OPEN in their browser app, the user must link the app first: bridge_pair gives a one-time code for them to paste (Settings, Agent link); then app_status, app_state, app_screenshot, the same measurement tools as app_measure / app_clearance / app_interference / app_thickness / app_draft / app_dfm / app_bodies (read-only, no edit permission needed) and, only if they allowed editing, app_run_script, app_undo and app_redo.`;

export function agentBackend(a: AgentSession, tools: ToolDef[] = createTools()): Backend {
  return {
    tools: () => tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    call: (name, args) => callTool(a, tools, name, args),
    resources: () => [
      { uri: 'ck://docs/guide', name: 'Script guide', description: 'How the script API works and the build-check loop', mimeType: 'text/markdown' },
      { uri: 'ck://llms.txt', name: 'llms.txt', description: 'The guide plus a one-line index of every method and recipe (same as docs/llms.txt in the repo)', mimeType: 'text/plain' },
      { uri: 'ck://docs/methods', name: 'Script methods', description: 'Every script method with signature and summary', mimeType: 'application/json' },
      ...a.registry.recipes().map((r) => ({ uri: `ck://recipes/${r.id}`, name: `Recipe: ${r.title}`, description: 'A complete example script', mimeType: 'text/javascript' })),
      { uri: 'ck://document', name: 'Open document', description: 'The open document as JSON', mimeType: 'application/json' },
      { uri: 'ck://notes', name: 'Notes', description: 'The agent notes string', mimeType: 'text/plain' },
    ],
    async read(uri) {
      if (uri === 'ck://docs/guide') return { uri, mimeType: 'text/markdown', text: a.registry.guide() };
      if (uri === 'ck://llms.txt') return { uri, mimeType: 'text/plain', text: a.registry.llmsTxt?.() ?? a.registry.guide() };
      if (uri === 'ck://docs/methods') return { uri, mimeType: 'application/json', text: JSON.stringify(a.registry.methods(), null, 1) };
      if (uri === 'ck://document') return { uri, mimeType: 'application/json', text: JSON.stringify(a.doc, null, 1) };
      if (uri === 'ck://notes') return { uri, mimeType: 'text/plain', text: a.notes };
      const m = /^ck:\/\/recipes\/(.+)$/.exec(uri);
      const r = m ? a.registry.recipes().find((x) => x.id === m[1]) : undefined;
      return r ? { uri, mimeType: 'text/javascript', text: r.code } : null;
    },
  };
}

export class McpProtocol {
  readonly queue = new SerialQueue();
  private initialized = false;
  constructor(private readonly backend: Backend) {}

  /** Handle one parsed message (or a batch). Returns the response, or null for notifications. */
  async handle(msg: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
    if (Array.isArray(msg)) {
      if (!msg.length) return this.err(null, -32600, 'empty batch');
      const out = (await Promise.all(msg.map((m) => this.handleOne(m)))).filter((r): r is JsonRpcResponse => r !== null);
      return out.length ? out : null;
    }
    return this.handleOne(msg);
  }

  /** Parse a text line and handle it; a parse failure yields a -32700 response. */
  async handleText(text: string): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
    let msg: unknown;
    try { msg = JSON.parse(text); } catch { return this.err(null, -32700, 'parse error'); }
    return this.handle(msg);
  }

  private err(id: JsonRpcResponse['id'], code: number, message: string, data?: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
  }

  private async handleOne(m: unknown): Promise<JsonRpcResponse | null> {
    if (!m || typeof m !== 'object' || (m as JsonRpcRequest).jsonrpc !== '2.0' || typeof (m as JsonRpcRequest).method !== 'string') {
      const id = (m as { id?: JsonRpcResponse['id'] } | null)?.id;
      // a response from the client (id, no method) is ignored
      if (m && typeof m === 'object' && 'id' in m && !('method' in m)) return null;
      return this.err(id ?? null, -32600, 'invalid request');
    }
    const req = m as JsonRpcRequest;
    const isNote = req.id === undefined;
    const ok = (result: unknown): JsonRpcResponse | null => (isNote ? null : { jsonrpc: '2.0', id: req.id!, result });
    const fail = (code: number, message: string, data?: unknown): JsonRpcResponse | null => (isNote ? null : this.err(req.id!, code, message, data));
    const p = req.params ?? {};
    try {
      switch (req.method) {
        case 'initialize': {
          const want = typeof p.protocolVersion === 'string' ? p.protocolVersion : SUPPORTED_VERSIONS[0];
          this.initialized = true;
          return ok({
            protocolVersion: SUPPORTED_VERSIONS.includes(want) ? want : SUPPORTED_VERSIONS[0],
            capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
            serverInfo: SERVER_INFO,
            instructions: INSTRUCTIONS,
          });
        }
        case 'notifications/initialized': case 'notifications/cancelled': case 'notifications/roots/list_changed':
          return null;
        case 'ping': return ok({});
        case 'tools/list': return ok({ tools: this.backend.tools() });
        case 'tools/call': {
          if (typeof p.name !== 'string') return fail(-32602, 'tools/call needs a string "name"');
          const name = p.name;
          const result = await this.queue.run(() => this.backend.call(name, p.arguments));
          return ok(result);
        }
        case 'resources/list': return ok({ resources: this.backend.resources() });
        case 'resources/templates/list': return ok({ resourceTemplates: [] });
        case 'resources/read': {
          if (typeof p.uri !== 'string') return fail(-32602, 'resources/read needs a string "uri"');
          const uri = p.uri;
          const r = await this.queue.run(() => this.backend.read(uri));
          return r ? ok({ contents: [r] }) : fail(-32002, `resource not found: ${uri}`);
        }
        case 'prompts/list': return ok({ prompts: [] });
        default:
          return isNote ? null : fail(-32601, `method not found: ${req.method}`);
      }
    } catch (e) {
      return fail(-32603, String((e as Error)?.message ?? e));
    } finally {
      void this.initialized;
    }
  }
}
