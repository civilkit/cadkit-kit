import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import type { PartDoc } from '@ck/part-model';
import { FeatureEditor } from '@kit/ui';
import { optionsFor } from './FeatureOptions';
import './i18n';

afterEach(cleanup);
type Wire = Record<string, unknown>;

const box = (n: number, name: string): Wire[] => [
  { type: 'sketch', id: `S${n}`, plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [] },
  { type: 'extrude', id: `E${n}`, op: 'newBody', sketch: `S${n}`, end: 'blind', depth: 5, body: name },
];
const cutter = (extra: Wire = {}): Wire => ({ type: 'extrude', id: 'C1', op: 'cut', sketch: 'S3', end: 'blind', depth: 5, ...extra });
const doc = (...f: Wire[]): PartDoc => ({ format: 'ck-part', version: 1, name: 't', features: f, seq: 9 }) as unknown as PartDoc;
const SK3: Wire = { type: 'sketch', id: 'S3', plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [] };

function mount(feature: Wire, d: PartDoc) {
  const drafts: Wire[] = [];
  const r = render(<FeatureEditor feature={feature} onDraft={(x) => drafts.push(x)} onConfirm={() => {}} onCancel={() => {}} options={(a) => optionsFor(a, d)} />);
  const q = (sel: string) => r.container.querySelector(sel) as HTMLElement | null;
  return { ...r, drafts, q };
}

describe('Cut from', () => {
  const D = (f: Wire) => doc(...box(1, 'Cup'), ...box(2, 'Lid'), SK3, f);
  it('lists the named bodies of the part with All bodies on, for a cut', () => {
    const m = mount(cutter(), D(cutter()));
    const g = m.q('[data-path="target"]')!;
    expect(g.textContent).toContain('Cut from');
    expect([...g.querySelectorAll('input[type="checkbox"]')].map((c) => (c as HTMLInputElement).checked)).toEqual([true, false, false]);
    expect(g.textContent).toContain('Cup');
    expect(g.textContent).toContain('Lid');
  });
  it('ticking a body writes a target list; ticking All again removes it', () => {
    const m = mount(cutter(), D(cutter()));
    const boxes = () => [...m.q('[data-path="target"]')!.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    fireEvent.click(boxes()[1]);
    expect(m.drafts.at(-1)).toEqual({ target: [{ body: 'Cup' }] });
  });
  it('shows the chosen bodies and unticks one', () => {
    const f = cutter({ target: [{ body: 'Cup' }, { body: 'Lid' }] });
    const m = mount(f, D(f));
    const boxes = [...m.q('[data-path="target"]')!.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    expect(boxes.map((c) => c.checked)).toEqual([false, true, true]);
    fireEvent.click(boxes[2]);
    expect(m.drafts.at(-1)).toEqual({ target: [{ body: 'Cup' }] });
  });
  it('an Add keeps the single Target body list, a New body has neither', () => {
    const add = { ...cutter(), op: 'add' };
    const a = mount(add, D(add));
    expect(a.q('[data-path="target"] select')).not.toBeNull();
    expect(a.q('[data-path="target"] input[type="checkbox"]')).toBeNull();
    cleanup();
    const nb = { ...cutter(), op: 'newBody', body: 'Z' };
    expect(mount(nb, D(nb)).q('[data-path="target"]')).toBeNull();
  });
  it('a revolve, a loft and a sweep cut get the control too', () => {
    for (const f of [{ type: 'revolve', id: 'C1', op: 'cut', sketch: 'S3', angle: 360 }, { type: 'loft', id: 'C1', op: 'cut', sketches: ['S3', 'S3'] }, { type: 'sweep', id: 'C1', op: 'cut', sketch: 'S3', path: { kind: 'sketch', id: 'S3' } }] as Wire[]) {
      const m = mount(f, D(f));
      expect(m.q('[data-path="target"]'), String(f.type)).not.toBeNull();
      cleanup();
    }
  });
});
