import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import './i18n';
import { FastenHoleWizard } from './FastenHoleWizard';
import type { FastenHole } from './fastenHole';
import type { FastenTarget } from './fasten';

afterEach(() => cleanup());

const hole = (face: string, over: Partial<FastenHole> = {}): FastenHole => ({
  face, diameter: 5.5, kind: 'plain', out: [0, 0, 1], mouth: [20, 15, 12], seat: [20, 15, 12], exit: [20, 15, 0], through: true, thickness: 12, grip: 12, seatDepth: 0,
  recessDiameter: null, openFace: 'P.C1', exitFace: 'P.C0', bothOpen: true, farRecess: false, ...over,
});
function mount(all: FastenHole[], pick = all[0].face, extra: { selected?: FastenHole[]; pattern?: FastenHole[]; hint?: string } = {}) {
  const drafts: FastenTarget[][] = [], applies: FastenTarget[][] = [];
  let cancelled = 0;
  const r = render(<FastenHoleWizard pick={pick} all={all} selected={extra.selected} pattern={extra.pattern} hint={extra.hint}
    read={(f, flip) => { const h = all.find((x) => x.face === f); return h ? (flip && h.bothOpen ? { ...h, out: [0, 0, -1], mouth: [20, 15, 0], seat: [20, 15, 0], exit: [20, 15, 12] } : h) : null; }}
    onDraft={(d) => drafts.push(d)} onApply={(d) => applies.push(d)} onCancel={() => { cancelled++; }} />);
  const q = (sel: string) => r.container.querySelector(sel) as HTMLElement;
  const select = (path: string) => r.container.querySelector(`[data-path="${path}"] select`) as HTMLSelectElement;
  const input = (path: string) => r.container.querySelector(`[data-path="${path}"] input`) as HTMLInputElement;
  return { r, drafts, applies, cancelled: () => cancelled, q, select, input };
}
const four = (over: Partial<FastenHole> = {}) => ['F4.S.h1', 'F4.S.h1@F9.1', 'F4.S.h1@F9.2', 'F4.S.h1@F9.3'].map((f) => hole(f, over));

describe('FastenHoleWizard', () => {
  it('starts from the hole: hex bolt for a plain hole, M5 clearance for 5.5 mm, the auto length, and previews at once', () => {
    const m = mount([hole('F4.S.h1')]);
    expect(m.q('[data-testid="fasten-hole"]').textContent).toBe('Plain hole, 5.5 mm, 12 mm through');
    expect(m.select('type').value).toBe('hex');
    expect(m.select('size').value).toBe('M5');
    expect(m.q('[data-testid="fasten-match"]').textContent).toMatch(/M5 clearance hole/);
    expect(m.q('[data-testid="fasten-match"]').getAttribute('data-fit')).toBe('clearance');
    expect(m.input('length').value).toBe('12');
    expect(m.q('[data-testid="fasten-length-why"]').textContent).toMatch(/Auto: 12 mm/);
    expect(m.drafts).toHaveLength(1);
    expect(m.drafts[0]).toHaveLength(1);
    expect(m.drafts[0][0].params).toMatchObject({ type: 'hex', size: 'M5', length: null });
  });
  it('says a 4.2 mm hole matched M5 tapped, and offers no nut for it', () => {
    const m = mount([hole('F4.S.h1', { diameter: 4.2 })]);
    expect(m.q('[data-testid="fasten-match"]').textContent).toMatch(/M5 tapped hole.*tap drill is 4.2/);
    expect(m.q('[data-testid="fasten-match"]').getAttribute('data-fit')).toBe('tap');
    expect(m.select('nut').disabled).toBe(true);
    expect(m.q('[data-testid="fasten-nut-why"]').textContent).toMatch(/tapped hole holds the bolt/);
  });
  it('a counterbore starts as a socket cap screw, a countersink as a countersunk screw (and takes no washer)', () => {
    const cb = mount([hole('F4.S.h1', { kind: 'cbore', recessDiameter: 10, seatDepth: 5, seat: [20, 15, 7], grip: 7, bothOpen: false })]);
    expect(cb.select('type').value).toBe('cap');
    expect(cb.q('[data-testid="fasten-type-why"]').textContent).toMatch(/counterbore takes a socket cap screw/);
    cleanup();
    const cs = mount([hole('F4.S.h1', { kind: 'csink', recessDiameter: 9.9, seatDepth: 2.2, bothOpen: false })]);
    expect(cs.select('type').value).toBe('countersunk');
    expect(cs.select('washer').disabled).toBe(true);
  });
  it('a blind hole: no nut, and the reason is said; the length is the longest that fits', () => {
    const m = mount([hole('F4.S.h1', { through: false, exit: null, exitFace: null, grip: 9.5, thickness: 9.5, bothOpen: false })]);
    expect(m.select('nut').disabled).toBe(true);
    expect(m.q('[data-testid="fasten-nut-why"]').textContent).toMatch(/blind/);
    expect(m.input('length').value).toBe('8');
    expect(m.q('[data-testid="fasten-length-why"]').textContent).toMatch(/longest standard length that fits 9.5 mm/);
  });
  it('washer and nut change the auto length and are in the draft; a typed length is kept until Auto', () => {
    const m = mount([hole('F4.S.h1')]);
    fireEvent.change(m.select('nut'), { target: { value: 'hex' } });
    expect(m.input('length').value).toBe('20');   // 12 + 4.7 = 16.7 -> 20
    fireEvent.change(m.select('washer'), { target: { value: 'both' } });
    expect(m.drafts.at(-1)![0].params).toMatchObject({ nut: true, washer: 'both', length: null });
    fireEvent.change(m.input('length'), { target: { value: '30' } });
    expect(m.drafts.at(-1)![0].params.length).toBe(30);
    expect(m.q('[data-testid="fasten-length-why"]').textContent).toMatch(/Your own length. Auto would be 20/);
    fireEvent.click(m.q('[data-testid="fasten-length-auto"]'));
    expect(m.drafts.at(-1)![0].params.length).toBeNull();
    // the washer under the nut needs the nut
    fireEvent.change(m.select('nut'), { target: { value: 'none' } });
    expect(m.drafts.at(-1)![0].params).toMatchObject({ nut: false, washer: 'head' });
  });
  it('identical holes on the plane: the count is shown, the box is on by default, off leaves one set; Add commits every hole in one call', () => {
    const all = [...four(), hole('F7.S.h1', { diameter: 3.4 })];
    const m = mount(all);
    const box = m.q('[data-path="identical"]');
    expect(box.textContent).toBe('3 more identical holes on this plane');
    expect((box.querySelector('input') as HTMLInputElement).checked).toBe(true);
    expect(m.q('[data-testid="fasten-count"]').getAttribute('data-count')).toBe('4');
    expect(m.q('[data-testid="fasten-count"]').textContent).toBe('4 sets of fasteners will be added.');
    expect(m.drafts.at(-1)!.map((x) => x.hole.face)).toEqual(['F4.S.h1', 'F4.S.h1@F9.1', 'F4.S.h1@F9.2', 'F4.S.h1@F9.3']);
    fireEvent.click(m.q('[data-testid="fasten-apply"]'));
    expect(m.applies).toHaveLength(1);
    expect(m.applies[0]).toHaveLength(4);
    fireEvent.click(box.querySelector('input')!);
    expect(m.q('[data-testid="fasten-count"]').getAttribute('data-count')).toBe('1');
    expect(m.drafts.at(-1)).toHaveLength(1);
    fireEvent.click(m.q('[data-testid="fasten-apply"]'));
    expect(m.applies.at(-1)).toHaveLength(1);
  });
  it('a lone hole shows no identical-holes box; one more identical hole says "1 more identical hole"', () => {
    const lone = mount([hole('F4.S.h1'), hole('F7.S.h1', { diameter: 3.4 })]);
    expect(lone.q('[data-path="identical"]')).toBeNull();
    expect(lone.q('[data-testid="fasten-count"]').textContent).toBe('One set of fasteners will be added.');
    cleanup();
    const two = mount([hole('F4.S.h1'), hole('F5.S.h1')]);
    expect(two.q('[data-path="identical"]').textContent).toBe('1 more identical hole on this plane');
  });
  it('other selected holes and pattern holes are separate boxes and get their own size', () => {
    const all = [hole('F4.S.h1'), hole('F7.S.h1', { diameter: 3.4 }), hole('F8.S.h1', { diameter: 6.6 })];
    const m = mount(all, 'F4.S.h1', { selected: [all[1]], pattern: [all[2]] });
    expect(m.q('[data-path="selected"]').textContent).toBe('1 more selected hole');
    expect(m.q('[data-path="pattern"]').textContent).toBe('1 more hole of this pattern');
    expect(m.drafts.at(-1)!.map((x) => [x.hole.face, x.params.size])).toEqual([['F4.S.h1', 'M5'], ['F7.S.h1', 'M3'], ['F8.S.h1', 'M6']]);
    fireEvent.click(m.q('[data-path="pattern"] input'));
    expect(m.drafts.at(-1)!.map((x) => x.hole.face)).toEqual(['F4.S.h1', 'F7.S.h1']);
  });
  it('the head on the other end is offered for a plain through hole only', () => {
    const m = mount([hole('F4.S.h1')]);
    expect(m.q('[data-path="flip"]')).not.toBeNull();
    fireEvent.click(m.q('[data-path="flip"] input'));
    expect(m.drafts.at(-1)![0].hole.out).toEqual([0, 0, -1]);
    cleanup();
    expect(mount([hole('F4.S.h1', { bothOpen: false })]).q('[data-path="flip"]')).toBeNull();
  });
  it('a problem blocks Add and says what: a washer too wide for the counterbore', () => {
    const m = mount([hole('F4.S.h1', { kind: 'cbore', recessDiameter: 10, seatDepth: 5, seat: [20, 15, 7], grip: 7, bothOpen: false })]);
    expect(m.q('[data-testid="fasten-apply"]').hasAttribute('disabled')).toBe(false);
    fireEvent.change(m.select('washer'), { target: { value: 'head' } });
    const bad = m.q('.thread-fit.bad');
    expect(bad.getAttribute('data-issue')).toBe('washerRecess');
    expect(bad.textContent).toMatch(/does not fit in the counterbore/);
    expect(m.q('[data-testid="fasten-apply"]').hasAttribute('disabled')).toBe(true);
    fireEvent.click(m.q('[data-testid="fasten-apply"]'));
    expect(m.applies).toHaveLength(0);
  });
  it('Escape and the Cancel button cancel; Enter adds; the preview hint shows', () => {
    const m = mount([hole('F4.S.h1')], undefined, { hint: 'preview failed' });
    expect(m.q('[data-testid="fasten-hint"]').textContent).toBe('preview failed');
    fireEvent.keyDown(m.q('[data-testid="fasten-wizard"]'), { key: 'Enter' });
    expect(m.applies).toHaveLength(1);
    fireEvent.keyDown(m.q('[data-testid="fasten-wizard"]'), { key: 'Escape' });
    fireEvent.click(m.q('[data-testid="fasten-cancel"]'));
    expect(m.cancelled()).toBe(2);
  });
});
