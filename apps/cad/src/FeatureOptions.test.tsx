import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { FeatureEditor } from '@kit/ui';
import { optionsFor } from './FeatureOptions';
import './i18n';

afterEach(cleanup);
type Wire = Record<string, unknown>;

function mount(feature: Wire, extra: Partial<Parameters<typeof FeatureEditor>[0]> = {}) {
  const drafts: Wire[] = [];
  const picks: string[] = [];
  const r = render(<FeatureEditor feature={feature} onDraft={(d) => drafts.push(d)} onConfirm={() => {}} onCancel={() => {}} onPickRequest={(p) => picks.push(p)} options={optionsFor} {...extra} />);
  const q = (path: string) => r.container.querySelector(`[data-path="${path}"]`) as HTMLElement | null;
  const sel = (path: string) => q(path)!.querySelector('select') as HTMLSelectElement;
  const num = (path: string) => q(path)!.querySelector("input") as HTMLInputElement;
  const box = (path: string) => q(path)!.querySelector('input[type="checkbox"]') as HTMLInputElement;
  const texts = (el: HTMLSelectElement) => [...el.options].map((o) => o.textContent);
  return { ...r, drafts, picks, q, sel, num, box, texts };
}

const EXTRUDE = { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 5 };

describe('extrude options', () => {
  it('lists the end conditions the kernel cuts, with labels', () => {
    const m = mount(EXTRUDE);
    expect(m.texts(m.sel('end'))).toEqual(['Blind', 'Mid plane', 'Through all', 'Through all, both ways', 'Up to next']);
    expect(m.num('depth').value).toBe('5');
    expect(m.q('endFace')).toBeNull();
    expect(m.q('sketch')).not.toBeNull();   // the generic profile section stays
    expect(m.container.querySelectorAll('[data-path="depth"]').length).toBe(1);   // not drawn twice
  });
  it('through hides the depth and removes it from the draft; blind brings it back', () => {
    const m = mount(EXTRUDE);
    fireEvent.change(m.sel('end'), { target: { value: 'through' } });
    expect(m.drafts.at(-1)).toMatchObject({ end: 'through', depth: null });
    expect(m.q('depth')).toBeNull();
    fireEvent.change(m.sel('end'), { target: { value: 'blind' } });
    expect(m.q('depth')).not.toBeNull();
  });
  it('mid and through both hide flip and draft', () => {
    const m = mount(EXTRUDE);
    expect(m.q('flip')).not.toBeNull();
    expect(m.q('draft')).not.toBeNull();
    fireEvent.change(m.sel('end'), { target: { value: 'mid' } });
    expect(m.q('flip')).toBeNull();
    expect(m.q('draft')).toBeNull();
    expect(m.num('depth')).not.toBeNull();
  });
  it('draft angle shows the outward box only once set', () => {
    const m = mount(EXTRUDE);
    expect(m.q('draftOut')).toBeNull();
    fireEvent.change(m.num('draft'), { target: { value: '5' } });
    expect(m.drafts.at(-1)).toEqual({ draft: 5 });
    fireEvent.click(m.box('draftOut'));
    expect(m.drafts.at(-1)).toEqual({ draft: 5, draftOut: true });
    fireEvent.change(m.num('draft'), { target: { value: '0' } });
    expect(m.drafts.at(-1)).toMatchObject({ draft: null, draftOut: null });
    expect(m.q('draftOut')).toBeNull();
  });
  it('flip is written true or removed', () => {
    const m = mount(EXTRUDE);
    fireEvent.click(m.box('flip'));
    expect(m.drafts.at(-1)).toEqual({ flip: true });
    fireEvent.click(m.box('flip'));
    expect(m.drafts.at(-1)).toEqual({ flip: null });
  });
  it('an end the editor does not offer stays selectable so the kernel can report it', () => {
    const m = mount({ ...EXTRUDE, end: 'upToFace' });
    expect(m.sel('end').value).toBe('upToFace');
    expect(m.q('endFace')).not.toBeNull();   // its face pick shows (the pick machinery is ready for when the kernel cuts it)
  });
  it('the face field has a Pick button that asks to pick, and shows what was picked', () => {
    const m = mount({ ...EXTRUDE, end: 'upToFace', endFace: 'F2.C1' });
    expect((m.q('endFace')!.querySelector('input') as HTMLInputElement).value).toBe('F2.C1');
    fireEvent.click(m.q('endFace')!.querySelector('button')!);
    expect(m.picks).toEqual(['endFace']);
  });
  it('a picked face lands in the draft', () => {
    const m = mount({ ...EXTRUDE, end: 'upToFace' }, { picked: { path: 'endFace', value: 'F2.S.e1' } });
    expect(m.drafts.at(-1)).toMatchObject({ endFace: 'F2.S.e1' });
  });
});

describe('revolve options', () => {
  const REV = { type: 'revolve', id: 'F2', op: 'add', sketch: 'F1', axis: 'ax', end: 'blind', angle: 360 };
  it('has an angle, blind / mid only, and keeps the axis pick', () => {
    const m = mount(REV);
    expect(m.texts(m.sel('end'))).toEqual(['Blind', 'Mid plane']);
    expect(m.num('angle').value).toBe('360');
    expect(m.q('depth')).toBeNull();
    expect(m.q('axis')).not.toBeNull();
    fireEvent.change(m.num('angle'), { target: { value: '90' } });
    expect(m.drafts.at(-1)).toEqual({ angle: 90 });
    fireEvent.change(m.sel('end'), { target: { value: 'mid' } });
    expect(m.drafts.at(-1)).toMatchObject({ end: 'mid' });
    expect(m.q('angle')!.textContent).toContain('Total angle');
  });
});

describe('chamfer options', () => {
  const CH = { type: 'chamfer', id: 'F3', chamferType: 'equal', distance: 2, edges: [] };
  it('shows the fields of each type', () => {
    const m = mount(CH);
    expect(m.texts(m.sel('chamferType'))).toEqual(['Equal distance', 'Two distances', 'Distance and angle']);
    expect(m.q('distance2')).toBeNull();
    expect(m.q('angle')).toBeNull();
    fireEvent.change(m.sel('chamferType'), { target: { value: 'distances' } });
    expect(m.drafts.at(-1)).toMatchObject({ chamferType: 'distances', distance2: 2 });
    expect(m.num('distance2').value).toBe('2');
    expect(m.q('distance')!.textContent).toContain('Distance 1');
    fireEvent.change(m.sel('chamferType'), { target: { value: 'angle' } });
    expect(m.drafts.at(-1)).toMatchObject({ chamferType: 'angle', distance2: null, angle: 45 });
    expect(m.q('distance2')).toBeNull();
    expect(m.num('angle').value).toBe('45');
  });
});

describe('fillet options', () => {
  const FI = { type: 'fillet', id: 'F3', radius: 2, edges: [] };
  it('variable radius swaps the radius for a start and an end radius', () => {
    const m = mount(FI);
    expect(m.num('radius').value).toBe('2');
    fireEvent.click(m.box('filletType'));
    expect(m.drafts.at(-1)).toMatchObject({ filletType: 'variable', radii: [2, 2] });
    expect(m.q('radius')).toBeNull();
    fireEvent.change(m.num('radii1'), { target: { value: '5' } });
    expect(m.drafts.at(-1)).toMatchObject({ radii: [2, 5] });
    fireEvent.click(m.box('filletType'));
    expect(m.drafts.at(-1)).toMatchObject({ filletType: null, radii: null, radius: 2 });
  });
  it('profile shows its parameter', () => {
    const m = mount(FI);
    expect(m.texts(m.sel('profile'))).toEqual(['Circular', 'Conic', 'Chordal', 'Curvature continuous (G2)']);
    expect(m.q('rho')).toBeNull();
    fireEvent.change(m.sel('profile'), { target: { value: 'conic' } });
    expect(m.num('rho').value).toBe('0.5');
    fireEvent.change(m.sel('profile'), { target: { value: 'curvature' } });
    expect(m.q('rho')).toBeNull();
    expect(m.num('shape').value).toBe('0.5');
    fireEvent.change(m.sel('profile'), { target: { value: 'chord' } });
    expect(m.q('radius')!.textContent).toContain('Chord width');
  });
});

describe('shell options', () => {
  it('thickness and grow outward; the unread inside flag is gone', () => {
    const m = mount({ type: 'shell', id: 'F3', faces: ['F2.C1'], thickness: 1, inside: false });
    expect(m.num('thickness').value).toBe('1');
    expect(m.q('inside')).toBeNull();
    fireEvent.click(m.box('outward'));
    expect(m.drafts.at(-1)).toEqual({ outward: true });
    expect(m.q('faces')).not.toBeNull();   // the face list keeps its pick button
  });
});

describe('other features', () => {
  it('a hole or rib keeps the plain editor', () => {
    const m = mount({ type: 'rib', id: 'F4', sketch: 'F1', thickness: 2 });
    expect(m.container.querySelector('[data-section]')).toBeNull();
  });
});
