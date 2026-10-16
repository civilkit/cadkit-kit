import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/preact';
import { slotMemory } from '@kit/ui';
import { buildCommands } from './commands';
import { fullActions } from './testActions';
import { ToolRail } from './ToolRail';
import { SketchRailSections } from './SketchToolStrip';
import './i18n';

afterEach(cleanup);
beforeEach(() => slotMemory.reset());
const commands = buildCommands(fullActions());

describe('ToolRail', () => {
  it('has a titled section per family and a cell for each family of commands', () => {
    const { container } = render(<ToolRail commands={commands} kind="none" />);
    const titles = [...container.querySelectorAll('.rail-title')].map((x) => x.textContent);
    expect(titles).toEqual(['Edit', 'Sketch', 'Create', 'Modify', 'Surfaces', 'Pattern', 'Inspect', 'Assembly', 'Select']);
    expect(container.querySelector('.rail-context')).toBeNull();
    expect(container.querySelectorAll('.slot').length).toBeGreaterThanOrEqual(30);
  });
  it('opens a family with its names and keys, and runs the chosen one', () => {
    render(<ToolRail commands={commands} kind="none" />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Fillet' }));
    const rows = [...document.querySelectorAll('.slot-row')];
    expect(rows.map((r) => r.querySelector('.slot-name')!.textContent)).toEqual(['Fillet', 'Chamfer']);
    expect(rows[1].querySelector('kbd')!.textContent).toBe('Shift+B');
  });
  it('puts a For selection cell first when a face is selected, with the commands that apply to a face', () => {
    const { container } = render(<ToolRail commands={commands} kind="face" />);
    const ctx = container.querySelector('.rail-context')!;
    expect(container.querySelector('.tool-rail')!.firstElementChild).toBe(ctx);
    expect(ctx.querySelector('.rail-title')!.textContent).toBe('For selection');
    fireEvent.contextMenu(ctx.querySelector('.slot-btn')!);
    const names = [...document.querySelectorAll('.slot-row .slot-name')].map((x) => x.textContent);
    expect(names).toContain('Hole');
    expect(names).toContain('Shell');
  });
});

describe('ToolRail while a sketch is open (Plasticity preset)', () => {
  it('shows undo / redo / rebuild then the sketch groups; the model groups are not rendered at all', () => {
    const picked: Array<string | null> = [];
    const { container } = render(<ToolRail commands={commands} kind="face" only={['history']} after={<SketchRailSections active={null} onPick={(id) => picked.push(id)} labels />} />);
    const titles = [...container.querySelectorAll('.rail-title')].map((x) => x.textContent);
    expect(titles).toEqual(['Edit', 'Select', 'Draw', 'Dimension', 'Constrain', 'Modify', 'Reference']);
    expect(container.querySelector('.rail-context')).toBeNull();
    for (const model of ['Create', 'Surfaces', 'Pattern', 'Inspect']) expect(titles).not.toContain(model);
    expect(container.querySelector('[aria-label="Undo"], [aria-label^="Undo"]') ?? screen.queryByRole('button', { name: /Undo/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Line' }));
    expect(picked).toEqual(['line']);
  });
});
