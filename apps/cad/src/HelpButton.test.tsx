import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen, act } from '@testing-library/preact';
import { FeatureEditor, StatusBar } from '@kit/ui';
import { DEFAULT_SKETCH_PREFS } from './sketchPrefs';
import { SketchBar } from './SketchBar';
import { HelpButton, HelpHost } from './HelpButton';
import { closeHelp, helpOpen } from './helpState';
import type { HelpContext } from './helpMap';
import './i18n';

afterEach(() => { cleanup(); closeHelp(); });

const app = (ctx: HelpContext = {}) => render(<div><HelpButton topic="sketch:trim" /><HelpButton topic="guide" /><input data-testid="box" /><HelpHost context={() => ctx} /></div>);

describe('help button and card', () => {
  it('shows a labelled ? button', () => {
    app();
    const b = screen.getAllByTestId('help-btn')[0];
    expect(b.textContent).toBe('?');
    expect(b.getAttribute('aria-label')).toBe('Help: Trim');
    expect(b.getAttribute('aria-expanded')).toBe('false');
  });
  it('opens a card with the name, the sentence and a guide link, not the page itself', () => {
    app();
    const open = vi.spyOn(window, 'open');
    fireEvent.click(screen.getAllByTestId('help-btn')[0]);
    const card = screen.getByTestId('help-card');
    expect(card.textContent).toMatch(/Trim/);
    expect(card.textContent).toMatch(/removes? it|remove it/i);
    const link = screen.getByTestId('help-link') as HTMLAnchorElement;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.href).toMatch(/^https?:\/\/.+\/docs\/cad\/sketching\/tools\.html#tool-trim$/);
    expect(open).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('help-btn')[0].getAttribute('aria-expanded')).toBe('true');
  });
  it('a second tap on the button closes the card', () => {
    app();
    const b = screen.getAllByTestId('help-btn')[0];
    fireEvent.click(b);
    fireEvent.click(b);
    expect(screen.queryByTestId('help-card')).toBeNull();
  });
  it('Escape closes it, and the key does not reach an editor underneath', () => {
    const under = vi.fn();
    document.addEventListener('keydown', under);
    app();
    fireEvent.click(screen.getAllByTestId('help-btn')[0]);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('help-card')).toBeNull();
    expect(under).not.toHaveBeenCalled();
    document.removeEventListener('keydown', under);
  });
  it('a tap outside closes it; a tap inside does not', async () => {
    app();
    await act(async () => { fireEvent.click(screen.getAllByTestId('help-btn')[0]); });
    screen.getByTestId('help-card').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(screen.getByTestId('help-card')).toBeTruthy();
    await act(async () => { screen.getByTestId('box').dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(screen.queryByTestId('help-card')).toBeNull();
  });
  it('stays inside the window: it is placed from the button and clamped', () => {
    app();
    fireEvent.click(screen.getAllByTestId('help-btn')[0]);
    const el = screen.getByTestId('help-card');
    expect(el.style.visibility).toBe('visible');
    expect(parseFloat(el.style.left)).toBeGreaterThanOrEqual(4);
    expect(parseFloat(el.style.top)).toBeGreaterThanOrEqual(4);
  });
});

describe('F1 and ?', () => {
  it('F1 opens the card for the current tool', () => {
    app({ sketching: true, tool: 'circle' });
    fireEvent.keyDown(document.body, { key: 'F1' });
    expect(screen.getByTestId('help-card').getAttribute('data-topic')).toBe('sketch:circle');
  });
  it('F1 opens the card for a wizard, a feature editor and, with nothing open, the guide', () => {
    const { unmount } = app({ wizard: 'spring' });
    fireEvent.keyDown(document.body, { key: 'F1' });
    expect(screen.getByTestId('help-card').getAttribute('data-topic')).toBe('wizard:spring');
    unmount(); closeHelp();
    app({ feature: 'extrude' });
    fireEvent.keyDown(document.body, { key: 'F1' });
    expect(screen.getByTestId('help-card').getAttribute('data-topic')).toBe('feature:extrude');
    cleanup(); closeHelp();
    app({});
    fireEvent.keyDown(document.body, { key: 'F1' });
    expect(screen.getByTestId('help-card').getAttribute('data-topic')).toBe('guide');
  });
  it('? is the shortcut cheat sheet now, not help; F1 with Ctrl or Cmd is not taken', () => {
    app({ sketching: true, tool: 'line' });
    fireEvent.keyDown(document.body, { key: '?', shiftKey: true });
    expect(helpOpen()).toBeNull();
    fireEvent.keyDown(document.body, { key: 'F1', ctrlKey: true });
    expect(helpOpen()).toBeNull();
  });
  it('the card hangs from the button of that topic when it is on screen', () => {
    app({ sketching: true, tool: 'trim' });
    fireEvent.keyDown(document.body, { key: 'F1' });
    expect(helpOpen()?.anchor).toBe(screen.getAllByTestId('help-btn')[0]);
  });
});

describe('where the buttons are', () => {
  it('the feature editor header carries the button passed to it', () => {
    const r = render(<FeatureEditor feature={{ id: 'F1', type: 'extrude', name: 'Boss' }} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} headExtra={<HelpButton topic="feature:extrude" />} />);
    expect(r.container.querySelector('.fedit-head [data-help-topic="feature:extrude"]')).not.toBeNull();
  });
  it('the status bar has a global ? for the guide', () => {
    const r = render(<StatusBar hover={null} busy={false} help={<HelpButton topic="guide" />} />);
    expect(r.container.querySelector('.status [data-help-topic="guide"]')).not.toBeNull();
  });
  it('the sketch bar has a ? for the active tool, and for the sketch with none', () => {
    const props = { name: 'S', plane: 'Front', onOk: vi.fn(), onCancel: vi.fn(), construction: false, onConstruction: vi.fn(), onLookNormal: vi.fn(), status: null, busy: false, prefs: DEFAULT_SKETCH_PREFS, onPrefs: vi.fn(), onFullyDefine: vi.fn(), selected: 0, onClearSelection: vi.fn(), list: <div /> };
    const a = render(<SketchBar {...props} tool="offset" />);
    expect(a.container.querySelector('[data-help-topic="sketch:offset"]')).not.toBeNull();
    a.unmount();
    const b = render(<SketchBar {...props} tool={null} />);
    expect(b.container.querySelector('[data-help-topic="sketch"]')).not.toBeNull();
  });
  it('opening it from a button moves nothing else: act wrapper sanity', () => {
    app();
    act(() => { fireEvent.click(screen.getAllByTestId('help-btn')[1]); });
    expect(screen.getByTestId('help-card').textContent).toMatch(/user guide/i);
  });
});
