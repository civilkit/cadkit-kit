import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { ImportReportDialog } from './ImportReportDialog';
import type { ImportPart } from './importReport';
import '../i18n';

afterEach(cleanup);

const parts: ImportPart[] = [
  { label: 'Bracket', outcome: 'solid', faces: 12, facesTotal: 12, reasons: [] },
  { label: 'Cover', outcome: 'surface', faces: 5, facesTotal: 6, surface: 'F1.P2', reasons: [
    { code: 'badEntity', faces: ['#106'], message: 'face #106 could not be read: referenced entity not found' },
    { code: 'SHELL_OPEN', faces: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], message: 'the faces do not close up: 4 edges belong to one face only' },
  ] },
  { label: 'solid #900', outcome: 'refused', faces: 0, facesTotal: 3, reasons: [{ code: 'unsupported', faces: ['#901'], message: 'face #901 could not be read' }] },
];

describe('ImportReportDialog', () => {
  it('lists every part with what became of it and why, naming the faces', () => {
    render(<ImportReportDialog name="cover.step" parts={parts} onClose={() => {}} onRepair={() => {}} />);
    const d = screen.getByRole('dialog');
    expect(d.textContent).toContain('cover.step');
    expect(d.querySelectorAll('.import-part')).toHaveLength(3);
    expect(d.querySelector('[data-outcome="solid"]')!.textContent).toContain('Bracket');
    const s = d.querySelector('[data-outcome="surface"]')!;
    expect(s.textContent).toContain('5 of 6');
    expect(s.textContent).toContain('face #106 could not be read');
    expect(s.querySelector('[data-code="SHELL_OPEN"]')!.textContent).toContain('and 2 more');
    expect(d.querySelector('[data-outcome="refused"]')!.textContent).toContain('Not imported');
  });

  it('Repair is offered only when a part is a surface body, and runs once clicked; Escape closes', () => {
    const on = { onRepair: vi.fn(), onClose: vi.fn() };
    render(<ImportReportDialog name="x" parts={parts} viewOnly {...on} />);
    expect(screen.getByRole('dialog').textContent).toContain('editable part');
    fireEvent.click(screen.getByText('Repair'));
    expect(on.onRepair).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(on.onClose).toHaveBeenCalledTimes(1);
    cleanup();
    render(<ImportReportDialog name="x" parts={[parts[0], parts[2]]} {...on} />);
    expect(screen.queryByText('Repair')).toBeNull();
  });
});
