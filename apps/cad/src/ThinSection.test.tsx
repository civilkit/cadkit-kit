import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import type { PartDoc } from '@ck/part-model';
import { FeatureEditor } from '@kit/ui';
import { optionsFor } from './FeatureOptions';
import './i18n';

afterEach(cleanup);
type Wire = Record<string, unknown>;

const sketch = (extra: Wire[] = []): Wire => ({
  type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'a', x: 20, y: 0 }, { id: 'b', x: 0, y: 0 }, { id: 'c', x: 0, y: 40 }, { id: 'd', x: 20, y: 40 }, { id: 'g', x: 20, y: 4 }],
  entities: [{ type: 'line', id: 'e1', p1: 'a', p2: 'b' }, { type: 'line', id: 'e2', p1: 'b', p2: 'c' }, { type: 'line', id: 'e3', p1: 'c', p2: 'd' }, { type: 'line', id: 'e4', p1: 'd', p2: 'g' }, ...extra],
  constraints: [],
});
const doc = (...f: Wire[]): PartDoc => ({ format: 'ck-part', version: 1, name: 't', features: f, seq: 9 }) as unknown as PartDoc;
const EXTRUDE = { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 5 };

function mount(feature: Wire, d: PartDoc, actions?: { closeWithLine(id: string): void; asSurface(): void; cutProblem?: 'nothing' | 'miss' | null }) {
  const drafts: Wire[] = [];
  const r = render(<FeatureEditor feature={feature} onDraft={(x) => drafts.push(x)} onConfirm={() => {}} onCancel={() => {}} options={(a) => optionsFor(a, d, actions)} />);
  const q = (sel: string) => r.container.querySelector(sel) as HTMLElement | null;
  return { ...r, drafts, q };
}

describe('open profile hint card', () => {
  it('replaces the dead end with three actions and the gap', () => {
    const m = mount(EXTRUDE, doc(sketch(), EXTRUDE));
    const card = m.q('[data-card="open-profile"]')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('4 mm apart');
    expect(card.textContent).toContain('Almost closed');
    expect([...card.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Make thin wall', 'Close with a line', 'Extrude as surface']);
  });
  it('a single open chain also points to Rib for a web; a revolve or a second chain does not', () => {
    const m = mount(EXTRUDE, doc(sketch(), EXTRUDE));
    expect(m.q('[data-note="rib"]')!.textContent).toMatch(/Rib/);
    cleanup();
    const rev = mount({ ...EXTRUDE, type: 'revolve', axis: 'e9' }, doc(sketch(), EXTRUDE));
    expect(rev.q('[data-note="rib"]')).toBeNull();
    cleanup();
    const base = sketch();
    const twoChains = { ...base, points: [...(base.points as Wire[]), { id: 'h', x: 50, y: 0 }, { id: 'i', x: 60, y: 9 }], entities: [...(base.entities as Wire[]), { type: 'line', id: 'e8', p1: 'h', p2: 'i' }] };
    const two = mount(EXTRUDE, doc(twoChains, EXTRUDE));
    expect(two.q('[data-card="open-profile"]')).not.toBeNull();
    expect(two.q('[data-note="rib"]')).toBeNull();
  });
  it('Make thin wall turns the option on with the default thickness (10% of the profile, 1 mm at least)', () => {
    const m = mount(EXTRUDE, doc(sketch(), EXTRUDE));
    fireEvent.click(m.q('[data-act="thin"]')!);
    expect(m.drafts.at(-1)).toEqual({ thin: { thickness: 4.5, side: 'inside', ends: 'flat', cornerStyle: 'mitre' } });
  });
  it('Close with a line and Extrude as surface call the app', () => {
    const actions = { closeWithLine: vi.fn(), asSurface: vi.fn() };
    const m = mount(EXTRUDE, doc(sketch(), EXTRUDE), actions);
    fireEvent.click(m.q('[data-act="close"]')!);
    expect(actions.closeWithLine).toHaveBeenCalledWith('F1');
    fireEvent.click(m.q('[data-act="surface"]')!);
    expect(actions.asSurface).toHaveBeenCalled();
  });
  it('a revolve has no surface action; a closed sketch has no card', () => {
    const m = mount({ ...EXTRUDE, type: 'revolve', axis: 'e9' }, doc(sketch(), EXTRUDE));
    expect(m.q('[data-card="open-profile"]')).not.toBeNull();
    expect(m.q('[data-act="surface"]')).toBeNull();
    cleanup();
    const closed = mount(EXTRUDE, doc(sketch([{ type: 'line', id: 'e5', p1: 'g', p2: 'a' }]), EXTRUDE));
    expect(closed.q('[data-card="open-profile"]')).toBeNull();
  });
});

describe('thin wall section', () => {
  const THIN = { ...EXTRUDE, thin: { thickness: 3, side: 'inside', ends: 'flat', cornerStyle: 'mitre' } };
  it('shows the controls once the box is ticked, and no card', () => {
    const off = mount(EXTRUDE, doc(sketch(), EXTRUDE));
    expect(off.q('[data-path="thin.thickness"]')).toBeNull();
    cleanup();
    const m = mount(THIN, doc(sketch(), THIN));
    expect(m.q('[data-card="open-profile"]')).toBeNull();
    expect((m.q('[data-path="thin.thickness"] input') as HTMLInputElement).value).toBe('3');
    expect([...m.q('[data-path="thin.side"]')!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Inside', 'Outside', 'Both', 'Mid']);
    expect(m.q('[data-path="thin.side"] [aria-checked="true"]')!.getAttribute('data-value')).toBe('inside');
    expect(m.q('[data-path="thin.ends"]')).not.toBeNull();       // the sketch is an open chain
    expect(m.q('[data-path="thin.thickness2"]')).toBeNull();
  });
  it('the side, ends and corner controls patch the option; both adds the second thickness', () => {
    const m = mount(THIN, doc(sketch(), THIN));
    fireEvent.click(m.q('[data-path="thin.side"] [data-value="both"]')!);
    expect(m.drafts.at(-1)).toEqual({ thin: { thickness: 3, side: 'both', ends: 'flat', cornerStyle: 'mitre', thickness2: 3 } });
    fireEvent.click(m.q('[data-path="thin.ends"] [data-value="round"]')!);
    expect((m.drafts.at(-1) as { thin: Wire }).thin.ends).toBe('round');
    fireEvent.click(m.q('[data-path="thin.cornerStyle"] [data-value="round"]')!);
    expect((m.drafts.at(-1) as { thin: Wire }).thin.cornerStyle).toBe('round');
  });
  it('the thickness takes an expression; unticking removes the option', () => {
    const m = mount(THIN, doc(sketch(), THIN));
    const input = m.q('[data-path="thin.thickness"] input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '=2*3' } });
    fireEvent.blur(input);
    expect((m.drafts.at(-1) as { thin: Wire }).thin.thickness).toBe('=2*3');
    fireEvent.click(m.q('[data-path="thin"] input[type="checkbox"]')!);
    expect(m.drafts.at(-1)).toEqual({ thin: null });
  });
});

describe('operation row', () => {
  const closed = (): Wire => ({ ...sketch(), entities: [{ type: 'line', id: 'e1', p1: 'a', p2: 'b' }, { type: 'line', id: 'e2', p1: 'b', p2: 'c' }, { type: 'line', id: 'e3', p1: 'c', p2: 'd' }, { type: 'line', id: 'e4', p1: 'd', p2: 'a' }] });
  const CUT = { ...EXTRUDE, op: 'cut' };
  it('offers New body, Add and Cut and switches between them', () => {
    const m = mount(CUT, doc(closed(), CUT));
    const btns = [...m.container.querySelectorAll('[data-path="op"] button')];
    expect(btns.map((b) => b.textContent)).toEqual(['New body', 'Add', 'Cut']);
    expect(m.q('[data-path="op"] [data-value="cut"]')!.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(m.q('[data-path="op"] [data-value="add"]')!);
    expect(m.drafts.at(-1)).toMatchObject({ op: 'add', flip: null });
  });
  it('a cut with no body shows the message and a one-click switch to Add', () => {
    const m = mount(CUT, doc(closed(), CUT), { closeWithLine() {}, asSurface() {}, cutProblem: 'nothing' });
    expect(m.q('[data-note="cut-nothing"]')!.textContent).toContain('Nothing to cut: no body under this sketch');
    fireEvent.click(m.q('[data-act="switch-add"]')!);
    expect(m.drafts.at(-1)).toMatchObject({ op: 'add' });
  });
  it('no message for an add, or when the cut works', () => {
    expect(mount(EXTRUDE, doc(closed(), EXTRUDE), { closeWithLine() {}, asSurface() {}, cutProblem: 'nothing' }).q('[data-note="cut-nothing"]')).toBeNull();
    expect(mount(CUT, doc(closed(), CUT)).q('[data-note="cut-nothing"]')).toBeNull();
  });
});
