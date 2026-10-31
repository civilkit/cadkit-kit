import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { t } from './i18n';

/** Where a sheet rests: a third of the screen, a little over half, or nearly all of it. */
export type SheetSnap = 'peek' | 'half' | 'full';
export const SHEET_SNAPS: SheetSnap[] = ['peek', 'half', 'full'];
/** Share of the available height each snap takes, and the least a sheet leaves free above it (px). */
export const SNAP_FRACTION: Record<SheetSnap, number> = { peek: 0.32, half: 0.55, full: 0.9 };
const TOP_GAP = 8;
/** A release faster than this (px per ms) is a flick: it moves to the next snap in its direction, wherever it was let go. */
const FLICK = 0.5;

/** Heights (px) of the three snaps in `avail` px of room. */
export function snapHeights(avail: number, fr: Record<SheetSnap, number> = SNAP_FRACTION): Record<SheetSnap, number> {
  const room = Math.max(0, avail - TOP_GAP);
  return { peek: Math.round(room * fr.peek), half: Math.round(room * fr.half), full: Math.round(room * fr.full) };
}
/** Snaps of a sheet that shares the screen with the canvas (docked): it never takes more than 60% while a value is edited, so the model stays in view;
 *  a browse list (tree, diagnostics) may still rise to nearly the whole screen. */
export const SPLIT_FRACTION: Record<SheetSnap, number> = { peek: 0.18, half: 0.38, full: 0.6 };
export const BROWSE_FRACTION: Record<SheetSnap, number> = { peek: 0.2, half: 0.45, full: 0.9 };

/** Where a dragged sheet settles when let go at height `h` moving at `vy` (px per ms, positive = down): a snap, or 'close' when
 *  it is pulled well under the lowest snap or flicked down from it. */
export function settleSnap(hs: Record<SheetSnap, number>, h: number, vy = 0): SheetSnap | 'close' {
  if (Math.abs(vy) > FLICK) {
    if (vy > 0) { const below = [...SHEET_SNAPS].reverse().find((s) => hs[s] < h - 1); return below ?? 'close'; }
    return SHEET_SNAPS.find((s) => hs[s] > h + 1) ?? 'full';
  }
  if (h < hs.peek * 0.6) return 'close';
  return SHEET_SNAPS.reduce((best, s) => (Math.abs(hs[s] - h) < Math.abs(hs[best] - h) ? s : best), 'peek' as SheetSnap);
}

export interface SheetProps {
  open: boolean;
  onClose(): void;
  title: string;
  snap: SheetSnap;
  onSnap(s: SheetSnap): void;
  /** A scrim behind the sheet that closes it when tapped. Without it the page above the sheet stays usable (the app turns it on at the full snap). */
  modal?: boolean;
  /** Space (px) the sheet leaves free at the bottom, e.g. a navigation bar; the sheet's snaps are measured above it. */
  bottom?: number;
  /** The sheet takes its own place in the page layout (it is not laid over the canvas): the canvas resizes to what is left above it.
   *  Its snaps are shares of the whole screen height (`fractions`), and nothing darkens the canvas unless `modal`. */
  docked?: boolean;
  fractions?: Record<SheetSnap, number>;
  class?: string;
  children?: ComponentChildren;
}

/** A panel that rises from the bottom edge: a drag handle that moves it between snap heights, a title and a close button.
 *  It stays clear of the home indicator (safe area) and of the on-screen keyboard (CSS variables `--kb-inset`, `--vvh`).
 *  Escape closes it; with `modal`, so does a tap outside. */
export function Sheet(p: SheetProps): JSX.Element | null {
  const el = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; h: number; cur: number; last: number; at: number; vy: number; id: number } | null>(null);
  const avail = () => (typeof window === 'undefined' ? 800 : (window.visualViewport?.height ?? window.innerHeight)) - (p.docked ? 0 : (p.bottom ?? 0));
  const heights = () => snapHeights(avail(), p.fractions ?? (p.docked ? SPLIT_FRACTION : SNAP_FRACTION));

  useEffect(() => {
    if (!p.open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [p.open, p.onClose]);

  if (!p.open) return null;

  const down = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button') || !el.current) return;
    const h0 = parseFloat(el.current.style.height) || el.current.offsetHeight;
    drag.current = { y: e.clientY, h: h0, cur: h0, last: e.clientY, at: e.timeStamp, vy: 0, id: e.pointerId };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic events have no active pointer */ }
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || !el.current) return;
    const dt = Math.max(1, e.timeStamp - d.at);
    d.vy = 0.6 * d.vy + 0.4 * ((e.clientY - d.last) / dt);   // smoothed, so one jittery sample is not a flick
    d.last = e.clientY; d.at = e.timeStamp;
    d.cur = Math.max(0, Math.min(d.h - (e.clientY - d.y), heights().full));
    el.current.style.height = `${d.cur}px`;
  };
  const end = (e: PointerEvent, cancelled: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !el.current) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(d.id); } catch { /* not captured */ }
    const to = cancelled || Math.abs(e.clientY - d.y) < 4 ? p.snap : settleSnap(heights(), d.cur, d.vy);   // a cancelled drag or a tap on the handle changes nothing
    if (to === 'close') { p.onClose(); return; }
    el.current.style.height = `${heights()[to]}px`;   // the drag set the height by hand; Preact only rewrites it when the snap changes
    if (to !== p.snap) p.onSnap(to);
  };
  const keys = (e: KeyboardEvent) => {
    const i = SHEET_SNAPS.indexOf(p.snap);
    if (e.key === 'ArrowUp') { e.preventDefault(); p.onSnap(SHEET_SNAPS[Math.min(2, i + 1)]!); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (i === 0) p.onClose(); else p.onSnap(SHEET_SNAPS[i - 1]!); }
  };

  const h = heights();
  return (
    <>
      {p.modal ? <div class="sheet-scrim" data-testid="sheet-scrim" onPointerDown={p.onClose} /> : null}
      <section ref={el} class={'sheet' + (p.docked ? ' docked' : '') + (p.class ? ' ' + p.class : '')} role="dialog" aria-label={p.title} data-snap={p.snap}
        style={{ height: `${h[p.snap]}px`, ...(p.bottom && !p.docked ? { '--sheet-bottom': `${p.bottom}px` } : {}) }}>
        <div class="sheet-head" onPointerDown={down} onPointerMove={move} onPointerUp={(e) => end(e, false)} onPointerCancel={(e) => end(e, true)}>
          <div class="sheet-grip" role="separator" aria-orientation="horizontal" aria-label={t('ui.sheet.resize')} aria-valuemin={0} aria-valuemax={2} aria-valuenow={SHEET_SNAPS.indexOf(p.snap)} tabIndex={0} onKeyDown={keys} />
          <b class="sheet-title">{p.title}</b>
          <button class="sheet-close" aria-label={t('ui.sheet.close')} onClick={p.onClose}>{'✕'}</button>
        </div>
        <div class="sheet-body">{p.children}</div>
      </section>
    </>
  );
}

export interface NavItem { id: string; label: string; icon: ComponentChildren; badge?: number; bad?: boolean; pressed?: boolean; disabled?: boolean }

/** The bar along the bottom edge of a phone: one button per sheet. Safe-area aware; the pressed one is the sheet that is open. */
export function BottomNav(p: { items: NavItem[]; onPick(id: string): void; label?: string }): JSX.Element {
  return (
    <nav class="bottom-nav" aria-label={p.label ?? t('ui.nav.label')}>
      {p.items.map((it) => (
        <button key={it.id} class="bn-btn" aria-pressed={!!it.pressed} disabled={it.disabled} data-nav={it.id} onClick={() => p.onPick(it.id)}>
          <span class="bn-icon">{it.icon}{it.badge ? <span class={'bn-badge' + (it.bad ? ' bad' : '')}>{it.badge}</span> : null}</span>
          <span class="bn-label">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
