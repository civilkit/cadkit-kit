import '../i18n';
import { useSignals } from '../useSignals';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import { createStore } from '@kit/store';
import { useInspect, sectionSpec, type InspectHost, type InspectView } from './useInspect';
import type { EdgeInfo } from './measure';
import type { FaceMesh } from './geometry';

afterEach(cleanup);

const edges: EdgeInfo[] = [{ key: 'a|b#0', pts: [[0, 0, 0], [30, 0, 0]], line: true, faces: ['A', 'B'], mid: [15, 0, 0] }];
// the top face of a 30 x 20 x 10 box (z = 10) as two triangles
const mesh: FaceMesh = { positions: [0, 0, 10, 30, 0, 10, 30, 20, 10, 0, 0, 10, 30, 20, 10, 0, 20, 10], triFace: [0, 0], faceIds: ['F2.C1'] };

function fakeHost(o: Partial<InspectHost> = {}): InspectHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls, revision: 1, document: () => ({ material: 'aluminium' }), bodyBox: () => ({ min: [0, 0, 0], max: [30, 20, 10] }), bodyEdges: () => edges, bodyFaces: () => mesh,
    massProps: async () => { calls.push('mass'); return { volume: 6000, area: 2200, com: [15, 10, 5], principal: [1, 2, 3] }; },
    measure: async (refs) => { calls.push('measure ' + JSON.stringify(refs)); return null; },
    interference: async () => { calls.push('interference'); return { bodies: 2, pairs: [{ a: 'F2.C0', b: 'F5.C0', volume: 4 }] }; },
    ...o,
  };
}
function fakeView(): InspectView & { section: unknown[]; marks: unknown[]; framed: string[][] } {
  const v = { section: [] as unknown[], marks: [] as unknown[], framed: [] as string[][], setSection: (s: unknown) => { v.section.push(s); }, setMeasure: (m: unknown) => { v.marks.push(m); }, frameNames: (n: string[]) => { v.framed.push(n); } };
  return v as never;
}

let api!: ReturnType<typeof useInspect>;
function Harness(p: { host: InspectHost; store: ReturnType<typeof createStore>; view: InspectView; opened: () => void; active: { current: boolean } }) {
  useSignals(() => { p.store.selection.value; p.store.mode.value; p.store.notices.value; });   // the app re-renders on these
  api = useInspect(p.host, p.store, () => p.view, p.opened, p.active);
  return <div data-measuring={String(api.measuring)} />;
}
const mount = (host = fakeHost()) => {
  const store = createStore(), view = fakeView(), opened = vi.fn(), active = { current: false };
  const r = render(<Harness host={host} store={store} view={view} opened={opened} active={active} />);
  return { host, store, view, opened, active, ...r };
};

describe('useInspect', () => {
  it('mass: computes with the material density (2.7 for aluminium) and follows a density change', async () => {
    const { host } = mount();
    await act(async () => { api.props.onVisible(); });
    await waitFor(() => expect(api.props.mass).not.toBeNull());
    expect(host.calls).toEqual(['mass']);
    expect(api.props.mass!.mass).toBeCloseTo(16.2);
    expect(api.props.density).toBe(2.7);
    await act(async () => { api.props.onDensity(7.85); });
    expect(api.props.mass!.mass).toBeCloseTo(47.1);
  });

  it('measure: turning it on opens the panel and makes picks additive; two corners give a distance and a leader', async () => {
    const { store, view, opened, active } = mount();
    await act(async () => { api.toggleMeasure(); });
    expect(opened).toHaveBeenCalled(); expect(active.current).toBe(true);
    await act(async () => { store.select(['v:0,0,0']); store.select(['v:30,20,10'], true); });
    await waitFor(() => expect(api.props.outcome?.rows.find((r) => r.id === 'distance')).toBeTruthy());
    expect(api.props.outcome!.rows.find((r) => r.id === 'distance')!.value).toBeCloseTo(Math.hypot(30, 20, 10));
    expect(view.marks.at(-1)).toEqual([{ a: [0, 0, 0], b: [30, 20, 10], text: expect.any(String) }]);
    expect(api.props.picks.length).toBe(2);
  });

  it('measure: a third pick keeps the last two; turning it off clears the leaders', async () => {
    const { store, view } = mount();
    await act(async () => { api.toggleMeasure(); });
    await act(async () => { store.select(['v:0,0,0', 'v:30,0,0', 'v:30,20,0']); });
    await waitFor(() => expect(store.selection.value).toEqual(['v:30,0,0', 'v:30,20,0']));
    await waitFor(() => expect(api.props.outcome?.rows[0]?.value).toBeCloseTo(20));
    await act(async () => { api.toggleMeasure(); });
    await waitFor(() => expect(view.marks.at(-1)).toBeNull());
    expect(api.props.outcome).toBeNull();
  });

  it('measure: a face goes to the kernel as a face reference', async () => {
    const { store, host } = mount();
    await act(async () => { api.toggleMeasure(); });
    await act(async () => { store.select(['F2.C1']); });
    await waitFor(() => expect(host.calls.some((c) => c.startsWith('measure'))).toBe(true));
    expect(host.calls.find((c) => c.startsWith('measure'))).toBe('measure [{"kind":"face","id":"F2.C1"}]');
    // the kernel gave nothing, so the area comes from the triangles
    await waitFor(() => expect(api.props.outcome?.rows[0]).toEqual({ id: 'area', value: 600, unit: 'mm2' }));
  });

  it('interference: runs on demand; a pair selects both faces in face mode and frames them', async () => {
    const { store, view, host } = mount();
    await act(async () => { api.props.onInterference(); });
    await waitFor(() => expect(api.props.interference).not.toBeNull());
    expect(host.calls).toContain('interference');
    store.mode.value = 'edge';
    act(() => api.props.onPair('F2.C0', 'F5.C0'));
    expect(store.mode.value).toBe('face'); expect(store.selection.value).toEqual(['F2.C0', 'F5.C0']); expect(view.framed).toEqual([['F2.C0', 'F5.C0']]);
  });

  it('section: a standard plane starts through the middle, the slider range is the part along the normal, flip and off reach the viewport', async () => {
    const { view, opened } = mount();
    await act(async () => { api.props.onSectionPlane('front'); });
    expect(api.props.section).toMatchObject({ on: true, plane: 'front', offset: 5 });
    expect(api.props.sectionRange).toEqual([0, 10]);
    expect(view.section.at(-1)).toEqual({ normal: [0, 0, 1], offset: 5, flip: false });
    await act(async () => { api.props.onSection({ offset: 8, flip: true }); });
    expect(view.section.at(-1)).toEqual({ normal: [0, 0, 1], offset: 8, flip: true });
    await act(async () => { api.props.onSectionPlane('right'); });
    expect(api.props.sectionRange).toEqual([0, 30]);
    expect(view.section.at(-1)).toMatchObject({ normal: [1, 0, 0], offset: 15 });
    await act(async () => { api.props.onSectionOff(); });
    expect(view.section.at(-1)).toBeNull();
    await act(async () => { api.toggleSection(); });
    expect(opened).toHaveBeenCalled(); expect(api.sectionOn).toBe(true);
  });

  it('section on a face needs a flat face selected; it starts on that face', async () => {
    const { store, view } = mount();
    await act(async () => { api.props.onSectionPlane('face'); });
    expect(api.props.section.on).toBe(false);
    expect(store.notices.value.at(-1)?.text).toContain('Select one flat face');
    await act(async () => { store.select(['F2.C1']); });
    await act(async () => { api.props.onSectionPlane('face'); });
    expect(api.props.section).toMatchObject({ on: true, plane: 'face', faceId: 'F2.C1' });
    expect(api.props.section.offset).toBeCloseTo(10);
    const s = view.section.at(-1) as { normal: number[]; offset: number };
    expect(s.normal[2]).toBeCloseTo(1); expect(s.offset).toBeCloseTo(10);
  });

  it('sectionSpec is null when off or without a normal', () => {
    expect(sectionSpec({ on: false, plane: 'front', faceId: null, offset: 1, flip: false }, [0, 0, 1])).toBeNull();
    expect(sectionSpec({ on: true, plane: 'face', faceId: null, offset: 1, flip: false }, null)).toBeNull();
  });
});
