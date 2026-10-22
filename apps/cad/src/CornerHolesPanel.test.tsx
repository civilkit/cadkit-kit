import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { CornerHolesPanel, type PlateInfo } from './CornerHolesPanel';
import { DEFAULT_CORNER, type CornerRecord, type Pt } from './cornerHoles';
import './i18n';

afterEach(cleanup);
const RECT = { minX: -30, minY: -20, maxX: 30, maxY: 20 };
const PLAIN: PlateInfo = { rect: RECT, radius: null, notes: [] };
const ROUND: PlateInfo = { rect: RECT, radius: 8, notes: [] };

function mount(plate: PlateInfo = PLAIN, extra: Partial<Parameters<typeof CornerHolesPanel>[0]> = {}) {
  const calls: Array<{ rec: CornerRecord; points: Pt[] }> = [];
  const r = render(<CornerHolesPanel value={DEFAULT_CORNER} plate={plate} holeDiameter={6.6} onPlace={(rec, points) => calls.push({ rec, points })} {...extra} />);
  const q = (path: string) => r.container.querySelector(`[data-path="${path}"]`) as HTMLElement | null;
  const input = (path: string) => q(path)!.querySelector('input') as HTMLInputElement;
  const place = () => r.container.querySelector('.chole-place') as HTMLButtonElement;
  const typeIn = (path: string, v: string) => fireEvent.input(input(path), { target: { value: v } });
  return { ...r, calls, q, input, place, typeIn, issues: () => [...r.container.querySelectorAll('.chole-issue')].map((e) => e.getAttribute('data-code')) };
}

describe('CornerHolesPanel', () => {
  it('places four corner holes at the default inset with one click', () => {
    const m = mount();
    expect(m.input('inset').value).toBe('10');
    expect(m.input('nx').value).toBe('2');
    expect(m.place().textContent).toBe('Place holes');
    fireEvent.click(m.place());
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0].points).toHaveLength(4);
    expect(m.calls[0].points.map((p) => `${p.x},${p.y}`).sort()).toEqual(['-20,-10', '-20,10', '20,-10', '20,10']);
    expect(m.calls[0].rec).toEqual({ inset: 10, matchFillet: false, nx: 2, ny: 2 });
  });
  it('typing the inset moves the holes', () => {
    const m = mount();
    m.typeIn('inset', '5');
    fireEvent.click(m.place());
    expect(m.calls[0].rec.inset).toBe(5);
    expect(m.calls[0].points[0]).toEqual({ x: -25, y: -15 });
  });
  it('more holes per side', () => {
    const m = mount();
    m.typeIn('nx', '3');
    expect(m.container.querySelector('[data-testid="corner-count"]')!.textContent).toContain('6 holes');
    fireEvent.click(m.place());
    expect(m.calls[0].points).toHaveLength(6);
  });
  it('shows Match corner fillet only when the plate has one, and follows the radius', () => {
    expect(mount().q('matchFillet')).toBeNull();
    const m = mount(ROUND);
    expect(m.q('matchFillet')!.textContent).toContain('R 8 mm');
    fireEvent.click(m.input('matchFillet'));
    expect(m.input('inset').disabled).toBe(true);
    expect(m.input('inset').value).toBe('8');
    fireEvent.click(m.place());
    expect(m.calls[0].rec.matchFillet).toBe(true);
    expect(m.calls[0].points[0]).toEqual({ x: -22, y: -12 });
  });
  it('a bad value shows the message and disables Place; no crash', () => {
    const m = mount();
    m.typeIn('inset', '25');
    expect(m.issues()).toEqual(['insetTooLarge']);
    expect(m.place().disabled).toBe(true);
    expect(m.container.textContent).toContain('use less than 20 mm');
    fireEvent.click(m.place());
    expect(m.calls).toHaveLength(0);
    m.typeIn('inset', '10'); m.typeIn('ny', '1');
    expect(m.issues()).toEqual(['count']);
  });
  it('warns about a hole that breaks the edge but still places', () => {
    const m = mount(PLAIN, { holeDiameter: 11 });
    m.typeIn('inset', '5');
    expect(m.issues()).toEqual(['wall']);
    expect(m.place().disabled).toBe(false);
    fireEvent.click(m.place());
    expect(m.calls[0].points).toHaveLength(4);
  });
  it('shows the outline warning for a plate it cannot reduce, and the Update label on a reopened hole', () => {
    const m = mount({ rect: RECT, radius: null, notes: [{ code: 'outline', params: {} }] }, { update: true });
    expect(m.issues()).toEqual(['outline']);
    expect(m.place().textContent).toBe('Update holes');
  });
  it('Enter in a count field places', () => {
    const m = mount();
    fireEvent.keyDown(m.input('nx'), { key: 'Enter' });
    expect(m.calls).toHaveLength(1);
  });
});
