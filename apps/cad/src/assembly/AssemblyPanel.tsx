// The Assembly panel (left tab "Outliner"): parts, mates, interference, bill of materials and exploded view in one place. All kernel and
// viewer access comes in through `AsmHost`, so the panel is tested with a fake host.
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { EditOp } from '@ck/session';
import { InlineName } from '@kit/ui';
import { t } from '../i18n';
import {
  bomCsv, bomItems, bomTotal, componentOfName, componentRows, deleteComponentOps, insertFeature, insertIds, mateComponents, NO_PLACEMENT, placementOps,
  type ComponentRow, type DocLike, type ExplodeDir, type ExplodeState, type Placement, type V3,
} from './model';
import { KIND_GROUPS, MATE_KINDS, draftOf, draftProblem, mateChanges, mateFeature, mateKind, newDraft, type MateDraft } from './mateKinds';
import { massText } from '../inspect/mass';

export type Section = 'parts' | 'mates' | 'interference' | 'bom' | 'explode';
export const SECTIONS: Section[] = ['parts', 'mates', 'interference', 'bom', 'explode'];

export interface AsmInterference { data: { bodies: number; pairs: Array<{ a: string; b: string; volume?: number; error?: string }> } | null; stale: boolean; busy: boolean; run(): void }

export interface AsmHost {
  doc: (DocLike & { name?: string }) | null;
  /** remaining degrees of freedom by component id, from the last rebuild */
  dof: ReadonlyMap<string, number>;
  /** failed features by id (the kernel's code) */
  errors: ReadonlyMap<string, string>;
  hidden: readonly string[];
  explode: ExplodeState;
  selection: readonly string[];
  /** every face name on screen */
  faceNames(): string[];
  /** the faces of the body that holds this face (for the interference highlight) */
  bodyFaces(name: string): string[];
  select(names: string[]): void;
  frame(names: string[]): void;
  edit(ops: EditOp[]): Promise<boolean>;
  preview(ops: EditOp[]): Promise<{ ok: boolean; hint?: string }>;
  cancelPreview(): Promise<void>;
  samples(): Promise<Array<{ id: string; title: string; url: string }>>;
  readUrl(url: string): Promise<string>;
  openFile(): Promise<{ name: string; text: string } | null>;
  saveFile(name: string, data: string, mime: string): Promise<void>;
  partVolume(part: unknown): Promise<number | null>;
  notify(text: string, level?: 'info' | 'warn' | 'error'): void;
  toggleHidden(id: string): void;
  setExplode(patch: Partial<ExplodeState>): void;
  interference: AsmInterference;
}

export interface AsmProps { host: AsmHost; section: Section; onSection(s: Section): void }

const fmt = (x: number, d = 3): string => String(+x.toPrecision(d));
const kindLabel = (k: string): string => (mateKind(k) ? t('asm.mate.kind.' + k) : t('asm.mate.kind.unknown', { kind: k }));

export function AssemblyPanel(p: AsmProps): JSX.Element {
  const { host } = p;
  return (
    <div class="asm" aria-label={t('asm.title')}>
      <div class="asm-tabs" role="tablist">
        {SECTIONS.map((s) => <button key={s} role="tab" class="asm-tab" aria-selected={p.section === s} onClick={() => p.onSection(s)}>{t('asm.sec.' + s)}</button>)}
      </div>
      {!host.doc ? <div class="empty">{t('asm.noDoc')}</div>
        : p.section === 'parts' ? <PartsSection host={host} />
        : p.section === 'mates' ? <MatesSection host={host} />
        : p.section === 'interference' ? <InterferenceSection host={host} />
        : p.section === 'bom' ? <BomSection host={host} />
        : <ExplodeSection host={host} />}
    </div>
  );
}

// ---- helpers ---------------------------------------------------------------------------------------------------------

const facesOfComponent = (host: AsmHost, id: string): string[] => { const ins = insertIds(host.doc!); return host.faceNames().filter((n) => componentOfName(n, ins) === id); };
const nameOfFace = (host: AsmHost, face: string | undefined): string => {
  if (!face) return t('asm.mate.unpicked');
  const c = componentOfName(face, insertIds(host.doc!));
  return c ? (host.doc!.features.find((f) => f.id === c)?.name ?? c) : t('asm.mate.root');
};

function DofBadge(p: { row: ComponentRow }): JSX.Element {
  const r = p.row;
  if (r.suppressed) return <span class="asm-dof off">{t('asm.part.suppressed')}</span>;
  if (r.dof === null) return r.fixed ? <span class="asm-dof ok">{t('asm.dof.fixed')}</span> : <span class="asm-dof off">{t('asm.dof.unknown')}</span>;
  if (r.fixed) return <span class="asm-dof ok">{t('asm.dof.fixed')}</span>;
  return <span class={'asm-dof ' + (r.dof === 0 ? 'ok' : 'free')} title={r.dof === 0 ? t('asm.dof.tip.zero', { name: r.name }) : t('asm.dof.tip', { name: r.name, n: r.dof ?? 0 })}>{r.dof === 0 ? t('asm.dof.zero') : t('asm.dof', { n: r.dof ?? 0 })}</span>;
}

// ---- parts -----------------------------------------------------------------------------------------------------------

function PlacementFields(p: { value: Placement; onChange(v: Placement): void }): JSX.Element {
  const v = p.value;
  const num = (k: 'dx' | 'dy' | 'dz' | 'angle') => (
    <label class="asm-f"><span>{t('asm.place.' + k)}</span><input type="number" step="any" value={v[k]} aria-label={t('asm.place.' + k)} onInput={(e) => { const x = parseFloat((e.target as HTMLInputElement).value); p.onChange({ ...v, [k]: Number.isFinite(x) ? x : 0 }); }} /></label>
  );
  return (
    <div class="asm-place">
      {num('dx')}{num('dy')}{num('dz')}
      <label class="asm-f"><span>{t('asm.place.axis')}</span>
        <select value={v.axis ?? ''} aria-label={t('asm.place.axis')} onChange={(e) => { const a = (e.target as HTMLSelectElement).value; p.onChange({ ...v, axis: a === 'x' || a === 'y' || a === 'z' ? a : null }); }}>
          <option value="">{t('asm.place.none')}</option><option value="x">X</option><option value="y">Y</option><option value="z">Z</option>
        </select></label>
      {v.axis ? num('angle') : null}
    </div>
  );
}

function PartsSection({ host }: { host: AsmHost }): JSX.Element {
  const [samples, setSamples] = useState<Array<{ id: string; title: string; url: string }> | null>(null);
  const [chosen, setChosen] = useState<{ title: string; part: Record<string, unknown>; source: string } | null>(null);
  const [place, setPlace] = useState<Placement>(NO_PLACEMENT);
  const [fixed, setFixed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [editPlace, setEditPlace] = useState<Placement | null>(null);
  useEffect(() => { let live = true; void host.samples().then((s) => { if (live) setSamples(s); }).catch(() => { if (live) setSamples([]); }); return () => { live = false; }; }, []);
  const rows = componentRows(host.doc, host.dof);

  const accept = (name: string, text: string, source: string): boolean => {
    try {
      const d = JSON.parse(text) as Record<string, unknown>;
      if (d.format !== 'ck-part' || !Array.isArray(d.features)) { host.notify(t('asm.insert.notPart'), 'error'); return false; }
      setChosen({ title: name, part: d, source }); return true;
    } catch (e) { host.notify(t('asm.insert.failed', { message: (e as Error).message }), 'error'); return false; }
  };
  const pickSample = async (url: string) => {
    if (!url) { setChosen(null); return; }
    const s = samples?.find((x) => x.url === url);
    setBusy(true);
    try { accept(s?.title ?? url, await host.readUrl(url), s?.id ?? url); } catch (e) { host.notify(t('asm.insert.failed', { message: (e as Error).message }), 'error'); } finally { setBusy(false); }
  };
  const openFile = async () => { const f = await host.openFile(); if (f) accept(f.name, f.text, f.name); };
  const insert = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const f = insertFeature(chosen.part, place, { source: chosen.source, fixed });
      if (await host.edit([{ op: 'add', feature: f }])) host.notify(t('asm.insert.inserted', { name: String(f.name) }));
    } finally { setBusy(false); }
  };
  const del = async (r: ComponentRow) => {
    const ops = deleteComponentOps(host.doc!, r.id);
    if (await host.edit(ops)) host.notify(ops.length > 1 ? t('asm.part.deleted', { name: r.name, n: ops.length - 1 }) : t('asm.part.deletedOnly', { name: r.name }));
  };
  const selectRow = (r: ComponentRow) => { setSel(r.id); setEditPlace({ dx: r.dx, dy: r.dy, dz: r.dz, axis: r.axis, angle: r.angle || 90 }); host.select(facesOfComponent(host, r.id)); };

  return (
    <div class="asm-sec">
      <section class="asm-card" aria-label={t('asm.insert.title')}>
        <h4>{t('asm.insert.title')}</h4>
        <label class="asm-f wide"><span>{t('asm.insert.sample')}</span>
          <select aria-label={t('asm.insert.sample')} value={chosen ? samples?.find((s) => s.id === chosen.source)?.url ?? '' : ''} onChange={(e) => void pickSample((e.target as HTMLSelectElement).value)}>
            <option value="">{t('asm.insert.choose')}</option>
            {(samples ?? []).map((s) => <option key={s.id} value={s.url}>{s.title}</option>)}
          </select></label>
        <div class="asm-bar"><button class="btn" onClick={() => void openFile()}>{t('asm.insert.file')}</button></div>
        {chosen ? <div class="asm-chosen">{String(chosen.part.name ?? chosen.title)}</div> : null}
        <PlacementFields value={place} onChange={setPlace} />
        <label class="asm-chk"><input type="checkbox" checked={fixed} onChange={(e) => setFixed((e.target as HTMLInputElement).checked)} /> {t('asm.insert.fixed')}</label>
        <div class="asm-bar"><button class="btn primary" disabled={!chosen || busy} onClick={() => void insert()}>{busy ? t('asm.insert.loading') : t('asm.insert.go')}</button></div>
      </section>
      <div class="grp">{t('asm.parts.list')}</div>
      {rows.length === 0 ? <div class="empty">{t('asm.parts.empty')}</div> : null}
      {rows.map((r) => {
        const hidden = host.hidden.includes(r.id);
        return (
          <div key={r.id}>
            <div class={'asm-row' + (sel === r.id ? ' sel' : '') + (r.suppressed ? ' suppressed' : '') + (hidden ? ' hid' : '')} onClick={() => selectRow(r)} title={t('asm.part.select', { name: r.name })}>
              <span class="row-id">{r.id}</span>
              {renaming === r.id
                ? <InlineName value={r.name} onCommit={(n) => { setRenaming(null); void host.edit([{ op: 'set', id: r.id, path: 'name', value: n }]); }} onCancel={() => setRenaming(null)} />
                : <span class="row-name" onDblClick={() => setRenaming(r.id)}>{r.name}<small class="asm-part">{r.partName}</small><DofBadge row={r} /></span>}
              <span class="asm-acts" onClick={(e) => e.stopPropagation()}>
                <button class="row-act on" aria-pressed={!hidden} title={hidden ? t('asm.part.show') : t('asm.part.hide')} aria-label={hidden ? t('asm.part.show') : t('asm.part.hide')} onClick={() => host.toggleHidden(r.id)}>{hidden ? '○' : '●'}</button>
                <button class="row-act on" aria-pressed={r.suppressed} title={r.suppressed ? t('asm.part.unsuppress') : t('asm.part.suppress')} aria-label={r.suppressed ? t('asm.part.unsuppress') : t('asm.part.suppress')} onClick={() => void host.edit([{ op: 'set', id: r.id, path: 'suppressed', value: !r.suppressed }])}>S</button>
                <button class="row-act on" aria-pressed={r.fixed} title={r.fixed ? t('asm.part.float') : t('asm.part.fix')} aria-label={r.fixed ? t('asm.part.float') : t('asm.part.fix')} onClick={() => void host.edit([{ op: 'set', id: r.id, path: 'fixed', value: !r.fixed }])}>{r.fixed ? '⚓' : '↔'}</button>
                <button class="row-act on" title={t('asm.part.rename')} aria-label={t('asm.part.rename')} onClick={() => setRenaming(r.id)}>✎</button>
                <button class="row-act on del" title={t('asm.part.delete')} aria-label={t('asm.part.delete')} onClick={() => void del(r)}>×</button>
              </span>
            </div>
            {sel === r.id && editPlace ? (
              <div class="asm-card inner" aria-label={t('asm.part.edit', { name: r.name })}>
                <PlacementFields value={editPlace} onChange={setEditPlace} />
                <div class="asm-bar"><button class="btn" onClick={() => { const ops = placementOps(r.id, r, editPlace); if (ops.length) void host.edit(ops); }}>{t('asm.place.apply')}</button></div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ---- mates -----------------------------------------------------------------------------------------------------------

function MatesSection({ host }: { host: AsmHost }): JSX.Element {
  const doc = host.doc!;
  const mates = doc.features.filter((f) => f.type === 'mate');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<MateDraft>(() => newDraft());
  const [picking, setPicking] = useState<'a' | 'b' | 'c' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [previewed, setPreviewed] = useState(false);
  const faces = useMemo(() => new Set(host.faceNames()), [host.faceNames().length]);
  const selKey = host.selection.join('\u0001');
  const rows = componentRows(doc, host.dof);

  // a face picked in the model fills the slot being picked
  useEffect(() => {
    if (!picking) return;
    const k = mateKind(draft.kind);
    const slot = k?.refs.find((r) => r.key === picking);
    const name = [...host.selection].reverse().find((n) => faces.has(n) && slot?.accept.includes('face'));
    if (name) { setDraft((d) => ({ ...d, refs: { ...d.refs, [picking]: name } })); setPicking(null); setMsg(null); }
  }, [selKey, picking]);

  const open = (id: string | 'new', d: MateDraft) => { setEditing(id); setDraft(d); setPicking(null); setMsg(null); setPreviewed(false); host.select([]); };
  const close = () => { if (previewed) void host.cancelPreview(); setEditing(null); setPicking(null); setMsg(null); setPreviewed(false); };
  const problem = draftProblem(draft);
  const old = editing && editing !== 'new' ? (doc.features.find((f) => f.id === editing) as Record<string, unknown> | undefined) : undefined;
  const opsOf = (): EditOp[] => {
    if (!old) return [{ op: 'add', feature: mateFeature(draft) }];
    if (String(old.kind) !== draft.kind) return [{ op: 'replace', id: editing!, feature: { ...mateFeature(draft), id: editing! } }];
    return mateChanges(old, draft).map((c) => ({ op: 'set' as const, id: editing!, path: c.path, value: c.value }));
  };
  const apply = async () => {
    if (problem) { setMsg(t(problem)); return; }
    const ops = opsOf();
    if (previewed) { await host.cancelPreview(); setPreviewed(false); }
    if (!ops.length) { close(); return; }
    if (await host.edit(ops)) { host.notify(old ? t('asm.mate.update') : t('asm.mate.ok')); setEditing(null); setMsg(null); }
  };
  const preview = async () => {
    if (problem) { setMsg(t(problem)); return; }
    const r = await host.preview(opsOf());
    setPreviewed(r.ok);
    setMsg(r.ok ? t('asm.mate.previewOk') : (r.hint ?? t('asm.mate.failed', { code: '?' })));
  };
  const setKind = (id: string) => setDraft((d) => ({ ...newDraft(id), refs: d.refs, name: d.name, flip: d.flip }));
  const kdef = mateKind(draft.kind);
  const movers = rows.filter((r) => !r.fixed && !r.suppressed && r.dof !== null);

  return (
    <div class="asm-sec">
      {movers.length ? <div class="asm-tip" role="status">{movers.map((r) => (r.dof === 0 ? t('asm.dof.tip.zero', { name: r.name }) : t('asm.dof.tip', { name: r.name, n: r.dof ?? 0 }))).join(' · ')}</div> : null}
      <div class="asm-bar"><button class="btn primary" disabled={editing !== null} onClick={() => open('new', newDraft())}>{t('asm.mate.new')}</button></div>
      {editing ? (
        <section class="asm-card" aria-label={t('asm.mate.title')}>
          <label class="asm-f wide"><span>{t('asm.mate.kind')}</span>
            <select value={draft.kind} aria-label={t('asm.mate.kind')} onChange={(e) => setKind((e.target as HTMLSelectElement).value)}>
              {KIND_GROUPS.map((g) => (
                <optgroup key={g} label={t('asm.mate.group.' + g)}>
                  {MATE_KINDS.filter((k) => k.group === g).map((k) => <option key={k.id} value={k.id} disabled={k.pending && k.id !== draft.kind}>{kindLabel(k.id)}{k.pending ? ` (${t('asm.mate.pendingTag')})` : ''}</option>)}
                </optgroup>
              ))}
              {!kdef ? <option value={draft.kind}>{kindLabel(draft.kind)}</option> : null}
            </select></label>
          {(kdef?.refs ?? []).map((r) => (
            <div class="asm-ref" key={r.key}>
              <span class="asm-ref-l">{t('asm.mate.ref.' + r.key)} ({t('asm.mate.ref.' + r.label)})</span>
              <button class={'btn' + (picking === r.key ? ' on' : '')} aria-pressed={picking === r.key} onClick={() => { setPicking(picking === r.key ? null : r.key); host.select([]); }}>{picking === r.key ? t('asm.mate.picking') : t('asm.mate.pick')}</button>
              <span class="asm-ref-v" title={draft.refs[r.key]}>{draft.refs[r.key] ? `${nameOfFace(host, draft.refs[r.key])}: ${draft.refs[r.key]}` : t('asm.mate.unpicked')}</span>
            </div>
          ))}
          {(kdef?.params ?? []).map((q) => (
            <label class="asm-f wide" key={q.key}><span>{t('asm.mate.param.' + q.key)}{q.type === 'angle' ? ' (°)' : q.type === 'length' ? ' (mm)' : ''}</span>
              <input type="number" step="any" value={draft.params[q.key] ?? q.default} onInput={(e) => { const x = parseFloat((e.target as HTMLInputElement).value); setDraft((d) => ({ ...d, params: { ...d.params, [q.key]: x } })); }} /></label>
          ))}
          {kdef?.flip ? <label class="asm-chk"><input type="checkbox" checked={draft.flip} onChange={(e) => setDraft((d) => ({ ...d, flip: (e.target as HTMLInputElement).checked }))} /> {t('asm.mate.flip')}</label> : null}
          <label class="asm-f wide"><span>{t('asm.mate.name')}</span><input type="text" value={draft.name} onInput={(e) => setDraft((d) => ({ ...d, name: (e.target as HTMLInputElement).value }))} /></label>
          <div class="asm-note">{t('asm.mate.hint')}</div>
          {problem && !msg ? <div class="asm-note">{t(problem)}</div> : null}
          {msg ? <div class="asm-note warn" role="status">{msg}</div> : null}
          <div class="asm-bar">
            <button class="btn primary" disabled={!!problem} onClick={() => void apply()}>{old ? t('asm.mate.update') : t('asm.mate.apply')}</button>
            <button class="btn" disabled={!!problem} onClick={() => void preview()}>{t('asm.mate.preview')}</button>
            <button class="btn" onClick={close}>{t('asm.mate.cancel')}</button>
          </div>
        </section>
      ) : null}
      {mates.length === 0 && !editing ? <div class="empty">{t('asm.mate.empty')}</div> : null}
      {mates.map((m) => {
        const kind = String(m.kind ?? 'coincident');
        const comps = mateComponents(doc, m).map((c) => doc.features.find((f) => f.id === c)?.name ?? c);
        const err = host.errors.get(m.id);
        return (
          <div key={m.id} class={'asm-row' + (err ? ' err' : '') + (m.suppressed ? ' suppressed' : '')}>
            <span class="row-id">{m.id}</span>
            <span class="row-name">{m.name ?? kindLabel(kind)}<small class="asm-part">{kindLabel(kind)}{comps.length >= 2 ? ` · ${t('asm.mate.between', { a: comps[0], b: comps[1] })}` : ''}{err ? ` · ${t('asm.mate.failed', { code: err })}` : ''}</small></span>
            <span class="asm-acts">
              <button class="row-act on" title={t('asm.mate.edit')} aria-label={t('asm.mate.edit')} disabled={editing !== null} onClick={() => open(m.id, draftOf(m as Record<string, unknown>))}>✎</button>
              <button class="row-act on del" title={t('asm.mate.delete')} aria-label={t('asm.mate.delete')} onClick={() => { if (editing === m.id) close(); void host.edit([{ op: 'remove', id: m.id }]); }}>×</button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---- interference -----------------------------------------------------------------------------------------------------

function InterferenceSection({ host }: { host: AsmHost }): JSX.Element {
  const i = host.interference, r = i.data;
  const show = (a: string, b: string) => { const names = [...new Set([...host.bodyFaces(a), ...host.bodyFaces(b)])]; host.select(names); host.frame(names); };
  return (
    <div class="asm-sec">
      <section class="asm-card" aria-label={t('asm.int.title')}>
        <h4>{t('asm.int.title')}</h4>
        <div class="asm-bar"><button class="btn primary" disabled={i.busy} onClick={i.run}>{i.busy ? t('asm.int.running') : t('asm.int.run')}</button></div>
        {i.stale && r ? <div class="asm-note warn">{t('asm.int.stale')}</div> : null}
        {!r ? <div class="asm-note">{t('asm.int.none')}</div> : null}
        {r && r.bodies < 2 ? <div class="asm-note">{t('asm.int.single')}</div> : null}
        {r && r.bodies >= 2 && r.pairs.length === 0 ? <div class="asm-ok">{t('asm.int.clean', { n: r.bodies })}</div> : null}
        {r && r.pairs.length ? <div class="asm-note">{t('asm.int.count', { n: r.pairs.length })}</div> : null}
        {r?.pairs.map((q, k) => (
          <button key={k} class="asm-pair" onClick={() => show(q.a, q.b)}>
            <span>{t('asm.int.pair', { a: nameOfFace(host, q.a), b: nameOfFace(host, q.b) })}</span>
            <span class="val">{q.error ? t('asm.int.failed', { code: q.error }) : t('asm.int.volume', { v: fmt(Math.abs(q.volume ?? 0), 4) })}</span>
          </button>
        ))}
      </section>
    </div>
  );
}

// ---- bill of materials ------------------------------------------------------------------------------------------------

function BomSection({ host }: { host: AsmHost }): JSX.Element {
  const doc = host.doc!;
  const [vols, setVols] = useState<Map<string, number | null>>(new Map());
  const [busy, setBusy] = useState(false);
  const parts = useMemo(() => {
    const m = new Map<string, unknown>();
    for (const f of doc.features) if (f.type === 'insertPart' && f.part && f.suppressed !== true) m.set(JSON.stringify(f.part), f.part);
    return m;
  }, [doc]);
  useEffect(() => {
    let live = true;
    const todo = [...parts].filter(([k]) => !vols.has(k));
    if (!todo.length) return;
    setBusy(true);
    void (async () => {
      const next = new Map(vols);
      for (const [k, part] of todo) { next.set(k, await host.partVolume(part).catch(() => null)); if (!live) return; }
      setVols(next); setBusy(false);
    })();
    return () => { live = false; };
  }, [parts]);
  const items = bomItems(doc, (part) => vols.get(JSON.stringify(part)) ?? null);
  const total = bomTotal(items);
  const save = async () => {
    const csv = bomCsv(items, [t('asm.bom.no'), t('asm.bom.part'), t('asm.bom.qty'), t('asm.bom.material'), `${t('asm.bom.massEach')} (g)`, `${t('asm.bom.massTotal')} (g)`], t('asm.bom.total'));
    await host.saveFile(t('asm.bom.file'), csv, 'text/csv');
    host.notify(t('asm.bom.saved', { name: t('asm.bom.file') }));
  };
  const selectItem = (comps: string[]) => { const ins = insertIds(doc); host.select(host.faceNames().filter((n) => { const c = componentOfName(n, ins); return !!c && comps.includes(c); })); };
  return (
    <div class="asm-sec">
      <section class="asm-card" aria-label={t('asm.bom.title')}>
        <h4>{t('asm.bom.title')}</h4>
        {items.length === 0 ? <div class="empty">{t('asm.bom.empty')}</div> : (
          <table class="asm-bom">
            <thead><tr><th>{t('asm.bom.no')}</th><th>{t('asm.bom.part')}</th><th>{t('asm.bom.qty')}</th><th>{t('asm.bom.massEach')}</th><th>{t('asm.bom.massTotal')}</th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.no} class="asm-bom-row" tabIndex={0} onClick={() => selectItem(it.components)} onKeyDown={(e) => { if (e.key === 'Enter') selectItem(it.components); }}>
                  <td>{it.no}</td><td>{it.part}</td><td>{it.qty}</td><td>{it.massEach === null ? '–' : massText(it.massEach)}</td><td>{it.massTotal === null ? '–' : massText(it.massTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td></td><td>{t('asm.bom.total')}</td><td>{items.reduce((s, i) => s + i.qty, 0)}</td><td></td><td>{total === null ? '–' : massText(total)}</td></tr></tfoot>
          </table>
        )}
        {busy ? <div class="asm-note">{t('asm.bom.measuring')}</div> : null}
        {items.some((i) => i.massEach === null) && !busy && items.length ? <div class="asm-note">{t('asm.bom.noMass')}</div> : null}
        <div class="asm-bar"><button class="btn" disabled={!items.length} onClick={() => void save()}>{t('asm.bom.csv')}</button></div>
      </section>
    </div>
  );
}

// ---- exploded view -----------------------------------------------------------------------------------------------------

function ExplodeSection({ host }: { host: AsmHost }): JSX.Element {
  const e = host.explode;
  const rows = componentRows(host.doc, host.dof).filter((r) => !r.suppressed);
  const [comp, setComp] = useState<string>(rows[0]?.id ?? '');
  const [axis, setAxis] = useState<0 | 1 | 2>(2);
  const cur = e.manual[comp] ?? [0, 0, 0];
  const setOffset = (v: number) => { const m: V3 = [...cur] as V3; m[axis] = Number.isFinite(v) ? v : 0; host.setExplode({ manual: { ...e.manual, [comp]: m } }); };
  return (
    <div class="asm-sec">
      <section class="asm-card" aria-label={t('asm.exp.title')}>
        <h4>{t('asm.exp.title')}</h4>
        <label class="asm-f wide"><span>{t('asm.exp.spread')} ({fmt(e.spread, 3)})</span>
          <input type="range" min="0" max="3" step="0.02" value={e.spread} aria-label={t('asm.exp.spread')} onInput={(ev) => host.setExplode({ spread: parseFloat((ev.target as HTMLInputElement).value) })} /></label>
        <label class="asm-f wide"><span>{t('asm.exp.dir')}</span>
          <select value={e.dir} aria-label={t('asm.exp.dir')} onChange={(ev) => host.setExplode({ dir: (ev.target as HTMLSelectElement).value as ExplodeDir })}>
            {(['auto', 'x', 'y', 'z'] as const).map((d) => <option key={d} value={d}>{t('asm.exp.' + d)}</option>)}
          </select></label>
        <div class="asm-bar"><button class="btn" onClick={() => host.setExplode({ spread: 0, dir: 'auto', manual: {} })}>{t('asm.exp.reset')}</button></div>
        <h4>{t('asm.exp.drag')}</h4>
        {rows.length ? (
          <>
            <label class="asm-f wide"><span>{t('asm.exp.comp')}</span>
              <select value={comp} aria-label={t('asm.exp.comp')} onChange={(ev) => setComp((ev.target as HTMLSelectElement).value)}>{rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            <label class="asm-f wide"><span>{t('asm.exp.axis')}</span>
              <select value={axis} aria-label={t('asm.exp.axis')} onChange={(ev) => setAxis(parseInt((ev.target as HTMLSelectElement).value, 10) as 0 | 1 | 2)}>
                <option value="0">X</option><option value="1">Y</option><option value="2">Z</option></select></label>
            <label class="asm-f wide"><span>{t('asm.exp.offset')} ({fmt(cur[axis], 4)})</span>
              <input type="range" min="-150" max="150" step="1" value={cur[axis]} aria-label={t('asm.exp.offset')} onInput={(ev) => setOffset(parseFloat((ev.target as HTMLInputElement).value))} /></label>
          </>
        ) : null}
        <div class="asm-note">{t('asm.exp.note')}</div>
      </section>
    </div>
  );
}
