// A small card with an arrow that points at the control it is about, closes with its X or Escape, and keeps out of the way of the window edges.
// Reusable: "What's new", a first-use tip, a feature pointer. The caller supplies every string (nothing here is language specific).
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export type CalloutSide = 'top' | 'bottom';
export interface Rect { left: number; top: number; width: number; height: number }

/** Where the card goes: above or below the anchor (the preferred side when it fits, else the other), its arrow under the anchor's middle, and the card kept `margin` inside the window. */
export function placeCallout(anchor: Rect, card: { width: number; height: number }, view: { width: number; height: number }, prefer: CalloutSide = 'top', gap = 10, margin = 8): { left: number; top: number; side: CalloutSide; arrowLeft: number } {
  const fitsTop = anchor.top - gap - card.height >= margin;
  const fitsBottom = anchor.top + anchor.height + gap + card.height <= view.height - margin;
  const side: CalloutSide = prefer === 'top' ? (fitsTop || !fitsBottom ? 'top' : 'bottom') : (fitsBottom || !fitsTop ? 'bottom' : 'top');
  const top = side === 'top' ? Math.max(margin, anchor.top - gap - card.height) : Math.min(view.height - margin - card.height, anchor.top + anchor.height + gap);
  const mid = anchor.left + anchor.width / 2;
  const left = Math.min(Math.max(margin, mid - card.width / 2), Math.max(margin, view.width - margin - card.width));
  const arrowLeft = Math.min(Math.max(16, mid - left), Math.max(16, card.width - 16));
  return { left, top, side, arrowLeft };
}

/** A flyout beside a panel, not over it: to the right of `panel` (top level with it), else to its left, else null when neither side has room (the caller then goes below its icon). */
export function placeBeside(panel: Rect, card: { width: number; height: number }, view: { width: number; height: number }, gap = 10, margin = 8): { left: number; top: number } | null {
  const top = Math.min(Math.max(margin, panel.top), Math.max(margin, view.height - margin - card.height));
  const right = panel.left + panel.width + gap;
  if (right + card.width <= view.width - margin) return { left: right, top };
  const left = panel.left - gap - card.width;
  if (left >= margin) return { left, top };
  return null;
}

export interface CalloutProps {
  /** The element the arrow points at (or a CSS selector for it; the callout waits until it exists). */
  anchor: HTMLElement | string | null;
  title: ComponentChildren;
  /** A small symbol before the title (an SVG Icon; no emoji). */
  icon?: ComponentChildren;
  children?: ComponentChildren;
  /** The one main button ("Done") and an optional second; Escape and the X call onClose. */
  primary?: { label: string; run(): void };
  secondary?: { label: string; run(): void };
  onClose(): void;
  closeLabel: string;
  /** Which side of the anchor it prefers (default: above, so a callout from the status bar rises from the bottom). */
  prefer?: CalloutSide;
  /** Stable name for tests and automation. */
  id?: string;
}

const resolve = (a: HTMLElement | string | null): HTMLElement | null => (typeof a === 'string' ? (typeof document === 'undefined' ? null : document.querySelector<HTMLElement>(a)) : a);

export function Callout(p: CalloutProps) {
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; side: CalloutSide; arrowLeft: number } | null>(null);
  const place = () => {
    const a = resolve(p.anchor), c = card.current;
    if (!a || !c) { setPos((v) => (v === null ? v : null)); return; }
    const r = a.getBoundingClientRect();
    const next = placeCallout({ left: r.left, top: r.top, width: r.width, height: r.height }, { width: c.offsetWidth, height: c.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, p.prefer);
    setPos((v) => (v && v.left === next.left && v.top === next.top && v.side === next.side && v.arrowLeft === next.arrowLeft ? v : next));   // an unchanged place is no re-render
  };
  useLayoutEffect(place, [p.anchor, p.prefer]);
  useEffect(() => {
    // the anchor may appear a moment later (a status bar item that loads): poll only until it exists; after that the place follows the window (resize, scroll)
    const again = () => place();
    window.addEventListener('resize', again);
    window.addEventListener('scroll', again, true);
    const timer = resolve(p.anchor) ? null : setInterval(() => { place(); if (resolve(p.anchor) && timer) clearInterval(timer); }, 500);
    // Escape closes it only when it has the focus, or nothing does (an Escape meant for an open editor or a text box is not ours)
    const esc = (e: KeyboardEvent) => { const ae = document.activeElement; if (e.key === 'Escape' && (!ae || ae === document.body || card.current?.contains(ae))) p.onClose(); };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('resize', again); window.removeEventListener('scroll', again, true); if (timer) clearInterval(timer); window.removeEventListener('keydown', esc); };
  }, [p.anchor, p.onClose]);
  // without an anchor the card is still rendered, hidden: the timer above places it as soon as the anchor exists (a status bar item that loads late)
  return (
    <div ref={card} class={'callout' + (pos ? ' callout-' + pos.side : ' callout-hidden')} role="dialog" aria-label={typeof p.title === 'string' ? p.title : undefined} data-callout={p.id}
      style={{ position: 'fixed', ...(pos ? { left: pos.left + 'px', top: pos.top + 'px', ['--arrow-left' as never]: pos.arrowLeft + 'px' } : { left: '0px', top: '0px' }) }}>   {/* fixed even if no stylesheet reached it: a callout never takes layout space */}
      <button type="button" class="callout-x" aria-label={p.closeLabel} onClick={p.onClose}>×</button>
      <h3 class="callout-title">{p.icon ? <span class="callout-icon" aria-hidden="true">{p.icon}</span> : null}{p.title}</h3>
      <div class="callout-body">{p.children}</div>
      {p.primary || p.secondary ? (
        <div class="callout-actions">
          {p.secondary ? <button type="button" class="btn callout-secondary" onClick={p.secondary.run}>{p.secondary.label}</button> : null}
          {p.primary ? <button type="button" class="btn primary callout-primary" onClick={p.primary.run}>{p.primary.label}</button> : null}
        </div>
      ) : null}
    </div>
  );
}
