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
