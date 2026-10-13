import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { createBrowserKernel, type BrowserKernel } from '@ck/kernel-client/browser';
import { Session, type EditOp } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { signal } from '@preact/signals-core';
import { createStore, type DisplayLayer, type Workspace } from '@kit/store';
import { Viewport } from '@kit/viewport';
import {
  BusyOverlay, CommandPalette, Drawer, FeatureTree, HistoryLog, Inspector, Ribbon, StatusBar, Toast,
  type HistoryFilter,
} from '@kit/ui';
import { createWebPlatform } from '@kit/platform';
import { Controller } from './controller';
import { buildCommands } from './commands';
import { toEntries, type Rejection } from './history';
import { SamplesDialog, type SampleEntry } from './SamplesDialog';
import { SettingsDialog } from './SettingsDialog';
import { useSignals } from './useSignals';
import './tokens.css';
import './app.css';

const base = import.meta.env.BASE_URL;
const platform = createWebPlatform({ base });
const read = (key: string): unknown => { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } };
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window */ } };
const store = createStore((read('cad.display') as object | null) ?? {}, read('cad.workspace'));

// One kernel worker for the app; cancel() restarts it.
let kernelP: Promise<BrowserKernel> = createBrowserKernel(platform.wasmUrl());
let session: Session | null = null;
let viewport: Viewport | null = null;
const controller = new Controller({
  store,
  view: {
    setBody: (b) => {
      viewport?.setBody(b as never);
      const body = b as { mesh?: { faceIds: string[]; triFace: ArrayLike<number> } } | null;
      store.facts.value = { ...store.facts.value, faces: body?.mesh?.faceIds.length ?? 0, triangles: body?.mesh?.triFace.length ?? 0 };
    },
    setHighlight: (n) => viewport?.setHighlight(n),
  },
  kernel: {
    async open(doc: PartDoc) { session = new Session(doc, await kernelP, 'user'); return session; },
    cancel() { void kernelP.then((k) => k.close()); kernelP = createBrowserKernel(platform.wasmUrl()); },
  },
});
// Rejected edits are not in the session history, so record them here whatever the source (UI, console, agent).
const rejections = signal<Rejection[]>([]);
const rawEdit = controller.edit.bind(controller);
controller.edit = async (ops, reason) => {
  const at = session?.history().length ?? 0;
  const r = await rawEdit(ops, reason);
  if (!r.ok) {
    const hint = r.hints?.map((h) => h.hint).join('; ') || r.schemaError || 'edit failed';
    rejections.value = [...rejections.value, { at, time: Date.now(), reason: reason ?? '', hint, ops }];
  }
  return r;
};
if (import.meta.env.DEV) Object.assign(window, { __cad: { controller, store } });   // for the browser console

const I = (d: string) => `<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const RAIL_ICONS: Record<string, string> = {
  undo: I('<path d="M6 3 3 6l3 3M3 6h6a4 4 0 010 8H6"/>'),
  redo: I('<path d="m10 3 3 3-3 3M13 6H7a4 4 0 000 8h3"/>'),
  'view-iso': I('<path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5zM2.5 5 8 8.2 13.5 5M8 8.2v6"/>'),
  'view-front': I('<rect x="3" y="3" width="10" height="10" rx="1"/><path d="M3 8h10" opacity=".4"/>'),
  'view-top': I('<path d="M2.5 11.5 5 4.5h8.5l-2.5 7z"/>'),
  'view-right': I('<path d="M3 3h6l4 2.5v7.5H3z"/>'),
  fit: I('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>'),
};
const timed = async <T,>(f: () => Promise<T>): Promise<T> => {
  const t0 = performance.now();
  try { return await f(); } finally { store.facts.value = { ...store.facts.value, rebuildMs: Math.round(performance.now() - t0) }; }
};

function App() {
  const host = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState('Home');
  const [leftTab, setLeftTab] = useState<'Outliner' | 'Features' | 'Assets'>('Features');
  const [drawerTab, setDrawerTab] = useState('history');
  const [histFilter, setHistFilter] = useState<HistoryFilter>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [samples, setSamples] = useState<SampleEntry[] | null>(null);
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const [, redraw] = useState(0);
  useSignals(() => { store.busy.value; store.hover.value; store.notices.value; store.featureStatus.value; store.mode.value; store.display.value; store.workspace.value; store.facts.value; store.selection.value; rejections.value; });
  const ws = store.workspace.value;

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
  useEffect(() => {
    const d = store.display.value;
    for (const k of Object.keys(d)) viewport?.setLayerVisible(k, d[k as DisplayLayer]);
    write('cad.display', d);
  }, [store.display.value]);
  useEffect(() => {
    write('cad.workspace', ws);
    const r = document.documentElement.style;
    r.setProperty('--alpha', String(ws.opacity));
    r.setProperty('--blur', `${ws.blur}px`);
    requestAnimationFrame(() => viewport?.resize());
  }, [ws]);

  const load = async (text: string) => {
    try {
      const doc = JSON.parse(text) as PartDoc;
      await timed(() => controller.load(doc));
      setSelectedId(null); store.select([]); rejections.value = []; redraw((n) => n + 1);
      store.notify(`Opened “${doc.name || 'part'}”`);
    } catch (e) { store.notify(`Could not open the part: ${(e as Error).message}`, 'error'); }
  };
  const edit = async (ops: EditOp[]) => {
    await timed(() => controller.edit(ops));
    redraw((n) => n + 1);
  };
  const gotoStep = async (count: number) => {
    const have = session?.history().length ?? 0;
    for (let i = have; i > count; i--) await controller.undo();
    redraw((n) => n + 1);
  };
  const setMode = (m: 'face' | 'edge') => { store.mode.value = m; viewport?.setPickMode(m); };
  const toggleDrawer = () => store.setWorkspace({ drawerOpen: !store.workspace.value.drawerOpen });

  const commands = buildCommands({
    open: async () => { const f = await platform.openFile(); if (f) await load(f.text); },
    save: async () => { const d = controller.document(); if (d) await platform.saveFile(`${d.name || 'part'}.ckpart`, JSON.stringify(d, null, 1)); },
    samples: async () => setSamples(await platform.listSamples()),
    undo: async () => { await controller.undo(); redraw((n) => n + 1); },
    redo: async () => { await controller.redo(); redraw((n) => n + 1); },
    palette: () => setPalette(true),
    toggleDrawer,
    settings: () => setSettings(true),
    hasDocument: () => controller.document() !== null,
    setView: (v) => viewport?.setView(v),
    fit: () => viewport?.fit(),
    setMode: (m) => setMode(m === 'edge' ? 'edge' : 'face'),
    mode: () => store.mode.value,
    toggleLayer: (l) => store.setDisplay(l, !store.display.value[l]),
    layer: (l) => store.display.value[l],
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); setPalette(true); }
      else if (e.key === '\\') { e.preventDefault(); toggleDrawer(); }
      else if (e.key === '1') setMode('face');
      else if (e.key === '2') setMode('edge');
      else if (e.key === 'z' || e.key === 'Z') viewport?.fit();
      else if (e.key === 'Escape') { setPalette(false); setSettings(false); setSamples(null); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const doc = controller.document();
  const rows = doc ? doc.features.map((f) => ({ id: f.id, type: f.type, name: f.name, suppressed: (f as { suppressed?: boolean }).suppressed })) : [];
  const feature = doc && selectedId ? (doc.features.find((f) => f.id === selectedId) as unknown as Record<string, unknown> | undefined) ?? null : null;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const records = session?.history() ?? [];
  const entries = toEntries(records, rejections.value);
  const failures = store.featureStatus.value.filter((s) => !s.ok);
  const facts = store.facts.value;

  const tree = (
    <FeatureTree rows={rows} status={store.featureStatus.value} selectedId={selectedId}
      onSelect={setSelectedId}
      onMove={(id, to) => edit([{ op: 'move', id, to }])}
      onRemove={(id) => edit([{ op: 'remove', id }])}
      onToggleSuppress={(id) => { const f = doc!.features.find((x) => x.id === id) as { suppressed?: boolean } | undefined; edit([{ op: 'set', id, path: 'suppressed', value: !f?.suppressed }]); }} />
  );
  const outliner = (
    <div class="outliner">
      {['insertPart', 'cpattern', 'lpattern', 'mate'].map((type) => {
        const list = rows.filter((r) => r.type === type);
        return list.length ? (
          <div key={type}><div class="grp">{type === 'insertPart' ? 'Parts' : type === 'mate' ? 'Mates' : 'Patterns'}</div>
            {list.map((r) => <div key={r.id} class={'row' + (selectedId === r.id ? ' sel' : '')} onClick={() => setSelectedId(r.id)}><span class="row-id">{r.id}</span><span class="row-name">{r.name ?? r.type}</span></div>)}
          </div>
        ) : null;
      })}
      {rows.length === 0 ? <div class="empty">Nothing to list yet.</div> : <div class="empty">Parts, mates and patterns appear here for assemblies.</div>}
    </div>
  );
  const leftBody = !rows.length ? <div class="empty">Open a part or choose a sample (press F, then type "samples").</div> : tree;
  const left = ws.leftPanel === 'hidden' ? null : (
    <div class={'tree-wrap ' + ws.leftPanel}>
      {ws.leftTabs ? (
        <>
          <div class="ptabs">
            {(['Outliner', 'Features', 'Assets'] as const).map((t) => <button key={t} class="pt" aria-selected={leftTab === t} onClick={() => setLeftTab(t)}>{t}</button>)}
          </div>
          {leftTab === 'Outliner' ? outliner : leftTab === 'Features' ? leftBody : (
            <div class="empty">Parts library. <button class="rb-btn" onClick={async () => setSamples(await platform.listSamples())}>Browse samples</button></div>
          )}
        </>
      ) : leftBody}
    </div>
  );
  const right = ws.rightPanel === 'off' ? null : (
    <div class={'insp-wrap ' + ws.rightPanel}>
      <Inspector feature={feature} onSet={(path, value) => {
        clearTimeout(pending);
        pending = setTimeout(() => edit([{ op: 'set', id: selectedId!, path, value }]), 150);
      }} />
    </div>
  );

  return (
    <div id="app" data-ribbon={ws.ribbon} data-left={ws.leftPanel} data-right={ws.rightPanel} data-drawer={ws.drawerOpen}>
      <div class="topbar">
        <b class="doc-name">{doc?.name ?? 'No part open'}</b>
        <button class="rb-btn" onClick={() => commands.find((c) => c.id === 'open')!.run()}>Open</button>
        <button class="rb-btn" disabled={!doc} onClick={() => commands.find((c) => c.id === 'save')!.run()}>Save</button>
        <button class="rb-btn" disabled={!doc} onClick={() => commands.find((c) => c.id === 'undo')!.run()}>Undo</button>
        <button class="rb-btn" disabled={!doc} onClick={() => commands.find((c) => c.id === 'redo')!.run()}>Redo</button>
        <button class="search-btn" onClick={() => setPalette(true)}>Search commands <kbd>F</kbd></button>
        <button class="rb-btn" onClick={() => setSettings(true)} title="Workspace settings">Settings</button>
      </div>
      {ws.ribbon !== 'off' ? <div class={'ribbon-wrap ' + ws.ribbon}><Ribbon commands={commands} activeTab={tab} onTab={setTab} /></div> : null}
      {ws.leftPanel === 'docked' ? left : null}
      <div id="vp" ref={host}>
        {ws.leftPanel === 'floating' ? left : null}
        {ws.rightPanel === 'floating' ? right : null}
        {ws.toolRail ? (
          <div class="tool-rail" role="toolbar" aria-label="Tools">
            {commands.filter((c) => ['view-iso', 'view-front', 'view-top', 'view-right', 'fit', 'undo', 'redo'].includes(c.id)).map((c) => (
              <button key={c.id} title={c.label} aria-label={c.label} disabled={c.enabled ? !c.enabled() : false} onClick={c.run} dangerouslySetInnerHTML={{ __html: RAIL_ICONS[c.id] ?? c.label.slice(0, 2) }} />
            ))}
          </div>
        ) : null}
        {ws.selectionBar ? (
          <div class="selmodes" role="toolbar" aria-label="Selection mode">
            {([['face', 'Face', '1'], ['edge', 'Edge', '2']] as const).map(([m, l, k]) => (
              <button key={m} aria-pressed={store.mode.value === m} onClick={() => setMode(m)}><kbd>{k}</kbd>{l}</button>
            ))}
          </div>
        ) : null}
        <div id="vp-layer">
          <BusyOverlay busy={store.busy.value} onCancel={async () => { await controller.cancel(); redraw((n) => n + 1); }} />
          <Toast notices={store.notices.value} />
        </div>
      </div>
      {ws.rightPanel === 'docked' ? right : null}
      {ws.drawerOpen ? (
        <Drawer active={drawerTab} onTab={setDrawerTab} onClose={toggleDrawer}
          tabs={[
            { id: 'history', label: 'History', badge: entries.length, content: <HistoryLog entries={entries} here={records.length} filter={histFilter} onFilter={setHistFilter} onGoto={gotoStep} /> },
            { id: 'diagnostics', label: 'Diagnostics', badge: failures.length, bad: failures.length > 0, content: failures.length ? (
              <div>{failures.map((f) => <div key={f.id} class="issue"><b>{f.code ?? 'error'}</b> on {f.id}<div class="why">{f.hint}</div><button class="btn" onClick={() => { setSelectedId(f.id); setLeftTab('Features'); }}>Show in tree</button></div>)}</div>
            ) : <div class="empty">No feature errors.</div> },
            { id: 'console', label: 'Console', content: (
              <pre class="log">{store.notices.value.map((n) => `${n.level.padEnd(5)} ${n.text}`).join('\n') || 'No messages yet.'}</pre>
            ) },
          ]} />
      ) : null}
      <div class="status-wrap">
        <StatusBar notices={store.notices.value} hover={store.hover.value} busy={store.busy.value}
          items={[
            { label: 'Features', value: String(rows.length) },
            { label: 'Faces', value: String(facts.faces) },
            { label: 'Triangles', value: String(facts.triangles) },
            ...(facts.rebuildMs !== null ? [{ label: 'Last rebuild', value: `${(facts.rebuildMs / 1000).toFixed(1)} s` }] : []),
            { label: 'Errors', value: String(failures.length), tone: failures.length ? ('err' as const) : ('ok' as const) },
          ]}
          drawerOpen={ws.drawerOpen} onToggleDrawer={toggleDrawer} />
      </div>
      {palette ? <CommandPalette commands={commands} pinned={['view-iso', 'fit', 'undo', 'redo', 'samples', 'settings']} onClose={() => setPalette(false)} /> : null}
      {samples ? <SamplesDialog samples={samples} thumbBase={base} onClose={() => setSamples(null)}
        onPick={async (s) => { setSamples(null); const r = await fetch(s.url); await load(await r.text()); }} /> : null}
      {settings ? <SettingsDialog workspace={ws} onChange={(p: Partial<Workspace>) => store.setWorkspace(p)} onPreset={(n) => store.applyPreset(n)} onClose={() => setSettings(false)} /> : null}
    </div>
  );
}

render(<App />, document.getElementById('root')!);
