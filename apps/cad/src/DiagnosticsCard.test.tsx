import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { DiagnosticsCard, DiagnosticsWarnings } from './DiagnosticsCard';
import { warningEntries } from './featureWarnings';
import { warningsById } from './threadData';
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
    expect(summaryLine(d)).toBe('Change not applied. Your model is unchanged. The surfaces do not cut each other. The trim tool no longer crosses the surface. Try a smaller change or move the tool.');
    expect(summaryLine(d, 'failed')).toMatch(/^Trim can't be rebuilt\. The surfaces do not cut each other\./);
    expect(summaryLine(d, 'preview')).toMatch(/^The surfaces do not cut each other\./);
    expect(adviceOf(d.roots[0])).toBe('The trim tool no longer crosses the surface. Try a smaller change or move the tool.');
  });
  it('every code of the ten most common has plain advice (not the generic one)', () => {
    for (const code of ['trimNoIntersection', 'nothingToCut', 'cutNoEffect', 'missingReference', 'missingEdge', 'booleanFailed', 'fillInvalid', 'filletChamfer', 'shellFailed', 'noClosedProfile']) {
      const r = diagnose([{ id: 'F14', code }], feats).roots[0];
      expect(adviceOf(r)).not.toBe('');
    }
  });
});

describe('DiagnosticsCard', () => {
  it('shows the cause, folds the consequences away, and each one is clickable', () => {
    const picked: string[] = [];
    const { container, getByText } = render(<DiagnosticsCard diagnosis={d} onSelect={(id) => picked.push(id)} onUndo={() => picked.push('undo')} />);
    expect(container.textContent).toContain("Trim can't be rebuilt.");
    expect(container.textContent).not.toMatch(/broke the model/);
    expect(container.querySelector('details.diag-details')!.hasAttribute('open')).toBe(false);
    fireEvent.click(getByText('Show in the tree'));
    const items = container.querySelectorAll('.diag-item');
    expect(items.length).toBe(2);
    fireEvent.click(items[0]);
    fireEvent.click(getByText('Undo this change'));
    expect(picked).toEqual(['F14', 'F28', 'undo']);
  });
  it('in an editor the card carries only one-click fixes (the causes are in the alert popover), and nothing when there are none', () => {
    const run: string[] = [];
    const none = render(<DiagnosticsCard diagnosis={d} variant="editor" onSelect={() => {}} onCancel={() => {}} />);
    expect(none.container.querySelector('.diag')).toBeNull();
    cleanup();
    const { container, getByText } = render(<DiagnosticsCard diagnosis={d} variant="editor" onSelect={() => {}} fixes={[{ key: 'flip', label: 'Flip direction', run: () => run.push('flip') }]} />);
    fireEvent.click(getByText('Flip direction'));
    expect(run).toEqual(['flip']);
    expect(container.querySelector('.diag-cause, .diag-advice')).toBeNull();
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
    expect(summaryLine(dd, 'preview')).toMatch(/^The fillet runs off the faces beside it\./);
    expect(summaryLine(dd, 'preview')).not.toMatch(/F3\.B0|spring/);   // the kernel's detail is developer text: Details only
  });
  it('every blend code has its own advice, and the editor card shows it', () => {
    for (const code of ['blendOverflow', 'blendTooLarge', 'blendFailed', 'blendUnsupported', 'chamferVertexEdges']) expect(adviceOf(diagnose([{ id: 'F3', code }], fil).roots[0])).not.toBe('');
  });
});

describe('DiagnosticsWarnings', () => {
  it('one entry per warning: the Warning tag, the feature as a link that selects it, the text and the advice', () => {
    const picked: string[] = [];
    const w = warningsById([
      ['F3', { code: 'blendRoundsCross', params: { detail: 'x', width: 4, radii: [3, 3], meetRadius: 2 } }],
      ['F3', { code: 'endRefRelinked', params: { from: 'a', to: 'b' } }],
    ]);
    const entries = warningEntries(w, [{ id: 'F3', type: 'fillet', name: 'Top rounds' }]);
    const { container } = render(<DiagnosticsWarnings entries={entries} onSelect={(id) => picked.push(id)} />);
    const items = container.querySelectorAll('.diag-warning');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute('data-warning')).toBe('blendRoundsCross');
    expect(items[0].querySelector('.diag-tag')!.textContent).toBe('Warning');
    expect(items[0].querySelector('.why')!.textContent).toMatch(/^The two fillets are wider than the face between them/);
    expect(items[0].querySelector('.diag-advice')!.textContent).toBe(en['diag.advice.blendRoundsCross']);
    expect(items[1].querySelector('.why')!.textContent).toBe('This feature built with a warning: endRefRelinked');
    expect(items[1].querySelector('.diag-advice')).toBeNull();
    const link = items[0].querySelector('button.diag-item') as HTMLElement;
    expect(link.textContent).toBe('F3 Top rounds');
    fireEvent.click(link);
    expect(picked).toEqual(['F3']);
  });
  it('info entries get the Info tag and are not styled as a warning', () => {
    const w = warningsById([['F1', { code: 'meshToSolidReport', params: { detail: '10000 triangles became 1 face' } }]]);
    const entries = warningEntries(w, [{ id: 'F1', type: 'meshToSolid', name: 'sphere' }]);
    const { container } = render(<DiagnosticsWarnings info entries={entries} onSelect={() => {}} />);
    const item = container.querySelector('.diag-warning')!;
    expect(item.classList.contains('warn')).toBe(false);
    expect(item.querySelector('.diag-tag')!.textContent).toBe('Info');
    expect(item.querySelector('.why')!.textContent).toBe('10000 triangles became 1 face');
  });
  it('nothing without warnings', () => {
    const { container } = render(<DiagnosticsWarnings entries={[]} onSelect={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('DiagnosticsCard in the editor (a preview that cannot be built)', () => {
  const dg = { roots: [{ id: 'F3', label: 'fillet', code: 'blendUnsupported', params: { detail: 'the rim is a closed smooth free-form curve; a round on a smooth closed spline rim is not supported yet', hint: 'close the profile' } }], consequences: [] } as never;
  it('the message the popover shows comes from the composer: one cause sentence, one action, no jargon', async () => {
    const { composeMessage } = await import('@kit/viewdata');
    const m = composeMessage({ roots: (dg as unknown as { roots: never[] }).roots, consequences: [], blockedBy: {} } as never, 'preview');
    expect(m.cause).toBe('This outline is a smooth curve, and a fillet on it is not supported yet.');
    expect(m.lead).toBe('');
    expect(`${m.cause} ${m.action}`).not.toMatch(/broke the model|free-form|spline|cannot be rounded yet/);
  });
});
