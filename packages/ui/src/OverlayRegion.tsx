import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { keyboardOverlap, lowerRight, reservedFrom, type Rect } from './overlayLayout';

/** The one overlay layer over the canvas. Everything that floats over the model and is not tied to a spot on the geometry goes into a named region, where items STACK
 *  instead of overlapping (geometry: overlayLayout.ts, tested):
 *    top      notices, busy and plane-pick pills, selection modes, the sketch bar   (stacks downward, between the left and right controls)
 *    bottom   toasts, hints, the start card, then the status readouts               (stacks upward from the bottom edge, above the keyboard)
 *  The controls fixed at the canvas edges (the undo card and tool column on the left, the view cube and Display on the right) mark themselves with `data-ovr-reserve`
 *  ("left", "right" or "right-bottom"); the host measures them (also while they animate or the window changes) and publishes how far they reach as CSS variables on the
 *  canvas: --ovr-left, --ovr-right, --ovr-right-b, and --ovr-kb for the on-screen keyboard, which the regions and the panels that avoid the controls read.
 *  Safe-area insets come from env(safe-area-inset-*) in the stylesheet. Docked panels need nothing: the canvas itself is the space beside them. */
export function OverlayHost(p: { top?: ComponentChildren; bottom?: ComponentChildren; status?: ComponentChildren }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current, vp = el?.parentElement;
    if (!el || !vp) return;
    const win = vp.ownerDocument.defaultView!;
    let raf = 0; const timers: number[] = [];
    const measure = () => {
      const vr = vp.getBoundingClientRect();
      const canvas: Rect = { x: vr.x, y: vr.y, w: vr.width, h: vr.height };
      const items = [...vp.querySelectorAll<HTMLElement>('[data-ovr-reserve]')].filter((e) => e.getClientRects().length > 0 && win.getComputedStyle(e).visibility !== 'hidden').map((e) => {
        const r = e.getBoundingClientRect();
        return { side: (e.dataset.ovrReserve ?? 'left') as 'left' | 'right' | 'right-bottom' | 'bottom', rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
      });
      let res = reservedFrom(canvas, items);
      // the bottom stack avoids right-edge controls that reach down to it (measured with the stack as it is now; the second pass settles after it narrows)
      const bottomEl = vp.querySelector<HTMLElement>('.ovr-bottom');
      if (bottomEl) for (let pass = 0; pass < 2; pass++) {
        const bt = bottomEl.getBoundingClientRect();
        if (bt.height > 0) res = reservedFrom(canvas, [...items, ...lowerRight(items, bt.top)]);
        const s = `${Math.round(res.rightBottom)}px`; if (vp.style.getPropertyValue('--ovr-right-b') !== s) vp.style.setProperty('--ovr-right-b', s);
      }
      const kb = keyboardOverlap(canvas, win.visualViewport);
      const set = (k: string, v: number) => { const s = `${Math.round(v)}px`; if (vp.style.getPropertyValue(k) !== s) vp.style.setProperty(k, s); };
      set('--ovr-bottom', res.bottom); set('--ovr-left', res.left); set('--ovr-right', res.right); set('--ovr-right-b', res.rightBottom); set('--ovr-kb', kb);
    };
    // measure after the layout settles, and again while an animation (the panel folding, the column narrowing) moves the controls
    const soon = () => { win.cancelAnimationFrame(raf); raf = win.requestAnimationFrame(measure); for (const t of timers.splice(0)) win.clearTimeout(t); for (const ms of [120, 300, 600]) timers.push(win.setTimeout(measure, ms)); };
    measure();
    const ro = new ResizeObserver(soon); ro.observe(vp);
    const mo = new MutationObserver(soon); mo.observe(vp.ownerDocument.getElementById('app') ?? vp, { attributes: true, subtree: true, childList: true, attributeFilter: ['class', 'data-lcol', 'data-left', 'data-rail', 'data-railmode', 'data-ovr-reserve', 'style', 'hidden'] });
    win.addEventListener('resize', soon);
    win.visualViewport?.addEventListener('resize', soon); win.visualViewport?.addEventListener('scroll', soon);
    vp.addEventListener('transitionend', soon);
    return () => {
      ro.disconnect(); mo.disconnect(); win.cancelAnimationFrame(raf); for (const t of timers) win.clearTimeout(t);
      win.removeEventListener('resize', soon);
      win.visualViewport?.removeEventListener('resize', soon); win.visualViewport?.removeEventListener('scroll', soon);
      vp.removeEventListener('transitionend', soon);
    };
  }, []);
  return (
    <div class="ovr-host" ref={host} data-testid="overlay-host">
      <div class="ovr-region ovr-top" data-region="top-center">{p.top}</div>
      <div class="ovr-bottom">
        <div class="ovr-region ovr-bottom-center" data-region="bottom-center">{p.bottom}</div>
        <div class="ovr-region ovr-bottom-left" data-region="bottom-left">{p.status}</div>
      </div>
    </div>
  );
}
