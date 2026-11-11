import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/preact';
import type { HandleDragSink, HandleSpec } from '@kit/viewport';
import { Sketch3dPanel, handleSpecs, sameSnap, HIT_PX, type Sketch3dHost, type Sketch3dResult } from './Sketch3dPanel';
import { emptyDraft, finishStroke, snapRay, withPoint, workPlanes, type Draft3, type P3, type SnapCandidate } from './model';
import '../i18n';

afterEach(() => cleanup());

/** A host whose "viewport" looks straight down on the ground: screen (x, y) is the ground point (x, 0, y). */
function fakeHost(cands: SnapCandidate[] = []) {
  const h = {
    placement: null as null | { move(x: number, y: number): void; tap(x: number, y: number): void; leave?(): void },
    specs: [] as HandleSpec[], sink: null as HandleDragSink | null,
    api: {
      rayAt: (x: number, y: number) => ({ o: [x, 100, y] as P3, d: [0, -1, 0] as P3 }),
      worldPerPixel: () => 1,
      setPlacement(hook) { h.placement = hook; },
      setHandles(specs, sink) { h.specs = specs ?? []; h.sink = sink; },
      dragging: () => false,
      upAxis: () => 'y' as const,
      candidates: () => cands,
      planes: () => [{ id: 'F9', frame: { o: [0, 0, 30], z: [0, 0, 1] } }],
    } as Sketch3dHost,
  };
  return h;
}

function mount(opts: { initial?: Draft3; edit?: boolean; cands?: SnapCandidate[] } = {}) {
  const host = fakeHost(opts.cands);
  const applied: Sketch3dResult[] = [];
  const cancels: number[] = [];
  const r = render(<Sketch3dPanel host={host.api} initial={opts.initial ?? emptyDraft()} featureId="F1" edit={opts.edit} onApply={(x) => applied.push(x)} onCancel={() => cancels.push(1)} />);
  const mode = (m: string) => fireEvent.click(r.container.querySelector(`[data-mode="${m}"]`)!);
  const tap = (x: number, y: number) => act(() => host.placement!.tap(x, y));
  const points = () => Array.from(r.container.querySelectorAll('[data-point]')).map((e) => e.getAttribute('data-point'));
  const input = (id: string, axis: string) => r.container.querySelector(`[data-point="${id}"] [data-axis="${axis}"]`) as HTMLInputElement;
  return { r, host, applied, cancels, mode, tap, points, input };
}

describe('Sketch3dPanel', () => {
  it('claims the pointer and shows the work plane; releases both when it goes', () => {
    const m = mount();
    expect(m.host.placement).not.toBeNull();
    expect(m.host.specs.map((s) => s.id)).toContain('sk3d:plane');
    m.r.unmount();
    expect(m.host.placement).toBeNull();
    expect(m.host.specs).toEqual([]);
  });

  it('clicks on the ground place points of a spline; Create adds one sketch3d with the spline, and a plane normal to its start', () => {
    const m = mount();
    m.tap(0, 0); m.tap(50, 20); m.tap(100, 0);
    expect(m.points()).toEqual(['p1', 'p2', 'p3']);
    expect(m.input('p2', 'x').value).toBe('50');
    expect(m.input('p2', 'y').value).toBe('0');   // on the ground: height 0
    expect(m.input('p2', 'z').value).toBe('20');
    expect(m.r.getByTestId('sk3d-path-note')).toBeTruthy();
    fireEvent.click(m.r.getByTestId('sk3d-apply'));
    expect(m.applied).toHaveLength(1);
    expect(m.applied[0].feature).toMatchObject({ type: 'sketch3d', id: 'F1', entities: [{ type: 'spline', pts: ['p1', 'p2', 'p3'] }] });
    expect(m.applied[0].normalPlane).toBe(true);
  });

  it('the height lifts the points off the plane', () => {
    const m = mount();
    fireEvent.input(m.r.container.querySelector('[data-path="offset"] input')!, { target: { value: '25' } });
    m.tap(10, 10);
    expect(m.input('p1', 'y').value).toBe('25');
  });

  it('a click near a model corner snaps to it, in space, not on the plane', () => {
    const m = mount({ cands: [{ p: [20, 40, 20], kind: 'endpoint' }] });
    m.tap(21, 21);   // within 12 px of the corner's line of sight
    expect(m.input('p1', 'y').value).toBe('40');
    expect(m.input('p1', 'x').value).toBe('20');
  });

  it('with snapping off the same click lands on the plane', () => {
    const m = mount({ cands: [{ p: [20, 40, 20], kind: 'endpoint' }] });
    fireEvent.click(m.r.container.querySelector('[data-path="snap"] input')!);
    m.tap(21, 21);
    expect(m.input('p1', 'y').value).toBe('0');
    expect(m.input('p1', 'x').value).toBe('21');
  });

  it('a typed point is added like a click', () => {
    const m = mount();
    const f = (axis: string, v: string) => fireEvent.input(m.r.container.querySelector(`[data-sk3d-add] [data-axis="${axis}"]`)!, { target: { value: v } });
    f('x', '12'); f('y', '34'); f('z', '-5');
    fireEvent.click(m.r.getByTestId('sk3d-add'));
    expect([m.input('p1', 'x').value, m.input('p1', 'y').value, m.input('p1', 'z').value]).toEqual(['12', '34', '-5']);
  });

  it('polyline: the last point clicked again ends the chain; a second chain is separate', () => {
    const m = mount();
    m.mode('line');
    m.tap(0, 0); m.tap(50, 0); m.tap(50, 50);
    m.tap(50, 50);   // the last point again: the chain ends (p3 is reused, no new point)
    expect(m.points()).toEqual(['p1', 'p2', 'p3']);
    m.tap(100, 100); m.tap(120, 100);
    fireEvent.click(m.r.getByTestId('sk3d-end'));
    fireEvent.click(m.r.getByTestId('sk3d-apply'));
    expect(m.applied[0].feature.entities).toEqual([
      { id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' }, { id: 'e3', type: 'line', p1: 'p4', p2: 'p5' },
    ]);
    expect(m.applied[0].normalPlane).toBe(false);   // lines are not a sweep path
  });

  it('an arc takes three clicks', () => {
    const m = mount();
    m.mode('arc');
    m.tap(100, 0); m.tap(70, 70); m.tap(0, 100);
    fireEvent.click(m.r.getByTestId('sk3d-apply'));
    const ents = m.applied[0].feature.entities as Array<{ type: string }>;
    expect(ents.map((e) => e.type)).toEqual(['arc']);
  });

  it('points mode places single points; Enter finishes; Escape drops the chain under way and then cancels', () => {
    const m = mount();
    m.mode('point');
    m.tap(5, 5);
    m.mode('spline');
    m.tap(0, 0);
    fireEvent.keyDown(window, { key: 'Escape' });   // drops the lone spline point
    expect(m.points()).toEqual(['p1']);
    expect(m.cancels).toHaveLength(0);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(m.applied).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(m.cancels).toHaveLength(1);
  });

  it('Create is disabled until something is drawn', () => {
    const m = mount();
    expect((m.r.getByTestId('sk3d-apply') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(m.applied).toHaveLength(0);
  });

  it('typed coordinates move a point; the delete button removes it and what depends on it', () => {
    const m = mount();
    m.tap(0, 0); m.tap(50, 0); m.tap(100, 0);
    fireEvent.change(m.input('p2', 'y'), { target: { value: '30' } });
    expect(m.input('p2', 'y').value).toBe('30');
    fireEvent.click(m.r.container.querySelector('[data-point="p3"] [data-act="delete"]')!);
    expect(m.points()).toEqual(['p1', 'p2']);
  });

  it('Ctrl+Z undoes a step of the tool, not the document', () => {
    const m = mount();
    m.tap(0, 0); m.tap(50, 0);
    const ev = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    const doc = vi.fn();
    document.addEventListener('keydown', doc);
    act(() => { window.dispatchEvent(ev); });
    document.removeEventListener('keydown', doc);
    expect(m.points()).toEqual(['p1']);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('reopening a sketch: its points are listed, Update replaces it, other keys of the feature stay', () => {
    let d = emptyDraft();
    const ids: string[] = [];
    for (const p of [[0, 0, 0], [10, 0, 5], [20, 5, 5]] as P3[]) { const r = withPoint(d, p); d = r.draft; ids.push(r.id); }
    d = finishStroke(d, { mode: 'spline', ids, degree: 3 });
    const host = fakeHost();
    const applied: Sketch3dResult[] = [];
    const r = render(<Sketch3dPanel host={host.api} initial={d} featureId="F7" base={{ type: 'sketch3d', id: 'F7', name: 'Rail' }} edit onApply={(x) => applied.push(x)} onCancel={() => {}} />);
    expect(r.container.querySelectorAll('[data-point]')).toHaveLength(3);
    fireEvent.click(r.getByTestId('sk3d-apply'));
    expect(applied[0].feature).toMatchObject({ id: 'F7', name: 'Rail' });
    expect(applied[0].normalPlane).toBe(false);   // not asked for when editing
  });

  it('the diamonds drag in the work plane: live specs follow the pointer, the commit moves the point', () => {
    const m = mount();
    m.tap(0, 0); m.tap(50, 0);
    const cube = m.host.specs.find((s) => s.id === 'p:p2')!;
    expect(cube).toMatchObject({ kind: 'cube', drag: 'plane', axis: [0, 1, 0] });
    const sink = m.host.sink!;
    sink.onStart!('p:p2');
    const live = sink.live!('p:p2', 0, [0, 0, 15])!;
    expect(live.find((s) => s.id === 'p:p2')).toMatchObject({ origin: [50, 0, 15], follow: true });
    act(() => sink.onCommit('p:p2', 0, [0, 0, 15]));
    expect(m.input('p2', 'z').value).toBe('15');
  });
});

describe('selecting points', () => {
  const click = (m: ReturnType<typeof mount>, id: string, shift = false) => act(() => m.host.sink!.onClick!('p:' + id, { shift, ctrl: false, alt: false }));
  const key = (k: string) => fireEvent.keyDown(window, { key: k });
  const sel = (m: ReturnType<typeof mount>) => Array.from(m.r.container.querySelectorAll('.sk3d-pt.sel')).map((e) => e.getAttribute('data-point'));

  it('a click on a diamond selects it: red diamond, highlighted row; clicking a row selects the diamond', () => {
    const m = mount();
    m.tap(0, 0); m.tap(50, 0); m.tap(100, 0);
    fireEvent.click(m.r.getByTestId('sk3d-end'));
    click(m, 'p2');
    expect(sel(m)).toEqual(['p2']);
    const col = (id: string) => m.host.specs.find((x) => x.id === 'p:' + id)!.color;
    expect(col('p2')).not.toBe(col('p1'));
    fireEvent.click(m.r.container.querySelector('[data-point="p3"]')!);
    expect(sel(m)).toEqual(['p3']);
    expect(col('p3')).not.toBe(col('p2'));   // the mark moved to p3
  });

  it('Backspace and Delete remove the selected point, not the chain\'s last one', () => {
    const m = mount();
    m.mode('line');
    m.tap(0, 0); m.tap(50, 0); m.tap(100, 0); m.tap(150, 0);
    fireEvent.click(m.r.getByTestId('sk3d-end'));
    click(m, 'p2');
    key('Delete');
    expect(m.points()).toEqual(['p1', 'p3', 'p4']);
    click(m, 'p3');
    key('Backspace');
    expect(m.points()).toEqual(['p1', 'p4']);
  });

  it('while a chain is under way a click on an existing point joins the chain there (closes on the first, ends on the last)', () => {
    const m = mount();
    m.mode('line');
    m.tap(0, 0); m.tap(50, 0); m.tap(50, 50);
    click(m, 'p1');                 // closes the outline on the first point
    expect(m.points()).toEqual(['p1', 'p2', 'p3']);
    expect(m.r.queryByTestId('sk3d-end')).toBeNull();
    expect(sel(m)).toEqual([]);
    expect(m.r.getByTestId('sk3d-status').textContent).toMatch(/3 points/);
    m.tap(200, 0); m.tap(250, 0);
    click(m, 'p5');                 // the last point again ends the chain
    expect(m.r.queryByTestId('sk3d-end')).toBeNull();
    expect(m.points()).toHaveLength(5);
  });

  it('with no chain a plain click only selects; Shift+click starts a chain from the point (line mode)', () => {
    const m = mount();
    m.mode('line');
    m.tap(0, 0); m.tap(50, 0);
    fireEvent.click(m.r.getByTestId('sk3d-end'));
    click(m, 'p2');
    expect(m.r.queryByTestId('sk3d-end')).toBeNull();
    click(m, 'p2', true);
    expect(m.r.getByTestId('sk3d-end')).toBeTruthy();
    m.tap(50, 80);
    expect(m.points()).toEqual(['p1', 'p2', 'p3']);
  });

  it('placing a new point clears the selection', () => {
    const m = mount();
    m.mode('point');
    m.tap(0, 0);
    click(m, 'p1');
    expect(sel(m)).toEqual(['p1']);
    m.tap(40, 40);
    expect(sel(m)).toEqual([]);
  });

  it('the pick radius is at least 12 px and every point carries it', () => {
    expect(HIT_PX).toBeGreaterThanOrEqual(12);
    const m = mount();
    m.tap(0, 0); m.tap(50, 0);
    const cubes = m.host.specs.filter((x) => x.kind === 'cube');
    expect(cubes).toHaveLength(2);
    expect(cubes.every((c) => (c.hitPx ?? 0) >= 12 && (c.hitPx ?? 0) > (c.sizePx ?? 0))).toBe(true);
  });

  it('a pointer move that changes nothing does not redraw the handles', () => {
    vi.stubGlobal('requestAnimationFrame', (f: () => void) => { f(); return 1; });
    try {
      const m = mount({ initial: (() => { const a = withPoint(emptyDraft(), [0, 0, 0]); return a.draft; })() });
      const spy = vi.spyOn(m.host.api, 'setHandles');
      act(() => m.host.placement!.move(0, 0));    // snaps to p1
      const after1 = spy.mock.calls.length;
      for (let i = 0; i < 5; i++) act(() => m.host.placement!.move(0, 0));
      expect(spy.mock.calls.length).toBe(after1);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('snap priority and hover equality', () => {
  const plane = workPlanes('y', [])[0];
  const ray = { o: [10, 100, 10] as P3, d: [0, -1, 0] as P3 };
  it('an existing point wins over a model corner, edge end or mesh surface at the same spot', () => {
    const cands: SnapCandidate[] = [{ p: [10, 0, 10], kind: 'vertex' }, { p: [11, 0, 10], kind: 'endpoint' }, { p: [10, 0, 10], kind: 'draft', id: 'p1' }];
    const s = snapRay(ray, cands, () => 1, 12, plane, 0, () => ({ pos: [10, 0, 10] }));
    expect(s).toMatchObject({ kind: 'draft', id: 'p1' });
  });
  it('sameSnap compares position, kind and id', () => {
    expect(sameSnap({ pos: [1, 2, 3], kind: 'draft', id: 'p1' }, { pos: [1, 2, 3], kind: 'draft', id: 'p1' })).toBe(true);
    expect(sameSnap({ pos: [1, 2, 3], kind: 'draft', id: 'p1' }, { pos: [1, 2, 4], kind: 'draft', id: 'p1' })).toBe(false);
    expect(sameSnap({ pos: [1, 2, 3], kind: 'plane' }, null)).toBe(false);
    expect(sameSnap(null, null)).toBe(true);
  });
});

describe('handleSpecs', () => {
  const plane = workPlanes('y', [])[0];
  it('draws the curves, the rubber band to the cursor and the snap cross', () => {
    let d = emptyDraft();
    const a = withPoint(d, [0, 0, 0]); d = a.draft;
    const b = withPoint(d, [10, 0, 0]); d = b.draft;
    const specs = handleSpecs({ draft: d, stroke: { mode: 'line', ids: [a.id, b.id], degree: 3 }, cursor: { pos: [20, 0, 10], kind: 'plane' }, selected: b.id, plane, offset: 0, wpp: () => 1 });
    const ids = specs.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['sk3d:plane', 'sk3d:wire', 'sk3d:rubber', 'sk3d:snap', 'p:p1', 'p:p2']));
    expect(specs.find((s) => s.id === 'p:p2')!.color).not.toBe(specs.find((s) => s.id === 'p:p1')!.color);   // the selected point is marked
    expect(specs.find((s) => s.id === 'sk3d:rubber')!.lines).toEqual([[10, 0, 0], [20, 0, 10]]);
  });

  it('draws the modes as one grid of icon buttons, the active one pressed, with a short hint under them', () => {
    const m = mount();
    const btns = Array.from(m.r.container.querySelectorAll('.sk3d-modes [data-mode]'));
    expect(btns.map((b) => b.getAttribute('data-mode'))).toEqual(['line', 'arc', 'spline', 'cvspline', 'point']);
    expect(btns.every((b) => b.querySelector('svg'))).toBe(true);
    expect(btns.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('data-mode'))).toEqual(['spline']);
    const hint = m.r.getByTestId('sk3d-hint').textContent;
    m.mode('arc');
    expect(m.r.container.querySelector('[data-mode="arc"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(m.r.getByTestId('sk3d-hint').textContent).not.toBe(hint);
  });

  it('groups the form in headed sections and keeps X, Y, Z and Add in one block', () => {
    const m = mount();
    const secs = Array.from(m.r.container.querySelectorAll('[data-sec]')).map((e) => e.getAttribute('data-sec'));
    expect(secs).toEqual(['draw', 'where', 'coords', 'points']);
    expect(Array.from(m.r.container.querySelectorAll('.sk3d-h')).every((h) => h.textContent)).toBe(true);
    const xyz = m.r.container.querySelector('.sk3d-xyz')!;
    expect(xyz.querySelectorAll('input[data-axis]')).toHaveLength(3);
    expect(xyz.querySelector('[data-testid="sk3d-add"]')).toBeTruthy();
    expect(m.r.getByTestId('sk3d-empty')).toBeTruthy();
  });

  it('keeps Cancel and Create in an action bar outside the scrolling body', () => {
    const m = mount();
    const bar = m.r.container.querySelector('.sk3d-actions')!;
    expect(bar.parentElement).toBe(m.r.getByTestId('sk3d-panel'));
    expect(bar.nextElementSibling).toBeNull();
    expect(bar.contains(m.r.getByTestId('sk3d-apply'))).toBe(true);
    expect(bar.contains(m.r.getByTestId('sk3d-cancel'))).toBe(true);
    expect(m.r.container.querySelector('.sk3d-body')!.contains(m.r.getByTestId('sk3d-apply'))).toBe(false);
    fireEvent.click(m.r.getByTestId('sk3d-cancel'));
    expect(m.cancels).toHaveLength(1);
  });

  it('has a collapsed How it works hint with a link to the guide', () => {
    const m = mount();
    expect(m.r.queryByTestId('sk3d-help')).toBeNull();
    fireEvent.click(m.r.getByTestId('sk3d-help-btn'));
    expect(m.r.getByTestId('sk3d-help').textContent).toMatch(/Enter/);
    expect(m.r.getByTestId('sk3d-learn').getAttribute('href')).toMatch(/intro-3d-sketching/);
    fireEvent.click(m.r.getByTestId('sk3d-help-btn'));
    expect(m.r.queryByTestId('sk3d-help')).toBeNull();
  });
});
