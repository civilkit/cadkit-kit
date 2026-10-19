import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { DiagnosticsCard } from './DiagnosticsCard';
import { diagnose, type DiagFeature } from './errorSummary';
import { adviceOf, summaryLine } from './diagnosticsText';
import './locales/en';
import { registerCatalog } from '@kit/i18n';
import { en } from './locales/en';

registerCatalog('en', en);
afterEach(cleanup);

const feats: DiagFeature[] = [
  { id: 'F13', type: 'loft' }, { id: 'F2', type: 'surfaceRevolve' },
  { id: 'F14', type: 'trimSurface', name: 'Trim', surface: 'F13', toolSurface: 'F2' },
  { id: 'F28', type: 'shell', name: 'Shell 2 mm', faces: ['F14.S.e1'] },
  { id: 'F30', type: 'extrude', name: 'Bosses' },
];
const d = diagnose([
  { id: 'F14', code: 'trimNoIntersection', params: { detail: 'the surfaces do not cut each other' } },
  { id: 'F28', code: 'nothingToCut' }, { id: 'F30', code: 'nothingToCut' },
], feats);

describe('summary text', () => {
  it('names the cause and counts what it blocked', () => {
    expect(summaryLine(d)).toBe('The edit broke the model at F14 Trim: the surfaces do not cut each other. 2 later features could not be built because of it.');
    expect(adviceOf(d.roots[0])).toBe('The trim tool no longer crosses the surface. Try a smaller change or move the tool.');
  });
  it('every code of the ten most common has plain advice (not the generic one)', () => {
    const generic = en['diag.advice.generic'];
    for (const code of ['trimNoIntersection', 'nothingToCut', 'cutNoEffect', 'missingReference', 'missingEdge', 'booleanFailed', 'fillInvalid', 'filletChamfer', 'shellFailed', 'noClosedProfile']) {
      const r = diagnose([{ id: 'F14', code }], feats).roots[0];
      expect(adviceOf(r)).not.toBe(generic);
    }
  });
});

describe('DiagnosticsCard', () => {
  it('shows the cause, folds the consequences away, and each one is clickable', () => {
    const picked: string[] = [];
    const { container, getByText } = render(<DiagnosticsCard diagnosis={d} onSelect={(id) => picked.push(id)} onUndo={() => picked.push('undo')} />);
    expect(container.textContent).toContain('The edit broke the model at F14 Trim');
    expect(container.querySelector('.diag-list')).toBeNull();
    fireEvent.click(getByText('Select F14'));
    fireEvent.click(getByText('Show 2 consequences'));
    const items = container.querySelectorAll('.diag-item');
    expect(items.length).toBe(2);
    fireEvent.click(items[0]);
    fireEvent.click(getByText('Undo this change'));
    expect(picked).toEqual(['F14', 'F28', 'undo']);
  });
  it('while an editor is open the button is Cancel, not Undo', () => {
    let cancelled = 0;
    const { queryByText, getByText } = render(<DiagnosticsCard diagnosis={d} variant="editor" onSelect={() => {}} onUndo={() => {}} onCancel={() => { cancelled++; }} />);
    expect(queryByText('Undo this change')).toBeNull();
    fireEvent.click(getByText('Cancel edit'));
    expect(cancelled).toBe(1);
  });
  it('copy puts the full raw error list on the clipboard', async () => {
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => { copied = t; } }, configurable: true });
    const { getByText } = render(<DiagnosticsCard diagnosis={d} onSelect={() => {}} />);
    fireEvent.click(getByText('Copy all errors'));
    await Promise.resolve();
    expect(copied.split('\n').length).toBe(3);
    expect(copied).toContain('F14: trimNoIntersection');
  });
});

describe('rounding refusals', () => {
  const fil: DiagFeature[] = [{ id: 'F2', type: 'extrude' }, { id: 'F3', type: 'fillet', name: 'Fillet', edges: [] }];
  const dd = diagnose([{ id: 'F3', code: 'blendOverflow', params: { detail: 'F3.B0: spring leaves its face away from its edges' } }], fil);
  it('the summary leads with plain words and keeps the kernel detail', () => {
    expect(summaryLine(dd)).toBe('The edit broke the model at F3 Fillet: the rounding runs off the faces beside it (F3.B0: spring leaves its face away from its edges).');
  });
  it('every blend code has its own advice, and the editor card shows it', () => {
    const generic = en['diag.advice.generic'];
    for (const code of ['blendOverflow', 'blendTooLarge', 'blendFailed', 'blendUnsupported', 'chamferVertexEdges']) expect(adviceOf(diagnose([{ id: 'F3', code }], fil).roots[0])).not.toBe(generic);
    const { container } = render(<DiagnosticsCard diagnosis={dd} variant="editor" onSelect={() => {}} />);
    expect(container.querySelector('.diag-summary')!.textContent).toContain('spring leaves its face');
    expect(container.querySelector('.diag-advice')!.textContent).toContain('smaller radius');
  });
});
