import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { FeatureEditor } from '@kit/ui';
import type { PartDoc } from '@ck/part-model';
import { optionsFor } from './FeatureOptions';
import './i18n';

afterEach(cleanup);
type Wire = Record<string, unknown>;

const features: Wire[] = [
  { type: 'extrude', id: 'F2' }, { type: 'sketch', id: 'F3' },
  { type: 'hole', id: 'F4', sketch: 'F3', size: 'M5' },
  { type: 'thread', id: 'F5', face: 'F4.S.h1', standard: 'metric', size: 'M5' },
];
const doc = { features } as unknown as PartDoc;

function mount(feature: Wire) {
  const drafts: Wire[] = [];
  const r = render(<FeatureEditor feature={feature} onDraft={(d) => drafts.push(d)} onConfirm={() => {}} onCancel={() => {}} options={(a) => optionsFor(a, doc)} />);
  return { ...r, drafts };
}

describe('pattern and mirror: threads', () => {
  const cp = { type: 'cpattern', id: 'F7', seeds: ['F4'], count: 4, angle: 360, equal: true };
  it('the seed reads "Hole F4 + Thread F5" and Carry threads is on by default', () => {
    const m = mount(cp);
    expect(m.container.querySelector('[data-seed="F4"]')!.textContent).toBe('Hole F4 + Thread F5');
    const box = m.container.querySelector('[data-path="carryThreads"] input[type="checkbox"]') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(m.container.querySelectorAll('[data-path="carryThreads"]').length).toBe(1);   // not drawn twice
  });
  it('unchecking sets carryThreads:false; checking again removes the field', () => {
    const m = mount(cp);
    const box = () => m.container.querySelector('[data-path="carryThreads"] input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(box());
    expect(m.drafts.at(-1)).toMatchObject({ carryThreads: false });
    expect(m.container.querySelector('[data-seed="F4"]')!.textContent).toBe('Hole F4');
    fireEvent.click(box());
    expect(m.drafts.at(-1)).toMatchObject({ carryThreads: null });
  });
  it('a pattern already saved with carryThreads:false shows the box off, and a mirror gets the section too', () => {
    const off = mount({ ...cp, carryThreads: false });
    expect((off.container.querySelector('[data-path="carryThreads"] input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    cleanup();
    const mi = mount({ type: 'mirror', id: 'F8', seeds: ['F4', 'F5'], plane: { kind: 'std', id: 'right' }, body: false });
    expect([...mi.container.querySelectorAll('[data-seed]')].map((e) => e.textContent)).toEqual(['Hole F4 + Thread F5', 'Thread F5']);
  });
});

describe('circular pattern: axis', () => {
  const cp = { type: 'cpattern', id: 'F7', seeds: ['F4'], count: 4, angle: 360, equal: true, axis: { kind: 'axis', axis: 'x' } };
  const sel = (m: ReturnType<typeof mount>) => m.container.querySelector('[data-path="axis"] select') as HTMLSelectElement;
  it('shows the stored world axis and writes a new one as {kind:"axis"}', () => {
    const m = mount(cp);
    expect(sel(m).value).toBe('x');
    fireEvent.change(sel(m), { target: { value: 'y' } });
    expect(m.drafts.at(-1)).toMatchObject({ axis: { kind: 'axis', axis: 'y' } });
  });
  it('a pattern without a stored axis shows z; a linear pattern has no axis picker', () => {
    const { axis: _a, ...bare } = cp;
    expect(sel(mount(bare)).value).toBe('z');
    cleanup();
    expect(mount({ type: 'lpattern', id: 'F8', seeds: ['F4'], count: 3, spacing: 10 }).container.querySelector('[data-path="axis"]')).toBeNull();
  });
});

describe('linear pattern: directions and distance types', () => {
  const lp = { type: 'lpattern', id: 'F7', seeds: ['F4'], dir: { kind: 'axis', axis: 'x' }, count: 4, spacing: 10 };
  const q = (m: ReturnType<typeof mount>, path: string, tag = 'select') => m.container.querySelector(`[data-path="${path}"] ${tag}`) as HTMLSelectElement;
  it('Direction 1 shows its axis, count and Spacing; Direction 2 is off', () => {
    const m = mount(lp);
    expect(q(m, 'dir').value).toBe('x');
    expect(q(m, 'distanceType').value).toBe('spacing');
    expect(m.container.querySelector('[data-path="spacing"]')).not.toBeNull();
    expect(q(m, 'dir2').value).toBe('');
    expect(m.container.querySelector('[data-path="count2"]')).toBeNull();
    expect(m.container.querySelector('[data-path="axis"]')).toBeNull();
  });
  it('Extent starts at the span the copies cover; back to Spacing drops it', () => {
    const m = mount(lp);
    fireEvent.change(q(m, 'distanceType'), { target: { value: 'extent' } });
    expect(m.drafts.at(-1)).toMatchObject({ distanceType: 'extent', extent: 30, to: null });
    expect(m.container.querySelector('[data-path="extent"]')).not.toBeNull();
    expect(m.container.querySelector('[data-path="spacing"]')).toBeNull();
    fireEvent.change(q(m, 'distanceType'), { target: { value: 'spacing' } });
    expect(m.drafts.at(-1)).toMatchObject({ distanceType: null, extent: null });
  });
  it('To object offers the planes, writes the reference and hides Reverse', () => {
    const m = mount({ ...lp, distanceType: 'toObject' });
    expect(m.container.querySelector('[data-path="reverse"]')).toBeNull();
    const to = q(m, 'to');
    expect([...to.options].map((o) => o.value)).toEqual(['', 'std:front', 'std:top', 'std:right']);
    fireEvent.change(to, { target: { value: 'std:right' } });
    expect(m.drafts.at(-1)).toMatchObject({ to: { kind: 'std', id: 'right' } });
    expect(m.container.querySelector('[data-path="toOffset"]')).not.toBeNull();
  });
  it('a picked face and a point show as what they are', () => {
    const f = mount({ ...lp, distanceType: 'toObject', to: { kind: 'face', id: 'F2.S.e2' } });
    expect(q(f, 'to').value).toBe('face:F2.S.e2');
    expect(q(f, 'to').selectedOptions[0].textContent).toBe('Face F2.S.e2');
    cleanup();
    const p = mount({ ...lp, distanceType: 'toObject', to: [50, 0, 0] });
    expect(q(p, 'to').selectedOptions[0].textContent).toBe('Point (50, 0, 0)');
  });
  it('the Pick button asks the viewport for a face under `to`', () => {
    const asked: string[] = [];
    const r = render(<FeatureEditor feature={{ ...lp, distanceType: 'toObject' }} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} onPickRequest={(p) => asked.push(p)} options={(a) => optionsFor(a, doc)} />);
    fireEvent.click(r.container.querySelector('[data-path="to"] button.fedit-pick') as HTMLButtonElement);
    expect(asked).toEqual(['to']);
  });
  it('Direction 2 turns on with an axis (2 copies at the spacing of direction 1) and None removes it', () => {
    const m = mount(lp);
    fireEvent.change(q(m, 'dir2'), { target: { value: 'y' } });
    expect(m.drafts.at(-1)).toMatchObject({ dir2: { kind: 'axis', axis: 'y' }, count2: 2, spacing2: 10 });
    expect(m.container.querySelector('[data-path="count2"]')).not.toBeNull();
    fireEvent.change(q(m, 'distanceType2'), { target: { value: 'toObject' } });
    expect(m.drafts.at(-1)).toMatchObject({ distanceType2: 'toObject' });
    fireEvent.change(q(m, 'dir2'), { target: { value: '' } });
    expect(m.drafts.at(-1)).toMatchObject({ dir2: null, count2: null, spacing2: null, distanceType2: null, to2: null });
  });
});

describe('pattern on path', () => {
  const sk = (id: string, ents: Wire[]) => ({ type: 'sketch', id, points: [], entities: ents });
  const pdoc = { features: [...features, sk('F8', [{ type: 'line', id: 'e1', p1: 'a', p2: 'b' }]), sk('F9', [{ type: 'circle', id: 'e1', c: 'c', r: 2 }])] } as unknown as PartDoc;
  const cp = { type: 'curvepattern', id: 'F10', seeds: ['F4'], path: { kind: 'sketch', id: 'F8' }, count: 3, spacing: 10 };
  function mountP(feature: Wire) {
    const drafts: Wire[] = [];
    const r = render(<FeatureEditor feature={feature} onDraft={(d) => drafts.push(d)} onConfirm={() => {}} onCancel={() => {}} options={(a) => optionsFor(a, pdoc)} />);
    return { ...r, drafts };
  }
  const q = (m: ReturnType<typeof mountP>, path: string) => m.container.querySelector(`[data-path="${path}"] select, select[data-path="${path}"]`) as HTMLSelectElement;
  it('lists the open sketches as paths and writes the path reference', () => {
    const m = mountP(cp);
    const path = m.container.querySelector('select[data-path="path"]') as HTMLSelectElement;
    expect([...path.options].map((o) => o.value)).toEqual(['', 'F8']);
    expect(path.value).toBe('F8');
  });
  it('start point as a distance or a fraction, flip and orientation', () => {
    const m = mountP(cp);
    expect(m.container.querySelector('[data-path="start"]')).not.toBeNull();
    fireEvent.change(q(m, 'startMode'), { target: { value: 'fraction' } });
    expect(m.drafts.at(-1)).toMatchObject({ start: null, startFraction: 0 });
    expect(m.container.querySelector('[data-path="startFraction"]')).not.toBeNull();
    fireEvent.click(m.container.querySelector('[data-path="flip"] input') as HTMLInputElement);
    expect(m.drafts.at(-1)).toMatchObject({ flip: true });
    fireEvent.change(q(m, 'orientation'), { target: { value: 'tangent' } });
    expect(m.drafts.at(-1)).toMatchObject({ orientation: 'tangent' });
    fireEvent.change(q(m, 'orientation'), { target: { value: 'fixed' } });
    expect(m.drafts.at(-1)).toMatchObject({ orientation: null });
  });
  it('offers Spacing and Extent, not To object', () => {
    const m = mountP(cp);
    expect([...q(m, 'distanceType').options].map((o) => o.value)).toEqual(['spacing', 'extent']);
    fireEvent.change(q(m, 'distanceType'), { target: { value: 'extent' } });
    expect(m.drafts.at(-1)).toMatchObject({ distanceType: 'extent', extent: 20 });
  });
});

describe('linear pattern: direction vector and picked edge', () => {
  const lp = { type: 'lpattern', id: 'F7', seeds: ['F4'], dir: { kind: 'axis', axis: 'x' }, count: 4, spacing: 10 };
  const sel = (m: ReturnType<typeof mount>, path = 'dir') => m.container.querySelector(`[data-path="${path}"] select`) as HTMLSelectElement;
  const typeIn = (m: ReturnType<typeof mount>, path: string, v: string) => {
    const input = m.container.querySelector(`[data-path="${path}"] input`) as HTMLInputElement;
    fireEvent.input(input, { target: { value: v } });
    fireEvent.blur(input);
  };
  it('offers X, Y, Z and a direction vector; a world axis keeps writing {kind:"axis"}', () => {
    const m = mount(lp);
    expect([...sel(m).options].map((o) => o.value)).toEqual(['x', 'y', 'z', 'vector']);
    fireEvent.change(sel(m), { target: { value: 'z' } });
    expect(m.drafts.at(-1)).toMatchObject({ dir: { kind: 'axis', axis: 'z' } });
    expect(m.container.querySelector('[data-path="dir.x"]')).toBeNull();
  });
  it('Direction vector starts as the axis it replaces and shows X, Y, Z fields; typing writes {kind:"vector"}', () => {
    const m = mount(lp);
    fireEvent.change(sel(m), { target: { value: 'vector' } });
    expect(m.drafts.at(-1)).toMatchObject({ dir: { kind: 'vector', dir: [1, 0, 0] } });
    cleanup();
    const v = mount({ ...lp, dir: { kind: 'vector', dir: [1, 0, 0] } });
    expect(sel(v).value).toBe('vector');
    expect(['dir.x', 'dir.y', 'dir.z'].every((p) => v.container.querySelector(`[data-path="${p}"]`))).toBe(true);
    typeIn(v, 'dir.y', '1');
    expect(v.drafts.at(-1)).toMatchObject({ dir: { kind: 'vector', dir: [1, 1, 0] } });
  });
  it('a vector of length 0 says so', () => {
    const m = mount({ ...lp, dir: { kind: 'vector', dir: [0, 0, 0] } });
    expect(m.container.textContent).toMatch(/length 0/);
  });
  it('a picked edge shows by its faces; the Pick button asks the viewport for `dir`', () => {
    const asked: string[] = [];
    const feature = { ...lp, dir: { kind: 'edge', faces: ['F2.S.e1', 'F2.S.e2'], at: [10, 0, 5] } };
    const r = render(<FeatureEditor feature={feature} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} onPickRequest={(p) => asked.push(p)} options={(a) => optionsFor(a, doc)} />);
    const s = r.container.querySelector('[data-path="dir"] select') as HTMLSelectElement;
    expect(s.value).toBe('ref');
    expect(s.selectedOptions[0].textContent).toBe('Edge F2.S.e1 / F2.S.e2');
    fireEvent.click(r.container.querySelector('[data-path="dir"] button.fedit-pick') as HTMLButtonElement);
    expect(asked).toEqual(['dir']);
  });
  it('a picked value arriving from the viewport lands in the draft as the direction', () => {
    const drafts: Wire[] = [];
    const edge = { kind: 'edge', faces: ['F2.S.e1', 'F2.S.e2'], at: [10, 0, 5] };
    const r = render(<FeatureEditor feature={lp} onDraft={(d) => drafts.push(d)} onConfirm={() => {}} onCancel={() => {}} picked={{ path: 'dir', value: edge }} options={(a) => optionsFor(a, doc)} />);
    expect(drafts.at(-1)).toMatchObject({ dir: edge });
    expect(r.container.querySelector('[data-path="dir"] select')).not.toBeNull();
  });
  it('Direction 2 can be a vector and None still removes it; Pick is only offered once it is on', () => {
    const asked: string[] = [];
    const drafts: Wire[] = [];
    const r = render(<FeatureEditor feature={lp} onDraft={(d) => drafts.push(d)} onConfirm={() => {}} onCancel={() => {}} onPickRequest={(p) => asked.push(p)} options={(a) => optionsFor(a, doc)} />);
    expect(r.container.querySelector('[data-path="dir2"] button.fedit-pick')).toBeNull();
    fireEvent.change(r.container.querySelector('[data-path="dir2"] select') as HTMLSelectElement, { target: { value: 'vector' } });
    expect(drafts.at(-1)).toMatchObject({ dir2: { kind: 'vector', dir: [1, 0, 0] }, count2: 2, spacing2: 10 });
  });
});

describe('circular pattern: axis position, direction and picked edge', () => {
  const cp = { type: 'cpattern', id: 'F7', seeds: ['F4'], count: 6, angle: 360, equal: true, axis: { kind: 'axis', axis: 'z' } };
  const sel = (m: ReturnType<typeof mount>) => m.container.querySelector('[data-path="axis"] select') as HTMLSelectElement;
  const typeIn = (m: ReturnType<typeof mount>, path: string, v: string) => {
    const input = m.container.querySelector(`[data-path="${path}"] input`) as HTMLInputElement;
    fireEvent.input(input, { target: { value: v } });
    fireEvent.blur(input);
  };
  it('offers the axes, a typed direction and the axis point (0, 0, 0 by default); the axis is drawn once', () => {
    const m = mount(cp);
    expect([...sel(m).options].map((o) => o.value)).toEqual(['x', 'y', 'z', 'custom']);
    expect(m.container.querySelectorAll('[data-path="axis"]').length).toBe(1);
    for (const c of ['x', 'y', 'z']) expect((m.container.querySelector(`[data-path="axis.point.${c}"] input`) as HTMLInputElement).value).toBe('0');
  });
  it('a point on the axis writes {kind:"axis", point, dir} and 0, 0, 0 goes back to the plain world axis', () => {
    const m = mount(cp);
    typeIn(m, 'axis.point.x', '40');
    expect(m.drafts.at(-1)).toMatchObject({ axis: { kind: 'axis', point: [40, 0, 0], dir: [0, 0, 1] } });
    cleanup();
    const off = mount({ ...cp, axis: { kind: 'axis', point: [40, 0, 0], dir: [0, 0, 1] } });
    expect(sel(off).value).toBe('z');   // still "the Z axis", moved
    expect((off.container.querySelector('[data-path="axis.point.x"] input') as HTMLInputElement).value).toBe('40');
    typeIn(off, 'axis.point.x', '0');
    expect(off.drafts.at(-1)).toMatchObject({ axis: { kind: 'axis', axis: 'z' } });
  });
  it('switching the axis keeps the point; Direction shows X, Y, Z of the axis and writes the vector', () => {
    const m = mount({ ...cp, axis: { kind: 'axis', point: [40, 0, 0], dir: [0, 0, 1] } });
    fireEvent.change(sel(m), { target: { value: 'x' } });
    expect(m.drafts.at(-1)).toMatchObject({ axis: { kind: 'axis', point: [40, 0, 0], dir: [1, 0, 0] } });
    cleanup();
    const c = mount({ ...cp, axis: { kind: 'axis', point: [0, 0, 0], dir: [1, 1, 0] } });
    expect(sel(c).value).toBe('custom');
    expect((c.container.querySelector('[data-path="axis.dir.y"] input') as HTMLInputElement).value).toBe('1');
    typeIn(c, 'axis.dir.z', '1');
    expect(c.drafts.at(-1)).toMatchObject({ axis: { kind: 'axis', point: [0, 0, 0], dir: [1, 1, 1] } });
  });
  it('a picked edge shows by its faces and hides the point; Pick asks for `axis`', () => {
    const asked: string[] = [];
    const feature = { ...cp, axis: { kind: 'edge', faces: ['F2.S.e1', 'F2.S.e2'], at: [53, 53, 5] } };
    const r = render(<FeatureEditor feature={feature} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} onPickRequest={(p) => asked.push(p)} options={(a) => optionsFor(a, doc)} />);
    const s = r.container.querySelector('[data-path="axis"] select') as HTMLSelectElement;
    expect(s.value).toBe('ref');
    expect(s.selectedOptions[0].textContent).toBe('Edge F2.S.e1 / F2.S.e2');
    expect(r.container.querySelector('[data-path="axis.point.x"]')).toBeNull();
    fireEvent.click(r.container.querySelector('[data-path="axis"] button.fedit-pick') as HTMLButtonElement);
    expect(asked).toEqual(['axis']);
  });
  it('a picked round face lands in the draft as the axis', () => {
    const drafts: Wire[] = [];
    render(<FeatureEditor feature={cp} onDraft={(d) => drafts.push(d)} onConfirm={() => {}} onCancel={() => {}} picked={{ path: 'axis', value: { kind: 'face', id: 'F5.S.e1' } }} options={(a) => optionsFor(a, doc)} />);
    expect(drafts.at(-1)).toMatchObject({ axis: { kind: 'face', id: 'F5.S.e1' } });
  });
});
