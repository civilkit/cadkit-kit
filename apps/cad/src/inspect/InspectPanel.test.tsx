import '../i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { InspectPanel, type InspectProps } from './InspectPanel';
import { massView } from './mass';

afterEach(cleanup);

function setup(o: Partial<InspectProps> = {}) {
  const p: InspectProps = {
    material: 'aluminium', density: 2.7, densityKnown: true, onDensity: vi.fn(),
    mass: null, massBusy: false, massStale: false, box: null, hasSolid: true, onMass: vi.fn(),
    measuring: false, onMeasure: vi.fn(), picks: [], outcome: null, onClearPicks: vi.fn(), onCopy: vi.fn(),
    interference: null, interferenceStale: false, interferenceBusy: false, onInterference: vi.fn(), onPair: vi.fn(),
    section: { on: false, plane: 'front', faceId: null, offset: 0, flip: false }, sectionRange: [0, 10],
    onSectionPlane: vi.fn(), onSection: vi.fn(), onSectionOff: vi.fn(), onVisible: vi.fn(), ...o,
  };
  return { p, ...render(<InspectPanel {...p} />) };
}
const card = (c: Element, name: string) => c.querySelector(`section[aria-label="${name}"]`) as HTMLElement;

describe('InspectPanel with surface bodies', () => {
  it('a part of surface bodies only says they have no volume, and Compute is off', () => {
    const { container } = setup({ hasSolid: false, surfaces: 2 });
    const c = card(container, 'Mass properties');
    expect(c.textContent).toContain('surface bodies');
    expect(c.textContent).toContain('no volume or mass');
    expect((c.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });
  it('a solid with surface bodies notes that mass counts the solid only', () => {
    const { container } = setup({ hasSolid: true, surfaces: 1 });
    expect(card(container, 'Mass properties').textContent).toContain('Mass counts the solid only');
  });
  it('nothing at all keeps the plain empty note', () => {
    const { container } = setup({ hasSolid: false });
    expect(card(container, 'Mass properties').textContent).toContain('No solid to measure.');
  });
});

describe('InspectPanel', () => {
  it('tells the app it is shown, and Compute asks for the mass properties', () => {
    const { p, getByText } = setup();
    expect(p.onVisible).toHaveBeenCalledTimes(1);
    fireEvent.click(getByText('Compute'));
    expect(p.onMass).toHaveBeenCalled();
  });

  it('mass card: material note, volume, area, mass in g, centre, size, moments; Copy sends the lines', () => {
    const mass = massView({ volume: 6000, area: 2200, com: [15, 10, 5], principal: [100, 200, 300] }, 2.7);
    const { p, container, getByText } = setup({ mass, box: { min: [0, 0, 0], max: [30, 20, 10] } });
    const text = card(container, 'Mass properties').textContent!;
    expect(text).toContain('Material: aluminium');
    expect(text).toContain('6000 mm³'); expect(text).toContain('2200 mm²'); expect(text).toContain('16.2 g');
    expect(text).toContain('(15, 10, 5) mm'); expect(text).toContain('30 × 20 × 10 mm');
    fireEvent.click(card(container, 'Mass properties').querySelector('button:last-of-type')!);
    expect(p.onCopy).toHaveBeenCalledWith(expect.stringContaining('Volume\t6000 mm³'));
    void getByText;
  });

  it('density field reports changes; an unknown material says to set one; no solid disables Compute', () => {
    const { p, container } = setup({ material: 'unobtainium', densityKnown: false, hasSolid: false });
    expect(card(container, 'Mass properties').textContent).toContain('No density known for "unobtainium"');
    expect(card(container, 'Mass properties').textContent).toContain('No solid to measure');
    expect((container.querySelector('button.btn') as HTMLButtonElement).disabled).toBe(true);   // Compute
    const input = container.querySelector('input[aria-label="Density"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '8' } });
    expect(p.onDensity).toHaveBeenCalledWith(8);
  });

  it('measure card: off hint, start button, picks and live results with units, copy', () => {
    const off = setup();
    expect(card(off.container, 'Measure').textContent).toContain('Press M');
    fireEvent.click(off.getByText('Start measuring'));
    expect(off.p.onMeasure).toHaveBeenCalled();
    cleanup();
    const { p, container } = setup({
      measuring: true,
      picks: [{ kind: 'vertex', name: 'v:0,0,0', p: [0, 0, 0] }, { kind: 'face', name: 'F2.C1' }],
      outcome: { rows: [{ id: 'distance', value: 12.5, unit: 'mm' }, { id: 'angle', value: 90, unit: 'deg' }, { id: 'center', value: [1, 2, 3], unit: 'text' }], marks: [] },
    });
    const m = card(container, 'Measure');
    expect(m.textContent).toContain('Stop measuring');
    expect(m.textContent).toContain('Corner (0, 0, 0)'); expect(m.textContent).toContain('Face F2.C1');
    expect(m.textContent).toContain('Minimum distance'); expect(m.textContent).toContain('12.5 mm');
    expect(m.textContent).toContain('90°'); expect(m.textContent).toContain('(1, 2, 3)');
    fireEvent.click([...m.querySelectorAll('button')].find((b) => b.textContent === 'Copy')!);
    expect(p.onCopy).toHaveBeenCalledWith('Minimum distance\t12.5 mm\nAngle\t90°\nCenter\t(1, 2, 3)');
    fireEvent.click([...m.querySelectorAll('button')].find((b) => b.textContent === 'Clear picks')!);
    expect(p.onClearPicks).toHaveBeenCalled();
  });

  it('measure card: surface kind and the unavailable message', () => {
    const a = setup({ measuring: true, picks: [{ kind: 'face', name: 'F1' }], outcome: { rows: [{ id: 'area', value: 251.3, unit: 'mm2' }], marks: [], surface: 'cylinder' } });
    expect(card(a.container, 'Measure').textContent).toContain('Cylindrical face');
    cleanup();
    const b = setup({ measuring: true, picks: [{ kind: 'face', name: 'F1' }], outcome: { rows: [], marks: [], error: 'unavailable' } });
    expect(card(b.container, 'Measure').textContent).toContain('No measurement for this pair');
  });

  it('section card: planes, slider and offset, flip, off', () => {
    const idle = setup();
    expect(card(idle.container, 'Section view').querySelector('input[type="range"]')).toBeNull();
    fireEvent.click(idle.getByText('Top'));
    expect(idle.p.onSectionPlane).toHaveBeenCalledWith('top');
    fireEvent.click(idle.getByText('Selected face'));
    expect(idle.p.onSectionPlane).toHaveBeenCalledWith('face');
    cleanup();
    const { p, container } = setup({ section: { on: true, plane: 'front', faceId: null, offset: 5, flip: false }, sectionRange: [0, 10] });
    const range = container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(range.min).toBe('0'); expect(range.max).toBe('10'); expect(range.value).toBe('5');
    fireEvent.input(range, { target: { value: '7' } });
    expect(p.onSection).toHaveBeenCalledWith({ offset: 7 });
    fireEvent.change(container.querySelector('input[aria-label="Offset in millimetres"]')!, { target: { value: '2.5' } });
    expect(p.onSection).toHaveBeenCalledWith({ offset: 2.5 });
    fireEvent.click(container.querySelector('input[type="checkbox"]')!);
    expect(p.onSection).toHaveBeenCalledWith({ flip: true });
    fireEvent.click(container.querySelector('button[aria-pressed="true"]')!.parentElement!.querySelector('button:last-child')!);
    expect(p.onSectionOff).toHaveBeenCalled();
  });

  it('interference card: not checked, a single body, no interference, and pairs that select on click', () => {
    const a = setup();
    expect(card(a.container, 'Interference check').textContent).toContain('Not checked yet');
    fireEvent.click(a.getByText('Check'));
    expect(a.p.onInterference).toHaveBeenCalled();
    cleanup();
    expect(card(setup({ interference: { bodies: 1, pairs: [] } }).container, 'Interference check').textContent).toContain('Needs two or more solid bodies');
    cleanup();
    expect(card(setup({ interference: { bodies: 3, pairs: [] } }).container, 'Interference check').textContent).toContain('No interference between 3 bodies');
    cleanup();
    const { p, container } = setup({ interference: { bodies: 2, pairs: [{ a: 'F2.C0', b: 'F5.C1', volume: 250 }, { a: 'F2.C0', b: 'F7.C0', error: 'boolean failed' }] } });
    const pairs = [...container.querySelectorAll('.insp-pair')] as HTMLButtonElement[];
    expect(pairs[0].textContent).toContain('F2 ∩ F5'); expect(pairs[0].textContent).toContain('250 mm³');
    expect(pairs[1].disabled).toBe(true);
    fireEvent.click(pairs[0]);
    expect(p.onPair).toHaveBeenCalledWith('F2.C0', 'F5.C1');
  });
});
