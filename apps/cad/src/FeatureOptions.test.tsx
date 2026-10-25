import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { FeatureEditor } from '@kit/ui';
import { optionsFor } from './FeatureOptions';
import { rememberRoundPick, tangentChainOn } from './roundChain';
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

describe('the operation of a solid feature', () => {
  const pressed = (m: ReturnType<typeof mount>) => [...m.q('op')!.querySelectorAll('button')].find((b) => b.getAttribute('aria-checked') === 'true')?.textContent;
  const press = (m: ReturnType<typeof mount>, label: string) => fireEvent.click([...m.q('op')!.querySelectorAll('button')].find((b) => b.textContent === label)!);
  it('offers New body, Add and Cut, and a body the feature names shows as New body with its name', () => {
    const m = mount({ ...EXTRUDE, op: 'newBody', body: 'Case' });
    expect([...m.q('op')!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['New body', 'Add', 'Cut']);
    expect(pressed(m)).toBe('New body');
    expect((m.q('body')!.querySelector('input') as HTMLInputElement).value).toBe('Case');
    expect(m.container.querySelectorAll('[data-path="body"]')).toHaveLength(1);   // the generic field is hidden
  });
  it('choosing New body gives it a free name, choosing Add drops the name, and a name can be typed', () => {
    const m = mount(EXTRUDE);
    expect(m.q('body')).toBeNull();
    press(m, 'New body');
    expect(m.drafts.at(-1)).toMatchObject({ op: 'newBody', body: 'Body 1' });
    const n = mount({ ...EXTRUDE, op: 'newBody', body: 'Body 1' });
    const input = n.q('body')!.querySelector('input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: ' Lid ' } });
    fireEvent.change(input, { target: { value: ' Lid ' } });
    expect(n.drafts.at(-1)).toMatchObject({ body: 'Lid' });
    press(n, 'Add');
    expect(n.drafts.at(-1)).toMatchObject({ op: 'add', body: null });
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

describe('tangent chain toggle (fillet and chamfer)', () => {
  const seeds = [{ faces: ['T', 'A'], at: [1, 0, 0] }];
  const all = [...seeds, { faces: ['T', 'B'], at: [2, 0, 0] }, { faces: ['T', 'C'], at: [3, 0, 0] }];
  it('is on by default, and switching it re-applies the choice to the feature\'s edges', () => {
    try { localStorage.removeItem('cad.tangentChain'); } catch { /* */ }
    rememberRoundPick(seeds, all);
    const m = mount({ type: 'fillet', id: 'F3', radius: 2, edges: all });
    expect(m.box('tangentChain').checked).toBe(true);
    expect(m.q('tangentChainNote')!.textContent).toContain('2');
    fireEvent.click(m.box('tangentChain'));
    expect(m.drafts.at(-1)).toMatchObject({ edges: seeds });
    expect(tangentChainOn()).toBe(false);
    fireEvent.click(m.box('tangentChain'));
    expect(m.drafts.at(-1)).toMatchObject({ edges: all });
    expect(tangentChainOn()).toBe(true);
  });
  it('chamfer has it too; an edge list of unknown origin is left alone', () => {
    const m = mount({ type: 'chamfer', id: 'F4', chamferType: 'equal', distance: 1, edges: [{ faces: ['X', 'Y'], at: [9, 9, 9] }] });
    expect(m.q('tangentChain')).not.toBeNull();
    const before = m.drafts.length;
    fireEvent.click(m.box('tangentChain'));
    expect(m.drafts.slice(before).some((d) => 'edges' in d)).toBe(false);
    fireEvent.click(m.box('tangentChain'));
  });
});

describe('the editors of the body features', () => {
  const COMBINE = { type: 'combine', id: 'F6', op: 'cut', target: { body: 'Block' }, tools: [{ body: 'Peg' }, { face: 'F4.C0' }], keepTools: true };
  it('combine: Join, Cut and Intersect (Cut chosen), the bodies in words, and keep tools', () => {
    const m = mount(COMBINE);
    const seg = [...m.q('op')!.querySelectorAll('button')];
    expect(seg.map((b) => b.textContent)).toEqual(['Join', 'Cut', 'Intersect']);
    expect(seg.find((b) => b.getAttribute('aria-checked') === 'true')!.textContent).toBe('Cut');
    expect((m.q('target')!.querySelector('input') as HTMLInputElement).value).toBe('Block');
    expect((m.q('tools')!.querySelector('input') as HTMLInputElement).value).toBe('Peg, the body with face F4.C0');
    expect(m.box('keepTools').checked).toBe(true);
    fireEvent.click(seg[0]);
    expect(m.drafts.at(-1)).toMatchObject({ op: 'union' });
    fireEvent.click(m.box('keepTools'));
    expect(m.drafts.at(-1)).toMatchObject({ keepTools: null });
  });
  it('move or copy: the bodies, how far, and a copy with its name', () => {
    const m = mount({ type: 'moveBody', id: 'F7', bodies: [{ body: 'Battery' }], translate: [0, 0, 5], rotate: { axis: [0, 1, 0], origin: [0, 0, 0], angle: 90 }, copy: true, body: 'Case' });
    expect((m.q('bodies')!.querySelector('input') as HTMLInputElement).value).toBe('Battery');
    expect((m.q('translate')!.querySelector('input') as HTMLInputElement).value).toBe('by 0, 0, 5 mm; turned 90° about (0, 1, 0)');
    expect(m.box('copy').checked).toBe(true);
    expect((m.q('body')!.querySelector('input') as HTMLInputElement).value).toBe('Case');
    fireEvent.click(m.box('copy'));
    expect(m.drafts.at(-1)).toMatchObject({ copy: null, body: null });
    const n = mount({ type: 'moveBody', id: 'F7', bodies: [{ body: 'Battery' }], translate: [1, 0, 0] });
    expect(n.q('body')).toBeNull();
    fireEvent.click(n.box('copy'));
    expect(n.drafts.at(-1)).toMatchObject({ copy: true, body: 'Body 1' });
  });
  it('sphere: radius and centre as numbers, and the operation with a body name for a new body', () => {
    const m = mount({ type: 'sphere', id: 'F9', op: 'newBody', body: 'Ball', center: [1, 2, 3], radius: 5 });
    expect((m.q('radius')!.querySelector('input') as HTMLInputElement).value).toBe('5');
    expect([0, 1, 2].map((i) => (m.q(`center.${i}`)!.querySelector('input') as HTMLInputElement).value)).toEqual(['1', '2', '3']);
    expect((m.q('body')!.querySelector('input') as HTMLInputElement).value).toBe('Ball');
    const y = m.q('center.1')!.querySelector('input') as HTMLInputElement;
    fireEvent.input(y, { target: { value: '7' } }); fireEvent.change(y, { target: { value: '7' } });
    expect(m.drafts.at(-1)).toMatchObject({ center: [1, 7, 3] });
  });
  it('delete or keep: the bodies in words next to the mode', () => {
    const m = mount({ type: 'deleteBody', id: 'F8', mode: 'delete', bodies: [{ body: 'Peg' }, { lump: 0 }] });
    expect((m.q('bodies')!.querySelector('input') as HTMLInputElement).value).toBe('Peg, body 1');
    expect(m.q('mode')).not.toBeNull();
  });
});

