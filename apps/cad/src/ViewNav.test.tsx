import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { t } from './i18n';
import { ViewNav, defaultGroups, loadGroups, parseGroups } from './ViewNav';

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const mk = (over: Partial<Parameters<typeof ViewNav>[0]> = {}) => {
  const p = { onTurn: vi.fn(), onRoll: vi.fn(), onHome: vi.fn(), ...over };
  render(<ViewNav {...p} />);
  return p;
};

describe('ViewNav', () => {
  it('has a labelled button for each arrow, both rolls and home', () => {
    mk();
    for (const key of ['viewnav.up', 'viewnav.down', 'viewnav.left', 'viewnav.right', 'viewnav.rollCw', 'viewnav.rollCcw', 'viewnav.home', 'viewnav.options']) expect(screen.getByRole('button', { name: t(key) })).toBeTruthy();
    expect(t('viewnav.up')).toBe('Turn view up');
    expect(t('viewnav.rollCcw')).toBe('Roll view counter-clockwise');
    expect(t('viewnav.home')).toBe('Home view');
  });
  it('a keyboard activation (Enter or Space click, no pointer) turns one step of 90 degrees', () => {
    const p = mk();
    fireEvent.click(screen.getByRole('button', { name: 'Turn view left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll view clockwise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Home view' }));
    expect(p.onTurn).toHaveBeenCalledWith('left', 90);
    expect(p.onRoll).toHaveBeenCalledWith('cw', 90);
    expect(p.onHome).toHaveBeenCalledTimes(1);
  });
  it('the buttons are real buttons the Tab key reaches', () => {
    mk();
    for (const b of screen.getAllByRole('button')) { expect(b.tagName).toBe('BUTTON'); expect((b as HTMLButtonElement).tabIndex).toBeGreaterThanOrEqual(0); }
  });
  it('a press turns at once and keeps turning while held, a click after it does not add a step', () => {
    vi.useFakeTimers();
    const p = mk();
    const down = screen.getByRole('button', { name: 'Turn view down' });
    fireEvent.pointerDown(down, { button: 0, pointerType: 'touch' });
    expect(p.onTurn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(420); expect(p.onTurn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(300); expect(p.onTurn).toHaveBeenCalledTimes(3);
    fireEvent.pointerUp(down, { pointerType: 'touch' });
    fireEvent.click(down, { detail: 1 });
    vi.advanceTimersByTime(3000);
    expect(p.onTurn).toHaveBeenCalledTimes(3);
    expect(p.onTurn).toHaveBeenLastCalledWith('down', 90);
  });
  it('the menu sets the step size, which is remembered, and the next turn uses it', () => {
    const p = mk();
    fireEvent.click(screen.getByRole('button', { name: t('viewnav.options') }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '45°' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn view up' }));
    expect(p.onTurn).toHaveBeenCalledWith('up', 45);
    expect(localStorage.getItem('cad.viewnav.step')).toBe('45');
    cleanup();
    const q = mk();
    fireEvent.click(screen.getByRole('button', { name: 'Roll view clockwise' }));
    expect(q.onRoll).toHaveBeenCalledWith('cw', 45);
  });
  const NAMES: Record<string, string[]> = { yaw: ['Turn view left', 'Turn view right'], pitch: ['Turn view up', 'Turn view down'], roll: ['Roll view clockwise', 'Roll view counter-clockwise'], home: ['Home view'] };
  const shown = () => Object.entries(NAMES).filter(([, ns]) => ns.every((n) => screen.queryByRole('button', { name: n }))).map(([g]) => g);
  const toggle = (g: string) => {
    if (!screen.queryByRole('menu')) fireEvent.click(screen.getByRole('button', { name: t('viewnav.options') }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: t(`viewnav.g${g[0]!.toUpperCase()}${g.slice(1)}`) }));
  };
  it('a phone starts with the turn left/right arrows alone, anything larger with every group', () => {
    expect(defaultGroups(true)).toEqual(['yaw']);
    expect(defaultGroups(false)).toEqual(['yaw', 'pitch', 'roll', 'home']);
    render(<ViewNav phone onTurn={vi.fn()} onRoll={vi.fn()} onHome={vi.fn()} />);
    expect(shown()).toEqual(['yaw']);
    expect(screen.getAllByRole('button')).toHaveLength(3);   // left, right and the menu button
    cleanup();
    mk();
    expect(shown()).toEqual(['yaw', 'pitch', 'roll', 'home']);
  });
  it('the menu lists the four groups, each switching only its own buttons', () => {
    for (const g of ['yaw', 'pitch', 'roll', 'home']) {
      cleanup(); localStorage.clear();
      mk();
      toggle(g);
      expect(shown()).toEqual(['yaw', 'pitch', 'roll', 'home'].filter((x) => x !== g));
      expect(screen.getAllByRole('menuitemcheckbox').map((e) => e.getAttribute('aria-checked'))).toEqual(['yaw', 'pitch', 'roll', 'home'].map((x) => String(x !== g)));
    }
  });
  it('every combination of groups renders exactly its buttons and says so on the host, which sizes the cube and the overlays', () => {
    for (let m = 0; m < 16; m++) {
      cleanup();
      const on = (['yaw', 'pitch', 'roll', 'home'] as const).filter((_, i) => m & (1 << i));
      localStorage.setItem('cad.viewnav.groups', on.join(','));
      const host = document.createElement('div'); document.body.appendChild(host);
      render(<ViewNav onTurn={vi.fn()} onRoll={vi.fn()} onHome={vi.fn()} />, { container: host });
      expect(shown()).toEqual(on);
      expect(host.getAttribute('data-vn')).toBe(on.join(' '));
      expect(screen.getAllByRole('button')).toHaveLength(1 + on.reduce((n, g) => n + NAMES[g]!.length, 0));
      cleanup(); host.remove();
    }
  });
  it('the choice is kept per device, survives a remount, and the menu stays open to switch several', () => {
    mk();
    toggle('pitch'); toggle('roll'); toggle('home');
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(localStorage.getItem('cad.viewnav.groups')).toBe('yaw');
    cleanup();
    mk();
    expect(shown()).toEqual(['yaw']);
    toggle('pitch');
    expect(shown()).toEqual(['yaw', 'pitch']);
    expect(localStorage.getItem('cad.viewnav.groups')).toBe('yaw,pitch');
  });
  it('with every group off the cube alone remains and the small menu button brings them back', () => {
    mk();
    for (const g of ['yaw', 'pitch', 'roll', 'home']) toggle(g);
    expect(localStorage.getItem('cad.viewnav.groups')).toBe('');
    expect(shown()).toEqual([]);
    fireEvent.keyDown(document, { key: 'Escape' });
    cleanup();
    mk();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    toggle('yaw');
    expect(shown()).toEqual(['yaw']);
  });
  it('the older arrows-off switch still hides every group, and a stored choice wins over the phone default', () => {
    expect(loadGroups(false)).toEqual(['yaw', 'pitch', 'roll', 'home']);
    localStorage.setItem('cad.viewnav.arrows', '0');
    expect(loadGroups(false)).toEqual([]);
    localStorage.setItem('cad.viewnav.groups', 'home,yaw,bogus');
    expect(loadGroups(true)).toEqual(['yaw', 'home']);
    expect(parseGroups(null)).toBeNull();
  });
  it('Look normal is in the menu only while a sketch is open, and closes it', () => {
    mk();
    fireEvent.click(screen.getByRole('button', { name: t('viewnav.options') }));
    expect(screen.queryByRole('menuitem', { name: t('app.sketch.lookNormal') })).toBeNull();
    cleanup();
    const onLookNormal = vi.fn();
    mk({ onLookNormal });
    fireEvent.click(screen.getByRole('button', { name: t('viewnav.options') }));
    fireEvent.click(screen.getByRole('menuitem', { name: t('app.sketch.lookNormal') }));
    expect(onLookNormal).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('Escape closes the menu', () => {
    mk();
    fireEvent.click(screen.getByRole('button', { name: t('viewnav.options') }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
