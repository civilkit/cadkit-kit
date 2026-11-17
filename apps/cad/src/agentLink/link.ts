// The agent link inside the app: the switch the user holds. Off at every start (nothing is remembered, not even the code); it turns
// on only when the user pastes a pairing code; `allowEdit` is a second, separate box and is off on every connect.
import { signal, type Signal } from '@preact/signals-core';
import { BridgeClient, BridgeError, type LinkState } from '@kit/agent-link';
import type { BodyRef } from '@kit/readback';
import type { Controller } from '../controller';
import { t } from '../i18n';
import { makeAppHandler, type AssetKind, type OpenedAsset } from './appHandlers';
import { mouldLabels } from '../designCheck';
import { runAgentScript } from './appRun';
import { listPlugins, runPluginOnApp } from './appPlugin';
import type { PluginRegistry } from '@kit/plugin';

export interface LinkDeps {
  controller: Controller;
  store: { selection: Signal<string[]>; facts: Signal<{ faces: number; triangles: number; rebuildMs: number | null }>; featureStatus: Signal<Array<{ id: string; ok: boolean; code?: string; hint?: string }>>; notify(text: string, level?: 'info' | 'warn' | 'error'): void };
  version?: string;
  /** The app's plugin registry (built-in and installed): what app_plugin_list shows and app_plugin_run runs. */
  plugins?: PluginRegistry;
  /** The bodies of what is shown (name, key, faces, volume), for the measurement tools. */
  bodies?: () => BodyRef[];
}

/** What the page does to open a file for the agent (it knows the tabs, the importers and the dialogs); set by the page once it exists. Throws when the file does not open. */
export type AssetOpener = (a: { name: string; kind: AssetKind; bytes: Uint8Array; unit?: string }) => Promise<void>;

export function createAgentLink(d: LinkDeps) {
  let opener: AssetOpener | null = null;
  const state = signal<LinkState>({ state: 'off' });
  const allowEdit = signal(false);
  const { controller: c, store } = d;
  const client: BridgeClient = new BridgeClient({
    app: { name: 'CadKit', version: d.version },
    allowEdit: () => allowEdit.value,
    handle: (op, args) => handle(op, args),
    onState: (s) => { state.value = s; if (s.state !== 'connected') allowEdit.value = false; },   // the box never outlives the link
    onCall: (op, ok) => {
      // a visible trace of everything that changes the document, and of every failure; plain reads stay quiet
      if (op === 'plugin_run') store.notify(t(ok ? 'agent.ran' : 'agent.failed'), ok ? 'info' : 'warn');
      else if (op === 'run_script' || op === 'open_asset' || op === 'edit') store.notify(t(ok ? 'agent.ran' : 'agent.failed'), ok ? 'info' : 'warn');
      else if (op === 'undo' || op === 'redo') store.notify(t(op === 'undo' ? 'agent.undid' : 'agent.redid'), 'info');
    },
  });
  const handle = makeAppHandler({
    edit: async (expected, ops, reason) => {
      const r = await c.editIfRevision(expected, ops as never, reason);
      if ('stale' in r) return { ok: false, stale: true, revision: r.revision };
      if (r.ok) return { ok: true, warnings: r.refWarnings?.length ?? 0 };
      return { ok: false, errors: (r.errors ?? []).map(([feature, e]: [string, { code?: string }]) => ({ feature, code: e.code ?? 'error' })), message: r.hints?.map((h: { hint: string }) => h.hint).join('; ') || r.schemaError };
    },
    fetchAsset: (h) => client.fetchAsset(h),
    openAsset: async (a): Promise<OpenedAsset> => {
      if (!opener) throw new BridgeError('unsupported', 'the app is not ready to open files yet');
      await opener(a);
      await c.settled();
      const doc = c.document();
      if (!doc || (a.kind !== 'part' && !/^(stl|obj|glb|3mf)$/.test(a.kind) && doc.features.length === 0)) throw new BridgeError('open_failed', 'the file did not open', 'the app shows why in its notices');
      return { documentId: c.documentId, revision: c.revision, counts: { features: doc.features.length, faces: store.facts.value.faces }, errorCount: store.featureStatus.value.filter((s) => !s.ok).length };
    },
    revision: () => c.revision,
    documentId: () => c.documentId,
    bounds: () => (c.hasSolid() ? c.bodyBox() : null),
    document: () => c.document() as never,
    selection: () => store.selection.value,
    facts: () => store.facts.value,
    status: () => store.featureStatus.value,
    hasSolid: () => c.hasSolid(),
    allowEdit: () => allowEdit.value,
    ...(d.plugins ? { plugins: () => listPlugins(d.plugins!), runPlugin: (pl: string, g: string, params: Record<string, unknown>) => runPluginOnApp(c, d.plugins!, pl, g, params) } : {}),
    readback: async () => {
      const m = await c.measureSession();
      return m ? { kernel: m.kernel, interference: m.interference, bodies: async () => d.bodies?.() ?? [], labels: mouldLabels() } : null;
    },
    runScript: (code) => runAgentScript(c, code, 'Agent script'),
    undo: () => c.undo(),
    redo: () => c.redo(),
    render: async (view, size, section) => {
      if (!c.hasSolid()) return null;
      const { renderSnapshot } = await import('@kit/snapshot');
      // a section picture draws the exact loops the kernel returns for the plane on the shaded body
      const cut = section ? await (await c.measureSession())?.kernel.section(section) : undefined;
      if (section && !cut) return null;
      return (await renderSnapshot({ mesh: c.bodyFaces() as never, edges: c.bodyEdges() as never, box: c.bodyBox() as never, ...(cut ? { section: cut as never } : {}) }, { view: view as never, size })).png;
    },
  });
  if (typeof addEventListener === 'function') addEventListener('pagehide', () => { void client.disconnect(); });
  return {
    state, allowEdit,
    /** The page says how files are opened for the agent (the importers and tabs live in the page). */
    setAssetOpener: (f: AssetOpener | null) => { opener = f; },
    /** The service's address and the paired session token while linked (the chat panel reuses them). */
    endpoint: () => client.endpoint,
    connect: (code: string) => client.connect(code),
    disconnect: () => client.disconnect(),
    setAllowEdit: (v: boolean) => { allowEdit.value = v; client.permissionChanged(); },
  };
}
export type AgentLink = ReturnType<typeof createAgentLink>;
