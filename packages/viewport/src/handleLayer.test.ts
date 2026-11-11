import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { HandleLayer } from './handleLayer';
import type { HandleDragSink, HandleSpec } from './handles';

// A camera 100 units in front of the origin on a 800 x 600 canvas: 1 world unit is about 7.25 px there, so a 70 px arrow
// along x ends at x = 70 / 7.25 on screen pixel (400 + 70, 300).
function setup(specs: HandleSpec[]) {
  const dom = document.createElement('canvas');
  dom.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;
  (dom as unknown as { setPointerCapture(): void }).setPointerCapture = () => {};
  (dom as unknown as { releasePointerCapture(): void }).releasePointerCapture = () => {};
  const host = document.createElement('div');
  host.appendChild(dom);
  document.body.appendChild(host);
  const camera = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 1000);
  camera.position.set(0, 0, 100);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const inval = vi.fn();
  const layer = new HandleLayer(dom, host, camera, inval);
  const sink: HandleDragSink = { onStart: vi.fn(), onDrag: vi.fn(), onCommit: vi.fn(), onCancel: vi.fn() };
  layer.set(specs, sink);
  const later = vi.fn();
  dom.addEventListener('pointerdown', later);   // stands in for the orbit controls / selection, registered after the layer
  const ev = (type: string, x: number, y: number, init: MouseEventInit = {}) => dom.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, ...init }));
  const key = (k: string, init: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  return { layer, dom, sink, later, ev, key, camera, dispose: () => { layer.dispose(); host.remove(); } };
}

const arrow: HandleSpec = { id: 'a', kind: 'arrow', origin: [0, 0, 0], axis: [1, 0, 0], sizePx: 70, base: 10, scale: 2 };
const dotAt0: HandleSpec = { id: 'd', kind: 'cube', look: 'diamond', drag: 'plane', origin: [0, 0, 0], axis: [0, 0, 1], sizePx: 4.5, hitPx: 14 };

describe('HandleLayer hover and click', () => {
  it('a rebuild of the same handles keeps the hover and the cursor (no flicker while a tool redraws on every pointer move)', () => {
    const t = setup([dotAt0]);
    t.ev('pointermove', 408, 300);
    expect(t.dom.style.cursor).not.toBe('');
    for (let i = 0; i < 5; i++) { t.layer.set([{ ...dotAt0 }], t.sink); t.ev('pointermove', 408 + (i % 2), 300); expect(t.dom.style.cursor).not.toBe(''); expect((t.layer as unknown as { hover: string | null }).hover).toBe('d'); }
    t.layer.set([{ ...dotAt0, id: 'other' }], t.sink);    // the hovered handle is gone: hover and cursor clear
    expect((t.layer as unknown as { hover: string | null }).hover).toBeNull();
    expect(t.dom.style.cursor).toBe('');
    t.dispose();
  });

  it('picks within hitPx (at least 12 px) of the centre and not beyond', () => {
    const t = setup([dotAt0]);
    t.ev('pointerdown', 400 + 13, 300);
    expect(t.sink.onStart).toHaveBeenCalledWith('d');
    t.ev('pointerup', 413, 300);
    (t.sink.onStart as ReturnType<typeof vi.fn>).mockClear();
    t.ev('pointerdown', 400 + 16, 300);
    expect(t.sink.onStart).not.toHaveBeenCalled();
    t.dispose();
  });

  it('a press and release without a drag calls onClick (not onCancel); a drag still commits', () => {
    const t = setup([dotAt0]);
    const onClick = vi.fn();
    t.layer.set([dotAt0], { ...t.sink, onClick });
    t.ev('pointerdown', 401, 300);
    t.ev('pointerup', 401, 300);
    expect(onClick).toHaveBeenCalledWith('d', expect.objectContaining({ shift: false }));
    expect(t.sink.onCancel).not.toHaveBeenCalled();
    t.ev('pointerdown', 401, 300);
    t.ev('pointermove', 430, 300);
    t.ev('pointerup', 430, 300);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(t.sink.onCommit).toHaveBeenCalledTimes(1);
    t.dispose();
  });
});

const pxPerUnit = 600 / (2 * 100 * Math.tan((45 * Math.PI) / 360));

describe('HandleLayer interaction', () => {
  it('a press on a handle is stopped before the orbit controls; a press elsewhere is not', () => {
    const t = setup([arrow]);
    t.ev('pointerdown', 700, 100);
    expect(t.later).toHaveBeenCalledTimes(1);
    expect(t.sink.onStart).not.toHaveBeenCalled();
    t.ev('pointerdown', 435, 300);
    expect(t.later).toHaveBeenCalledTimes(1);          // not called again: stopped
    expect(t.sink.onStart).toHaveBeenCalledWith('a');
    t.ev('pointerup', 435, 300);
    t.dispose();
  });

  it('dragging reports base + scale * distance along the axis; release commits', () => {
    const t = setup([arrow]);
    t.ev('pointerdown', 435, 300);
    t.ev('pointermove', 465, 300);
    const [id, q, vec] = (t.sink.onDrag as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(id).toBe('a');
    expect(q).toBeCloseTo(10 + 2 * (30 / pxPerUnit), 3);
    expect(vec[0]).toBeCloseTo(30 / pxPerUnit, 3);
    t.ev('pointerup', 465, 300);
    expect(t.sink.onCommit).toHaveBeenCalledTimes(1);
    expect(t.sink.onCancel).not.toHaveBeenCalled();
    t.dispose();
  });

  it('Shift is a tenth, Ctrl snaps to whole millimetres', () => {
    const t = setup([{ ...arrow, base: 0, scale: 1 }]);
    t.ev('pointerdown', 435, 300);
    t.ev('pointermove', 495, 300, { shiftKey: true });
    expect((t.sink.onDrag as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]).toBeCloseTo((60 / pxPerUnit) * 0.1, 3);
    t.ev('pointermove', 495, 300, { ctrlKey: true });
    expect((t.sink.onDrag as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]).toBe(Math.round(60 / pxPerUnit));
    t.ev('pointerup', 495, 300);
    t.dispose();
  });

  it('Esc cancels and a click without a drag does nothing', () => {
    const t = setup([arrow]);
    t.ev('pointerdown', 435, 300);
    t.ev('pointermove', 470, 300);
    t.key('Escape');
    expect(t.sink.onCancel).toHaveBeenCalledTimes(1);
    expect(t.sink.onCommit).not.toHaveBeenCalled();
    t.ev('pointerup', 470, 300);                           // after the cancel: ignored
    expect(t.sink.onCommit).not.toHaveBeenCalled();
    t.ev('pointerdown', 435, 300);
    t.ev('pointerup', 435, 300);
    expect(t.sink.onCancel).toHaveBeenCalledTimes(2);      // a plain click is a cancel
    t.dispose();
  });

  it('typed digits override the drag and Enter commits the typed quantity', () => {
    const t = setup([arrow]);
    t.ev('pointerdown', 435, 300);
    t.ev('pointermove', 470, 300);
    for (const k of ['2', '5', '.', '5']) t.key(k);
    expect((t.sink.onDrag as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]).toBe(25.5);
    t.ev('pointermove', 480, 300);                          // the pointer no longer matters
    expect((t.sink.onDrag as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]).toBe(25.5);
    t.key('Enter');
    expect(t.sink.onCommit).toHaveBeenCalledWith('a', 25.5, expect.any(Array), expect.anything());
    t.dispose();
  });

  it('hovering a handle changes the cursor; hiding the handles stops capturing', () => {
    const t = setup([arrow]);
    t.ev('pointermove', 435, 300);
    expect(t.dom.style.cursor).toBe('pointer');
    t.ev('pointermove', 700, 100);
    expect(t.dom.style.cursor).toBe('');
    t.layer.set(null, null);
    t.ev('pointerdown', 435, 300);
    expect(t.later).toHaveBeenCalledTimes(1);
    expect(t.sink.onStart).not.toHaveBeenCalled();
    t.dispose();
  });

  it('keys are left alone when no handle is dragged', () => {
    const t = setup([arrow]);
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    t.key('5');
    expect(seen).toHaveBeenCalled();
    window.removeEventListener('keydown', seen);
    t.dispose();
  });

  it('a ring reports degrees', () => {
    const ring: HandleSpec = { id: 'r', kind: 'ring', origin: [0, 0, 0], axis: [0, 0, 1], sizePx: 64, unit: 'deg' };
    const t = setup([ring]);
    t.ev('pointerdown', 400 + 64, 300);
    t.ev('pointermove', 400, 300 - 64);                     // a quarter turn counter-clockwise on screen
    expect((t.sink.onDrag as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]).toBeCloseTo(90, 0);
    t.ev('pointerup', 400, 236);
    t.dispose();
  });
});

describe('HandleLayer move pad and shape surface', () => {
  const pad: HandleSpec = { id: 'move', kind: 'pad', origin: [0, 0, 0], axis: [0, 0, 1], u: [1, 0, 0], drag: 'plane', reportMods: true, sizePx: 17 };

  it('the pad drags in its plane and reports the raw move with the modifier keys', () => {
    const t = setup([pad]);
    t.ev('pointerdown', 400, 300);
    t.ev('pointermove', 400 + 2 * pxPerUnit, 300 - pxPerUnit, { shiftKey: true, altKey: true });
    const [id, , vec, mods] = (t.sink.onDrag as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(id).toBe('move');
    expect(vec[0]).toBeCloseTo(2, 2); expect(vec[1]).toBeCloseTo(1, 2);          // raw: Shift does not slow or lock it here
    expect(mods).toEqual({ shift: true, ctrl: false, alt: true });
    t.key('Escape');
    expect(t.sink.onCancel).toHaveBeenCalledWith('move');
    t.dispose();
  });

  it('pressing on the shape surface moves it after a small threshold; a plain click is handed back to select', () => {
    const t = setup([pad]);
    const click = vi.fn();
    t.layer.set([pad], t.sink, { hit: (x) => (x > 600 ? [0, 0, 0] : null), click });
    t.ev('pointerdown', 700, 300);
    expect(t.later).toHaveBeenCalledTimes(0);                // the press is ours (no orbit)
    t.ev('pointermove', 702, 300);
    expect(t.sink.onStart).not.toHaveBeenCalled();           // under the threshold
    t.ev('pointerup', 702, 300);
    expect(click).toHaveBeenCalledTimes(1);
    expect(t.sink.onStart).not.toHaveBeenCalled();
    t.ev('pointerdown', 700, 300);
    t.ev('pointermove', 740, 300);
    expect(t.sink.onStart).toHaveBeenCalledWith('move');
    const vec = (t.sink.onDrag as ReturnType<typeof vi.fn>).mock.calls.at(-1)![2];
    expect(vec[0]).toBeCloseTo(40 / pxPerUnit, 2);           // measured from where the press began, no jump
    t.ev('pointerup', 740, 300);
    expect(t.sink.onCommit).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    t.ev('pointerdown', 100, 300);                           // off the shape: not ours, orbit gets it
    expect(t.later).toHaveBeenCalledTimes(1);
    t.dispose();
  });

  it('a double click on the pad is reported; a handle too small on screen is hidden and not hit', () => {
    const t = setup([pad]);
    const act = vi.fn();
    t.layer.set([pad], { ...t.sink, onActivate: act });
    t.ev('dblclick', 400, 300);
    expect(act).toHaveBeenCalledWith('move');
    const small: HandleSpec = { id: 'c', kind: 'cube', origin: [0, 0, 0], axis: [0, 0, 1], drag: 'plane', sizePx: 6, spanWorld: 1, showMinPx: 60 };
    t.layer.set([small], t.sink);
    t.ev('pointerdown', 400, 300);
    expect(t.sink.onStart).not.toHaveBeenCalled();           // 1 mm is ~7 px here: hidden
    const big = { ...small, spanWorld: 20 };
    t.layer.set([big], t.sink);
    t.ev('pointerdown', 400, 300);
    expect(t.sink.onStart).toHaveBeenCalledWith('c');
    t.dispose();
  });
  it('a typed label value commits when the box loses focus (no Enter on a phone keyboard) and Escape still cancels', () => {
    const label: HandleSpec = { id: 'l', kind: 'label', origin: [0, 0, 0], axis: [1, 0, 0], sizePx: 0, forId: 'a', text: '70 mm' };
    const t = setup([arrow, label]);
    const open = () => { (document.querySelector('.vp-size-label') as HTMLElement).click(); return document.querySelector('.vp-size-label input') as HTMLInputElement; };
    let input = open();
    input.value = '90';
    input.dispatchEvent(new FocusEvent('blur'));
    expect(t.sink.onCommit).toHaveBeenCalledWith('a', 90, [0, 0, 0]);
    input = open();
    input.value = '55';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(t.sink.onCommit).toHaveBeenCalledTimes(1);
    t.dispose();
  });
  it('a typed label value commits from whichever event the phone keyboard sends, once, and Escape (key or code) cancels', () => {
    const label: HandleSpec = { id: 'l', kind: 'label', origin: [0, 0, 0], axis: [1, 0, 0], sizePx: 0, forId: 'a', text: '70 mm' };
    const t = setup([arrow, label]);
    const open = (v: string) => { (document.querySelector('.vp-size-label') as HTMLElement).click(); const i = document.querySelector('.vp-size-label input') as HTMLInputElement; i.value = v; return i; };
    const key = (i: HTMLInputElement, type: 'keydown' | 'keyup', init: KeyboardEventInit & { keyCode?: number }) => { const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }); if (init.keyCode) Object.defineProperty(e, 'keyCode', { value: init.keyCode }); i.dispatchEvent(e); };
    const commits = () => (t.sink.onCommit as ReturnType<typeof vi.fn>).mock.calls.length;
    let i = open('61'); key(i, 'keydown', { key: 'Unidentified', keyCode: 13 }); expect(commits()).toBe(1);                // check key: keyCode 13 only
    i = open('62'); key(i, 'keyup', { key: 'Enter' }); expect(commits()).toBe(2);                                          // only the keyup arrives
    i = open('63'); i.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertLineBreak', bubbles: true, cancelable: true })); expect(commits()).toBe(3);
    i = open('64'); i.dispatchEvent(new Event('change', { bubbles: true })); expect(commits()).toBe(4);
    i = open('65'); key(i, 'keydown', { key: 'Enter' }); key(i, 'keyup', { key: 'Enter' }); i.dispatchEvent(new FocusEvent('blur')); expect(commits()).toBe(5);   // all of them: still one commit
    expect((t.sink.onCommit as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1])).toEqual([61, 62, 63, 64, 65]);
    i = open('66'); key(i, 'keydown', { key: 'Unidentified', keyCode: 27 }); expect(commits()).toBe(5);
    t.dispose();
  });
});
