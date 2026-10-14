import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { FeatureTree } from './FeatureTree';

afterEach(cleanup);

describe('FeatureTree', () => {
  it('renders one row per feature and shows the hint for a failed one', () => {
    const { container } = render(
      <FeatureTree
        rows={[{ id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude' }, { id: 'F4', type: 'cut' }]}
        status={[{ id: 'F4', ok: false, code: 'cutNoEffect', hint: 'F4 cuts nothing' }]}
        selectedId={null}
        onSelect={() => {}}
        onMove={() => {}}
        onRemove={() => {}}
        onToggleSuppress={() => {}}
      />,
    );
    const rows = container.querySelectorAll('.row');
    expect(rows.length).toBe(3);
    expect(rows[2].className).toContain('err');
    expect(container.textContent).toContain('F4 cuts nothing');
  });

  it('shows a regen warning as an amber hint under the row, the row stays ok', () => {
    const { container } = render(
      <FeatureTree
        rows={[{ id: 'F1', type: 'sketch' }, { id: 'F5', type: 'thread' }]}
        status={[{ id: 'F5', ok: true }]}
        warnings={{ F5: { code: 'threadDiameterMismatch', hint: 'hole is 6.5, M6 tap drill is 5' } }}
        selectedId={null}
        onSelect={() => {}}
        onMove={() => {}}
        onRemove={() => {}}
        onToggleSuppress={() => {}}
      />,
    );
    const rows = container.querySelectorAll('.row');
    expect(rows[1].className).not.toContain('err');
    const hint = rows[1].querySelector('.row-warn')!;
    expect(hint.getAttribute('title')).toBe('hole is 6.5, M6 tap drill is 5');
    expect(hint.getAttribute('data-warning')).toBe('threadDiameterMismatch');
    expect(rows[0].querySelector('.row-warn')).toBeNull();
  });

  it('calls onSelect with the row id on click', () => {
    const picked: string[] = [];
    const { container } = render(
      <FeatureTree
        rows={[{ id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude' }]}
        status={[]}
        selectedId={null}
        onSelect={(id) => picked.push(id)}
        onMove={() => {}}
        onRemove={() => {}}
        onToggleSuppress={() => {}}
      />,
    );
    fireEvent.click(container.querySelectorAll('.row')[1]);
    expect(picked).toEqual(['F2']);
  });

  it('marks the selected row and drags to reorder', () => {
    const moves: Array<[string, number]> = [];
    const { container } = render(
      <FeatureTree
        rows={[{ id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude' }]}
        status={[]}
        selectedId="F2"
        onSelect={() => {}}
        onMove={(id, to) => moves.push([id, to])}
        onRemove={() => {}}
        onToggleSuppress={() => {}}
      />,
    );
    expect(container.querySelectorAll('.row')[1].className).toContain('sel');
    const [first] = [container.querySelectorAll('.row')[0]];
    fireEvent.dragStart(first);
    fireEvent.drop(container.querySelectorAll('.row')[1]);
    expect(moves).toEqual([['F1', 1]]);
  });

  it('fires onEdit on double click and on the edit button', () => {
    const edits: string[] = [];
    const { container } = render(
      <FeatureTree
        rows={[{ id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude' }]}
        status={[]}
        selectedId={null}
        onSelect={() => {}}
        onMove={() => {}}
        onRemove={() => {}}
        onToggleSuppress={() => {}}
        onEdit={(id) => edits.push(id)}
      />,
    );
    fireEvent.dblClick(container.querySelectorAll('.row')[1]);
    fireEvent.click(container.querySelectorAll('.row')[0].querySelector('.row-edit')!);
    expect(edits).toEqual(['F2', 'F1']);
  });

  it('renders no edit control when onEdit is absent', () => {
    const { container } = render(
      <FeatureTree
        rows={[{ id: 'F1', type: 'sketch' }]}
        status={[]}
        selectedId={null}
        onSelect={() => {}}
        onMove={() => {}}
        onRemove={() => {}}
        onToggleSuppress={() => {}}
      />,
    );
    expect(container.querySelector('.row-edit')).toBeNull();
  });
});

describe('FeatureTree: look', () => {
  it('shows a kind icon per row (cut and boss differ), the part header with count, and icon-only actions with labels', () => {
    const { container } = render(
      <FeatureTree partName="Bracket" rows={[{ id: 'F1', type: 'extrude', op: 'add' }, { id: 'F2', type: 'extrude', op: 'cut', suppressed: true }]}
        status={[]} selectedId={null} onSelect={() => {}} onMove={() => {}} onRemove={() => {}} onToggleSuppress={() => {}} onEdit={() => {}} />,
    );
    expect(container.querySelector('.tree-head')!.textContent).toContain('Bracket');
    const icons = [...container.querySelectorAll('.row-icon')].map((e) => e.getAttribute('data-icon'));
    expect(icons).toEqual(['add-extrude', 'add-cut']);
    for (const b of container.querySelectorAll('.row-act')) expect(b.getAttribute('aria-label')).toBeTruthy();
    expect(container.querySelectorAll('.row-sup svg')[1].getAttribute('data-icon')).toBe('eye-off');
  });
});

describe('FeatureTree: reference rows', () => {
  const refs = [
    { id: 'material', label: 'Material: steel', icon: 'ref-material' },
    { id: 'top', label: 'Top Plane', icon: 'feature-plane', choosable: true },
    { id: 'origin', label: 'Origin', icon: 'ref-origin', choosable: true },
  ];
  it('lists the reference rows above the features; planes can be chosen, hovered and opened, the material row cannot', () => {
    const chosen: Array<string | null> = [], hovered: Array<string | null> = [], opened: string[] = [];
    const { container } = render(
      <FeatureTree partName="Part1" rows={[]} status={[]} selectedId={null} onSelect={() => {}} onMove={() => {}} onRemove={() => {}} onToggleSuppress={() => {}}
        refs={refs} selectedRef="top" onSelectRef={(id) => chosen.push(id)} onHoverRef={(id) => hovered.push(id)} onOpenRef={(id) => opened.push(id)} />,
    );
    const rows = [...container.querySelectorAll('.row.ref')];
    expect(rows.map((r) => r.textContent)).toEqual(['Material: steel', 'Top Plane', 'Origin']);
    expect(rows[1].className).toContain('sel');
    fireEvent.click(rows[0]);
    expect(chosen).toEqual([]);                       // information only
    fireEvent.click(rows[1]);
    expect(chosen).toEqual([null]);                   // clicking the chosen plane again clears it
    fireEvent.dblClick(rows[1]);
    expect(opened).toEqual(['top']);
    fireEvent.mouseEnter(rows[1]);
    fireEvent.mouseLeave(rows[1]);
    expect(hovered).toEqual(['top', null]);
  });
});

import { sketchOwners } from './FeatureTree';
describe('FeatureTree: sketches tucked under their feature', () => {
  const rows = [
    { id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude', uses: ['F1'] },
    { id: 'F3', type: 'sketch' },                                   // used by nobody
    { id: 'P', type: 'sketch3d' }, { id: 'S0', type: 'sketch' }, { id: 'W', type: 'sweep', uses: ['S0', 'P'] },
  ];
  it('gives each sketch to the first feature that uses it, and leaves unused sketches alone', () => {
    const o = sketchOwners(rows);
    expect([...o.entries()]).toEqual([['F1', 'F2'], ['S0', 'W'], ['P', 'W']]);
  });
  it('shows owned sketches as indented children under the feature, folds them with the chevron, and still selects them', () => {
    const picked: string[] = [];
    localStorage.clear();
    const { container } = render(<FeatureTree rows={rows} status={[]} selectedId={null} onSelect={(id) => picked.push(id)} onMove={() => {}} onRemove={() => {}} onToggleSuppress={() => {}} />);
    const all = [...container.querySelectorAll('.tree > .row')].map((r) => r.querySelector('.row-id')!.textContent);
    expect(all).toEqual(['F2', 'F1', 'F3', 'W', 'P', 'S0']);       // F1 right under its extrude, P and S0 under the sweep
    expect(container.querySelectorAll('.row.child').length).toBe(3);
    fireEvent.click(container.querySelectorAll('.row.child')[0]);
    expect(picked).toEqual(['F1']);
    fireEvent.click(container.querySelectorAll('.row-chev')[0]);
    expect(container.querySelectorAll('.row.child').length).toBe(2);
  });
});

describe('FeatureTree: material colour chip', () => {
  it('shows a chip with the colour on the row that has a swatch, and none elsewhere', () => {
    const { container } = render(
      <FeatureTree partName="P" rows={[]} status={[]} selectedId={null} onSelect={() => {}} onMove={() => {}} onRemove={() => {}} onToggleSuppress={() => {}}
        refs={[{ id: 'material', label: 'Material: steel', icon: 'ref-material', swatch: '#d0463b' }, { id: 'origin', label: 'Origin', icon: 'ref-origin' }]} />,
    );
    const chips = container.querySelectorAll('.ref-chip');
    expect(chips.length).toBe(1);
    expect(chips[0].getAttribute('data-swatch')).toBe('#d0463b');
    expect(container.querySelector('[data-ref="material"] .ref-chip')).toBeTruthy();
  });
});

const base = { status: [], selectedId: null, onSelect: () => {}, onMove: () => {}, onRemove: () => {}, onToggleSuppress: () => {} };
const four = [{ id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude' }, { id: 'F3', type: 'sketch' }, { id: 'F4', type: 'extrude' }];

describe('FeatureTree multi-select and dependents', () => {
  it('passes the modifier keys with the click', () => {
    const seen: Array<[string, boolean, boolean]> = [];
    const { container } = render(<FeatureTree {...base} rows={four} onSelect={(id, m) => seen.push([id, !!m?.ctrl, !!m?.shift])} />);
    const rows = container.querySelectorAll('.row');
    fireEvent.click(rows[1], { ctrlKey: true });
    fireEvent.click(rows[3], { shiftKey: true });
    fireEvent.click(rows[0]);
    expect(seen).toEqual([['F2', true, false], ['F4', false, true], ['F1', false, false]]);
  });
  it('marks every selected row and the rows that depend on the selection', () => {
    const { container } = render(<FeatureTree {...base} rows={[{ id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude' }, { id: 'F5', type: 'fillet' }]} selectedId="F2" selectedIds={['F2', 'F5']} dependents={['F5']} />);
    const cls = [...container.querySelectorAll('.row')].map((r) => r.className);
    expect(cls[0]).not.toContain('sel');
    expect(cls[1]).toContain('sel');
    expect(cls[2]).toContain('sel');
    expect(cls[2]).toContain('dep');
    expect(cls[1]).not.toContain('dep');
  });
});

describe('FeatureTree rename', () => {
  it('shows a field for the renaming row; Enter commits the new name, Esc cancels', () => {
    const renamed: Array<[string, string]> = [];
    const changes: Array<string | null> = [];
    const { container, rerender } = render(<FeatureTree {...base} rows={four} renaming="F2" onRenamingChange={(v) => changes.push(v)} onRename={(id, n) => renamed.push([id, n])} />);
    const input = container.querySelector('input.inline-name') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect((container.querySelector('.row[data-id="F2"]') as HTMLElement).getAttribute('draggable')).toBe('false');
    input.value = 'Base plate';
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(renamed).toEqual([['F2', 'Base plate']]);
    expect(changes).toEqual([null]);
    rerender(<FeatureTree {...base} rows={four} renaming="F3" onRenamingChange={(v) => changes.push(v)} onRename={(id, n) => renamed.push([id, n])} />);
    const again = container.querySelector('input.inline-name') as HTMLInputElement;
    again.value = 'ignored';
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(renamed.length).toBe(1);
  });
  it('an empty or unchanged name is a cancel', () => {
    const renamed: string[] = [];
    const { container } = render(<FeatureTree {...base} rows={[{ id: 'F1', type: 'extrude', name: 'Pad' }]} renaming="F1" onRename={(_, n) => renamed.push(n)} />);
    const input = container.querySelector('input.inline-name') as HTMLInputElement;
    input.value = '   ';
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(renamed).toEqual([]);
  });
  it('double-click on the part name renames the part; double-click on a row still opens its editor', () => {
    const parts: string[] = [];
    const edited: string[] = [];
    const { container } = render(<FeatureTree {...base} rows={four} partName="Bracket" onRenamePart={(n) => parts.push(n)} onEdit={(id) => edited.push(id)} />);
    fireEvent.dblClick(container.querySelectorAll('.row')[1]);
    expect(edited).toEqual(['F2']);
    fireEvent.dblClick(container.querySelector('.tree-part')!);
    const input = container.querySelector('input.inline-name') as HTMLInputElement;
    expect(input.value).toBe('Bracket');
    input.value = 'Hinge';
    fireEvent.blur(input);
    expect(parts).toEqual(['Hinge']);
  });
  it('without an onRename handler nothing becomes editable', () => {
    const { container } = render(<FeatureTree {...base} rows={four} renaming="F2" />);
    expect(container.querySelector('input.inline-name')).toBeNull();
  });
});

describe('FeatureTree rollback marker', () => {
  it('sits at the end when nothing is rolled back and greys no row', () => {
    const { container } = render(<FeatureTree {...base} rows={four} rollback={null} onRollback={() => {}} />);
    const kids = [...container.querySelector('.tree')!.children];
    const bar = container.querySelector('.rb-bar')!;
    expect(kids.indexOf(bar)).toBe(four.length);
    expect(container.querySelectorAll('.row.rolled').length).toBe(0);
    expect(container.querySelector('.rb-fwd')).toBeNull();
  });
  it('greys the features after the marker and offers Roll forward', () => {
    const calls: Array<number | null> = [];
    const { container } = render(<FeatureTree {...base} rows={four} rollback={2} onRollback={(c) => calls.push(c)} />);
    const kids = [...container.querySelector('.tree')!.children];
    expect(kids.indexOf(container.querySelector('.rb-bar')!)).toBe(2);
    expect([...container.querySelectorAll('.row')].map((r) => r.className.includes('rolled'))).toEqual([false, false, true, true]);
    fireEvent.click(container.querySelector('.rb-fwd')!);
    expect(calls).toEqual([null]);
  });
  it('the row button rolls back to just after that row; the last row rolls forward', () => {
    const calls: Array<number | null> = [];
    const { container } = render(<FeatureTree {...base} rows={four} rollback={null} onRollback={(c) => calls.push(c)} />);
    const btn = (i: number) => container.querySelectorAll('.row')[i].querySelector('.row-rb')!;
    fireEvent.click(btn(1));
    fireEvent.click(btn(3));
    expect(calls).toEqual([2, null]);
  });
  it('arrow keys on the marker move it one row, Home and End jump', () => {
    const calls: Array<number | null> = [];
    const { container } = render(<FeatureTree {...base} rows={four} rollback={2} onRollback={(c) => calls.push(c)} />);
    const bar = container.querySelector('.rb-bar')!;
    fireEvent.keyDown(bar, { key: 'ArrowUp' });
    fireEvent.keyDown(bar, { key: 'ArrowDown' });
    fireEvent.keyDown(bar, { key: 'Home' });
    fireEvent.keyDown(bar, { key: 'End' });
    expect(calls).toEqual([1, 3, 0, null]);
  });
  it('dragging the marker onto a row puts it after that row (lower half) or before it, and does not reorder', () => {
    const calls: Array<number | null> = [];
    const moves: unknown[] = [];
    const { container } = render(<FeatureTree {...base} rows={four} rollback={null} onRollback={(c) => calls.push(c)} onMove={(...a) => moves.push(a)} />);
    fireEvent.dragStart(container.querySelector('.rb-bar')!);
    const row = container.querySelectorAll('.row')[1];
    const dropAt = (el: Element, clientY: number) => { const ev = new Event('drop', { bubbles: true }); Object.assign(ev, { clientY }); el.dispatchEvent(ev); };
    dropAt(row, 50);     // jsdom rects are zero: a positive clientY is the lower half
    fireEvent.dragStart(container.querySelector('.rb-bar')!);
    dropAt(row, -5);
    fireEvent.dragStart(container.querySelector('.rb-bar')!);
    fireEvent.drop(container.querySelector('.rb-end')!);
    expect(calls).toEqual([2, 1, null]);
    expect(moves).toEqual([]);
  });
  it('nested sketches are not marker positions: rolling back after a feature with a sketch goes after the feature', () => {
    const calls: Array<number | null> = [];
    const rows = [{ id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude', uses: ['F1'] }, { id: 'F3', type: 'fillet' }];
    const { container } = render(<FeatureTree {...base} rows={rows} rollback={null} onRollback={(c) => calls.push(c)} />);
    const tops = [...container.querySelectorAll('.row')].filter((r) => !r.className.includes('child'));
    expect(tops.length).toBe(2);
    fireEvent.click(tops[0].querySelector('.row-rb')!);
    expect(calls).toEqual([2]);
  });
  it('shows no marker without an onRollback handler', () => {
    const { container } = render(<FeatureTree {...base} rows={four} />);
    expect(container.querySelector('.rb-bar')).toBeNull();
  });
});
