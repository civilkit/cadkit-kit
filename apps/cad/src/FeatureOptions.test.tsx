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
    expect(m.texts(m.sel('end'))).toEqual(['Blind', 'Mid plane', 'Through all', 'Through all, both ways', 'Up to next', 'To object']);
    expect(m.num('depth').value).toBe('5');
    expect(m.q('endRef')).toBeNull();
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
  });
});

describe('To object and From object', () => {
  it('To object swaps the depth for a reference with a Pick button, a list of planes and bodies, and an offset', () => {
    const m = mount(EXTRUDE);
    fireEvent.change(m.sel('end'), { target: { value: 'toObject' } });
    expect(m.drafts.at(-1)).toMatchObject({ end: 'toObject', depth: null });
    expect(m.q('depth')).toBeNull();
    expect(m.q('endRef')).not.toBeNull();
    expect(m.q('endOffset')).not.toBeNull();
    fireEvent.click(m.q('endRef')!.querySelector('button')!);
    expect(m.picks).toEqual(['endRef']);
  });
  it('a picked face lands in the draft as a reference and shows in words', () => {
    const m = mount({ ...EXTRUDE, end: 'toObject' }, { picked: { path: 'endRef', value: { kind: 'face', id: 'F2.S.e1' } } });
    expect(m.drafts.at(-1)).toMatchObject({ endRef: { kind: 'face', id: 'F2.S.e1' } });
    const r = mount({ ...EXTRUDE, end: 'toObject', endRef: { kind: 'face', id: 'F2.C1' } });
    expect(r.sel('endRef').value).toBe('picked');
    expect(r.texts(r.sel('endRef'))[0]).toBe('Face F2.C1');
  });
  it('a plane from the list becomes the reference', () => {
    const m = mount({ ...EXTRUDE, end: 'toObject' });
    expect(m.texts(m.sel('endRef')).slice(0, 4)).toEqual(['Pick a face, corner or body, or choose', 'Front Plane', 'Top Plane', 'Right Plane']);
    fireEvent.change(m.sel('endRef'), { target: { value: 'std:top' } });
    expect(m.drafts.at(-1)).toEqual({ endRef: { kind: 'std', id: 'top' } });
    fireEvent.change(m.num('endOffset'), { target: { value: '2' } });
    expect(m.drafts.at(-1)).toMatchObject({ endOffset: 2 });
  });
  it('the start: the sketch plane by default, From object adds its own reference and offset', () => {
    const m = mount(EXTRUDE);
    expect(m.sel('start').value).toBe('sketch');
    expect(m.q('startRef')).toBeNull();
    fireEvent.change(m.sel('start'), { target: { value: 'fromObject' } });
    expect(m.drafts.at(-1)).toMatchObject({ start: 'fromObject' });
    expect(m.q('startRef')).not.toBeNull();
    expect(m.q('startOffset')).not.toBeNull();
    fireEvent.click(m.q('startRef')!.querySelector('button')!);
    expect(m.picks).toEqual(['startRef']);
    fireEvent.change(m.sel('start'), { target: { value: 'sketch' } });
    expect(m.drafts.at(-1)).toMatchObject({ start: null, startRef: null, startOffset: null });
  });
  it('mid and through have no start choice', () => {
    const m = mount({ ...EXTRUDE, end: 'mid' });
    expect(m.q('start')).toBeNull();
  });
  it('a cut has the same choices', () => {
    const m = mount({ ...EXTRUDE, op: 'cut', end: 'toObject', endRef: { kind: 'feature', id: 'P1' } });
    expect(m.q('endRef')).not.toBeNull();
    expect(m.sel('endRef').value).toBe('feature:P1');
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
  it('a hole keeps the plain editor', () => {
    const m = mount({ type: 'hole', id: 'F4', sketch: 'F1', diameter: 2 });
    expect(m.container.querySelector('[data-section]')).toBeNull();
  });
});

describe('rib options', () => {
  const RIB = { type: 'rib', id: 'F4', sketch: 'F3', thickness: 2 };
  it('offers the side, a fillet radius and a draft angle next to the generic thickness and flip', () => {
    const m = mount(RIB);
    expect(m.texts(m.sel('side'))).toEqual(['Both sides (centred)', 'Along the sketch normal', 'Against the sketch normal']);
    expect(m.sel('side').value).toBe('both');
    expect(m.num('fillet').value).toBe('0');
    expect(m.num('draft').value).toBe('0');
    expect(m.q('thickness')).not.toBeNull();   // the generic fields stay
    expect(m.container.querySelectorAll('[data-path="side"]').length).toBe(1);   // not drawn twice
  });
  it('a side is written, both removes the field', () => {
    const m = mount(RIB);
    fireEvent.change(m.sel('side'), { target: { value: 'right' } });
    expect(m.drafts.at(-1)).toEqual({ side: 'right' });
    fireEvent.change(m.sel('side'), { target: { value: 'both' } });
    expect(m.drafts.at(-1)).toEqual({ side: null });
  });
  it('a fillet radius and a draft angle are written; zero removes them', () => {
    const m = mount({ ...RIB, fillet: 0.5, draft: 2 });
    expect(m.num('fillet').value).toBe('0.5');
    expect(m.num('draft').value).toBe('2');
    fireEvent.change(m.num('fillet'), { target: { value: '0.8' } });
    expect(m.drafts.at(-1)).toEqual({ fillet: 0.8 });
    fireEvent.change(m.num('draft'), { target: { value: '4' } });
    expect(m.drafts.at(-1)).toMatchObject({ draft: 4 });
    fireEvent.change(m.num('draft'), { target: { value: '0' } });
    expect(m.drafts.at(-1)).toMatchObject({ draft: null });
  });
  it('the bodies it extends to: all by default, the ticked ones once a body is named', () => {
    const doc = { format: 'ck-part', version: 1, features: [
      { type: 'extrude', id: 'F2', op: 'newBody', body: 'Base', sketch: 'F1' },
      { type: 'extrude', id: 'F5', op: 'newBody', body: 'Lid', sketch: 'F1' },
      RIB,
    ] } as never;
    const m = mount(RIB, { options: (a) => optionsFor(a, doc) });
    expect(m.q('target')!.textContent).toContain('Extend to');
    expect(m.box('target.all').checked).toBe(true);
    fireEvent.click(m.box('target.Base'));
    expect(m.drafts.at(-1)).toEqual({ target: [{ body: 'Base' }] });
  });
  it('without a named body there is no body choice', () => {
    const m = mount(RIB);
    expect(m.q('target')).toBeNull();
  });
});

describe('full round fillet', () => {
  const FI = { type: 'fillet', id: 'F3', radius: 2, edges: [] };
  it('the box swaps the radius for three face fields with Pick buttons, and back', () => {
    const m = mount(FI);
    fireEvent.click(m.box('fullRound'));
    expect(m.drafts.at(-1)).toMatchObject({ filletType: 'fullRound', radii: null });
    expect(m.q('radius')).toBeNull();
    expect(m.q('profile')).toBeNull();
    expect(m.q('edges')).toBeNull();
    for (const k of ['side1', 'center', 'side2']) expect(m.q(k)).not.toBeNull();
    fireEvent.click(m.q('center')!.querySelector('button')!);
    expect(m.picks).toEqual(['center']);
  });
  it('a full round shows the picked faces and unticking removes them', () => {
    const m = mount({ ...FI, filletType: 'fullRound', side1: 'F2.C1', center: 'F2.S.e1', side2: 'F2.C0' });
    expect((m.q('center')!.querySelector('input') as HTMLInputElement).value).toBe('F2.S.e1');
    fireEvent.click(m.box('filletType'));
    expect(m.drafts.at(-1)).toMatchObject({ filletType: null, side1: null, center: null, side2: null });
  });
});

describe('extrude twist', () => {
  it('twist shows its axis only once set, and excludes the draft', () => {
    const m = mount(EXTRUDE);
    expect(m.q('twistCentreX')).toBeNull();
    fireEvent.change(m.num('twist'), { target: { value: '90' } });
    expect(m.drafts.at(-1)).toMatchObject({ twist: 90, draft: null });
    expect(m.q('twistCentreX')).not.toBeNull();
    expect(m.q('draft')).toBeNull();
    fireEvent.change(m.num('twistCentreX'), { target: { value: '5' } });
    expect(m.drafts.at(-1)).toMatchObject({ twist: 90, twistCentre: [5, 0] });
    fireEvent.change(m.num('twist'), { target: { value: '0' } });
    expect(m.drafts.at(-1)).toMatchObject({ twist: null, twistCentre: null });
  });
  it('a draft hides the twist, up to next hides it, and it is not offered for a revolve', () => {
    expect(mount({ ...EXTRUDE, draft: 5 }).q('twist')).toBeNull();
    expect(mount({ ...EXTRUDE, end: 'upToNext', depth: undefined }).q('twist')).toBeNull();
    expect(mount({ type: 'revolve', id: 'F2', sketch: 'F1', end: 'blind', angle: 360 }).q('twist')).toBeNull();
  });
});

describe('loft centre line and connectors', () => {
  const sk = (id: string, closed: boolean) => ({
    type: 'sketch', id, name: id, plane: { kind: 'std', id: 'front' },
    points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: 1, y: 1 }],
    entities: closed ? [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'b', p2: 'c' }, { id: 'e3', type: 'line', p1: 'c', p2: 'a' }] : [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }],
    constraints: [],
  });
  const doc = { features: [sk('S1', true), sk('S2', true), sk('S3', false)] } as never;
  const LOFT = { type: 'loft', id: 'F4', sketches: ['S1', 'S2'] };
  const mountLoft = (f: Wire) => mount(f, { options: (a: never) => optionsFor(a, doc) });
  it('the centre line is a list of the open sketches; choosing one sets it, None removes it', () => {
    const m = mountLoft(LOFT);
    const sel = m.container.querySelector('select[data-path="centreLine"]') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(['', 'S3']);
    fireEvent.change(sel, { target: { value: 'S3' } });
    expect(m.drafts.at(-1)).toMatchObject({ centreLine: { sketch: 'S3' } });
    fireEvent.change(sel, { target: { value: '' } });
    expect(m.drafts.at(-1)).toMatchObject({ centreLine: null });
  });
  it('a connector per profile: a number sets it, blank removes it', () => {
    const m = mountLoft(LOFT);
    const inp = (i: number) => m.q('connectors.' + i)!.querySelector('input') as HTMLInputElement;
    fireEvent.change(inp(1), { target: { value: '0.25' } });
    expect(m.drafts.at(-1)).toMatchObject({ connectors: [null, 0.25] });
    fireEvent.change(inp(1), { target: { value: '' } });
    expect(m.drafts.at(-1)).toMatchObject({ connectors: null });
  });
});

describe('variable thicken', () => {
  const TH = { type: 'thicken', id: 'F3', surface: 'F2', thickness: 4, side: 'front' };
  it('the box swaps the thickness for a ramp with stops', () => {
    const m = mount(TH);
    expect(m.num('thickness').value).toBe('4');
    expect(m.q('surface')).not.toBeNull();   // the generic fields stay
    fireEvent.click(m.box('thicknessAt'));
    expect(m.drafts.at(-1)).toMatchObject({ thickness: null, thicknessAt: { along: [0, 0, 1], stops: [[0, 4], [10, 2]] } });
    expect(m.q('thickness')).toBeNull();
  });
  it('edits stops, the axis, adds and removes', () => {
    const at = { along: [0, 0, 1], stops: [[0, 4], [48, 1]] };
    const m = mount({ ...TH, thickness: undefined, thicknessAt: at });
    fireEvent.change(m.q('stop1t')!.querySelector('input')!, { target: { value: '2' } });
    expect(m.drafts.at(-1)).toMatchObject({ thicknessAt: { stops: [[0, 4], [48, 2]] } });
    fireEvent.change(m.sel('along'), { target: { value: 'x' } });
    expect(m.drafts.at(-1)).toMatchObject({ thicknessAt: { along: [1, 0, 0] } });
    expect((m.container.querySelector('[data-act="remove-stop"]') as HTMLButtonElement).disabled).toBe(true);   // two stops is the least
    fireEvent.click(m.container.querySelector('[data-act="add-stop"]')!);
    expect((m.drafts.at(-1)!.thicknessAt as { stops: unknown[] }).stops).toHaveLength(3);
    expect((m.container.querySelector('[data-act="remove-stop"]') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(m.box('thicknessAt'));
    expect(m.drafts.at(-1)).toMatchObject({ thicknessAt: null, thickness: 4 });
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
  it('switched on for an edge list of unknown origin, it follows the chain on the body the feature is applied to; off again restores the list', async () => {
    try { localStorage.setItem('cad.tangentChain', '0'); } catch { /* */ }
    const own = [{ faces: ['T', 'P'], at: [7, 0, 0] }];
    const more = [...own, { faces: ['T', 'Q'], at: [8, 0, 0] }];
    const asked: Wire[] = [];
    const m = mount({ type: 'fillet', id: 'F7', radius: 1, edges: own }, { options: (a: never) => optionsFor(a, null, { closeWithLine() {}, asSurface() {}, chainEdges: async (eff) => { asked.push(eff); return more; } }) });
    expect(m.box('tangentChain').checked).toBe(false);
    fireEvent.click(m.box('tangentChain'));
    await new Promise((r) => setTimeout(r, 0));
    expect(asked.at(-1)).toMatchObject({ id: 'F7', edges: own });
    expect(m.drafts.at(-1)).toMatchObject({ edges: more });
    expect(tangentChainOn()).toBe(true);
    m.rerender(<FeatureEditor feature={{ type: 'fillet', id: 'F7', radius: 1, edges: more }} onDraft={(d) => m.drafts.push(d)} onConfirm={() => {}} onCancel={() => {}} options={(a: never) => optionsFor(a, null, { closeWithLine() {}, asSurface() {}, chainEdges: async () => null })} />);
    fireEvent.click(m.box('tangentChain'));
    expect(m.drafts.at(-1)).toMatchObject({ edges: own });
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
  it('combine: Join, Cut, Intersect and Split (Cut chosen), the bodies in words, and keep tools', () => {
    const m = mount(COMBINE);
    const seg = [...m.q('op')!.querySelectorAll('button')];
    expect(seg.map((b) => b.textContent)).toEqual(['Join', 'Cut', 'Intersect', 'Split']);
    expect(seg.find((b) => b.getAttribute('aria-checked') === 'true')!.textContent).toBe('Cut');
    expect((m.q('target')!.querySelector('input') as HTMLInputElement).value).toBe('Block');
    expect((m.q('tools')!.querySelector('input') as HTMLInputElement).value).toBe('Peg, the body with face F4.C0');
    expect(m.box('keepTools').checked).toBe(true);
    fireEvent.click(seg[0]);
    expect(m.drafts.at(-1)).toMatchObject({ op: 'union' });
    fireEvent.click(seg[3]);
    expect(m.drafts.at(-1)).toMatchObject({ op: 'split' });
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
  it('scale: one factor, or one per axis; about the centre of mass, the origin or a point', () => {
    const m = mount({ type: 'scale', id: 'F5', factor: 2 });
    expect((m.q('factor')!.querySelector('input') as HTMLInputElement).value).toBe('2');
    expect((m.q('bodies')!.querySelector('input') as HTMLInputElement).value).toBe('The whole part');
    expect(m.box('uniform').checked).toBe(true);
    fireEvent.click(m.box('uniform'));
    expect(m.drafts.at(-1)).toMatchObject({ factor: [2, 2, 2], factors: null });
    const n = mount({ type: 'scale', id: 'F5', factor: [1, 3, 1], at: [0, 5, 0], bodies: [{ body: 'Arm' }] });
    expect(n.box('uniform').checked).toBe(false);
    expect([0, 1, 2].map((i) => (n.q(`factor.${i}`)!.querySelector('input') as HTMLInputElement).value)).toEqual(['1', '3', '1']);
    expect((n.q('at')!.querySelector('input') as HTMLInputElement).value).toBe('0, 5, 0');
    expect((n.q('bodies')!.querySelector('input') as HTMLInputElement).value).toBe('Arm');
    const y = n.q('factor.1')!.querySelector('input') as HTMLInputElement;
    fireEvent.input(y, { target: { value: '4' } }); fireEvent.change(y, { target: { value: '4' } });
    expect(n.drafts.at(-1)).toMatchObject({ factor: [1, 4, 1] });
  });
  it('delete or keep: the bodies in words next to the mode', () => {
    const m = mount({ type: 'deleteBody', id: 'F8', mode: 'delete', bodies: [{ body: 'Peg' }, { lump: 0 }] });
    expect((m.q('bodies')!.querySelector('input') as HTMLInputElement).value).toBe('Peg, body 1');
    expect(m.q('mode')).not.toBeNull();
  });
});


describe('extrude target body', () => {
  const doc = { features: [{ type: 'importStep', id: 'F1', body: 'Original (STEP)' }, { type: 'extrude', id: 'F3', op: 'newBody', body: 'History' }, { type: 'extrude', id: 'F5', op: 'add' }] } as never;
  const withDoc = (feature: Wire) => mount(feature, { options: (a: never) => optionsFor(a, doc) });
  it('Add and Cut offer Automatic and the named bodies of the part; the choice is written as {body: name}', () => {
    const m = withDoc({ type: 'extrude', id: 'F5', op: 'add', sketch: 'F4', end: 'blind', depth: 5 });
    expect(m.texts(m.sel('target'))).toEqual(['Automatic (every body the shape reaches)', 'Original (STEP)', 'History']);
    fireEvent.change(m.sel('target'), { target: { value: 'History' } });
    expect(m.drafts.at(-1)).toMatchObject({ target: { body: 'History' } });
    fireEvent.change(m.sel('target'), { target: { value: '' } });
    expect(m.drafts.at(-1)).toMatchObject({ target: null });
  });
  it('is not offered for a new body, for a revolve, or when the part names no body', () => {
    const nb = withDoc({ type: 'extrude', id: 'F5', op: 'newBody', body: 'B', sketch: 'F4', end: 'blind', depth: 5 });
    expect(nb.q('target')).toBeNull();
    const none = mount({ type: 'extrude', id: 'F5', op: 'cut', sketch: 'F4', end: 'blind', depth: 5 });
    expect(none.q('target')).toBeNull();
  });
  it('choosing New body drops the target', () => {
    const m = withDoc({ type: 'extrude', id: 'F5', op: 'cut', sketch: 'F4', end: 'blind', depth: 5, target: { body: 'History' } });
    const newBtn = [...m.container.querySelectorAll('[data-path="op"] button')].find((b) => b.textContent === 'New body') as HTMLElement;
    fireEvent.click(newBtn);
    expect(m.drafts.at(-1)).toMatchObject({ op: 'newBody', target: null });
  });
});

describe('revolve axis in words', () => {
  const doc = { features: [{ type: 'sketch', id: 'F1', points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 9 }, { id: 'c', x: 4, y: 0 }], entities: [{ id: 'e14', type: 'line', p1: 'a', p2: 'b', construction: true }, { id: 'e15', type: 'line', p1: 'a', p2: 'c' }] }] } as never;
  const REV = { type: 'revolve', id: 'F2', op: 'add', sketch: 'F1', axis: 'e14', end: 'blind', angle: 360 };
  it('shows the sketch vertical axis, not the id, and lists the sketch lines', () => {
    const m = mount(REV, { options: (a: never) => optionsFor(a, doc) });
    expect(m.container.querySelectorAll('[data-path="axis"]').length).toBe(1);
    expect(m.texts(m.sel('axis'))).toEqual(['Sketch vertical axis', 'Sketch horizontal axis (profile edge)']);
    expect(m.sel('axis').value).toBe('e14');
    expect(m.container.textContent).not.toContain('e14');
    fireEvent.change(m.sel('axis'), { target: { value: 'e15' } });
    expect(m.drafts.at(-1)).toEqual({ axis: 'e15' });
  });
});

describe('split and lip joint options', () => {
  const SPLIT = { type: 'split', id: 'F4', plane: { kind: 'std', id: 'front' }, offset: 5, names: ['Base', 'Lid'] };
  it('split: plane, offset, flip, the two names and which half to keep', () => {
    const m = mount(SPLIT);
    expect(m.texts(m.sel('planeChoice'))).toEqual(['Front Plane', 'Top Plane', 'Right Plane']);
    expect(m.num('offset').value).toBe('5');
    expect((m.q('names.0')!.querySelector('input') as HTMLInputElement).value).toBe('Base');
    fireEvent.change(m.sel('planeChoice'), { target: { value: 'std:top' } });
    expect(m.drafts.at(-1)).toMatchObject({ plane: { kind: 'std', id: 'top' } });
    fireEvent.change(m.sel('keep'), { target: { value: 'above' } });
    expect(m.drafts.at(-1)).toMatchObject({ keep: 'above' });
    fireEvent.change(m.q('names.1')!.querySelector('input')!, { target: { value: 'Cover' } });
    expect(m.drafts.at(-1)).toMatchObject({ names: ['Base', 'Cover'] });
    fireEvent.click(m.box('flip'));
    expect(m.drafts.at(-1)).toMatchObject({ flip: true });
    expect(m.q('target')).toBeNull();    // one body: nothing to choose
  });
  it('lip joint: height, width as a fraction or in mm, centred or inset, clearance, tongue side', () => {
    const m = mount({ type: 'lipJoint', id: 'F4', plane: { kind: 'std', id: 'front' }, height: 1.5, widthRatio: 0.5, clearance: 0.2, names: ['Base', 'Lid'] });
    expect(m.num('height').value).toBe('1.5');
    expect(m.num('widthRatio').value).toBe('0.5');
    expect(m.q('width')).toBeNull();
    expect(m.q('inset')).toBeNull();     // centred by default
    expect(m.num('clearance').value).toBe('0.2');
    fireEvent.change(m.sel('widthMode'), { target: { value: 'mm' } });
    expect(m.drafts.at(-1)).toMatchObject({ width: 1, widthRatio: null });
    expect(m.q('width')).not.toBeNull();
    fireEvent.click(m.box('centred'));
    expect(m.drafts.at(-1)).toMatchObject({ inset: 0.5 });
    expect(m.q('inset')).not.toBeNull();
    fireEvent.change(m.sel('tongue'), { target: { value: 'above' } });
    expect(m.drafts.at(-1)).toMatchObject({ tongue: 'above' });
    fireEvent.change(m.num('clearance'), { target: { value: '0.3' } });
    expect(m.drafts.at(-1)).toMatchObject({ clearance: 0.3 });
  });
  it('lip joint: the two names are shown from the document and written back as a pair (names: [below, above])', () => {
    const m = mount({ type: 'lipJoint', id: 'F4', plane: { kind: 'std', id: 'front' }, height: 1.5, widthRatio: 0.5, names: ['Base', 'Lid'] });
    const inp = (i: number) => m.q(`names.${i}`)!.querySelector('input') as HTMLInputElement;
    expect([inp(0).value, inp(1).value]).toEqual(['Base', 'Lid']);
    fireEvent.change(inp(0), { target: { value: ' Bottom ' } });
    expect(m.drafts.at(-1)).toMatchObject({ names: ['Bottom', 'Lid'] });
    fireEvent.change(inp(1), { target: { value: 'Top' } });
    expect(m.drafts.at(-1)).toMatchObject({ names: ['Bottom', 'Top'] });
    // a feature without names shows empty fields; typing one name writes the pair with the other blank (the kernel rejects that, the form says so)
    const bare = mount({ type: 'split', id: 'F5', plane: { kind: 'std', id: 'front' } });
    fireEvent.change(bare.q('names.0')!.querySelector('input')!, { target: { value: 'Base' } });
    expect(bare.drafts.at(-1)).toMatchObject({ names: ['Base', ''] });
  });
  it('a cut after a lip joint can be aimed at one half: the Cut from list names Base and Lid', () => {
    const CUT = { type: 'extrude', id: 'F5', op: 'cut', sketch: 'F4s', end: 'blind', depth: 3 };
    const doc = { format: 'ck-part', version: 1, features: [
      { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1' },
      { type: 'lipJoint', id: 'F4', plane: { kind: 'std', id: 'front' }, height: 1.5, names: ['Base', 'Lid'] },
      CUT,
    ] } as never;
    const m = mount(CUT, { options: (a) => optionsFor(a, doc) });
    expect(m.box('target.all').checked).toBe(true);
    fireEvent.click(m.box('target.Lid'));
    expect(m.drafts.at(-1)).toMatchObject({ target: [{ body: 'Lid' }] });
    expect(m.q('target.Base')).not.toBeNull();
  });
  it('the plane stays pickable from a face in the generic Plane section', () => {
    const m = mount(SPLIT);
    expect(m.q('plane')).not.toBeNull();
  });
});
