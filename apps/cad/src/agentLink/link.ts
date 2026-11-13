// The agent link inside the app: the switch the user holds. Off at every start (nothing is remembered, not even the code); it turns
// on only when the user pastes a pairing code; `allowEdit` is a second, separate box and is off on every connect.
import { signal, type Signal } from '@preact/signals-core';
import { BridgeClient, type LinkState } from '@kit/agent-link';
import type { BodyRef } from '@kit/readback';
import type { Controller } from '../controller';
import { t } from '../i18n';
import { makeAppHandler } from './appHandlers';
import { mouldLabels } from '../designCheck';
import { runAgentScript } from './appRun';

export interface LinkDeps {
  controller: Controller;
  store: { selection: Signal<string[]>; facts: Signal<{ faces: number; triangles: number; rebuildMs: number | null }>; featureStatus: Signal<Array<{ id: string; ok: boolean; code?: string; hint?: string }>>; notify(text: string, level?: 'info' | 'warn' | 'error'): void };
  version?: string;
  /** The bodies of what is shown (name, key, faces, volume), for the measurement tools. */
  bodies?: () => BodyRef[];
}

export function createAgentLink(d: LinkDeps) {
  const state = signal<LinkState>({ state: 'off' });
  const allowEdit = signal(false);
  const { controller: c, store } = d;
  const handle = makeAppHandler({
    document: () => c.document() as never,
    selection: () => store.selection.value,
    facts: () => store.facts.value,
    status: () => store.featureStatus.value,
    hasSolid: () => c.hasSolid(),
    allowEdit: () => allowEdit.value,
    readback: async () => {
      const m = await c.measureSession();
      return m ? { kernel: m.kernel, interference: m.interference, bodies: async () => d.bodies?.() ?? [], labels: mouldLabels() } : null;
    },
    runScript: (code) => runAgentScript(c, code, 'Agent script'),
    undo: () => c.undo(),
    redo: () => c.redo(),
    render: async (view, size) => {
      if (!c.hasSolid()) return null;
      const { renderSnapshot } = await import('@kit/snapshot');
      return (await renderSnapshot({ mesh: c.bodyFaces() as never, edges: c.bodyEdges() as never, box: c.bodyBox() as never }, { view: view as never, size })).png;
    },
  });
  const client = new BridgeClient({
    app: { name: 'CadKit', version: d.version },
    allowEdit: () => allowEdit.value,
    handle,
    onState: (s) => { state.value = s; if (s.state !== 'connected') allowEdit.value = false; },   // the box never outlives the link
    onCall: (op, ok) => {
      // a visible trace of everything that changes the document, and of every failure; plain reads stay quiet
      if (op === 'run_script') store.notify(t(ok ? 'agent.ran' : 'agent.failed'), ok ? 'info' : 'warn');
      else if (op === 'undo' || op === 'redo') store.notify(t(op === 'undo' ? 'agent.undid' : 'agent.redid'), 'info');
    },
  });
  if (typeof addEventListener === 'function') addEventListener('pagehide', () => { void client.disconnect(); });
  return {
    state, allowEdit,
    /** The service's address and the paired session token while linked (the chat panel reuses them). */
    endpoint: () => client.endpoint,
    connect: (code: string) => client.connect(code),
    disconnect: () => client.disconnect(),
    setAllowEdit: (v: boolean) => { allowEdit.value = v; client.permissionChanged(); },
  };
}
export type AgentLink = ReturnType<typeof createAgentLink>;
