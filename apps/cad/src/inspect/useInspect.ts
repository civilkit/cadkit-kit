import { useEffect, useRef, useState } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import type { Store } from '@kit/store';
import { boxRange, facePlane, type FaceMesh, type V3 } from './geometry';
import { copyText, measure, resolvePick, type EdgeInfo, type KernelMeasure, type Outcome, type Pick } from './measure';
import { densityOf, massView, type MassRaw, type MassView } from './mass';
import type { Interference } from './kernel';
import type { Box, InspectProps, SectionState } from './InspectPanel';
import { STD_SECTION_NORMAL, type SectionSpec } from '@kit/viewport';
import { t } from '../i18n';

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
export function useInspect(host: InspectHost, store: Store, getView: () => InspectView | null, openPanel: () => void, measureActive: MutableRef<boolean>) {
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
    if (!measuring) { seq.current++; setOutcome(null); view?.setMeasure(null); return; }
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
  const cutOn = (plane: SectionState['plane']) => {
    if (plane === 'face') {
      const id = [...store.selection.value].reverse().find((n) => faces?.faceIds.includes(n) && facePlane(faces, n)?.flat);
      if (!id || !faces) { store.notify(t('inspect.section.pickFace'), 'warn'); return; }
      const pl = facePlane(faces, id)!;
      setSectionState((s) => ({ ...s, on: true, plane, faceId: id, offset: pl.normal.reduce((a, x, i) => a + x * pl.point[i], 0) }));
      return;
    }
    const n = STD_SECTION_NORMAL[plane];
    const r = box ? boxRange(box, n) : [0, 0];
    setSectionState((s) => ({ ...s, on: true, plane, faceId: null, offset: (r[0] + r[1]) / 2 }));
  };
  const toggleSection = () => { if (section.on) setSection({ on: false }); else { cutOn(section.plane === 'face' ? 'front' : section.plane); openPanel(); } };

  const props: InspectProps = {
    material, density, densityKnown: known !== null, onDensity: (d) => { if (Number.isFinite(d) && d >= 0) setDensity(d); },
    mass: massV, massBusy: mbusy, massStale: !!raw && raw.revision !== rev, box, hasSolid: hasSolid(), surfaces: host.surfaceBodies?.().length ?? 0,
    onMass: () => void runMass(),
    measuring, onMeasure: () => toggleMeasure(), picks, outcome: outcome && outcome.key === selKey ? outcome.out : null,
    onClearPicks: () => store.select([]),
    onCopy: (text) => copy(text),
    interference: inter ? inter.data : null, interferenceStale: !!inter && inter.revision !== rev, interferenceBusy: ibusy,
    onInterference: () => void runInterference(),
    onPair: (a, b) => { store.mode.value = 'face'; store.select([a, b]); getView()?.frameNames([a, b]); },
    section, sectionRange: range,
    onSectionPlane: cutOn,
    onSection: (patch) => setSection(patch),
    onSectionOff: () => setSection({ on: false }),
    onVisible: () => { if (hasSolid() && (!raw || raw.revision !== rev)) void runMass(); },
  };
  return { props, toggleMeasure, measuring, runMass, runInterference, toggleSection, sectionOn: section.on, copy, copyMeasure: () => outcome && copy(copyText(outcome.out.rows, (id) => t('measure.' + id))) };
}
