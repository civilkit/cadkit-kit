import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { InsertWizard, NutWizard, StandoffWizard } from './FastenerWizards';
import { DEFAULT_INSERT, DEFAULT_NUT, DEFAULT_STANDOFF, type InsertParams, type NutParams, type StandoffParams } from './fasteners';
import './i18n';

afterEach(() => cleanup());

function mount<P>(C: (p: never) => unknown, params: P, extra: Record<string, unknown> = {}) {
  const drafts: P[] = [], applies: P[] = [];
  let cancelled = 0;
  const Comp = C as unknown as (p: Record<string, unknown>) => import('preact').JSX.Element;
  const r = render(<Comp params={params} {...extra} onDraft={(d: P) => drafts.push(d)} onApply={(d: P) => applies.push(d)} onCancel={() => { cancelled++; }} />);
  const q = (sel: string) => r.container.querySelector(sel) as HTMLElement;
  const input = (path: string) => r.container.querySelector(`[data-path="${path}"] input`) as HTMLInputElement;
  const select = (path: string) => r.container.querySelector(`[data-path="${path}"] select`) as HTMLSelectElement;
  return { r, drafts, applies, cancelled: () => cancelled, q, input, select };
}

describe('NutWizard', () => {
  it('previews its defaults at once, shows the standard and the unverified note', () => {
    const m = mount<NutParams>(NutWizard, DEFAULT_NUT);
    expect(m.drafts).toHaveLength(1);
    expect(m.q('[data-testid="nut-summary"]').textContent).toContain('ISO 4032');
    expect(m.q('[data-testid="nut-summary"]').textContent).toContain('13 mm across flats');
    expect(m.q('[data-testid="nut-unverified"]').textContent).toMatch(/not yet checked/);
    expect(m.input('clearance')).toBeNull();   // only a modelled thread has a print clearance
  });
  it('every valid change drafts the whole record; style 2 drops the sizes below M5', () => {
    const m = mount<NutParams>(NutWizard, { ...DEFAULT_NUT, size: 'M3' });
    fireEvent.change(m.select('size'), { target: { value: 'M10' } });
    expect(m.drafts.at(-1)).toMatchObject({ size: 'M10', type: 'regular' });
    fireEvent.change(m.select('type'), { target: { value: 'thin' } });
    expect(m.drafts.at(-1)).toMatchObject({ size: 'M10', type: 'thin' });
    expect([...m.select('size').options].map((o) => o.value)).toContain('M2');
    fireEvent.change(m.select('size'), { target: { value: 'M3' } });
    fireEvent.change(m.select('type'), { target: { value: 'style2' } });
    expect(m.drafts.at(-1)).toMatchObject({ type: 'style2', size: 'M5' });   // M3 has no style 2 row
    expect([...m.select('size').options].map((o) => o.value)).not.toContain('M4');
    fireEvent.change(m.select('thread'), { target: { value: 'modeled' } });
    expect(m.input('clearance')).not.toBeNull();
    fireEvent.change(m.input('clearance'), { target: { value: '0.1' } });
    expect(m.drafts.at(-1)).toMatchObject({ thread: 'modeled', clearance: 0.1 });
    expect(m.q('[data-testid="fastener-modeled-note"]')).not.toBeNull();
    fireEvent.change(m.input('x'), { target: { value: '7' } });
    expect(m.drafts.at(-1)?.origin).toEqual([7, 0, 0]);
  });
  it('a clearance out of range blocks Add and the preview, and says why', () => {
    const m = mount<NutParams>(NutWizard, { ...DEFAULT_NUT, thread: 'modeled' });
    const before = m.drafts.length;
    fireEvent.change(m.input('clearance'), { target: { value: '2' } });
    expect(m.drafts.length).toBe(before);
    expect((m.q('[data-testid="nut-apply"]') as HTMLButtonElement).disabled).toBe(true);
    expect(m.q('[data-issue="clearance"]').textContent).toMatch(/between -1 and 1/);
    fireEvent.click(m.q('[data-testid="nut-apply"]'));
    expect(m.applies).toHaveLength(0);
  });
  it('Add applies the current record; Cancel and Escape cancel; the preview failure is shown', () => {
    const m = mount<NutParams>(NutWizard, DEFAULT_NUT, { hint: 'kernel said no' });
    expect(m.q('[data-testid="nut-hint"]').textContent).toBe('kernel said no');
    fireEvent.click(m.q('[data-testid="nut-apply"]'));
    expect(m.applies).toHaveLength(1);
    fireEvent.click(m.q('[data-testid="nut-cancel"]'));
    fireEvent.keyDown(m.q('[data-testid="nut-wizard"]'), { key: 'Escape' });
    expect(m.cancelled()).toBe(2);
  });
});

describe('StandoffWizard', () => {
  it('takes the table values of a size and of a shape', () => {
    const m = mount<StandoffParams>(StandoffWizard, DEFAULT_STANDOFF);
    expect(m.input('outer').value).toBe('6');
    fireEvent.change(m.select('kind'), { target: { value: 'hex' } });
    expect(m.drafts.at(-1)).toMatchObject({ kind: 'hex', outer: 5.5 });
    fireEvent.change(m.input('length'), { target: { value: '30' } });
    fireEvent.change(m.select('size'), { target: { value: 'M5' } });
    expect(m.drafts.at(-1)).toMatchObject({ size: 'M5', outer: 8, threadLength: 10, length: 30 });
  });
  it('a thread longer than the standoff blocks Add and says how long it may be', () => {
    const m = mount<StandoffParams>(StandoffWizard, DEFAULT_STANDOFF);
    const before = m.drafts.length;
    fireEvent.change(m.input('length'), { target: { value: '10' } });
    expect(m.drafts.length).toBe(before);
    expect(m.q('[data-issue="threadMeet"]').textContent).toMatch(/at most 5 mm/);
    expect((m.q('[data-testid="standoff-apply"]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(m.select('ends'), { target: { value: 'male-female' } });   // one thread: 6 mm in 10 mm is fine
    expect(m.q('[data-issue]')).toBeNull();
    expect(m.drafts.at(-1)).toMatchObject({ ends: 'male-female', length: 10 });
    expect(m.q('[data-testid="standoff-summary"]').textContent).toContain('Overall length 16 mm');
  });
  it('Add applies; Escape cancels', () => {
    const m = mount<StandoffParams>(StandoffWizard, DEFAULT_STANDOFF);
    fireEvent.click(m.q('[data-testid="standoff-apply"]'));
    expect(m.applies[0]).toMatchObject({ size: 'M3', length: 15 });
    fireEvent.keyDown(m.q('[data-testid="standoff-wizard"]'), { key: 'Escape' });
    expect(m.cancelled()).toBe(1);
  });
});

describe('InsertWizard', () => {
  it('shows the table row of a size and the press fit', () => {
    const m = mount<InsertParams>(InsertWizard, DEFAULT_INSERT);
    expect(m.input('holeDiameter').value).toBe('4');
    expect(m.q('[data-testid="insert-summary"]').textContent).toContain('0.3 mm bigger');
    expect(m.q('[data-testid="insert-unverified"]').textContent).toMatch(/typical catalogue values/);
    fireEvent.change(m.select('size'), { target: { value: 'M5' } });
    expect(m.drafts.at(-1)).toMatchObject({ size: 'M5', outer: 6.4, length: 9.5, holeDiameter: 5.8, holeDepth: 11 });
  });
  it('the hole option offers the document bodies and passes the choice on', () => {
    const m = mount<InsertParams>(InsertWizard, DEFAULT_INSERT, { bodies: ['Block', 'Lid'] });
    expect(m.select('holeIn')).toBeNull();   // no hole, nothing to choose
    expect(m.q('[data-testid="insert-hole-note"]')).toBeNull();
    fireEvent.click(m.input('hole'));
    expect(m.drafts.at(-1)?.hole).toBe(true);
    expect([...m.select('holeIn').options].map((o) => o.value)).toEqual(['', 'Block', 'Lid']);
    fireEvent.change(m.select('holeIn'), { target: { value: 'Lid' } });
    expect(m.drafts.at(-1)).toMatchObject({ hole: true, holeIn: 'Lid' });
    expect(m.q('[data-testid="insert-hole-note"]')).not.toBeNull();
  });
  it('a hole that does not fit the insert blocks Add', () => {
    const m = mount<InsertParams>(InsertWizard, DEFAULT_INSERT);
    const before = m.drafts.length;
    fireEvent.change(m.input('holeDiameter'), { target: { value: '5' } });
    expect(m.drafts.length).toBe(before);
    expect(m.q('[data-issue="holeDiameter"]').textContent).toMatch(/4\.6/);
    fireEvent.change(m.input('holeDiameter'), { target: { value: '4' } });
    fireEvent.change(m.input('holeDepth'), { target: { value: '5' } });
    expect(m.q('[data-issue="holeDepth"]').textContent).toMatch(/5\.7/);
    expect((m.q('[data-testid="insert-apply"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
