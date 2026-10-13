import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { Drawer } from './Drawer';
import { HistoryLog, type HistoryEntry } from './HistoryLog';
import { StatusBar } from './StatusBar';

afterEach(cleanup);

describe('Drawer', () => {
  const tabs = [
    { id: 'h', label: 'History', badge: 3, content: <p>history body</p> },
    { id: 'd', label: 'Diagnostics', badge: 1, bad: true, content: <p>diag body</p> },
  ];
  it('shows the active tab body, badges, and switches tabs', () => {
    const onTab = vi.fn();
    render(<Drawer tabs={tabs} active="h" onTab={onTab} onClose={() => {}} />);
    expect(screen.getByText('history body')).toBeTruthy();
    expect(screen.queryByText('diag body')).toBeNull();
    fireEvent.click(screen.getByText('Diagnostics'));
    expect(onTab).toHaveBeenCalledWith('d');
  });
  it('close button calls onClose; an unknown active id falls back to the first tab', () => {
    const onClose = vi.fn();
    render(<Drawer tabs={tabs} active="nope" onTab={() => {}} onClose={onClose} />);
    expect(screen.getByText('history body')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close drawer'));
    expect(onClose).toHaveBeenCalled();
  });
});

const E: HistoryEntry[] = [
  { id: '1', author: 'you', time: '09:12', title: 'Add sketch F1' },
  { id: '2', author: 'agent', time: '09:24', title: 'Set F8 count', reason: 'match the spec', chips: ['+2 bolts'], ops: 'set F8.count 6' },
  { id: '3', author: 'agent', time: '09:25', title: 'Rejected: no contact', failed: true, chips: ['mateNoContact'] },
];

describe('HistoryLog', () => {
  it('shows author, reason and chips, and marks failed entries', () => {
    const { container } = render(<HistoryLog entries={E} here={3} filter="All" onFilter={() => {}} onGoto={() => {}} />);
    expect(screen.getByText('match the spec', { exact: false })).toBeTruthy();
    expect(screen.getByText('+2 bolts')).toBeTruthy();
    expect(container.querySelectorAll('.he.fail').length).toBe(1);
  });
  it('filters by author and by failed', () => {
    const { container, rerender } = render(<HistoryLog entries={E} here={3} filter="Agent" onFilter={() => {}} onGoto={() => {}} />);
    expect(container.querySelectorAll('.he').length).toBe(2);
    rerender(<HistoryLog entries={E} here={3} filter="Failed" onFilter={() => {}} onGoto={() => {}} />);
    expect(container.querySelectorAll('.he').length).toBe(1);
  });
  it('puts the "model is here" line after the applied entries and dims later ones', () => {
    const { container } = render(<HistoryLog entries={E} here={1} filter="All" onFilter={() => {}} onGoto={() => {}} />);
    expect(container.querySelectorAll('.he.after').length).toBe(1);   // the second applied edit; the rejection is never dimmed
    const kids = [...container.querySelector('.hlog')!.children];
    expect(kids.findIndex((k) => k.classList.contains('here-line'))).toBe(1);
  });
  it('clicking an entry goes to just after it; revert goes to the current marker', () => {
    const onGoto = vi.fn();
    render(<HistoryLog entries={E} here={1} filter="All" onFilter={() => {}} onGoto={onGoto} />);
    fireEvent.click(screen.getByText('Set F8 count'));
    expect(onGoto).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByText(/Revert to step 1/));
    expect(onGoto).toHaveBeenLastCalledWith(1);
  });
  it('says so when there are no edits', () => {
    render(<HistoryLog entries={[]} here={0} filter="All" onFilter={() => {}} onGoto={() => {}} />);
    expect(screen.getByText('No edits yet.')).toBeTruthy();
  });
});

describe('HistoryLog with rejected entries', () => {
  const mixed: HistoryEntry[] = [
    { id: '1', author: 'you', time: '09:12', title: 'Edit one' },
    { id: 'r', author: 'you', time: '09:13', title: 'Rejected: no contact', failed: true },
    { id: '2', author: 'you', time: '09:14', title: 'Edit two' },
  ];
  it('a rejected entry is never dimmed and does not move the marker', () => {
    const { container } = render(<HistoryLog entries={mixed} here={1} filter="All" onFilter={() => {}} onGoto={() => {}} />);
    const items = [...container.querySelectorAll('.he')];
    expect(items.map((x) => x.classList.contains('after'))).toEqual([false, false, true]);
    const kids = [...container.querySelector('.hlog')!.children];
    expect(kids.findIndex((k) => k.classList.contains('here-line'))).toBe(1);
  });
  it('clicking a rejected entry keeps the applied count; clicking an applied one goes just after it', () => {
    const onGoto = vi.fn();
    render(<HistoryLog entries={mixed} here={2} filter="All" onFilter={() => {}} onGoto={onGoto} />);
    fireEvent.click(screen.getByText('Rejected: no contact'));
    expect(onGoto).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByText('Edit two'));
    expect(onGoto).toHaveBeenLastCalledWith(2);
  });
});

describe('StatusBar items', () => {
  it('shows Ready, items with tone, and a drawer toggle', () => {
    const onToggle = vi.fn();
    const { container } = render(<StatusBar notices={[]} hover={null} busy={false} items={[{ label: 'Faces', value: '182' }, { label: 'Valid', value: 'ok', tone: 'ok' }]} drawerOpen={true} onToggleDrawer={onToggle} />);
    expect(container.textContent).toContain('Ready');
    expect(container.textContent).toContain('182');
    expect(container.querySelector('b.ok')).toBeTruthy();
    fireEvent.click(screen.getByText(/Drawer/));
    expect(onToggle).toHaveBeenCalled();
  });
  it('shows Busy instead of Ready while working', () => {
    const { container } = render(<StatusBar notices={[]} hover={null} busy={true} />);
    expect(container.textContent).toContain('Busy');
    expect(container.textContent).not.toContain('Ready');
  });
});
