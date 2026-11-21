import '../i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/preact';
import { InspectPanel, scrollMassIntoView, type InspectProps } from './InspectPanel';
import { massView } from './mass';

afterEach(cleanup);

function setup(o: Partial<InspectProps> = {}) {
  const p: InspectProps = {
    material: 'aluminium', density: 2.7, densityKnown: true, onDensity: vi.fn(),
    mass: null, massBusy: false, massStale: false, box: null, hasSolid: true, onMass: vi.fn(),
    measuring: false, onMeasure: vi.fn(), picks: [], outcome: null, onClearPicks: vi.fn(), onCopy: vi.fn(),
    interference: null, interferenceStale: false, interferenceBusy: false, onInterference: vi.fn(), onPair: vi.fn(),
    intersection: null, intersectionStale: false, intersectionBusy: false, intersectionError: null, intersectionFaces: 0, onIntersection: vi.fn(),
    section: { on: false, plane: 'front', faceId: null, offset: 0, flip: false }, sectionRange: [0, 10],
    onSectionPlane: vi.fn(), onSection: vi.fn(), onSectionOff: vi.fn(), onVisible: vi.fn(), ...o,
  };
  return { p, ...render(<InspectPanel {...p} />) };
}
const card = (c: Element, name: string) => c.querySelector(`section[aria-label="${name}"]`) as HTMLElement;

describe('scrollMassIntoView', () => {
  it('scrolls the Mass properties card into view, and says false when the panel is not there', () => {
    expect(scrollMassIntoView()).toBe(false);
    const { container } = setup();
    const el = card(container, 'Mass properties');
    el.scrollIntoView = vi.fn();
    expect(scrollMassIntoView()).toBe(true);
    expect(el.scrollIntoView).toHaveBeenCalledOnce();
  });
});

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

  it('mass card: first moments, principal axes and the inertia tensors, scaled by density; Copy carries them', () => {
    const I = [[100, -10, 0], [-10, 200, 0], [0, 0, 250]];
    const mass = massView({ volume: 1000, area: 600, com: [1, 2, 3], principal: [95, 205, 250], axes: [[0.9, 0.4, 0], [-0.4, 0.9, 0], [0, 0, 1]],
      firstMoment: [1000, 2000, 3000], inertia: I, inertiaOrigin: I.map((r) => r.map((x) => x + 5)) }, 2);
    const { p, container } = setup({ mass });
    const text = card(container, 'Mass properties').textContent!;
    expect(text).toContain('Principal axis 1'); expect(text).toContain('(0.9, 0.4, 0)');
    expect(text).toContain('First moments'); expect(text).toContain('(2, 4, 6) g·mm');   // density 2 g/cm3 = 0.002 g/mm3
    expect(text).toContain('Inertia tensor about the centre of mass'); expect(text).toContain('0.2   -0.02   0');
    expect(text).toContain('Inertia tensor about the origin');
    fireEvent.click(card(container, 'Mass properties').querySelector('button:last-of-type')!);
    expect(p.onCopy).toHaveBeenCalledWith(expect.stringContaining('Inertia tensor about the origin'));
  });

  it('mass card without tensor data (an older kernel) shows only the rows it has', () => {
    const { container } = setup({ mass: massView({ volume: 10, area: 5, com: [0, 0, 0], principal: [1, 2, 3] }, 1) });
    expect(card(container, 'Mass properties').textContent).not.toContain('Inertia tensor');
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

  it('measure card: a point on a reference mesh is named with its mesh and the results say they are to its triangles', () => {
    const { container } = setup({
      measuring: true, meshNames: { mesh1: 'Head scan' },
      picks: [{ kind: 'vertex', name: 'mp:mesh1@1,2,3', p: [1, 2, 3], mesh: 'mesh1' }, { kind: 'vertex', name: 'v:0,0,0', p: [0, 0, 0] }],
      outcome: { rows: [{ id: 'distance', value: 3.7417, unit: 'mm' }, { id: 'delta', value: [1, 2, 3], unit: 'text' }], marks: [], onMesh: true },
    });
    const m = card(container, 'Measure');
    expect(m.textContent).toContain('Point on mesh Head scan (1, 2, 3)');
    expect(m.textContent).toContain('Corner (0, 0, 0)');
    expect(m.textContent).toContain('not on an exact surface');
    expect(m.textContent).toContain('Offset (x, y, z)'); expect(m.textContent).toContain('3.7417 mm');
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
    fireEvent.click(within(card(a.container, 'Interference check')).getByText('Check'));
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

  describe('intersection card', () => {
    const NAME = 'Intersection check';
    const result = (o: Partial<NonNullable<InspectProps['intersection']>> = {}): InspectProps['intersection'] => ({ curves: 4, marched: 2, spans: 790, proved: 790, repaired: 0, unresolved: 0, pairs: 2, issues: [], ...o });
    it('says what it covers, runs on the button, and is not checked yet', () => {
      const a = setup();
      expect(card(a.container, NAME).textContent).toContain('Not checked yet');
      expect(card(a.container, NAME).textContent).toContain('Checks the whole part');
      fireEvent.click(card(a.container, NAME).querySelector('button.btn')!);
      expect(a.p.onIntersection).toHaveBeenCalled();
      cleanup();
      expect(card(setup({ intersectionFaces: 3 }).container, NAME).textContent).toContain('Checks 3 selected faces');
    });
    it('a clean result, an all-exact result and a part with no meeting faces', () => {
      expect(card(setup({ intersection: result() }).container, NAME).textContent).toContain('790 of 790 spans proved');
      cleanup();
      expect(card(setup({ intersection: result() }).container, NAME).textContent).toContain('Every span is proved');
      cleanup();
      expect(card(setup({ intersection: result({ marched: 0, spans: 0, proved: 0 }) }).container, NAME).textContent).toContain('Every intersection is exact (4 found)');
      cleanup();
      expect(card(setup({ intersection: result({ pairs: 0, curves: 0, marched: 0, spans: 0, proved: 0 }) }).container, NAME).textContent).toContain('No two faces meet');
    });
    it('unproved spans are listed with their reason and select the two faces on click; repaired ones are not listed', () => {
      const issues = [{ a: 'F2.C0', b: 'F5.S', curve: 0, span: 12, reason: 'singular' }, { a: 'F2.C1', b: 'F5.S', curve: 0, span: 30, reason: 'noContraction', repaired: true }];
      const { p, container } = setup({ intersection: result({ proved: 788, unresolved: 1, issues }) });
      const c = card(container, NAME);
      expect(c.textContent).toContain('1 spans could not be proved');
      expect(c.textContent).toContain('not an error');
      const rows = [...c.querySelectorAll('.insp-pair')] as HTMLButtonElement[];
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain('tangent contact or pole');
      fireEvent.click(rows[0]);
      expect(p.onPair).toHaveBeenCalledWith('F2.C0', 'F5.S');
    });
    it('a refusal shows its detail, and too many face pairs ask for a selection', () => {
      expect(card(setup({ intersectionError: 'checkIntersection: bad' }).container, NAME).textContent).toContain('The check could not run: checkIntersection: bad');
      cleanup();
      expect(card(setup({ intersectionError: 'checkIntersection: 812 face pairs (at most 400 per request)' }).container, NAME).textContent).toContain('Select the faces to check first');
    });
    it('a stale result and a busy button', () => {
      expect(card(setup({ intersection: result(), intersectionStale: true }).container, NAME).textContent).toContain('Out of date');
      cleanup();
      const b = card(setup({ intersectionBusy: true }).container, NAME).querySelector('button.btn') as HTMLButtonElement;
      expect(b.disabled).toBe(true);
    });
  });
});
