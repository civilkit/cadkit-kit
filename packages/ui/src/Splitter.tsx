import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';

/** What a drag or key press asks for: a size in px, or 0 for "collapse the panel". */
export interface DragLimits { min: number; max: number; collapsible?: boolean }

/** Pure drag maths. `start` is the size when the drag began (0 when the panel was collapsed), `delta` the pointer travel along the
 *  axis, `grow` +1 when moving right/down grows the panel and -1 when it shrinks it. Past the minimum a collapsible panel snaps shut
 *  (48px beyond min, or less than half of min when opening from collapsed). */
export function resolveDrag(start: number, delta: number, grow: 1 | -1, lim: DragLimits): number {
  const max = Math.max(lim.min, lim.max);
  const raw = start + grow * delta;
  if (lim.collapsible) {
    if (start === 0 ? raw < lim.min / 2 : raw < lim.min - 48) return 0;
  }
  return Math.min(max, Math.max(lim.min, raw));
}

export interface SplitterProps {
  /** 'vertical': a vertical bar between side-by-side panes (drag left/right, col-resize); 'horizontal': a bar above/below (row-resize). */
  orientation: 'vertical' | 'horizontal';
  /** Current committed size in px; 0 while collapsed. */
  value: number;
  min: number;
  max: number | (() => number);
  /** Size restored by Enter or a double click. */
  def: number;
  grow: 1 | -1;
  collapsible?: boolean;
  /** Called on every drag step with the size (0 = collapse preview). Update CSS directly here, not state. */
  onLive?(v: number): void;
  /** Called once when a drag ends or a key changes the size (0 = collapse). */
  onCommit(v: number): void;
  /** Called after a drag ends, committed or cancelled: drop any inline overrides set by onLive. */
  onEnd?(): void;
  label: string;
  class?: string;
}

const STEP = 16, BIG = 64;

/** A draggable, keyboard-operable divider (role=separator). Arrow keys move 16px, Shift+arrow 64px, Home/End jump to min/max,
 *  Enter or double click resets. The hit area is 8px; the visible line is 1px and lights up on hover and while dragging. */
export function Splitter(p: SplitterProps): JSX.Element {
  const drag = useRef<{ id: number; from: number; start: number; last: number } | null>(null);
  const maxNow = () => (typeof p.max === 'function' ? p.max() : p.max);
  const lim = (): DragLimits => ({ min: p.min, max: maxNow(), collapsible: p.collapsible });
  const vert = p.orientation === 'vertical';
  const pos = (e: { clientX: number; clientY: number }) => (vert ? e.clientX : e.clientY);
  const setBusy = (on: boolean) => { try { if (on) document.documentElement.setAttribute('data-resizing', p.orientation); else document.documentElement.removeAttribute('data-resizing'); } catch { /* no document */ } };

  const onDown = (e: PointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    try { el.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
    drag.current = { id: e.pointerId, from: pos(e), start: p.value, last: p.value };
    setBusy(true);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    d.last = resolveDrag(d.start, pos(e) - d.from, p.grow, lim());
    p.onLive?.(d.last);
  };
  const end = (e: PointerEvent, cancel: boolean) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    setBusy(false);
    try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch { /* already released */ }
    if (cancel) p.onLive?.(d.start);
    else if (d.last !== d.start) p.onCommit(d.last);
    else p.onLive?.(d.start);
    p.onEnd?.();
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? BIG : STEP;
    const l = lim();
    const cur = p.value;
    let next: number | null = null;
    const dir = vert ? { ArrowLeft: -1, ArrowRight: 1 }[e.key] : { ArrowUp: -1, ArrowDown: 1 }[e.key];
    if (dir !== undefined) next = (cur === 0 && p.grow * dir > 0 ? l.min : cur + p.grow * dir * step);
    else if (e.key === 'Home') next = l.min;
    else if (e.key === 'End') next = l.max;
    else if (e.key === 'Enter') next = p.def;
    if (next === null) return;
    e.preventDefault();
    if (dir !== undefined && cur === 0 && p.grow * dir < 0) return;
    next = Math.min(Math.max(l.min, l.max), Math.max(l.min, next));
    if (next !== cur) p.onCommit(next);
  };
  const reset = () => { if (p.value !== p.def) p.onCommit(p.def); };

  return (
    <div role="separator" tabIndex={0} class={'splitter ' + (vert ? 'sp-v ' : 'sp-h ') + (p.value === 0 ? 'sp-collapsed ' : '') + (p.class ?? '')}
      aria-orientation={vert ? 'vertical' : 'horizontal'} aria-label={p.label}
      aria-valuenow={Math.round(p.value)} aria-valuemin={p.min} aria-valuemax={Math.round(maxNow())}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={(e) => end(e, false)} onPointerCancel={(e) => end(e, true)}
      onKeyDown={onKey} onDblClick={reset} />
  );
}

/** A two-axis grip (the bottom-right corner of a floating panel). Reports width and height; the panel decides what 0 means. */
export function CornerGrip(p: {
  size(): [number, number]; min: [number, number]; max: () => [number, number];
  onLive?(w: number, h: number): void; onCommit(w: number, h: number): void; onReset?(): void; label: string;
}): JSX.Element {
  const drag = useRef<{ id: number; x: number; y: number; w: number; h: number; lw: number; lh: number } | null>(null);
  const clampWH = (w: number, h: number): [number, number] => { const m = p.max(); return [Math.min(Math.max(p.min[0], m[0]), Math.max(p.min[0], w)), Math.min(Math.max(p.min[1], m[1]), Math.max(p.min[1], h))]; };
  return (
    <div class="splitter sp-corner" role="separator" tabIndex={0} aria-label={p.label}
      onPointerDown={(e) => {
        try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* synthetic */ }
        const [w0, h0] = p.size();
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, w: w0, h: h0, lw: w0, lh: h0 };
        document.documentElement.setAttribute('data-resizing', 'corner'); e.preventDefault();
        e.stopPropagation();
      }}
      onPointerMove={(e) => { const d = drag.current; if (!d || d.id !== e.pointerId) return; [d.lw, d.lh] = clampWH(d.w + e.clientX - d.x, d.h + e.clientY - d.y); p.onLive?.(d.lw, d.lh); }}
      onPointerUp={(e) => { const d = drag.current; if (!d || d.id !== e.pointerId) return; drag.current = null; document.documentElement.removeAttribute('data-resizing'); p.onCommit(d.lw, d.lh); }}
      onPointerCancel={(e) => { const d = drag.current; if (!d || d.id !== e.pointerId) return; drag.current = null; document.documentElement.removeAttribute('data-resizing'); p.onLive?.(d.w, d.h); }}
      onKeyDown={(e) => {
        const s = e.shiftKey ? BIG : STEP;
        const d = ({ ArrowRight: [s, 0], ArrowLeft: [-s, 0], ArrowDown: [0, s], ArrowUp: [0, -s] } as Record<string, [number, number]>)[e.key];
        if (e.key === 'Enter') { e.preventDefault(); p.onReset?.(); return; }
        if (!d) return;
        e.preventDefault();
        const [w0, h0] = p.size();
        const [w, h] = clampWH(w0 + d[0], h0 + d[1]);
        p.onCommit(w, h);
      }}
      onDblClick={() => p.onReset?.()} />
  );
}
