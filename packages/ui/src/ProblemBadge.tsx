// The one place an editor says what is wrong: a small alert icon beside the title, a count when there are several causes, a "checking" state while the kernel is
// still answering. Mouse: hover or keyboard focus opens the popover. Touch: a tap opens it and it stays until Close, Escape or a tap outside. The popover lists each
// problem as one cause sentence and one action sentence, keeps inside the window (placeCallout), and a polite live region announces changes.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { render, type ComponentChildren } from 'preact';
import { Icon } from './icons';
import { placeBeside, placeCallout } from './Callout';

export interface Problem {
  /** stable key (the feature and code), so a re-render does not reopen or reorder */
  id: string;
  /** one plain sentence: what is wrong */
  cause: string;
  /** one plain sentence: what to do (may be empty) */
  action?: string;
  /** the long form, collapsed: the code, the feature name, anything for a bug report */
  details?: string;
}

export interface ProblemBadgeProps {
  problems: readonly Problem[];
  /** the kernel is still answering: show "checking" instead of the last answer */
  checking?: boolean;
  /** text, all supplied by the caller */
  label: { problems(n: number): string; checking: string; close: string; details: string; announce(n: number): string };
  /** an id for aria-describedby of the title */
  popoverId?: string;
  /** Raised by the caller (the greyed confirm button was clicked): opens the popover and keeps it open. */
  openSignal?: number;
}

/** Draws `children` into a node on document.body (so no ancestor's overflow, transform or stacking context can clip a popover). Plain preact render: preact/compat is not
 *  used because importing it changes event handling for the whole app. Events inside are ordinary DOM events on the real nodes. */
function BodyPortal(p: { children: ComponentChildren }) {
  const host = useRef<HTMLDivElement | null>(null);
  // drawn from an effect, never during this component's own render (a nested render would corrupt the hook state)
  useLayoutEffect(() => {
    if (!host.current) { host.current = document.createElement('div'); document.body.appendChild(host.current); }
    render(p.children as never, host.current);
  });
  useEffect(() => () => { if (host.current) { render(null, host.current); host.current.remove(); host.current = null; } }, []);
  return null;
}

/** Whether the main input is touch: a tap is then the only way to open it (no hover). */
const coarse = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

export function ProblemBadge(p: ProblemBadgeProps) {
  const [hover, setHoverNow] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Opening is immediate; closing waits a moment, so the pointer can cross the gap onto the popover (to read it, scroll it, select its text). */
  const setHover = (v: boolean) => { if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; } if (v) setHoverNow(true); else leaveTimer.current = setTimeout(() => setHoverNow(false), 180); };
  const hide = () => { if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; } setPinned(false); setHoverNow(false); };
  useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; arrowLeft: number } | null>(null);
  const skipFocus = useRef(false);
  const refocus = () => { skipFocus.current = true; btn.current?.focus(); skipFocus.current = false; };   // giving the button focus back must not open the popover again
  const btn = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null), root = useRef<HTMLSpanElement>(null);
  const n = p.problems.length;
  const open = (hover || pinned) && (n > 0 || !!p.checking);
  const id = p.popoverId ?? 'fedit-problem';
  const tapped = useRef(false);
  useEffect(() => { if (p.openSignal) setPinned(true); }, [p.openSignal]);

  useLayoutEffect(() => {
    if (!open || !btn.current || !pop.current) { setPos(null); return; }
    const r = btn.current.getBoundingClientRect();
    // beside the editor panel (to its right, else its left), so it never covers the fields being edited; below the icon only where there is no room at the side
    const panel = btn.current.closest('.editor-card, .fedit') as HTMLElement | null;
    const size = { width: pop.current.offsetWidth, height: pop.current.offsetHeight }, view = { width: window.innerWidth, height: window.innerHeight };
    const side = panel ? (() => { const q = panel.getBoundingClientRect(); return placeBeside({ left: q.left, top: q.top, width: q.width, height: q.height }, size, view); })() : null;
    if (side) { setPos({ left: side.left, top: side.top, arrowLeft: 0 }); return; }
    const c = placeCallout({ left: r.left, top: r.top, width: r.width, height: r.height }, size, view, 'bottom', 8, 8);
    setPos({ left: c.left, top: c.top, arrowLeft: c.arrowLeft });
  }, [open, n, p.checking]);
  useEffect(() => {
    if (!pinned) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); hide(); refocus(); } };
    const out = (e: Event) => { if (root.current && !root.current.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) setPinned(false); };
    window.addEventListener('keydown', esc, true);
    window.addEventListener('pointerdown', out, true);
    return () => { window.removeEventListener('keydown', esc, true); window.removeEventListener('pointerdown', out, true); };
  }, [pinned]);
  // a problem list that becomes empty closes everything
  useEffect(() => { if (!n && !p.checking) hide(); }, [n, p.checking]);

  if (!n && !p.checking) return <span class="fedit-problem-live" role="status" aria-live="polite" />;
  const name = p.checking ? p.label.checking : p.label.problems(n);
  return (
    <span class="fedit-problem" ref={root} onMouseEnter={() => { if (!coarse()) setHover(true); }} onMouseLeave={() => setHover(false)}>
      <button type="button" ref={btn} class={'fedit-problem-btn' + (p.checking ? ' checking' : ' bad')} aria-label={name} aria-expanded={open} aria-controls={open ? id : undefined} data-testid="problem-badge"
        onFocus={() => { if (!coarse() && !skipFocus.current) setHover(true); }} onBlur={() => { if (!pinned) setHover(false); }}
        onPointerDown={(e) => { if (e.pointerType === 'touch' || e.pointerType === 'pen') { tapped.current = true; setPinned((v) => !v); } }}   /* a touch opens on the press: a number box losing focus under the finger would otherwise swallow the click */
        onClick={() => { if (tapped.current) { tapped.current = false; return; } setPinned((v) => !v); }}>
        <Icon name={p.checking ? 'checking' : 'alert'} size={18} />
        {!p.checking && n > 1 ? <span class="fedit-problem-count" data-testid="problem-count">{n}</span> : null}
      </button>
      <span class="fedit-problem-live" role="status" aria-live="polite">{p.checking ? '' : p.label.announce(n)}</span>
      {open ? <BodyPortal>
        <div ref={pop} onMouseEnter={() => { if (!coarse()) setHover(true); }} onMouseLeave={() => setHover(false)} id={id} class="fedit-problem-pop" role={pinned ? 'dialog' : 'tooltip'} data-testid="problem-popover" style={pos ? { left: pos.left + 'px', top: pos.top + 'px' } : { visibility: 'hidden' }}>
          {pinned ? <button type="button" class="fedit-problem-close" aria-label={p.label.close} onClick={() => { hide(); refocus(); }}>×</button> : null}
          {p.checking ? <p class="fedit-problem-checking">{p.label.checking}</p> : (
            <ul class="fedit-problem-list">
              {p.problems.map((q) => (
                <li key={q.id} data-problem={q.id}>
                  <p class="fedit-problem-cause">{q.cause}</p>
                  {q.action ? <p class="fedit-problem-action">{q.action}</p> : null}
                  {q.details ? <details class="fedit-problem-details"><summary>{p.label.details}</summary><p>{q.details}</p></details> : null}
                </li>
              ))}
            </ul>
          )}
        </div></BodyPortal> : null}
    </span>
  );
}
