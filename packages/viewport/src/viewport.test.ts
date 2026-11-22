import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Viewport } from './viewport';

describe('viewport import', () => {
  it('Viewport is a function', () => {
    expect(typeof Viewport).toBe('function');
  });
});

// The handlers are arrow fields and the class needs WebGL, so the cancel logic is run on a bare instance with just the fields it touches.
type Bare = Record<string, unknown> & { cancelGesture(): void };
const bare = (over: Record<string, unknown> = {}): Bare => {
  const v = Object.create(Viewport.prototype) as Bare;
  Object.assign(v, { down: { x: 1, y: 2 }, rubber: null, sketchDrag: null, modPan: null, midZoom: null, boxDrag: null, boxEl: null,
    controls: { enabled: false }, dom: { releasePointerCapture: vi.fn() }, opts: {} }, over);
  return v;
};

describe('cancelGesture (pointercancel, and a second finger landing)', () => {
  it('forgets the press, so the pointerup that may still come is no click, and gives the orbit controls back', () => {
    const v = bare({ sketchDrag: 'P1', modPan: { x: 0, y: 0, moved: true }, midZoom: { y: 0, id: 1 } });
    v.cancelGesture();
    expect(v.down).toBeNull();
    expect(v.sketchDrag).toBeNull();
    expect(v.modPan).toBeNull();
    expect(v.midZoom).toBeNull();
    expect((v.controls as { enabled: boolean }).enabled).toBe(true);
  });
  it('a point drag in progress is ended for the app (its drop or refusal is settled there); with none, no event', () => {
    const onSketchDragEnd = vi.fn();
    const v = bare({ sketchDrag: 'P1', opts: { onSketchDragEnd } });
    v.cancelGesture();
    expect(onSketchDragEnd).toHaveBeenCalledWith('P1');
    onSketchDragEnd.mockClear();
    bare({ opts: { onSketchDragEnd } }).cancelGesture();
    expect(onSketchDragEnd).not.toHaveBeenCalled();
  });
  it('a rubber band that was drawn is cancelled for the sketch; one that never moved needs no event', () => {
    const onSketchBox = vi.fn();
    const moved = bare({ rubber: { cx: 0, cy: 0, x: 0, y: 0, moved: true }, opts: { onSketchBox } });
    moved.cancelGesture();
    expect(moved.rubber).toBeNull();
    expect(onSketchBox).toHaveBeenCalledWith(expect.objectContaining({ phase: 'cancel' }));
    onSketchBox.mockClear();
    const still = bare({ rubber: { cx: 0, cy: 0, x: 0, y: 0, moved: false }, opts: { onSketchBox } });
    still.cancelGesture();
    expect(still.rubber).toBeNull();
    expect(onSketchBox).not.toHaveBeenCalled();
  });
  it('a box select in progress is dropped with its rectangle and its pointer capture', () => {
    const remove = vi.fn(), release = vi.fn();
    const v = bare({ boxDrag: { x0: 0, y0: 0, id: 4, add: false }, boxEl: { remove }, dom: { releasePointerCapture: release } });
    v.cancelGesture();
    expect(v.boxDrag).toBeNull();
    expect(v.boxEl).toBeNull();
    expect(remove).toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(4);
  });
  it('with nothing in progress it only makes sure the controls are on', () => {
    const v = bare({ down: null });
    expect(() => v.cancelGesture()).not.toThrow();
    expect((v.controls as { enabled: boolean }).enabled).toBe(true);
  });
});

describe('render loop: draws on demand and goes to sleep when idle', () => {
  type Loop = Record<string, unknown> & { frame(): void; requestRender(): void; wake(): void };
  const rig = (over: Record<string, unknown> = {}) => {
    const queue: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: () => void) => { queue.push(cb); return queue.length; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const render = vi.fn();
    const v = Object.create(Viewport.prototype) as Loop;
    const vec = { copy: () => vec, applyQuaternion: () => vec };
    Object.assign(v, { raf: 0, disposed: false, dirty: false, anim: null, hoverPending: null, down: null, sketchEdit: null, captures: [],
      fixSpriteScale: vi.fn(), sortGlass: vi.fn(), sunOffset: vec, sun: { position: vec }, camera: { quaternion: {} },
      scene: { environmentRotation: { setFromQuaternion: vi.fn() } }, renderer: { render }, handleLayer: { render: vi.fn() }, triball: { render: vi.fn() },
      viewCube: null, controls: { target: {} }, ...over });
    v.loop = () => v.frame();
    const tick = () => { const cb = queue.shift(); cb?.(); };
    return { v, render, queue, tick };
  };

  it('nothing dirty: no frame is drawn and none is scheduled again', () => {
    const { v, render, queue, tick } = rig();
    v.requestRender();
    expect(queue.length).toBe(1);
    tick();   // draws the requested frame
    expect(render).toHaveBeenCalledTimes(1);
    expect(queue.length).toBe(0);   // asleep
    expect(v.raf).toBe(0);
  });
  it('requestRender wakes it once, however often it is called', () => {
    const { v, render, queue, tick } = rig();
    v.requestRender(); v.requestRender(); v.requestRender();
    expect(queue.length).toBe(1);
    tick();
    expect(render).toHaveBeenCalledTimes(1);
    v.requestRender();
    tick();
    expect(render).toHaveBeenCalledTimes(2);
  });
  it('a running view animation keeps it awake until the animation ends', () => {
    const { v, queue, tick } = rig({ anim: {} });
    v.stepAnim = () => { v.anim = null; v.dirty = true; };
    v.wake();
    tick();   // the step finishes the animation and marks dirty: one more frame, then idle
    expect(queue.length).toBe(0);
    expect(v.dirty).toBe(false);
  });
  it('a pending hover wakes it; a stale one while sketching does not keep it spinning', () => {
    const a = rig({ hoverPending: { x: 1, y: 2 }, pickName: () => null, hit: () => null, lastHover: null, opts: {} });
    a.v.wake();
    a.tick();
    expect(a.queue.length).toBe(0);   // the hover was consumed
    const b = rig({ hoverPending: { x: 1, y: 2 }, sketchEdit: {} });
    b.v.wake();
    b.tick();
    expect(b.queue.length).toBe(0);
  });
  it('a disposed viewport never schedules', () => {
    const { v, queue } = rig({ disposed: true });
    v.requestRender();
    expect(queue.length).toBe(0);
  });
});

describe('dispose frees what the viewport itself owns', () => {
  it('textures, ground grid, underlay, reference planes, and the pending frame handles', () => {
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('window', { removeEventListener: vi.fn() });
    const none = () => ({ removeEventListener: vi.fn(), remove: vi.fn() });
    const scene = new THREE.Scene();
    const envTex = new THREE.Texture(), bgTexture = new THREE.Texture(), map = new THREE.Texture();
    const grid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    const umat = new THREE.MeshBasicMaterial({ map }), ugeo = new THREE.PlaneGeometry(1, 1);
    const underlay = { mesh: new THREE.Mesh(ugeo, umat), url: 'u' };
    scene.add(grid, underlay.mesh);
    scene.background = bgTexture; scene.environment = envTex;
    const spies = [envTex, bgTexture, map, grid.geometry, grid.material, ugeo, umat].map((o) => vi.spyOn(o as { dispose(): void }, 'dispose'));
    const refPlanes = { dispose: vi.fn() };
    const renderer = { dispose: vi.fn() };
    const v = Object.create(Viewport.prototype) as Record<string, unknown> & { dispose(): void };
    Object.assign(v, { offTextures: null, offHdri: null, hdris: new Map(), disposed: false, refMeshes: { dispose: vi.fn() }, raf: 5, cursorRaf: 6, tween: 7, sketchRefreshRaf: 8,
      dom: none(), viewCube: null, handleLayer: { dispose: vi.fn() }, triball: { dispose: vi.fn() }, controls: { dispose: vi.fn() }, sectionView: { clear: vi.fn() },
      setMeasure: vi.fn(), clearSketchOverlay: vi.fn(), clearBody: vi.fn(), renderer, scene, envTex, bgTexture, groundGrid: grid, underlay, refPlanes, requestRender: vi.fn() });
    v.dispose();
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
    expect(refPlanes.dispose).toHaveBeenCalled();
    expect(v.tween).toBeNull();
    expect(v.groundGrid).toBeNull();
    expect(v.underlay).toBeNull();
    expect(cancel).toHaveBeenCalledWith(7);
    expect(cancel).toHaveBeenCalledWith(8);
    expect(cancel).toHaveBeenCalledWith(5);
    expect(renderer.dispose).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('clearBody and the silhouette hull geometry', () => {
  const clear = (hullGeo: (body: THREE.BufferGeometry) => THREE.BufferGeometry) => {
    const scene = new THREE.Scene();
    const body = new THREE.BufferGeometry();
    const hull = new THREE.Mesh(hullGeo(body), new THREE.MeshBasicMaterial());
    const mesh = new THREE.Mesh(body, new THREE.MeshBasicMaterial());
    scene.add(mesh, hull);
    const bodyDispose = vi.spyOn(body, 'dispose'), hullDispose = vi.spyOn(hull.geometry, 'dispose');
    const noop = vi.fn();
    const v = Object.create(Viewport.prototype) as Record<string, unknown> & { clearBody(): void };
    Object.assign(v, { clearLayers: noop, dropThreadGroup: noop, dropFat: noop, dropFeatureHover: noop, dropIssueMeshes: noop, dropIssueHover: noop,
      threadFocusObj: null, hoverObj: null, shapeHover: null, edgeHighlight: null, hiddenEdgeLines: null, glass: [], own: [], scene,
      mesh, edgeLines: null, highlight: null, hull, analysis: { dispose: noop } });
    v.clearBody();
    return { bodyDispose, hullDispose, hull: v.hull };
  };
  it('frees a hull geometry of its own (the wrapper buildGlass makes when there are clear or textured bodies)', () => {
    const r = clear(() => new THREE.BufferGeometry());
    expect(r.hullDispose).toHaveBeenCalledTimes(1);
    expect(r.bodyDispose).toHaveBeenCalledTimes(1);
    expect(r.hull).toBeNull();
  });
  it('leaves the body geometry to the body mesh when the hull shares it (freed once)', () => {
    const r = clear((b) => b);
    expect(r.bodyDispose).toHaveBeenCalledTimes(1);
  });
});
