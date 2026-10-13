import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { createBrowserKernel, type BrowserKernel } from '@ck/kernel-client/browser';
import { Session, type EditOp } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore, type DisplayLayer } from '@kit/store';
import { Viewport } from '@kit/viewport';
import { FeatureTree, Inspector, Ribbon, StatusBar } from '@kit/ui';
import { createWebPlatform } from '@kit/platform';
import { Controller } from './controller';
import { buildCommands } from './commands';
import { SamplesDialog, type SampleEntry } from './SamplesDialog';
import { useSignals } from './useSignals';
import './tokens.css';
import './app.css';

const base = import.meta.env.BASE_URL;
const platform = createWebPlatform({ base });
const DISPLAY_KEY = 'cad.display';
const loadDisplay = () => { try { return JSON.parse(localStorage.getItem(DISPLAY_KEY) ?? '{}'); } catch { return {}; } };
const store = createStore(loadDisplay());

// One kernel worker for the app; cancel() restarts it.
let kernelP: Promise<BrowserKernel> = createBrowserKernel(platform.wasmUrl());
const controller = new Controller({
  store,
  view: { setBody: (b) => viewport?.setBody(b as never), setHighlight: (n) => viewport?.setHighlight(n) },
  kernel: {
    async open(doc: PartDoc) {
      return new Session(doc, await kernelP, 'user');
    },
    cancel() { void kernelP.then((k) => k.close()); kernelP = createBrowserKernel(platform.wasmUrl()); },
  },
});
let viewport: Viewport | null = null;
if (import.meta.env.DEV) Object.assign(window, { __cad: { controller, store } });   // for debugging in the browser console

function App() {
  const host = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState('Home');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [samples, setSamples] = useState<SampleEntry[] | null>(null);
  const [, redraw] = useState(0);
  useSignals(() => { store.busy.value; store.hover.value; store.notices.value; store.featureStatus.value; store.mode.value; store.display.value; });

  useEffect(() => {
    const vp = new Viewport(host.current!, {
      onPick: (names, additive) => store.select(names, additive),
      onHover: (n) => { store.hover.value = n; },
    });
    viewport = vp;
    const ro = new ResizeObserver(() => vp.resize());
    ro.observe(host.current!);
    return () => { ro.disconnect(); vp.dispose(); viewport = null; };
  }, []);
  useEffect(() => { viewport?.setHighlight(store.selection.value); }, [store.selection.value]);
  useSignals(() => { viewport?.setHighlight(store.selection.value); });
  useEffect(() => {
    const d = store.display.value;
    for (const k of Object.keys(d)) viewport?.setLayerVisible(k, d[k as DisplayLayer]);
    try { localStorage.setItem(DISPLAY_KEY, JSON.stringify(d)); } catch { /* private window */ }
  }, [store.display.value]);

  const load = async (text: string) => {
    try { await controller.load(JSON.parse(text) as PartDoc); setSelectedId(null); store.select([]); redraw((n) => n + 1); }
    catch (e) { store.notify(`Could not open the part: ${(e as Error).message}`, 'error'); }
  };
  const edit = async (ops: EditOp[]) => { await controller.edit(ops); redraw((n) => n + 1); };

  const commands = buildCommands({
    open: async () => { const f = await platform.openFile(); if (f) await load(f.text); },
    save: async () => { const d = controller.document(); if (d) await platform.saveFile(`${d.name || 'part'}.ckpart`, JSON.stringify(d, null, 1)); },
    samples: async () => setSamples(await platform.listSamples()),
    undo: async () => { await controller.undo(); redraw((n) => n + 1); },
    redo: async () => { await controller.redo(); redraw((n) => n + 1); },
    hasDocument: () => controller.document() !== null,
    setView: (v) => viewport?.setView(v),
    fit: () => viewport?.fit(),
    setMode: (m) => { store.mode.value = m; viewport?.setPickMode(m === 'edge' ? 'edge' : 'face'); },
    mode: () => store.mode.value,
    toggleLayer: (l) => store.setDisplay(l, !store.display.value[l]),
    layer: (l) => store.display.value[l],
  });

  const doc = controller.document();
  const rows = doc ? doc.features.map((f) => ({ id: f.id, type: f.type, name: f.name, suppressed: (f as { suppressed?: boolean }).suppressed })) : [];
  const feature = doc && selectedId ? (doc.features.find((f) => f.id === selectedId) as unknown as Record<string, unknown> | undefined) ?? null : null;
  let pending: ReturnType<typeof setTimeout> | undefined;

  return (
    <>
      <div class="ribbon-wrap"><Ribbon commands={commands} activeTab={tab} onTab={setTab} /></div>
      <div class="tree-wrap">
        {rows.length ? (
          <FeatureTree rows={rows} status={store.featureStatus.value} selectedId={selectedId}
            onSelect={setSelectedId}
            onMove={(id, to) => edit([{ op: 'move', id, to }])}
            onRemove={(id) => edit([{ op: 'remove', id }])}
            onToggleSuppress={(id) => { const f = doc!.features.find((x) => x.id === id) as { suppressed?: boolean } | undefined; edit([{ op: 'set', id, path: 'suppressed', value: !f?.suppressed }]); }} />
        ) : <div class="empty">Open a part or choose a sample.</div>}
      </div>
      <div id="vp" ref={host} />
      <div class="insp-wrap">
        <Inspector feature={feature} onSet={(path, value) => {
          clearTimeout(pending);
          pending = setTimeout(() => edit([{ op: 'set', id: selectedId!, path, value }]), 150);
        }} />
      </div>
      <div class="status-wrap"><StatusBar notices={store.notices.value} hover={store.hover.value} busy={store.busy.value} /></div>
      {samples ? <SamplesDialog samples={samples} thumbBase={base} onClose={() => setSamples(null)}
        onPick={async (s) => { setSamples(null); const r = await fetch(s.url); await load(await r.text()); }} /> : null}
    </>
  );
}

render(<App />, document.getElementById('app')!);
