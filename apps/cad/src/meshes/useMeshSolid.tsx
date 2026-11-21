// The owner of Convert mesh to solid in the app: which mesh the panel is open on, the kernel run (preview tag, Cancel by ignoring the
// late answer), and what the viewport shows meanwhile: the converted solid as a tinted body beside the part, the source mesh faded,
// and crosses at the places a report or a refusal names. main.tsx reads the two module-level hooks below (`meshSolidMeshes` for the
// reference meshes, `meshSolidBody` for the body) and renders `panel`. Nothing here writes the document: the preview is phase 1, the
// Accept of phase 2 is `acceptMeshSolid` (meshSolidAccept.ts).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { HandleSpec, ViewSurface } from '@kit/viewport';
import { t } from '../i18n';
import { meshesOf, type MeshRec, type V3 } from './meshDoc';
import { buildMeshRecord, guessUnit, meshKindOf, probeMesh } from './meshImport';
import {
  MESH_SOLID_TAG, crossLines, marksOf, releasePreview, runMeshToSolid, withPreview, previewSurface, worldMesh,
  type LengthUnit, type MeshSolidKernel, type MeshSolidReport, type MeshSolidMark, type MeshSolidOptions, type MeshSolidOutcome,
} from './meshSolid';
import { MeshSolidPanel, type MeshSolidShow, type MeshSolidSource } from './MeshSolidPanel';
import { acceptMeshSolid } from './meshSolidAccept';
import type { PartDoc } from '@ck/part-model';
import type { DocPatch } from '../docFields';

/** The id of a mesh read from a file for the panel (never one of the document's: those are `mesh<n>`). */
export const FILE_SOURCE_ID = 'm2s-file';

// ---- what the viewport draws while the panel is open (module state: main.tsx's body and mesh lists are module functions too) ----
const view: { surface: ViewSurface | null; sourceId: string | null; show: MeshSolidShow; file: MeshRec | null } = { surface: null, sourceId: null, show: 'both', file: null };

/** The reference meshes as drawn while the panel is open: the file being converted added, the source faded with its triangle edges
 *  while the solid is shown over it, or left out when only the solid is shown. Unchanged when the panel is closed. */
export function meshSolidMeshes(list: MeshRec[]): MeshRec[] {
  if (!view.sourceId) return list;
  const all = view.file ? [...list, view.file] : list;
  return all.flatMap((m) => {
    if (m.id !== view.sourceId) return [m];
    if (view.show === 'solid' && view.surface) return [];
    if (view.show === 'both' && view.surface) return [{ ...m, visible: true, opacity: Math.min(m.opacity, 0.35), wire: true }];
    return [{ ...m, visible: true }];
  });
}
/** The body as drawn while a converted solid is previewed: the solid attached as a tinted body (unless only the mesh is shown). */
export function meshSolidBody<B extends { mesh: { triFace: ArrayLike<number> }; box: { min: number[]; max: number[] }; surfaces?: ViewSurface[] }>(body: B | null): B | null {
  return view.sourceId && view.surface && view.show !== 'mesh' ? withPreview(body, view.surface) : body;
}

const MARK_COLOUR: Record<MeshSolidMark['kind'], string> = { gap: '#e5484d', failed: '#f76b15', hole: '#30a46c' };
const FOCUS_COLOUR = '#ffd23f';

/** What the hook needs from the app. */
export interface MeshSolidDeps {
  /** the open document (its reference meshes are the sources) */
  doc(): unknown;
  /** the kernel transport (null without a session); the run uses its own tag, never the document's */
  kernel(): Promise<MeshSolidKernel | null>;
  /** pick a mesh file (STL, OBJ, GLB, 3MF) when the part has no reference mesh */
  pickFile(): Promise<{ name: string; bytes: Uint8Array } | null>;
  notify(text: string, level?: 'info' | 'warn' | 'error'): void;
  /** redraw the body and the reference meshes (they read meshSolidBody / meshSolidMeshes) */
  refresh(): void;
  /** the wire crosses at the places (null clears them) */
  setHandles(specs: HandleSpec[] | null): void;
  worldPerPixel(p: number[]): number;
  /** move the camera so that `p` is in the middle of the view, keeping the direction and zoom */
  centreOn(p: V3): void;
  /** close the other editors and wizards and show the editor card / tab */
  showEditor(): void;
  unit(): LengthUnit;
  /** hide a reference mesh of the part (view only): after Accept the solid lies on the mesh, and the two would fight for the same pixels */
  hideMesh(id: string): void;
  /** apply a document edit as one history step (the kernel rebuilds the part first; `ok: false` leaves the part as it was) */
  apply(patch: DocPatch, reason: string): Promise<{ ok: true } | { ok: false; errors: Array<{ feature: string; code: string }> }>;
}

export interface MeshSolidUi {
  /** the panel is open */
  open: boolean;
  /** open on a reference mesh of the part (`id`), else on the first one, else ask for a file */
  start(id?: string | null): Promise<void>;
  close(): void;
  panel: JSX.Element | null;
}

export function useMeshSolid(d: MeshSolidDeps): MeshSolidUi {
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [file, setFile] = useState<MeshRec | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<MeshSolidOutcome | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [show, setShow] = useState<MeshSolidShow>('both');
  const [focus, setFocus] = useState<number | null>(null);
  /** the run whose answer is wanted: a Cancel (or a new run, or closing) moves it on, so the late answer of the old one is dropped */
  const runId = useRef(0);
  /** what the last successful run converted and with which options: Accept keeps exactly that */
  const lastRun = useRef<{ mesh: ReturnType<typeof worldMesh>; options: MeshSolidOptions; name: string; sourceName?: string; report: MeshSolidReport } | null>(null);
  const deps = useRef(d);
  deps.current = d;

  const sources = (): MeshSolidSource[] => [
    ...meshesOf(d.doc()).map((m) => ({ id: m.id, name: m.name, tris: m.tris })),
    ...(file ? [{ id: file.id, name: file.name, tris: file.tris, fileUnit: file.unit }] : []),
  ];
  const recOf = (id: string | null): MeshRec | null => (id === FILE_SOURCE_ID ? file : meshesOf(deps.current.doc()).find((m) => m.id === id) ?? null);

  // the viewport follows the state: the solid, the source's look and the crosses (nothing is touched before the panel first opens:
  // the handles belong to whichever editor is open then)
  const used = useRef(false);
  if (sourceId) used.current = true;
  useEffect(() => {
    if (!used.current) return;
    view.sourceId = sourceId; view.show = show; view.file = file;
    view.surface = outcome?.ok ? previewSurface(outcome.body) : null;
    deps.current.refresh();
  }, [sourceId, show, file, outcome]);
  useEffect(() => {
    if (!used.current) return;
    if (!sourceId) { deps.current.setHandles(null); return; }
    const marks = marksOf(outcome);
    if (!marks.length) { deps.current.setHandles(null); return; }
    const groups = new Map<string, V3[]>();
    marks.forEach((m, i) => {
      const on = i === focus;
      const k = (on ? 14 : 7) * deps.current.worldPerPixel(m.at);
      const col = on ? FOCUS_COLOUR : MARK_COLOUR[m.kind];
      groups.set(col, [...(groups.get(col) ?? []), ...crossLines(m.at, k)]);
    });
    const origin = marks[focus ?? 0]?.at ?? marks[0].at;
    deps.current.setHandles([...groups].map(([color, lines], i) => ({ id: `m2s:marks:${i}`, kind: 'wire', origin, axis: [0, 0, 1], color, lines, label: t('m2s.places', { n: marks.length }) } as HandleSpec)));
    if (focus !== null && marks[focus]) deps.current.centreOn(marks[focus].at);
  }, [sourceId, outcome, focus]);

  const drop = (): void => { runId.current++; setBusy(false); };
  const release = (): void => { void deps.current.kernel().then((k) => (k ? releasePreview(k, MESH_SOLID_TAG) : undefined)); };

  const close = (): void => {
    const had = sourceId !== null;
    drop();
    setSourceId(null); setFile(null); setOutcome(null); setCancelled(false); setFocus(null); setShow('both');
    view.sourceId = null; view.surface = null; view.file = null;
    deps.current.setHandles(null);
    if (had) { deps.current.refresh(); release(); }
  };

  const start = async (id?: string | null): Promise<void> => {
    const list = meshesOf(deps.current.doc());
    let pick = (id && list.find((m) => m.id === id)) || list[0] || null;
    let fileRec: MeshRec | null = null;
    if (!pick) {
      const f = await deps.current.pickFile();
      if (!f) return;
      const kind = meshKindOf(f.name);
      if (!kind) { deps.current.notify(t('m2s.readFailed', { name: f.name, reason: t('m2s.noMesh') }), 'warn'); return; }
      try {
        const probe = await probeMesh(kind, f.bytes);
        if (!probe.ok) { deps.current.notify(t('m2s.readFailed', { name: f.name, reason: t('mesh.err.' + probe.code) }), 'error'); return; }
        // the file's own unit where it states one (GLB, 3MF), else the unit that gives the model a likely size (said in the panel)
        const unit = probe.probe.unitFixed ?? guessUnit(probe.probe.size);
        fileRec = { ...(await buildMeshRecord(kind, f.bytes, f.name, unit, [], null)).rec, id: FILE_SOURCE_ID };
      } catch (e) { deps.current.notify(t('m2s.readFailed', { name: f.name, reason: (e as Error).message }), 'error'); return; }
      pick = fileRec;
    }
    drop();
    deps.current.showEditor();
    setFile(fileRec); setOutcome(null); setCancelled(false); setFocus(null); setShow('both');
    setSourceId(pick.id);
  };

  const run = async (o: MeshSolidOptions): Promise<void> => {
    const rec = recOf(sourceId);
    if (!rec) return;
    const k = await deps.current.kernel();
    if (!k) { setOutcome({ ok: false, failed: t('m2s.noMesh') }); return; }
    const mine = ++runId.current;
    setBusy(true); setCancelled(false); setFocus(null); setOutcome(null);
    // let the busy state paint before the mesh is packed and sent
    await new Promise<void>((r) => setTimeout(r, 30));
    if (mine !== runId.current) return;
    const res = await runMeshToSolid(k, worldMesh(rec), o, { tag: MESH_SOLID_TAG, name: rec.name });
    // A Cancel cannot stop the kernel: the worker runs the request to the end. Its answer arrives here and is ignored.
    if (mine !== runId.current) return;
    setBusy(false);
    setOutcome(res);
    lastRun.current = res.ok ? { mesh: worldMesh(rec), options: o, name: rec.name, ...(rec.id === FILE_SOURCE_ID ? { sourceName: rec.name } : {}), report: res.report } : null;
  };

  const accept = async (): Promise<void> => {
    const lr = lastRun.current;
    if (!lr || !outcome?.ok) return;
    setBusy(true);
    try {
      const r = await acceptMeshSolid({ doc: deps.current.doc() as PartDoc, mesh: lr.mesh, options: lr.options, name: lr.name, ...(lr.sourceName ? { sourceName: lr.sourceName } : {}), report: lr.report }, (patch, reason) => deps.current.apply(patch, reason));
      if (!r.ok) { deps.current.notify(t('m2s.accept.failed', { message: r.message }), 'error'); return; }
      deps.current.notify(t('m2s.accept.done', { name: lr.name }), 'info');
      const src = sourceId;
      close();
      if (src && src !== FILE_SOURCE_ID) deps.current.hideMesh(src);
    } finally { setBusy(false); }
  };

  const panel = sourceId ? (
    <MeshSolidPanel key="m2s" sources={sources()} sourceId={sourceId}
      onSource={(id) => { drop(); setOutcome(null); setFocus(null); setCancelled(false); setSourceId(id); }}
      busy={busy} outcome={outcome} cancelled={cancelled} show={show} onShow={setShow} focus={focus} onFocus={setFocus} unit={d.unit()}
      onRun={(o) => void run(o)}
      onCancelRun={() => { drop(); setCancelled(true); }}
      onClose={close}
      onAccept={() => void accept()} />
  ) : null;

  return { open: sourceId !== null, start, close, panel };
}
