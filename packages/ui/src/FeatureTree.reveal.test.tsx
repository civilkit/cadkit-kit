import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/preact';
import { FeatureTree, matchRows, type FeatureRow } from './FeatureTree';

const base = { status: [], selectedId: null, onSelect: () => {}, onMove: () => {}, onRemove: () => {}, onToggleSuppress: () => {} };
/** Gauge tach (4 rows), gauge oil (2 rows), and a loose row on each side. */
const rows: FeatureRow[] = [
  { id: 'F1', type: 'sketch', name: 'Panel' },
  { id: 'F2', type: 'extrude', name: 'Extrude Panel' },
  { id: 'F3', type: 'sketch', name: 'Tach bezel', group: 'Tach gauge' },
  { id: 'F4', type: 'revolve', name: 'Revolve Tach bezel', group: 'Tach gauge' },
  { id: 'F5', type: 'sketch', name: 'Tach lens', group: 'Tach gauge' },
  { id: 'F6', type: 'revolve', name: 'Revolve Tach lens', group: 'Tach gauge' },
  { id: 'F7', type: 'sketch', name: 'Oil dial', group: 'Oil gauge' },
  { id: 'F8', type: 'extrude', name: 'Extrude Oil dial', group: 'Oil gauge' },
  { id: 'F9', type: 'fillet' },
];
const big = (n: number): FeatureRow[] => Array.from({ length: n }, (_, i) => ({ id: `F${i + 1}`, type: i % 2 ? 'revolve' : 'sketch', name: `Part ${i + 1}`, group: `G${Math.floor(i / 10)}` }));
const ids = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('.row[data-id]')].map((e) => e.dataset.id);

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('FeatureTree folders', () => {
  it('lists consecutive rows of one group under a folder row with the count; a lone group row stays a plain row', () => {
    const { container } = render(<FeatureTree {...base} rows={[...rows.slice(0, 3), { id: 'F10', type: 'sketch', group: 'Alone' }]} partName="Dash" />);
    const folders = container.querySelectorAll('.row.folder');
    expect(folders.length).toBe(0);   // Tach gauge has only one row here
    cleanup();
    const r2 = render(<FeatureTree {...base} rows={rows} partName="Dash" />);
    const f = r2.container.querySelectorAll('.row.folder');
    expect([...f].map((x) => x.getAttribute('data-group'))).toEqual(['Tach gauge', 'Oil gauge']);
    expect(f[0].textContent).toContain('Tach gauge');
    expect(f[0].textContent).toContain('4');
    expect(ids(r2.container)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9']);   // short list: folders start open
    expect(f[0].getAttribute('aria-expanded')).toBe('true');
  });

  it('collapses and expands on click, and remembers the choice for the document', () => {
    const a = render(<FeatureTree {...base} rows={rows} partName="Dash" />);
    fireEvent.click(a.container.querySelector('.row.folder[data-group="Tach gauge"]')!);
    expect(ids(a.container)).toEqual(['F1', 'F2', 'F7', 'F8', 'F9']);
    expect(a.container.querySelector('.row.folder[data-group="Tach gauge"]')!.getAttribute('aria-expanded')).toBe('false');
    cleanup();
    const b = render(<FeatureTree {...base} rows={rows} partName="Dash" />);
    expect(ids(b.container)).toEqual(['F1', 'F2', 'F7', 'F8', 'F9']);
    cleanup();
    const c = render(<FeatureTree {...base} rows={rows} partName="Another part" />);   // another document: its own state
    expect(ids(c.container).length).toBe(9);
  });

  it('starts closed in a list of more than 40 features, and a folder opened by hand stays open', () => {
    const a = render(<FeatureTree {...base} rows={big(60)} partName="Heavy" />);
    expect(a.container.querySelectorAll('.row.folder').length).toBe(6);
    expect(ids(a.container)).toEqual([]);
    fireEvent.click(a.container.querySelector('.row.folder[data-group="G1"]')!);
    expect(ids(a.container).length).toBe(10);
    cleanup();
    const b = render(<FeatureTree {...base} rows={big(60)} partName="Heavy" />);
    expect(ids(b.container).length).toBe(10);
  });

  it('opens with the keyboard (Enter / Space on the folder row)', () => {
    const a = render(<FeatureTree {...base} rows={big(60)} partName="Heavy" />);
    const f = a.container.querySelector<HTMLElement>('.row.folder[data-group="G0"]')!;
    fireEvent.keyDown(f, { key: 'Enter' });
    expect(ids(a.container).length).toBe(10);
    fireEvent.keyDown(a.container.querySelector<HTMLElement>('.row.folder[data-group="G0"]')!, { key: ' ' });
    expect(ids(a.container).length).toBe(0);
  });

  it('keeps the rollback marker visible: it sits before the folder, or inside a folder that then stays open', () => {
    const before = render(<FeatureTree {...base} rows={rows} partName="Dash" rollback={2} onRollback={() => {}} />);
    const kids = [...before.container.querySelector('.tree')!.children].map((e) => e.getAttribute('data-id') ?? (e.classList.contains('rb-bar') ? '|' : e.classList.contains('folder') ? 'folder' : ''));
    expect(kids.filter(Boolean)).toEqual(['F1', 'F2', '|', 'folder', 'F3', 'F4', 'F5', 'F6', 'folder', 'F7', 'F8', 'F9']);
    cleanup();
    localStorage.setItem('cad.treeFolders', JSON.stringify({ Dash: { 'Tach gauge': false } }));
    const inside = render(<FeatureTree {...base} rows={rows} partName="Dash" rollback={4} onRollback={() => {}} />);
    expect(inside.container.querySelector('.rb-bar')).not.toBeNull();
    expect(ids(inside.container)).toContain('F4');   // the folder holding the marker is open though it was closed
    const seq = [...inside.container.querySelector('.tree')!.children].map((e) => e.getAttribute('data-id') ?? (e.classList.contains('rb-bar') ? '|' : ''));
    expect(seq.indexOf('|')).toBe(seq.indexOf('F4') + 1);
  });

  it('keeps drag-reorder working for rows in a folder', () => {
    const moves: Array<[string, number]> = [];
    const { container } = render(<FeatureTree {...base} rows={rows} partName="Dash" onMove={(id, to) => moves.push([id, to])} />);
    const row = (id: string) => container.querySelector<HTMLElement>(`.row[data-id="${id}"]`)!;
    expect(container.querySelector('.row.folder')!.getAttribute('draggable')).not.toBe('true');
    fireEvent.dragStart(row('F6'));
    fireEvent.drop(row('F4'));
    expect(moves).toEqual([['F6', 3]]);
  });

  it('has a "select all faces" button on a folder', () => {
    const calls: Array<[string[], string]> = [];
    const { container } = render(<FeatureTree {...base} rows={rows} partName="Dash" onSelectGroup={(i, n) => calls.push([i, n])} />);
    const b = container.querySelector<HTMLElement>('.row.folder[data-group="Oil gauge"] button')!;
    expect(b.getAttribute('aria-label')).toBe('Select all faces of this group');
    fireEvent.click(b);
    expect(calls).toEqual([[['F7', 'F8'], 'Oil gauge']]);
  });
});

describe('FeatureTree reveal', () => {
  const scrolls = () => vi.spyOn(Element.prototype, 'scrollIntoView' as never).mockImplementation((() => {}) as never) as unknown as ReturnType<typeof vi.fn>;
  const geometry = (rowTop: number) => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return (this.classList.contains('row') ? { top: rowTop, bottom: rowTop + 34, left: 0, right: 0, width: 0, height: 34, x: 0, y: rowTop, toJSON() {} } : { top: 0, bottom: 400, left: 0, right: 0, width: 0, height: 400, x: 0, y: 0, toJSON() {} }) as DOMRect;
  });
  Element.prototype.scrollIntoView ??= () => {};

  it('marks the owning row (and the pattern that repeated it) while the pick lasts, and pulses it', () => {
    const r = render(<FeatureTree {...base} rows={rows} partName="Dash" reveal={{ id: 'F4', also: ['F9'], n: 1 }} />);
    const row = (id: string) => r.container.querySelector(`.row[data-id="${id}"]`)!;
    expect(row('F4').className).toContain('owns');
    expect(row('F4').className).toContain('pulse');
    expect(row('F9').className).toContain('owns');
    expect(row('F3').className).not.toContain('owns');
    r.rerender(<FeatureTree {...base} rows={rows} partName="Dash" reveal={null} />);
    expect(row('F4').className).not.toContain('owns');
  });

  it('stops pulsing after 1.5 s but keeps the marker', () => {
    vi.useFakeTimers();
    try {
      const r = render(<FeatureTree {...base} rows={rows} partName="Dash" reveal={{ id: 'F4', n: 1 }} />);
      expect(r.container.querySelector('.row[data-id="F4"]')!.className).toContain('pulse');
      act(() => { vi.advanceTimersByTime(1600); });
      const cls = r.container.querySelector('.row[data-id="F4"]')!.className;
      expect(cls).not.toContain('pulse');
      expect(cls).toContain('owns');
    } finally { vi.useRealTimers(); }
  });

  it('opens a closed folder that hides the row', () => {
    localStorage.setItem('cad.treeFolders', JSON.stringify({ Dash: { 'Tach gauge': false } }));
    const r = render(<FeatureTree {...base} rows={rows} partName="Dash" />);
    expect(ids(r.container)).not.toContain('F6');
    r.rerender(<FeatureTree {...base} rows={rows} partName="Dash" reveal={{ id: 'F6', n: 1 }} />);
    expect(ids(r.container)).toContain('F6');
    expect(r.container.querySelector('.row.folder[data-group="Tach gauge"]')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens a sketch parent that was collapsed to show a feature tucked under it', () => {
    const nested: FeatureRow[] = [{ id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude', uses: ['F1'] }];
    localStorage.setItem('cad.treeCollapsed', JSON.stringify(['F2']));
    const r = render(<FeatureTree {...base} rows={nested} partName="Dash" />);
    expect(ids(r.container)).toEqual(['F2']);
    r.rerender(<FeatureTree {...base} rows={nested} partName="Dash" reveal={{ id: 'F1', n: 1 }} />);
    expect(ids(r.container)).toEqual(['F2', 'F1']);
  });

  it('scrolls to the middle only when the row is out of view', () => {
    const sc = scrolls(); geometry(1000);
    const r = render(<FeatureTree {...base} rows={rows} partName="Dash" />);
    sc.mockClear();
    r.rerender(<FeatureTree {...base} rows={rows} partName="Dash" reveal={{ id: 'F4', n: 1 }} />);
    expect(sc).toHaveBeenCalledWith({ block: 'center' });
  });

  it('does not scroll a row that is already in view, unless forced', () => {
    const sc = scrolls(); geometry(100);
    const r = render(<FeatureTree {...base} rows={rows} partName="Dash" />);
    sc.mockClear();
    r.rerender(<FeatureTree {...base} rows={rows} partName="Dash" reveal={{ id: 'F4', n: 1 }} />);
    expect(sc).not.toHaveBeenCalledWith({ block: 'center' });
    r.rerender(<FeatureTree {...base} rows={rows} partName="Dash" reveal={{ id: 'F4', n: 2, force: true }} />);
    expect(sc).toHaveBeenCalledWith({ block: 'center' });
  });

  it('does not steal the scroll while the pointer is on the tree or the user just scrolled it', () => {
    const sc = scrolls(); geometry(1000);
    const r = render(<FeatureTree {...base} rows={rows} partName="Dash" />);
    const tree = r.container.querySelector('.tree')!;
    sc.mockClear();
    fireEvent.mouseEnter(tree);
    r.rerender(<FeatureTree {...base} rows={rows} partName="Dash" reveal={{ id: 'F4', n: 1 }} />);
    expect(sc).not.toHaveBeenCalledWith({ block: 'center' });
    fireEvent.mouseLeave(tree);
    fireEvent.wheel(tree);
    r.rerender(<FeatureTree {...base} rows={rows} partName="Dash" reveal={{ id: 'F6', n: 2 }} />);
    expect(sc).not.toHaveBeenCalledWith({ block: 'center' });
    // the row is still marked, and a forced request (the chip) scrolls regardless
    expect(r.container.querySelector('.row[data-id="F6"]')!.className).toContain('owns');
    r.rerender(<FeatureTree {...base} rows={rows} partName="Dash" reveal={{ id: 'F6', n: 3, force: true }} />);
    expect(sc).toHaveBeenCalledWith({ block: 'center' });
  });

  it('marks a closed folder that holds the picked feature when the tree is busy', () => {
    localStorage.setItem('cad.treeFolders', JSON.stringify({ Dash: { 'Tach gauge': false } }));
    const r = render(<FeatureTree {...base} rows={rows} partName="Dash" />);
    fireEvent.mouseEnter(r.container.querySelector('.tree')!);
    r.rerender(<FeatureTree {...base} rows={rows} partName="Dash" reveal={{ id: 'F6', n: 1 }} />);
    expect(ids(r.container)).not.toContain('F6');
    expect(r.container.querySelector('.row.folder[data-group="Tach gauge"]')!.className).toContain('owns');
  });

  it('works inside a long (virtualised) list', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ id: `F${i + 1}`, type: 'extrude', name: `Item ${i + 1}` }));
    const r = render(<FeatureTree {...base} rows={many} partName="Many" />);
    expect(r.container.querySelector('.row[data-id="F250"]')).toBeNull();
    r.rerender(<FeatureTree {...base} rows={many} partName="Many" reveal={{ id: 'F250', n: 1, force: true }} />);
    // jsdom has no layout, so only the bookkeeping is checked: no crash and the request is still pending for the next render
    expect(r.container.querySelectorAll('.row[data-id]').length).toBeGreaterThan(0);
  });
});

describe('FeatureTree search', () => {
  const open = (c: HTMLElement) => { fireEvent.keyDown(c.querySelector('.tree')!, { key: 'f', ctrlKey: true }); return c.querySelector<HTMLInputElement>('.tree-search-input')!; };
  const type = (i: HTMLInputElement, v: string) => { i.value = v; fireEvent.input(i); };

  it('opens with Ctrl+F or Cmd+F on the tree and from the magnifier button, and focuses the field', () => {
    const r = render(<FeatureTree {...base} rows={rows} partName="Dash" />);
    expect(r.container.querySelector('.tree-search-input')).toBeNull();
    const i = open(r.container);
    expect(i).not.toBeNull();
    cleanup();
    const r2 = render(<FeatureTree {...base} rows={rows} partName="Dash" />);
    fireEvent.keyDown(r2.container.querySelector('.tree')!, { key: 'f', metaKey: true });
    expect(r2.container.querySelector('.tree-search-input')).not.toBeNull();
    cleanup();
    const r3 = render(<FeatureTree {...base} rows={rows} partName="Dash" />);
    fireEvent.click(r3.container.querySelector('.tree-search-btn')!);
    expect(r3.container.querySelector('.tree-search-input')).not.toBeNull();
    expect(r3.container.querySelector('.tree-search-btn')!.getAttribute('aria-label')).toBe('Search features');
  });

  it('filters by name, kind and id, keeps the parent sketch of a match and highlights the text', () => {
    const nested: FeatureRow[] = [{ id: 'F1', type: 'sketch', name: 'Tach lens' }, { id: 'F2', type: 'revolve', uses: ['F1'] }, { id: 'F3', type: 'extrude', name: 'Panel' }];
    const r = render(<FeatureTree {...base} rows={nested} partName="Dash" />);
    const i = open(r.container);
    type(i, 'revolve');
    expect(ids(r.container)).toEqual(['F2']);
    cleanup();
    const r2 = render(<FeatureTree {...base} rows={rows} partName="Dash" />);
    const i2 = open(r2.container);
    type(i2, 'lens');
    expect(ids(r2.container)).toEqual(['F5', 'F6']);
    expect(r2.container.querySelector('.row[data-id="F5"] mark')!.textContent).toBe('lens');
    expect(r2.container.querySelector('.tree-search-count')!.textContent).toBe('2 matches');
    type(i2, 'F8');
    expect(ids(r2.container)).toEqual(['F8']);
    type(i2, 'tach gauge');   // every word, and the folder name counts
    expect(ids(r2.container)).toEqual(['F3', 'F4', 'F5', 'F6']);
    type(i2, 'zzz');
    expect(ids(r2.container)).toEqual([]);
    expect(r2.container.querySelector('.tree-search-count')!.textContent).toBe('No matches');
  });

  it('keeps the parent of a nested match visible', () => {
    const nested: FeatureRow[] = [{ id: 'F1', type: 'sketch', name: 'Tach lens' }, { id: 'F2', type: 'revolve', name: 'Dome', uses: ['F1'] }];
    const r = render(<FeatureTree {...base} rows={nested} partName="Dash" />);
    type(open(r.container), 'dome');
    expect(ids(r.container)).toEqual(['F2']);   // F1 is the CHILD (tucked under F2); the parent F2 holds it
    type(r.container.querySelector<HTMLInputElement>('.tree-search-input')!, 'tach');
    expect(ids(r.container)).toEqual(['F2', 'F1']);
  });

  it('shows matches inside closed folders, and goes back to the folders when cleared', () => {
    const r = render(<FeatureTree {...base} rows={big(60)} partName="Heavy" />);
    expect(ids(r.container)).toEqual([]);
    const i = open(r.container);
    type(i, 'Part 33');
    expect(ids(r.container)).toEqual(['F33']);
    expect(r.container.querySelector('.row.folder[data-group="G3"]')).not.toBeNull();
    fireEvent.keyDown(i, { key: 'Escape' });
    expect(r.container.querySelector('.tree-search-input')).toBeNull();
    expect(ids(r.container)).toEqual([]);
  });

  it('Enter / Down go to the next match and select it, Shift+Enter / Up to the previous, wrapping round', () => {
    const picked: string[] = [];
    const r = render(<FeatureTree {...base} rows={rows} partName="Dash" onSelect={(id) => picked.push(id)} />);
    const i = open(r.container);
    type(i, 'revolve');
    expect(r.container.querySelector('.tree-search-count')!.textContent).toBe('2 matches');
    fireEvent.keyDown(i, { key: 'Enter' });
    expect(r.container.querySelector('.tree-search-count')!.textContent).toBe('1 of 2');
    fireEvent.keyDown(i, { key: 'ArrowDown' });
    fireEvent.keyDown(i, { key: 'Enter' });
    fireEvent.keyDown(i, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(i, { key: 'ArrowUp' });
    expect(picked).toEqual(['F4', 'F6', 'F4', 'F6', 'F4']);
  });

  it('hides the rollback marker while a filter is on and brings it back after', () => {
    const r = render(<FeatureTree {...base} rows={rows} partName="Dash" rollback={3} onRollback={() => {}} />);
    expect(r.container.querySelector('.rb-bar')).not.toBeNull();
    const i = open(r.container);
    type(i, 'tach');
    expect(r.container.querySelector('.rb-bar')).toBeNull();
    fireEvent.keyDown(i, { key: 'Escape' });
    expect(r.container.querySelector('.rb-bar')).not.toBeNull();
  });
});

describe('matchRows', () => {
  const kind = (t: string) => ({ sketch: 'Sketch', revolve: 'Revolve', extrude: 'Extrude', fillet: 'Fillet' }[t] ?? t);
  it('matches name, kind, type, id and group, every word, ignoring case', () => {
    expect(matchRows(rows, 'F62', kind)).toEqual([]);
    expect(matchRows(rows, 'f4', kind)).toEqual(['F4']);
    expect(matchRows(rows, 'REVOLVE', kind)).toEqual(['F4', 'F6']);
    expect(matchRows(rows, 'oil gauge', kind)).toEqual(['F7', 'F8']);
    expect(matchRows(rows, 'fillet', kind)).toEqual(['F9']);
    expect(matchRows(rows, '  ', kind)).toHaveLength(rows.length);
  });
});
