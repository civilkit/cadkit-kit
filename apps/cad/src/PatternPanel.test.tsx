import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import type { PanelSpec } from '@kit/sketch';
import { PatternPanel } from './PatternPanel';
import { en as catalogue } from './locales/en';
import './i18n';

const en = (k: string): string => String((catalogue as Record<string, unknown>)[k]);
afterEach(() => { cleanup(); vi.useRealTimers(); });

const panel = (canApply = true): PanelSpec => ({
  title: 'app.sketch.tool.pattern-linear',
  groups: [
    { id: 'dir1', title: 'app.sketch.pattern.dir1', rows: [
      { kind: 'number', id: 'n', label: 'app.sketch.pattern.count', value: 3, unit: 'count' },
      { kind: 'pick', id: 'pick1', label: 'app.sketch.pattern.direction', active: false, button: 'app.sketch.pattern.pickLine' },
      { kind: 'choice', id: 'tot1', label: 'app.sketch.pattern.distanceType', value: 0, options: ['app.sketch.pattern.spacing', 'app.sketch.pattern.totalLength'] },
      { kind: 'number', id: 'd', label: 'app.sketch.pattern.spacing', value: 20, unit: 'length' },
    ] },
    { id: 'dir2', title: 'app.sketch.pattern.dir2', rows: [{ kind: 'number', id: 'n2', label: 'app.sketch.pattern.count', value: 1, unit: 'count' }] },
  ],
  note: 'app.sketch.pattern.noteLinear',
  canApply,
});
const props = (c = true) => ({ panel: panel(c), onField: vi.fn(), onKey: vi.fn(), onCancel: vi.fn() });

describe('PatternPanel', () => {
  it('shows the groups with the feature editors\' words and every row', () => {
    const { container } = render(<PatternPanel {...props()} />);
    expect(screen.getByText(en('app.sketch.pattern.dir1'))).toBeTruthy();
    expect(screen.getByText(en('app.sketch.pattern.dir2'))).toBeTruthy();
    expect(container.querySelectorAll('[data-group="dir1"] [data-field]').length).toBe(4);
    expect((container.querySelector('[data-field="d"] input') as HTMLInputElement).value).toBe('20');
  });
  it('a number applies after the debounce and on Enter, as a locked value; an invalid entry does nothing', () => {
    vi.useFakeTimers();
    const p = props();
    const { container } = render(<PatternPanel {...p} />);
    const d = container.querySelector('[data-field="d"] input') as HTMLInputElement;
    fireEvent.input(d, { target: { value: '25' } });
    expect(p.onField).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(p.onField).toHaveBeenCalledWith('d', 25, true);
    p.onField.mockClear();
    fireEvent.input(d, { target: { value: 'abc' } });
    fireEvent.keyDown(d, { key: 'Enter' });
    expect(p.onField).not.toHaveBeenCalled();
  });
  it('a choice sends its index, a pick button starts picking, OK makes the pattern, Cancel leaves, Escape in a row goes to the tool', () => {
    const p = props();
    const { container } = render(<PatternPanel {...p} />);
    fireEvent.click(screen.getByText(en('app.sketch.pattern.totalLength')));
    expect(p.onField).toHaveBeenCalledWith('tot1', 1, true);
    fireEvent.click(screen.getByText(en('app.sketch.pattern.pickLine')));
    expect(p.onField).toHaveBeenCalledWith('pick1', 1, false);
    fireEvent.click(screen.getByTestId('pattern-ok'));
    expect(p.onKey).toHaveBeenCalledWith('Enter');
    fireEvent.click(screen.getByTestId('pattern-cancel'));
    expect(p.onCancel).toHaveBeenCalled();
    fireEvent.keyDown(container.querySelector('[data-field="n"] input')!, { key: 'Escape' });
    expect(p.onKey).toHaveBeenCalledWith('Escape');
  });
  it('OK is disabled when nothing would be made; moving the pointer onto the panel tells the tool to stop following it', () => {
    const p = props(false);
    render(<PatternPanel {...p} />);
    expect((screen.getByTestId('pattern-ok') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.pointerEnter(screen.getByTestId('pattern-panel'));
    expect(p.onField).toHaveBeenCalledWith('freeze', 1, false);
  });
});
