import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { Ribbon, type Command } from './Ribbon';
import { StatusBar } from './StatusBar';

afterEach(cleanup);

const commands: Command[] = [
  { id: 'open', label: 'Open', tab: 'Home', group: 'File', run: () => {} },
  { id: 'save', label: 'Save', tab: 'Home', group: 'File', run: () => {} },
  { id: 'undo', label: 'Undo', tab: 'Home', group: 'Edit', run: () => {} },
  { id: 'front', label: 'Front', tab: 'View', group: 'Camera', run: () => {} },
  { id: 'disabled-thing', label: 'Nope', tab: 'Home', group: 'Edit', enabled: () => false, run: () => {} },
];

describe('Ribbon', () => {
  it('renders only the commands of the active tab, grouped by group', () => {
    const { container } = render(<Ribbon commands={commands} activeTab="Home" onTab={() => {}} />);
    expect(container.textContent).toContain('Open');
    expect(container.textContent).toContain('Save');
    expect(container.textContent).toContain('Undo');
    expect(container.textContent).not.toContain('Front');
    expect(container.querySelectorAll('.rb-group').length).toBe(2);
  });

  it('disables a button when enabled() returns false and runs on click', () => {
    const run = vi.fn();
    const { container } = render(
      <Ribbon commands={[...commands, { id: 'x', label: 'X', tab: 'Home', group: 'Edit', run }]} activeTab="Home" onTab={() => {}} />,
    );
    const buttons = [...container.querySelectorAll('.rb-btn')] as HTMLButtonElement[];
    expect(buttons.find((b) => b.textContent === 'Nope')?.disabled).toBe(true);
    expect(buttons.find((b) => b.textContent === 'Undo')?.disabled).toBe(false);
    fireEvent.click(buttons.find((b) => b.textContent === 'X')!);
    expect(run).toHaveBeenCalledOnce();
  });

  it('calls onTab when a tab is clicked', () => {
    const onTab = vi.fn();
    const { container } = render(<Ribbon commands={commands} activeTab="Home" onTab={onTab} />);
    fireEvent.click([...container.querySelectorAll('*')].find((e) => e.textContent === 'View' && e.children.length === 0)!);
    expect(onTab).toHaveBeenCalledWith('View');
  });
});

describe('StatusBar', () => {
  it('shows the last notice and Busy when busy', () => {
    const { container } = render(
      <StatusBar
        notices={[{ id: 1, text: 'older', level: 'info' }, { id: 2, text: 'Selection lost: F2.C1', level: 'warn' }]}
        hover={null}
        busy={true}
      />,
    );
    expect(container.textContent).toContain('Selection lost: F2.C1');
    expect(container.textContent).not.toContain('older');
    expect(container.textContent).toContain('Busy');
  });

  it('shows the hover name and no Busy when idle', () => {
    const { container } = render(<StatusBar notices={[]} hover="F2.S.e1" busy={false} />);
    expect(container.textContent).toContain('F2.S.e1');
    expect(container.textContent).not.toContain('Busy');
  });
});
