import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { t } from './i18n';
import { StartCard } from './StartHereCard';
import { viewportHasContent, showStartCard, isStartDismissed, dismissStart, resetStartDismissal, startDismissed, type ViewportSources } from './startContent';

afterEach(() => { cleanup(); startDismissed.value = new Set(); });

const empty = (): ViewportSources => ({ doc: { features: [] }, meshes: 0, hasSolid: false, hasImportedBody: false, sketching: false, panelOpen: false, drawingOpen: false });
const with_ = (over: Partial<ViewportSources>): ViewportSources => ({ ...empty(), ...over });

describe('viewportHasContent: every source that fills the viewport', () => {
  it('an open document with nothing is empty; no document is not "content" either', () => {
    expect(viewportHasContent(empty())).toBe(false);
    expect(viewportHasContent(with_({ doc: null }))).toBe(false);
  });
  const cases: Array<[string, Partial<ViewportSources>]> = [
    ['a feature (sketch, 3D sketch, plane, axis, body)', { doc: { features: [{ type: 'plane' }] } }],
    ['a reference mesh', { meshes: 1 }],
    ['a solid on screen (loaded or library part)', { hasSolid: true }],
    ['a view-only imported body', { hasImportedBody: true }],
    ['a sketch open', { sketching: true }],
    ['a tool panel or dialog open (3D Sketch, feature editor, wizard)', { panelOpen: true }],
    ['the drawing workspace', { drawingOpen: true }],
    ['STEP data carried by the document', { doc: { features: [], blobs: { abc: 'x' } } }],
    ['a drawing sheet', { doc: { features: [], drawing: {} } }],
    ['cosmetic knurls', { doc: { features: [], cosmeticKnurls: [{}] } }],
  ];
  for (const [name, over] of cases) it('has content: ' + name, () => { expect(viewportHasContent(with_(over))).toBe(true); expect(showStartCard(with_(over), false)).toBe(false); });
  it('the exact screenshot case: no features, a mesh and the 3D Sketch panel open', () => {
    expect(showStartCard(with_({ meshes: 1, panelOpen: true }), false)).toBe(false);
  });
  it('is a pure function of its sources, so undo to empty brings the card back and redo hides it', () => {
    expect(showStartCard(with_({ doc: { features: [{}] } }), false)).toBe(false);
    expect(showStartCard(empty(), false)).toBe(true);
  });
});

describe('showStartCard and the dismissal', () => {
  it('shows on an empty document, not when dismissed, not without a document', () => {
    expect(showStartCard(empty(), false)).toBe(true);
    expect(showStartCard(empty(), true)).toBe(false);
    expect(showStartCard(with_({ doc: null }), false)).toBe(false);
  });
  it('dismissal is per tab and reset on demand', () => {
    dismissStart(3);
    expect(isStartDismissed(3)).toBe(true);
    expect(isStartDismissed(4)).toBe(false);
    resetStartDismissal(3);
    expect(isStartDismissed(3)).toBe(false);
  });
});

describe('StartCard', () => {
  const mk = () => { const p = { active: null, onHover: vi.fn(), onSketch: vi.fn(), onClose: vi.fn() }; render(<StartCard {...p} />); return p; };
  it('has a labelled Close button that dismisses it and is a real button (keyboard reachable)', () => {
    const p = mk();
    const b = screen.getByRole('button', { name: t('app.start.close') });
    expect(t('app.start.close')).toBe('Close');
    expect(b.tagName).toBe('BUTTON');
    fireEvent.click(b);
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(p.onSketch).not.toHaveBeenCalled();
  });
  it('still offers the three planes', () => {
    const p = mk();
    fireEvent.click(screen.getByRole('button', { name: /Top Plane/ }));
    expect(p.onSketch).toHaveBeenCalledWith('top');
    expect(screen.getByText(t('app.start.title'))).toBeTruthy();
  });
});
