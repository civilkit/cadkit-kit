import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { FramePanel } from './FramePanel';
import { CutListDialog } from './CutListDialog';
import { DEFAULT_FRAME, type FrameParams } from './frameLib';
import '../i18n';

afterEach(() => cleanup());

const SK = [{ id: 'F1', label: 'F1', lines: ['e1', 'e2', 'e3', 'e4'] }];

function mount(skeletons = SK, params: FrameParams = DEFAULT_FRAME) {
  const drafts: FrameParams[] = [], applies: FrameParams[] = [];
  const r = render(<FramePanel params={params} skeletons={skeletons} onDraft={(d) => drafts.push(d)} onApply={(d) => applies.push(d)} onCancel={() => {}} />);
  const select = (path: string) => r.container.querySelector(`[data-path="${path}"] select`) as HTMLSelectElement;
  return { r, drafts, applies, select };
}

describe('FramePanel', () => {
  it('takes the last sketch with lines as the skeleton and previews at once', () => {
    const m = mount();
    expect(m.drafts).toHaveLength(1);
    expect(m.drafts[0]).toMatchObject({ sketch: 'F1', profile: 'tslot-2020', corner: 'butt' });
  });
  it('a profile brings its usual corner; unticking a line leaves it out; Create applies', () => {
    const m = mount();
    fireEvent.change(m.select('profile'), { target: { value: 'shs-40x40x2' } });
    expect(m.drafts.at(-1)).toMatchObject({ profile: 'shs-40x40x2', corner: 'mitre' });
    const box = m.r.container.querySelector('input[aria-label="e3"]') as HTMLInputElement;
    fireEvent.click(box);
    expect(m.drafts.at(-1)?.segments).toEqual(['e1', 'e2', 'e4']);
    fireEvent.click(m.r.getByTestId('frame-apply'));
    expect(m.applies.at(-1)?.segments).toEqual(['e1', 'e2', 'e4']);
  });
  it('without a sketch of lines it says to draw one and cannot create', () => {
    const m = mount([]);
    expect(m.r.getByTestId('frame-no-skeleton')).toBeTruthy();
    expect((m.r.getByTestId('frame-apply') as HTMLButtonElement).disabled).toBe(true);
    expect(m.drafts).toHaveLength(0);
  });
});

describe('CutListDialog', () => {
  it('shows the grouped pieces and the bill of materials', () => {
    const frames = [{ id: 'F2', members: [1, 2].map((k) => ({ segment: 'e' + k, body: 'F2 M' + k, profile: 'tslot-2020', label: 'T-slot 20 x 20', length: 500, angles: [0, 0] as [number, number], ends: ['free', 'free'] as [string, string], volume: 1000 })) }];
    let csv = 0;
    const r = render(<CutListDialog frames={frames} onClose={() => {}} onCsv={() => { csv++; }} />);
    const rows = r.getByTestId('cutlist-table').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('500');
    expect(r.getByTestId('bom-table').textContent).toContain('End cap 20 x 20');
    fireEvent.click(r.getByTestId('cutlist-csv'));
    expect(csv).toBe(1);
  });
});
