import { cloneElement, render, type VNode } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export type TipSide = 'top' | 'bottom' | 'left' | 'right';
const GAP = 7, EDGE = 4, TOUCH_MS = 2200;
let seq = 0;

/** Where a tooltip of size w x h goes next to the anchor rect: the preferred side if it fits, then the opposite,
 *  then the other two, else the preferred side pushed back inside the viewport. Exported for tests. */
export function placeTip(a: { left: number; top: number; right: number; bottom: number }, w: number, h: number, vw: number, vh: number, prefer: TipSide): { x: number; y: number; side: TipSide } {
  const at = (s: TipSide) => {
    const cx = (a.left + a.right) / 2 - w / 2, cy = (a.top + a.bottom) / 2 - h / 2;
    return s === 'bottom' ? { x: cx, y: a.bottom + GAP } : s === 'top' ? { x: cx, y: a.top - GAP - h }
      : s === 'right' ? { x: a.right + GAP, y: cy } : { x: a.left - GAP - w, y: cy };
  };
  const opposite: Record<TipSide, TipSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const order: TipSide[] = [prefer, opposite[prefer], ...(['bottom', 'top', 'right', 'left'] as TipSide[]).filter((s) => s !== prefer && s !== opposite[prefer])];
  const clampX = (x: number) => Math.max(EDGE, Math.min(x, vw - w - EDGE));
  const clampY = (y: number) => Math.max(EDGE, Math.min(y, vh - h - EDGE));
  for (const s of order) {
    const p = at(s);
    const fits = p.x >= EDGE && p.y >= EDGE && p.x + w <= vw - EDGE && p.y + h <= vh - EDGE;
    const vertical = s === 'top' || s === 'bottom';
    // Along the side the tip may slide to stay inside the viewport; across it, it must fit.
    const acrossOk = vertical ? p.y >= EDGE && p.y + h <= vh - EDGE : p.x >= EDGE && p.x + w <= vw - EDGE;
    if (fits || acrossOk) return { x: clampX(p.x), y: clampY(p.y), side: s };
  }
  const p = at(prefer);
  return { x: clampX(p.x), y: clampY(p.y), side: prefer };
}

/** Wraps one button (or any focusable element) and shows `label` at once on pointer-enter and keyboard focus, with
 *  the shortcut as a small badge. It hides on leave, blur and Escape, flips to stay inside the viewport, and on touch
 *  appears on tap or long press and goes away by itself. The tooltip is drawn on the page body so a scrolling or
 *  blurred toolbar cannot clip it; the child gets aria-describedby while it shows. */
export function Tip(p: { label: string; keys?: string; hint?: string; side?: TipSide; children: VNode }): VNode {
  const [id] = useState(() => 'tip-' + ++seq);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [touch, setTouch] = useState(false);
  const clicked = useRef(false);
  const timers = useRef<{ press?: ReturnType<typeof setTimeout>; hide?: ReturnType<typeof setTimeout> }>({});
  const shown = !!p.label && (hover || focus || touch);

  const hideAll = () => { setHover(false); setFocus(false); setTouch(false); };
  useEffect(() => () => { clearTimeout(timers.current.press); clearTimeout(timers.current.hide); }, []);

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hideAll(); };
    const onDown = (e: Event) => { if (touch && anchor && !anchor.contains(e.target as Node)) hideAll(); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown, true); };
  }, [shown, touch, anchor]);

  // The bubble is rendered into a host element on the page body (a hand-made portal: preact/compat would also remap
  // focus and change events), so a scrolling or blurred toolbar cannot clip it. Positioned right after it is drawn.
  const host = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!shown || !anchor) return;
    const h = (host.current ??= document.createElement('div'));
    document.body.appendChild(h);
    render(
      <div id={id} role="tooltip" class="tip" style={{ visibility: 'hidden' }}>
        <span class="tip-label">{p.label}</span>
        {p.keys ? <kbd class="tip-key">{p.keys}</kbd> : null}
        {p.hint ? <span class="tip-hint">{p.hint}</span> : null}
      </div>, h);
    const el = h.firstElementChild as HTMLElement;
    const pos = placeTip(anchor.getBoundingClientRect(), el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight, p.side ?? 'bottom');
    el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px'; el.setAttribute('data-side', pos.side);
    el.style.visibility = 'visible';
    return () => { render(null, h); h.remove(); };
  }, [shown, anchor, p.label, p.keys, p.hint, p.side, id]);

  const child = p.children;
  const cp = (child.props ?? {}) as Record<string, (e: Event) => void> & Record<string, unknown>;
  const call = (name: string, e: Event) => { const f = cp[name]; if (typeof f === 'function') f(e); };
  const showTouch = (el: HTMLElement) => {
    setAnchor(el); setTouch(true);
    clearTimeout(timers.current.hide);
    timers.current.hide = setTimeout(() => setTouch(false), TOUCH_MS);
  };

  const handlers = {
    onPointerEnter: (e: PointerEvent) => {
      call('onPointerEnter', e);
      const el = e.currentTarget as HTMLElement;
      if (e.pointerType === 'touch') showTouch(el); else { setAnchor(el); setHover(true); }
    },
    onPointerLeave: (e: PointerEvent) => { call('onPointerLeave', e); if (e.pointerType !== 'touch') setHover(false); },
    onPointerDown: (e: PointerEvent) => {
      call('onPointerDown', e);
      clicked.current = true;                                           // a focus that follows is from the click, not the keyboard
      if (e.pointerType === 'touch') {
        const el = e.currentTarget as HTMLElement;
        clearTimeout(timers.current.press);
        timers.current.press = setTimeout(() => showTouch(el), 450);   // long press
      }
    },
    onPointerUp: (e: PointerEvent) => { call('onPointerUp', e); clearTimeout(timers.current.press); },
    onPointerCancel: (e: PointerEvent) => { call('onPointerCancel', e); clearTimeout(timers.current.press); },
    onFocus: (e: FocusEvent) => { call('onFocus', e); const el = e.currentTarget as HTMLElement; if (!clicked.current) { setAnchor(el); setFocus(true); } },
    onBlur: (e: FocusEvent) => { call('onBlur', e); clicked.current = false; setFocus(false); },
  };
  const described = shown ? { 'aria-describedby': id } : {};
  return cloneElement(child, { ...handlers, ...described });
}
