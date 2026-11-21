import { useEffect, useRef, useState } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import type { Store } from '@kit/store';
import { boxRange, facePlane, type FaceMesh, type V3 } from './geometry';
import { copyText, measure, resolvePick, type EdgeInfo, type KernelMeasure, type Outcome, type Pick } from './measure';
import { densityOf, massView, type MassRaw, type MassView } from './mass';
import type { Interference, IntersectionCheck } from './kernel';
import type { Box, InspectProps, SectionState } from './InspectPanel';
import { STD_SECTION_NORMAL, type SectionSpec } from '@kit/viewport';
import { t } from '../i18n';
import { meshesOf } from '../meshes/meshDoc';

/** What the Inspect tools need from the controller (a fake in tests). */
export interface InspectHost {
  revision: number;
  document(): { material?: string } | null;
  bodyBox(): Box | null;
  /** whether the part has a solid on screen (default: it has when there is a box); a part of surface bodies only has none */
  hasSolid?(): boolean;
  /** surface bodies on screen */
  surfaceBodies?(): Array<{ id: string }>;
  bodyEdges(): EdgeInfo[];
  bodyFaces(): FaceMesh | null;
  massProps(): Promise<MassRaw | null>;
  measure(refs: Array<Record<string, unknown>>): Promise<KernelMeasure | null>;
  interference(): Promise<Interference | null>;
  /** The intersection check of the given faces against the part (all faces of the part when none are given); throws the kernel's message when it refuses. */
  intersection(faces: string[]): Promise<IntersectionCheck | null>;
}
export interface InspectView {
  setSection(s: SectionSpec | null): void;
  setMeasure(m: Array<{ a: number[]; b: number[]; text: string }> | null): void;
  frameNames(n: string[]): void;
}

const boxed = (b: Box | null): boolean => !!b;
export const defaultSection = (): SectionState => ({ on: false, plane: 'front', faceId: null, offset: 0, flip: false });

/** The spec the viewport draws for a section state, or null when it is off or has no plane. */
export function sectionSpec(s: SectionState, normal: V3 | null): SectionSpec | null {
  if (!s.on || !normal) return null;
  return { normal: normal as [number, number, number], offset: s.offset, flip: s.flip };
}

/** All the state of the Inspect tab: mass properties, measure, interference and section. It lives at the app level so the
 *  section and the measurement stay when the drawer shows another tab. */
export function useInspect(host: InspectHost, store: Store, getView: () => InspectView | null, openPanel: () => void, measureActive: MutableRef<boolean>, editing = false) {
  const rev = host.revision;
  const material = host.document()?.material ?? '';
  const known = densityOf(material);

  // ---- mass properties
  const [raw, setRaw] = useState<{ data: MassRaw; revision: number } | null>(null);
  const [mbusy, setMbusy] = useState(false);
  const [density, setDensity] = useState<number>(known ?? 1);
  useEffect(() => { setDensity(known ?? 1); }, [material]);
  const hasSolid = (): boolean => boxed(host.bodyBox()) && (host.hasSolid ? host.hasSolid() : true);
  const runMass = async () => {
    if (mbusy || !hasSolid()) { if (!hasSolid()) setRaw(null); return; }
    setMbusy(true);
    try { const d = await host.massProps(); if (d) setRaw({ data: d, revision: rev }); } finally { setMbusy(false); }
  };
  // a result that was made, stays current with the part
  useEffect(() => { if (raw && raw.revision !== rev) void runMass(); }, [rev]);
  const massV: MassView | null = raw ? massView(raw.data, density) : null;

  // ---- measure
  const [measuring, setMeasuring] = useState(false);
  measureActive.current = measuring;
  const [outcome, setOutcome] = useState<{ key: string; out: Outcome; picks: Pick[] } | null>(null);
  const sel = store.selection.value;
  const edges = host.bodyEdges();
  const picks = sel.map((n) => resolvePick(n, edges)).filter((p): p is Pick => !!p);
  const selKey = sel.join('\u0001');
  const seq = useRef(0);
  useEffect(() => {
    const view = getView();
    if (!measuring) {
      seq.current++; setOutcome(null); view?.setMeasure(null);
      // points on a reference mesh are only for measuring: they leave the selection with the tool, so no command takes them for a face
      if (sel.some((n) => n.startsWith('mp:'))) store.select(sel.filter((n) => !n.startsWith('mp:')));
      return;
    }
    if (sel.length > 2) { store.select(sel.slice(-2)); return; }   // a third pick starts again with the last two
    if (!picks.length) { seq.current++; setOutcome(null); view?.setMeasure(null); return; }
    const mine = ++seq.current;
    void measure(picks, { edges, mesh: host.bodyFaces(), kernel: (refs) => host.measure(refs) }).then((out) => {
      if (mine !== seq.current) return;
      setOutcome({ key: selKey, out, picks });
      view?.setMeasure(out.marks);
    });
  }, [measuring, selKey, rev]);
  useEffect(() => () => { getView()?.setMeasure(null); }, []);
  const toggleMeasure = (on = !measuring) => { setMeasuring(on); if (on) openPanel(); };
  const copy = (text: string) => {
    try { void navigator.clipboard.writeText(text); store.notify(t('inspect.copied'), 'info'); } catch { store.notify(t('inspect.copyFailed'), 'warn'); }
  };

  // ---- interference
  const [inter, setInter] = useState<{ data: Interference; revision: number } | null>(null);
  const [ibusy, setIbusy] = useState(false);
  const runInterference = async () => {
    if (ibusy) return;
    setIbusy(true);
    try { const d = await host.interference(); if (d) setInter({ data: d, revision: rev }); } finally { setIbusy(false); }
  };

  // ---- intersection check
  const [xing, setXing] = useState<{ data: IntersectionCheck; revision: number; faces: number } | null>(null);
  const [xerr, setXerr] = useState<string | null>(null);
  const [xbusy, setXbusy] = useState(false);
  /** The selected faces of the part: the check covers these against the rest, or the whole part when none are selected. */
  const selectedFaces = (): string[] => { const ids = host.bodyFaces()?.faceIds ?? []; return store.selection.value.filter((n) => ids.includes(n)); };
  const runIntersection = async () => {
    if (xbusy) return;
    setXbusy(true); setXerr(null);
    const faces = selectedFaces();
    try { const d = await host.intersection(faces); if (d) setXing({ data: d, revision: rev, faces: faces.length }); }
    catch (e) { setXing(null); setXerr(String((e as Error)?.message ?? e)); }
    finally { setXbusy(false); }
  };

  // ---- section
  const [section, setSectionState] = useState<SectionState>(defaultSection);
  const box = host.bodyBox();
  const faces = host.bodyFaces();
  const normal: V3 | null = section.plane === 'face'
    ? (section.faceId && faces ? facePlane(faces, section.faceId)?.normal ?? null : null)
    : STD_SECTION_NORMAL[section.plane];
  const range: [number, number] | null = box && normal ? boxRange(box, normal) : null;
  const spec = sectionSpec(section, normal);
  const specKey = spec ? JSON.stringify(spec) : '';
  useEffect(() => { getView()?.setSection(spec); }, [specKey]);
  const setSection = (patch: Partial<SectionState>) => setSectionState((s) => ({ ...s, ...patch }));
  /** Start or change the cut. A standard plane begins through the middle of the part; a face begins on the face. */
  const cutOn = (plane: SectionState['plane'], faceArg?: string) => {
    if (plane === 'face') {
      const id = faceArg && faces?.faceIds.includes(faceArg) && facePlane(faces, faceArg)?.flat ? faceArg : [...store.selection.value].reverse().find((n) => faces?.faceIds.includes(n) && facePlane(faces, n)?.flat);
      if (!id || !faces) { store.notify(t('inspect.section.pickFace'), 'warn'); return; }
      const pl = facePlane(faces, id)!;
      setSectionState((s) => ({ ...s, on: true, plane, faceId: id, offset: pl.normal.reduce((a, x, i) => a + x * pl.point[i], 0) }));
      return;
    }
    const n = STD_SECTION_NORMAL[plane];
    const r = box ? boxRange(box, n) : [0, 0];
    setSectionState((s) => ({ ...s, on: true, plane, faceId: null, offset: (r[0] + r[1]) / 2 }));
  };
  // A cut made while a feature panel is open is temporary: it goes when the panel closes. One made from the Inspect panel, or
  // already on when the panel opened, is the user's own and stays.
  const temp = useRef(false);
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current && !editing && temp.current) { temp.current = false; setSectionState((s) => ({ ...s, on: false })); }
    wasEditing.current = editing;
  }, [editing]);
  const sectionOff = () => { temp.current = false; setSection({ on: false }); };
  const toggleSection = () => { if (section.on) sectionOff(); else { temp.current = editing; cutOn(section.plane === 'face' ? 'front' : section.plane); if (!editing) openPanel(); } };
  /** The viewport's Section control: pick the plane (a standard one, or a given flat face), keeping the temporary mark of a cut that is already on. */
  const cutPlane = (plane: SectionState['plane'], faceId?: string) => { if (!section.on) temp.current = editing; cutOn(plane, faceId); };

  const props: InspectProps = {
    material, density, densityKnown: known !== null, onDensity: (d) => { if (Number.isFinite(d) && d >= 0) setDensity(d); },
    mass: massV, massBusy: mbusy, massStale: !!raw && raw.revision !== rev, box, hasSolid: hasSolid(), surfaces: host.surfaceBodies?.().length ?? 0,
    onMass: () => void runMass(),
    measuring, onMeasure: () => toggleMeasure(), picks, meshNames: Object.fromEntries(meshesOf(host.document()).map((m) => [m.id, m.name])), outcome: outcome && outcome.key === selKey ? outcome.out : null,
    onClearPicks: () => store.select([]),
    onCopy: (text) => copy(text),
    interference: inter ? inter.data : null, interferenceStale: !!inter && inter.revision !== rev, interferenceBusy: ibusy,
    onInterference: () => void runInterference(),
    intersection: xing ? xing.data : null, intersectionStale: !!xing && xing.revision !== rev, intersectionBusy: xbusy, intersectionError: xerr, intersectionFaces: xing ? xing.faces : selectedFaces().length,
    onIntersection: () => void runIntersection(),
    onPair: (a, b) => { store.mode.value = 'face'; store.select([a, b]); getView()?.frameNames([a, b]); },
    section, sectionRange: range,
    onSectionPlane: (p) => { temp.current = false; cutOn(p); },
    onSection: (patch) => setSection(patch),
    onSectionOff: sectionOff,
    onVisible: () => { if (hasSolid() && (!raw || raw.revision !== rev)) void runMass(); },
  };
  return { props, toggleMeasure, measuring, runMass, runInterference, runIntersection, toggleSection, cutPlane, sectionOff, section, sectionRange: range, setSection, sectionOn: section.on, copy, copyMeasure: () => outcome && copy(copyText(outcome.out.rows, (id) => t('measure.' + id))) };
}
