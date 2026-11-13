// The read-only measurement tools (measure, clearance, interference, thickness, draft, dfm): what the kernel answers about the open document,
// so an assistant can check its own work. Defined once in @kit/readback (the app link's app_ tools use the same list); this wraps them for an AgentSession.
import { READBACK_TOOLS, ReadbackError, type ReadbackHost } from '@kit/readback';
import type { AgentSession } from './agent-session';
import { listBodies } from './bodies';
import { ToolError } from './errors';
import type { ToolDef } from './tools';

export function readbackHost(a: AgentSession): ReadbackHost {
  return {
    kernel: a.session,
    interference: () => a.interference(),
    bodies: async () => (await listBodies(a, { faces: true })).map((b) => ({ name: b.name, key: b.key, volume: b.volume, faces: b.faces ?? [] })),
  };
}

export function readbackTools(): ToolDef[] {
  return READBACK_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    async handler(input, a) {
      try { return await t.run(input, readbackHost(a)); } catch (e) {
        if (e instanceof ReadbackError) throw new ToolError(e.code, e.message, e.hint);
        throw e;
      }
    },
  }));
}
