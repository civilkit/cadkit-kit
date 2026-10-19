import type { JSX } from 'preact';
import { render } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons';
import { Tip } from './Tip';
import { t } from './i18n';

/** One entry of a slot: a command or a sketch tool, reduced to what a button needs. */
export interface SlotItem { id: string; label: string; keys?: string; tip?: string; icon?: string; /** Why the item is disabled right now; the tooltip says so while it is. */ why?(): string | undefined; enabled?(): boolean; pressed?(): boolean; run(): void }

export type SlotSide = 'bottom' | 'right' | 'left';

/** Which item of a group each slot last ran, shared by every surface that shows the same slot (the ribbon, the tool
 *  palette) and kept in localStorage. Exported so tests can reset it. */
const LAST_KEY = 'kit.slotLast';
const listeners = new Set<() => void>();
let last: Record<string, string> | null = null;
const load = (): Record<string, string> => {
  if (!last) { try { last = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Record<string, string>; } catch { last = {}; } }
  return last!;
};
export const slotMemory = {
  get: (slot: string): string | undefined => load()[slot],
  set(slot: string, item: string): void {
    if (load()[slot] === item) return;
    last = { ...load(), [slot]: item };
    try { localStorage.setItem(LAST_KEY, JSON.stringify(last)); } catch { /* private window */ }
    listeners.forEach((f) => f());
  },
  reset(): void { last = {}; listeners.forEach((f) => f()); },
};

const isOn = (x: SlotItem) => x.enabled?.() ?? true;

/** The item a slot's button shows and runs: the pressed one (its tool is active), else the one used last, else the first. */
export function shownItem(items: SlotItem[], lastId: string | undefined, menu?: boolean): SlotItem {
  return (menu ? undefined : items.find((x) => x.pressed?.())) ?? items.find((x) => x.id === lastId) ?? items[0];
}

export interface SlotProps {
  /** Memory key: the same id in two places shares the last-used tool. */
  id: string;
  items: SlotItem[];
  /** Button shape: `ribbon` (a tall button, optional label under the icon), `icon` (a square), `rail` (the palette cell). */
  variant: 'ribbon' | 'icon' | 'rail';
  /** Ribbon: write the name under the icon. */
  labels?: boolean;
  /** Label to draw under the icon instead of the shown item's (a shorter name). */
  caption?: (x: SlotItem) => string;
  side?: SlotSide;
  /** The button opens the list instead of running an item (a list of toggles or of choices). */
  menu?: boolean;
  /** The items are choices of one setting: the button shows the chosen one but is not drawn as pressed. */
  radio?: boolean;
  /** Keep the list open after an item runs (toggles). */
  keepOpen?: boolean;
  /** In a menu slot, the icon and name of the button itself. */
  icon?: string;
  title?: string;
  /** Extra class on the wrapper (a rail slot that is contextual, etc.). */
  class?: string;
}

/** A grouped split button in the Plasticity style: a slot shows one tool (the one used last) with a small corner
 *  triangle when the slot holds more; a long press, a flick towards the list, a right click or a click on the triangle opens
 *  the list of all its tools with their names and keys. Used for the ribbon groups, the tool palette and the sketch palette. */
export function Slot(p: SlotProps): JSX.Element | null {
  return p.items.length ? <SlotCell {...p} /> : null;
}

function SlotCell(p: SlotProps): JSX.Element {
  const [, setTick] = useState(0);
  const bump = useRef(() => setTick((n) => n + 1)).current;
  useEffect(() => { listeners.add(bump); return () => { listeners.delete(bump); }; }, []);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left?: number; right?: number; top: number }>({ top: 0 });
  const box = useRef<HTMLDivElement>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const side = p.side ?? 'bottom';
  const items = p.items;
  const multi = items.length > 1 || !!p.menu;
  const shown = shownItem(items, slotMemory.get(p.id), p.menu);
  const on = p.menu ? items.some(isOn) : isOn(shown);
  const pressed = p.menu || p.radio ? undefined : shown.pressed?.();

  const openFlyout = () => {
    const r = box.current?.getBoundingClientRect();
    if (r) setPos(side === 'right' ? { left: r.right + 6, top: r.top } : side === 'left' ? { right: Math.max(8, window.innerWidth - r.left + 6), top: r.top } : { left: r.left, top: r.bottom + 4 });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!(e.target as Element | null)?.closest?.('.slot-flyout, .slot')) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', key); };
  }, [open]);

  const run = (x: SlotItem) => {
    if (!p.keepOpen) setOpen(false);
    if (!p.menu) slotMemory.set(p.id, x.id);
    x.run();
    if (p.keepOpen) bump();
  };
  const cancelHold = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };
  const flicked = (e: PointerEvent) => {
    const s = start.current;
    if (!s) return false;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    return side === 'right' ? dx > 12 : side === 'left' ? -dx > 12 : dy > 12;
  };
  const name = p.menu ? (p.title ?? shown.label) : shown.label;
  const iconName = p.menu ? (p.icon ?? shown.icon ?? shown.id) : (shown.icon ?? shown.id);
  const size = p.variant === 'ribbon' ? (p.labels ? 22 : 20) : 20;
  const text = p.labels ? (p.menu ? (p.title ?? '') : (p.caption ? p.caption(shown) : shown.label)) : null;

  const flyout = open ? (
        <div class="slot-flyout" role="menu" aria-label={name} style={{ ...(pos.left !== undefined ? { left: pos.left + 'px' } : {}), ...(pos.right !== undefined ? { right: pos.right + 'px' } : {}), top: pos.top + 'px' }}>
          {items.map((x) => {
            const dis = !isOn(x);
            const pr = x.pressed?.();
            return (
              <button key={x.id} class={'slot-row' + (x === shown && !p.menu ? ' shown' : '')} role={p.keepOpen ? 'menuitemcheckbox' : 'menuitem'} aria-label={x.label} aria-checked={p.keepOpen || pr !== undefined ? !!pr : undefined} aria-pressed={undefined} disabled={dis} onClick={() => run(x)}>
                <Icon name={x.icon ?? x.id} size={18} />
                <span class="slot-name">{x.label}</span>
                {x.keys ? <kbd>{x.keys}</kbd> : <span />}
                <span class={'slot-check' + (pr ? ' on' : '')} aria-hidden="true">{pr ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>
  ) : null;
  // drawn on a host element on the body (a hand-made portal: preact/compat would remap change and focus events for the whole app)
  const host = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!flyout) return;
    const h = (host.current ??= document.createElement('div'));
    document.body.appendChild(h);
    render(flyout, h);
    const el = h.firstElementChild as HTMLElement | null;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.bottom > window.innerHeight - 8) el.style.top = Math.max(8, window.innerHeight - 8 - r.height) + 'px';
      if (r.right > window.innerWidth - 8) { el.style.left = Math.max(8, window.innerWidth - 8 - r.width) + 'px'; el.style.right = 'auto'; }
    }
    return () => { render(null, h); h.remove(); };
  });

  return (
    <div class={'slot ' + p.variant + (multi ? ' multi' : '') + (p.class ? ' ' + p.class : '')} data-side={side} data-slot={p.id} ref={box}>
      <Tip label={name} keys={p.menu ? undefined : shown.keys} hint={p.menu ? undefined : on ? shown.tip : shown.why?.() ?? t('ui.slot.unavailable')} side={side === 'bottom' ? 'bottom' : side === 'right' ? 'right' : 'left'}>
        <button
          class={'slot-btn' + (p.variant === 'ribbon' ? ' rb-btn' : ' stool') + (p.labels ? ' has-label' : ' icon-only')}
          disabled={!on}
          aria-pressed={pressed}
          aria-label={name}
          aria-haspopup={multi ? 'true' : undefined}
          aria-expanded={multi ? open : undefined}
          onPointerDown={(e) => {
            held.current = false;
            start.current = { x: (e as PointerEvent).clientX, y: (e as PointerEvent).clientY };
            if (multi && !p.menu) hold.current = setTimeout(() => { held.current = true; openFlyout(); }, 380);
          }}
          // a flick towards the list opens it at once (the touch way: no waiting for a long press)
          onPointerMove={(e) => { if (multi && hold.current && flicked(e as PointerEvent)) { cancelHold(); held.current = true; openFlyout(); } }}
          onPointerUp={() => { cancelHold(); start.current = null; }}
          onPointerCancel={() => { cancelHold(); start.current = null; }}
          onPointerLeave={cancelHold}
          onContextMenu={(e) => { if (multi) { e.preventDefault(); openFlyout(); } }}
          onClick={() => {
            if (held.current) { held.current = false; return; }
            if (p.menu) { if (open) setOpen(false); else openFlyout(); return; }
            run(shown);
          }}
        >
          <Icon name={iconName} size={size} />
          {text ? <span class="slot-lab">{text}</span> : null}
        </button>
      </Tip>
      {multi && !p.menu ? (
        <button class="slot-more" tabIndex={-1} disabled={!items.some(isOn)} aria-label={t('ui.slot.more', { name: items[0].label })} onClick={(e) => { e.stopPropagation(); if (open) setOpen(false); else openFlyout(); }} />
      ) : null}
      {multi && p.menu ? <span class="slot-more-mark" aria-hidden="true" /> : null}
    </div>
  );
}
