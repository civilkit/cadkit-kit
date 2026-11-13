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

describe('Ribbon label mode', () => {
  it('icons mode drops the text, keeps an accessible name, and shows the label on hover', () => {
    const { container, getByRole } = render(<Ribbon commands={commands} activeTab="Home" onTab={() => {}} labels="icons" />);
    const b = getByRole('button', { name: 'Undo' });
    expect(b.textContent).toBe('');
    expect(b.querySelector('svg')).not.toBeNull();
    fireEvent.pointerEnter(b, { pointerType: 'mouse' });
    expect(document.querySelector('[role="tooltip"]')!.textContent).toBe('Undo');
    expect(container.querySelectorAll('.rb-btn.icon-only').length).toBeGreaterThan(0);
  });
  it('the default keeps icon and text', () => {
    const { container } = render(<Ribbon commands={commands} activeTab="Home" onTab={() => {}} />);
    const undo = [...container.querySelectorAll('.rb-btn')].find((b) => b.textContent === 'Undo')!;
    expect(undo.querySelector('svg')).not.toBeNull();
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

describe('Ribbon layout', () => {
  const cmds: Command[] = [
    { id: 'open', label: 'Open', tab: 'Home', group: 'File', run: () => {} },
    { id: 'ex-a', label: 'Export A', tab: 'Home', group: 'Export', keys: 'Ctrl+E', run: () => {} },
    { id: 'ex-b', label: 'Export B', tab: 'Home', group: 'Export', run: () => {} },
    { id: 'stray', label: 'Stray', tab: 'Home', group: 'Misc', run: () => {} },
    { id: 'cam', label: 'Camera', tab: 'View', group: 'Views', run: () => {} },
  ];
  const layout = { Home: [{ id: 'File', entries: ['open'] }, { id: 'Export', entries: [{ slot: 'export', ids: ['ex-a', 'ex-b', 'gone'] }] }] };
  it('draws titled groups from the layout, a slot as one split button, and appends commands the layout forgot', () => {
    const { container } = render(<Ribbon commands={cmds} activeTab="Home" onTab={() => {}} layout={layout} />);
    expect([...container.querySelectorAll('.rb-gtitle')].map((x) => x.textContent)).toEqual(['File', 'Export', 'Misc']);
    expect(container.querySelectorAll('.rb-group').length).toBe(3);
    expect(container.querySelectorAll('.slot.multi').length).toBe(1);
    expect(container.textContent).toContain('Stray');
  });
  it('icons-only mode has no group titles and no label text', () => {
    const { container } = render(<Ribbon commands={cmds} activeTab="Home" onTab={() => {}} layout={layout} labels="icons" />);
    expect(container.querySelector('.rb-gtitle')).toBeNull();
    expect(container.querySelector('.slot-lab')).toBeNull();
    expect(container.querySelectorAll('.rb-group').length).toBe(3);
  });
  it('tabs come from the layout and the commands that are in no layout tab', () => {
    const { container } = render(<Ribbon commands={cmds} activeTab="Home" onTab={() => {}} layout={layout} />);
    expect([...container.querySelectorAll('.rb-tab')].map((x) => x.textContent)).toEqual(['Home', 'View']);
  });
  it('uses the short caption under the icon but keeps the full name for assistive tech', () => {
    const { getByRole, container } = render(<Ribbon commands={cmds} activeTab="Home" onTab={() => {}} layout={layout} caption={(c) => c.label.replace('Export ', '')} />);
    expect(getByRole('button', { name: 'Export A' }).textContent).toBe('A');
    expect(container.querySelector('.slot-lab')).not.toBeNull();
  });
});

describe('Ribbon automation hooks', () => {
  it('tab buttons have test ids and names, and a command button a test id by command id', () => {
    const picked: string[] = [];
    const { container } = render(<Ribbon commands={commands} activeTab="Home" onTab={(x) => picked.push(x)} />);
    const tab = container.querySelector('[data-testid="ribbon-tab-View"]') as HTMLElement;
    expect(tab.getAttribute('aria-label')).toBe('View');
    fireEvent.click(tab);
    expect(picked).toEqual(['View']);
    expect(container.querySelector('[data-testid="ribbon-tab-Home"]')!.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[data-testid="cmd-open"]')).not.toBeNull();
  });

  it('a strip with hidden groups shows a chevron at the edge that hides them, which scrolls by one group and goes away at the end', () => {
    const sw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    const cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get() { return (this as HTMLElement).classList.contains('rb-groups') ? 1000 : 0; } });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return (this as HTMLElement).classList.contains('rb-groups') ? 400 : 0; } });
    const scrollTo = vi.fn(function (this: HTMLElement, o: ScrollToOptions) { this.scrollLeft = o.left ?? 0; this.dispatchEvent(new Event('scroll')); });
    (HTMLElement.prototype as any).scrollTo = scrollTo;
    try {
      const layout = { Sketch: [{ id: 'Tools', entries: [{ key: 'a', node: <span>a</span> }] }, { id: 'Dim', entries: [{ key: 'b', node: <span>b</span> }] }] };
      const { container } = render(<Ribbon commands={[]} layout={layout} activeTab="Sketch" onTab={() => {}} />);
      expect(container.querySelector('[data-testid="ribbon-scroll-left"]')).toBeNull();
      expect(container.querySelector('.rb-strip')!.className).toContain('edge-r');
      fireEvent.click(container.querySelector('[data-testid="ribbon-scroll-right"]')!);
      expect(scrollTo).toHaveBeenCalled();
      expect(container.querySelector('[data-testid="ribbon-scroll-left"]')).not.toBeNull();
      const row = container.querySelector('.rb-groups') as HTMLElement;
      row.scrollLeft = 600; row.dispatchEvent(new Event('scroll'));
      expect(container.querySelector('[data-testid="ribbon-scroll-right"]')).toBeNull();
    } finally {
      if (sw) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', sw); else delete (HTMLElement.prototype as any).scrollWidth;
      if (cw) Object.defineProperty(HTMLElement.prototype, 'clientWidth', cw); else delete (HTMLElement.prototype as any).clientWidth;
      delete (HTMLElement.prototype as any).scrollTo;
    }
  });
});
