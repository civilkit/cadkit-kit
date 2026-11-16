import { describe, it, expect } from 'vitest';
import { REGION_IDS, lowerRight, keyboardOverlap, layoutOverlays, overlappingPairs, rectsIntersect, regionRects, reservedFrom, visibleToasts, type OverlayItem, type Rect, type ToastEntry } from './overlayLayout';

const VIEWPORTS: Array<[string, Rect, { left: number; right: number; rightBottom: number; bottom: number }]> = [
  ['phone', { x: 0, y: 0, w: 390, h: 640 }, { left: 0, right: 150, rightBottom: 0, bottom: 70 }],
  ['tablet portrait (nav open, tool column)', { x: 0, y: 0, w: 540, h: 960 }, { left: 112, right: 140, rightBottom: 0, bottom: 0 }],
  ['tablet portrait (nav hidden, compact column)', { x: 0, y: 0, w: 820, h: 960 }, { left: 66, right: 140, rightBottom: 0, bottom: 0 }],
  ['tablet landscape', { x: 0, y: 0, w: 900, h: 640 }, { left: 112, right: 140, rightBottom: 252, bottom: 0 }],
  ['desktop', { x: 0, y: 0, w: 1440, h: 780 }, { left: 112, right: 140, rightBottom: 252, bottom: 0 }],
];
/** A busy canvas: every overlay the app can show at once. */
const items = (): OverlayItem[] => [
  { id: 'selmodes', region: 'top-center', w: 330, h: 44, order: 0 },
  { id: 'update-notice', region: 'top-center', w: 300, h: 40, order: 1 },
  { id: 'busy-pill', region: 'top-center', w: 260, h: 40, order: 2 },
  { id: 'face-chip', region: 'top-center', w: 180, h: 32, order: 3 },
  { id: 'toast-1', region: 'bottom-center', w: 280, h: 40, order: 0 },
  { id: 'toast-2', region: 'bottom-center', w: 280, h: 40, order: 1 },
  { id: 'toast-3', region: 'bottom-center', w: 280, h: 40, order: 2 },
  { id: 'hint', region: 'bottom-center', w: 300, h: 34, order: 3 },
  { id: 'start-card', region: 'bottom-center', w: 320, h: 120, order: 4 },
  { id: 'status-pill', region: 'bottom-left', w: 160, h: 28, order: 0 },
  { id: 'readout', region: 'bottom-left', w: 160, h: 28, order: 1 },
  { id: 'undo-card', region: 'canvas-left', w: 96, h: 52, order: 0 },
  { id: 'view-cube', region: 'canvas-right', w: 130, h: 140, order: 0 },
  { id: 'display', region: 'canvas-right', w: 100, h: 44, order: 1 },
];

describe('overlay regions', () => {
  it.each(VIEWPORTS)('several overlays at once never intersect, stay on screen and clear the reserved controls (%s)', (_n, canvas, reserved) => {
    for (const kb of [0, 300]) {
      const placed = layoutOverlays(canvas, items(), { reserved, safe: { top: 20, bottom: 34, left: 0, right: 0 }, keyboard: kb });
      const drawn = placed.filter((p) => !p.hidden);
      expect(drawn.length).toBeGreaterThanOrEqual(kb ? 3 : 6);
      expect(overlappingPairs(drawn.map((p) => p.rect)).map(([a, b]) => `${drawn[a].id}x${drawn[b].id}`)).toEqual([]);
      for (const p of drawn) {
        expect(p.rect.x, p.id).toBeGreaterThanOrEqual(-0.5); expect(p.rect.y, p.id).toBeGreaterThanOrEqual(-0.5);
        expect(p.rect.x + p.rect.w, p.id).toBeLessThanOrEqual(canvas.w + 0.5); expect(p.rect.y + p.rect.h, p.id).toBeLessThanOrEqual(canvas.h - kb + 0.5);   // above the keyboard
        // the middle regions clear the reserved left and right extents
        if (p.region === 'top-center') { expect(p.rect.x, p.id).toBeGreaterThanOrEqual(reserved.left - 0.5); expect(p.rect.x + p.rect.w, p.id).toBeLessThanOrEqual(canvas.w - reserved.right + 0.5); }
      }
    }
  });
  it('an item that does not fit is queued (hidden), never drawn over its neighbour', () => {
    const placed = layoutOverlays({ x: 0, y: 0, w: 390, h: 300 }, Array.from({ length: 12 }, (_, i) => ({ id: 'n' + i, region: 'top-center' as const, w: 200, h: 44, order: i })), {});
    const drawn = placed.filter((p) => !p.hidden);
    expect(drawn.length).toBeLessThan(12); expect(drawn.length).toBeGreaterThan(0);
    expect(overlappingPairs(drawn.map((p) => p.rect))).toEqual([]);
    expect(placed.filter((p) => p.hidden).length).toBe(12 - drawn.length);
  });
  it('regions follow the layout: a wider tool column moves the middle regions, not a fixed number', () => {
    const c: Rect = { x: 0, y: 0, w: 800, h: 600 };
    const a = regionRects(c, { reserved: { left: 66 } }), b = regionRects(c, { reserved: { left: 112 } });
    expect(b['top-center'].x - a['top-center'].x).toBe(46);
    expect(b['top-center'].w).toBe(a['top-center'].w - 46);
    for (const id of REGION_IDS) expect(a[id].w).toBeGreaterThanOrEqual(0);
  });
  it('safe-area insets and the keyboard shrink the usable area', () => {
    const c: Rect = { x: 0, y: 0, w: 800, h: 600 };
    const plain = regionRects(c), safe = regionRects(c, { safe: { top: 24, left: 30, right: 30, bottom: 34 }, keyboard: 280 });
    expect(safe['top-center'].y).toBe(24); expect(safe['canvas-left'].x).toBe(30);
    expect(safe['bottom-center'].y + safe['bottom-center'].h).toBe(600 - 34 - 280);
    expect(plain['bottom-center'].y + plain['bottom-center'].h).toBe(600 - 8);
  });
  it('reservedFrom measures the edge each control reaches; hidden ones (zero size) reserve nothing', () => {
    const c: Rect = { x: 100, y: 50, w: 700, h: 500 };
    const r = reservedFrom(c, [
      { side: 'left', rect: { x: 100, y: 60, w: 50, h: 400 } },
      { side: 'left', rect: { x: 100, y: 60, w: 0, h: 0 } },
      { side: 'right', rect: { x: 700, y: 100, w: 90, h: 100 } },
      { side: 'right-bottom', rect: { x: 540, y: 400, w: 250, h: 100 } },
    ]);
    expect(r).toEqual({ left: 58, right: 108, rightBottom: 268, bottom: 0 });
    expect(reservedFrom(c, [])).toEqual({ left: 0, right: 0, rightBottom: 0, bottom: 0 });
    // a wide strip along the bottom (the phone's sketch strip) reserves the bottom, not the right edge
    expect(reservedFrom(c, [{ side: 'right-bottom', rect: { x: 108, y: 440, w: 684, h: 60 } }])).toEqual({ left: 0, right: 0, rightBottom: 0, bottom: 118 });
  });
  it('right controls that reach down into the bottom stack are avoided by it', () => {
    const rect = (y: number): Rect => ({ x: 700, y, w: 90, h: 100 });
    expect(lowerRight([{ side: 'right', rect: rect(10) }], 400)).toEqual([]);
    expect(lowerRight([{ side: 'right', rect: rect(350) }, { side: 'left', rect: rect(350) }], 400).length).toBe(1);
  });
  it('the keyboard overlap is what lies below the visual viewport', () => {
    const c: Rect = { x: 0, y: 40, w: 800, h: 700 };
    expect(keyboardOverlap(c, null)).toBe(0);
    expect(keyboardOverlap(c, { height: 900, offsetTop: 0 })).toBe(0);
    expect(keyboardOverlap(c, { height: 500, offsetTop: 0 })).toBe(240);
  });
  it('rectsIntersect ignores shared edges', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });
});

describe('toast queue', () => {
  const n = (id: number, text: string, level = 'info', at = 1000): ToastEntry => ({ id, text, level, at });
  it('shows at most N, queues the rest and shows them as the earlier ones expire', () => {
    const list = [n(1, 'a'), n(2, 'b'), n(3, 'c'), n(4, 'd'), n(5, 'e')];
    const t0 = visibleToasts(list, 1100, { max: 3 });
    expect(t0.shown.map((x) => x.text)).toEqual(['a', 'b', 'c']); expect(t0.queued).toBe(2);
    expect(visibleToasts(list, 5000).shown).toEqual([]);   // all expired
  });
  it('merges identical messages into one with a count (an action toast is never merged)', () => {
    const t = visibleToasts([n(1, 'Saved'), n(2, 'Saved'), n(3, 'Saved'), n(4, 'Other')], 1100);
    expect(t.shown.map((x) => [x.text, x.count])).toEqual([['Saved', 3], ['Other', 1]]);
    const act = { label: 'Undo', run() {} };
    expect(visibleToasts([{ ...n(1, 'Deleted'), action: act }, { ...n(2, 'Deleted'), action: act }], 1100).shown.length).toBe(2);
  });
  it('errors jump the queue and last longer than info', () => {
    const list = [n(1, 'a'), n(2, 'b'), n(3, 'c'), n(4, 'd'), n(5, 'boom', 'error')];
    expect(visibleToasts(list, 1100, { max: 3 }).shown.map((x) => x.text)).toContain('boom');
    expect(visibleToasts([n(1, 'x', 'error')], 1000 + 5000).shown.length).toBe(1);
    expect(visibleToasts([n(1, 'x', 'info')], 1000 + 5000).shown.length).toBe(0);
  });
  it('dismissed and already-seen notices do not show', () => {
    expect(visibleToasts([n(1, 'a'), n(2, 'b')], 1100, { dismissed: new Set([1]) }).shown.map((x) => x.text)).toEqual(['b']);
    expect(visibleToasts([n(1, 'a'), n(2, 'b')], 1100, { since: 1 }).shown.map((x) => x.text)).toEqual(['b']);
  });
});
