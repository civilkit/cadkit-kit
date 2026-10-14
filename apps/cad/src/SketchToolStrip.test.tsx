import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/preact';
import { sketchTools } from '@kit/sketch';
import { ICON_NAMES } from '@kit/ui';
import { SketchToolStrip } from './SketchToolStrip';
import { buildCommands, type Actions } from './commands';
import './i18n';

afterEach(cleanup);

const actions: Actions = {
  open() {}, save() {}, samples() {}, undo() {}, redo() {}, palette() {}, toggleDrawer() {}, settings() {}, hasDocument: () => true, newPart() {}, addExtrude() {}, newSketch() {},
  setView() {}, fit() {}, setMode() {}, mode: () => 'face', toggleLayer() {}, layer: () => false,
};

describe('icons cover everything the UI offers', () => {
  it('every command id has an icon', () => {
    const missing = buildCommands(actions).map((c) => c.id).filter((id) => !ICON_NAMES.includes(id));
    expect(missing).toEqual([]);
  });
  it('every selection mode used by the selection bar has an icon', () => {
    expect(['face', 'edge', 'vertex'].filter((m) => !ICON_NAMES.includes('sel-' + m))).toEqual([]);
  });
});

describe('SketchToolStrip', () => {
  const count = sketchTools().length + 1;
  it('icons-and-text mode shows an icon and the name on every button, with group headings', () => {
    const { container } = render(<SketchToolStrip active={null} onPick={() => {}} labels="icons-and-text" />);
    const buttons = [...container.querySelectorAll('.stool')];
    expect(buttons.length).toBe(count);
    expect(buttons.every((b) => b.querySelector('svg.icon') && b.textContent!.trim().length > 0)).toBe(true);
    expect(container.querySelectorAll('.sgroup-name').length).toBe(4);
    expect(container.querySelector('.icon-only')).toBeNull();
    expect(container.querySelector('[data-icon="placeholder"]')).toBeNull();
  });
  it('is the default mode', () => {
    const { container } = render(<SketchToolStrip active={null} onPick={() => {}} />);
    expect(container.querySelector('.sgroup-name')).not.toBeNull();
  });
  it('icons mode shows only icons, drops the headings, labels buttons for assistive tech and has no native title', () => {
    const { container } = render(<SketchToolStrip active="line" onPick={() => {}} labels="icons" />);
    const buttons = [...container.querySelectorAll('.stool')] as HTMLElement[];
    expect(buttons.length).toBe(count);
    expect(buttons.every((b) => b.classList.contains('icon-only') && b.textContent === '' && !!b.getAttribute('aria-label') && !b.hasAttribute('title'))).toBe(true);
    expect(container.querySelectorAll('.sgroup-name').length).toBe(0);
    expect(container.querySelectorAll('[role="group"]').length).toBe(4);
    expect(container.querySelector('[data-icon="placeholder"]')).toBeNull();
    expect(container.querySelector('.stool[aria-pressed="true"]')!.getAttribute('aria-label')).toBe('Line');
  });
  it('shows the name and shortcut instantly on hover in icons mode, and picks on click', () => {
    const onPick = vi.fn();
    render(<SketchToolStrip active={null} onPick={onPick} labels="icons" />);
    const line = screen.getByRole('button', { name: 'Line' });
    fireEvent.pointerEnter(line, { pointerType: 'mouse' });
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Line');
    expect(tip.querySelector('kbd')!.textContent).toBe('L');
    fireEvent.click(line);
    expect(onPick).toHaveBeenCalledWith('line');
  });
});
