import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { DEFAULT_STEP, STEP_SIZES, holdRepeat, sanitizeStep, type ViewRoll, type ViewTurn } from '@kit/viewport';
import { Icon } from '@kit/ui';
import { t } from './i18n';

const ARROWS_KEY = 'cad.viewnav.arrows';
const GROUPS_KEY = 'cad.viewnav.groups';
const STEP_KEY = 'cad.viewnav.step';
const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

/** The button groups of the ring the menu switches on and off: turn left/right (yaw), turn up/down (pitch), roll and Home. */
export type NavGroup = 'yaw' | 'pitch' | 'roll' | 'home';
export const NAV_GROUPS: NavGroup[] = ['yaw', 'pitch', 'roll', 'home'];
const GROUP_LABEL: Record<NavGroup, string> = { yaw: 'viewnav.gYaw', pitch: 'viewnav.gPitch', roll: 'viewnav.gRoll', home: 'viewnav.gHome' };

/** What a device shows before the user chooses: a phone only the turn left/right arrows (the cube does the rest), anything bigger all four groups. */
export const defaultGroups = (phone: boolean): NavGroup[] => (phone ? ['yaw'] : [...NAV_GROUPS]);
export const parseGroups = (raw: string | null): NavGroup[] | null => raw === null ? null : NAV_GROUPS.filter((g) => raw.split(',').includes(g));
/** The stored choice; the older all-arrows switch (off) still means everything off. */
export function loadGroups(phone: boolean): NavGroup[] {
  return parseGroups(read(GROUPS_KEY)) ?? (read(ARROWS_KEY) === '0' ? [] : defaultGroups(phone));
}

/** Arrows around the view cube in four switchable groups (turn left/right, turn up/down, roll, Home) and a small menu (the groups, step size, look normal). */
export interface ViewNavProps {
  /** A phone layout: the first-run default is the turn left/right arrows alone. */
  phone?: boolean;
  /** Turn the view by `step` degrees. */
  onTurn(turn: ViewTurn, step: number): void;
  onRoll(roll: ViewRoll, step: number): void;
  onHome(): void;
  /** Given while a sketch is open: the menu offers the existing Look normal command. */
  onLookNormal?: () => void;
}

const TURNS: ViewTurn[] = ['up', 'down', 'left', 'right'];

/** One button that turns on press, repeats while held, and also works from the keyboard (Enter and Space click it with no pointer). */
function StepButton(p: { cls: string; label: string; fire: () => void; children: preact.ComponentChildren }) {
  const fire = useRef(p.fire);
  fire.current = p.fire;
  const rep = useMemo(() => holdRepeat(() => fire.current()), []);
  useEffect(() => () => rep.up(), [rep]);
  return (
    <button type="button" class={'vn-btn ' + p.cls} aria-label={p.label} title={p.label}
      onPointerDown={(e) => { if (e.button !== 0 && e.pointerType === 'mouse') return; e.preventDefault(); e.stopPropagation(); rep.down(); }}
      onPointerUp={() => rep.up()} onPointerCancel={() => rep.up()} onPointerLeave={() => rep.up()} onBlur={() => rep.up()}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => { if (e.detail === 0) fire.current(); }}>
      {p.children}
    </button>
  );
}

const Triangle = () => <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 5.5 20 18H4Z" fill="currentColor" /></svg>;
const Curve = () => <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4.5 15.5A8.5 8.5 0 0 1 17 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /><path d="M21 7.5 14.2 5.2 15.8 12Z" fill="currentColor" /></svg>;

export function ViewNav(p: ViewNavProps) {
  const [groups, setGroups] = useState<NavGroup[]>(() => loadGroups(!!p.phone));
  const [step, setStep] = useState(() => sanitizeStep(Number(read(STEP_KEY) ?? DEFAULT_STEP)));
  const [menu, setMenu] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const on = (g: NavGroup) => groups.includes(g);
  // the cube canvas and the overlays beside the ring are sized from the groups in play (see the --vn rules in app.css)
  useLayoutEffect(() => {
    const host = box.current?.parentElement;
    if (host) host.setAttribute('data-vn', groups.join(' '));
    return () => host?.removeAttribute('data-vn');
  }, [groups]);
  useEffect(() => {
    if (!menu) return;
    const away = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc); };
  }, [menu]);
  const pick = (n: number) => { setStep(n); write(STEP_KEY, String(n)); };
  const toggle = (g: NavGroup) => { const next = NAV_GROUPS.filter((x) => (x === g ? !on(g) : on(x))); setGroups(next); write(GROUPS_KEY, next.join(',')); };
  const labels: Record<ViewTurn, string> = { up: t('viewnav.up'), down: t('viewnav.down'), left: t('viewnav.left'), right: t('viewnav.right') };
  return (
    <div class="viewnav" ref={box} role="group" aria-label={t('viewnav.group')}>
      {TURNS.filter((x) => on(x === 'up' || x === 'down' ? 'pitch' : 'yaw')).map((x) => (
        <StepButton key={x} cls={'vn-turn vn-' + x} label={labels[x]} fire={() => p.onTurn(x, step)}><Triangle /></StepButton>
      ))}
      {on('roll') ? (
        <>
          <StepButton cls="vn-roll vn-ccw" label={t('viewnav.rollCcw')} fire={() => p.onRoll('ccw', step)}><Curve /></StepButton>
          <StepButton cls="vn-roll vn-cw" label={t('viewnav.rollCw')} fire={() => p.onRoll('cw', step)}><Curve /></StepButton>
        </>
      ) : null}
      {on('home') ? <button type="button" class="vn-btn vn-home" aria-label={t('viewnav.home')} title={t('viewnav.home')} onClick={p.onHome}><Icon name="view-iso" size={20} /></button> : null}
      <button type="button" class={'vn-btn vn-more' + (menu ? ' on' : '')} aria-label={t('viewnav.options')} title={t('viewnav.options')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="more" size={20} /></button>
      {menu ? (
        <div class="vn-menu" role="menu" aria-label={t('viewnav.options')}>
          {NAV_GROUPS.map((g) => <button key={g} type="button" role="menuitemcheckbox" aria-checked={on(g)} onClick={() => toggle(g)}>{t(GROUP_LABEL[g])}</button>)}
          <div class="vn-steps" role="group" aria-label={t('viewnav.step')}>
            <span>{t('viewnav.step')}</span>
            {STEP_SIZES.map((n) => <button key={n} type="button" role="menuitemradio" aria-checked={step === n} class={step === n ? 'on' : ''} onClick={() => pick(n)}>{t('viewnav.degrees', { n })}</button>)}
          </div>
          {p.onLookNormal ? <button type="button" role="menuitem" onClick={() => { setMenu(false); p.onLookNormal?.(); }}>{t('app.sketch.lookNormal')}</button> : null}
        </div>
      ) : null}
    </div>
  );
}
