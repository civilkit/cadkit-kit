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

  it('the warning tooltip carries what is wrong and what to do', () => {
    const hint = 'sketch has no field `origin`; it is ignored. check the field names';
    const { container } = render(
      <FeatureTree rows={[{ id: 'S1', type: 'sketch' }]} status={[{ id: 'S1', ok: true }]} warnings={{ S1: { code: 'unknownField', hint } }}
        selectedId={null} onSelect={() => {}} onMove={() => {}} onRemove={() => {}} onToggleSuppress={() => {}} />,
    );
    const w = container.querySelector('.row-warn')!;
    expect(w.getAttribute('title')).toBe(hint);
    expect(w.getAttribute('aria-label')).toBe(hint);
  });

  it('clicking the warning mark reports the feature without selecting the row', () => {
    const got: string[] = []; const sel: string[] = [];
    const { container } = render(
      <FeatureTree rows={[{ id: 'S1', type: 'sketch' }]} status={[{ id: 'S1', ok: true }]} warnings={{ S1: { code: 'unknownField', hint: 'h' } }}
        selectedId={null} onSelect={(id) => sel.push(id)} onWarning={(id) => got.push(id)} onMove={() => {}} onRemove={() => {}} onToggleSuppress={() => {}} />,
    );
    (container.querySelector('.row-warn') as HTMLElement).click();
    expect(got).toEqual(['S1']);
    expect(sel).toEqual([]);
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

describe('FeatureTree: a thread under its hole, patterned by', () => {
  const rows = [
    { id: 'F2', type: 'extrude', note: 'patterned by F7' }, { id: 'F3', type: 'sketch' }, { id: 'F4', type: 'hole', uses: ['F3'], note: 'patterned by F7' },
    { id: 'F5', type: 'thread', under: 'F4', note: 'patterned by F7' }, { id: 'F7', type: 'cpattern' },
  ];
  it('nests the thread under its hole, after the hole sketch, and notes the pattern on both', () => {
    localStorage.clear();
    const { container } = render(<FeatureTree rows={rows} status={[]} selectedId={null} onSelect={() => {}} onMove={() => {}} onRemove={() => {}} onToggleSuppress={() => {}} />);
    expect([...container.querySelectorAll('.tree > .row')].map((r) => r.querySelector('.row-id')!.textContent)).toEqual(['F2', 'F4', 'F3', 'F5', 'F7']);
    expect([...container.querySelectorAll('.row.child')].map((r) => r.getAttribute('data-id'))).toEqual(['F3', 'F5']);
    expect(container.querySelector('[data-id="F5"] .row-note')!.textContent).toBe('patterned by F7');
    expect(container.querySelector('[data-id="F7"] .row-note')).toBeNull();
  });
  it('a nested thread is behind the rollback bar with its hole: the bar after the hole counts the thread', () => {
    const calls: Array<number | null> = [];
    const { container } = render(<FeatureTree rows={rows} status={[]} selectedId={null} onSelect={() => {}} onMove={() => {}} onRemove={() => {}} onToggleSuppress={() => {}} rollback={null} onRollback={(c) => calls.push(c)} />);
    fireEvent.click(container.querySelector('[data-id="F4"] .row-rb')!);
    expect(calls).toEqual([4]);   // F2 F3 F4 F5 built, F7 not
  });
  it('an unknown or self parent is ignored', () => {
    const o = sketchOwners([{ id: 'A', type: 'thread', under: 'A' }, { id: 'B', type: 'thread', under: 'Z' }]);
    expect(o.size).toBe(0);
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

describe('FeatureTree: editable reference row', () => {
  const mount = (opened: string[]) => render(
    <FeatureTree partName="Part1" rows={[]} status={[]} selectedId={null} onSelect={() => {}} onMove={() => {}} onRemove={() => {}} onToggleSuppress={() => {}}
      refs={[{ id: 'material', label: 'Material: steel', icon: 'ref-material', editable: true, editLabel: 'Change material' }]} onOpenRef={(id) => opened.push(id)} />,
  );
  it('opens on click, on the pencil, and on Enter or F2', () => {
    const opened: string[] = [];
    const { container } = mount(opened);
    const row = container.querySelector('[data-ref="material"]') as HTMLElement;
    expect(row.getAttribute('role')).toBe('button');
    fireEvent.click(row);
    fireEvent.click(container.querySelector('.ref-edit')!);
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: 'F2' });
    fireEvent.keyDown(row, { key: 'a' });
    expect(opened).toEqual(['material', 'material', 'material', 'material']);
    expect(container.querySelector('.ref-edit')!.getAttribute('aria-label')).toBe('Change material');
  });
});

describe('FeatureTree: hover and hide', () => {
  const base = { status: [], selectedId: null, onSelect: () => {}, onMove: () => {}, onRemove: () => {} };
  const rows = [{ id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude', op: 'add' }];
  it('reports the hovered feature row and clears it on leave', () => {
    const seen: Array<string | null> = [];
    const { container } = render(<FeatureTree {...base} rows={rows} onToggleSuppress={() => {}} onHoverFeature={(id) => seen.push(id)} />);
    const r = container.querySelectorAll('.row[data-id]')[1];
    fireEvent.mouseEnter(r); fireEvent.mouseLeave(r);
    expect(seen).toEqual(['F2', null]);
  });
  it('marks the row of the feature under the pointer in the 3D view', () => {
    const { container } = render(<FeatureTree {...base} rows={rows} onToggleSuppress={() => {}} hoverId="F2" />);
    expect(container.querySelector('.row[data-id="F2"]')!.className).toContain('hov');
    expect(container.querySelector('.row[data-id="F1"]')!.className).not.toContain('hov');
  });
  it('the eye hides in the view only; suppress is its own button with a different icon and a rebuild tooltip', () => {
    const hid: string[] = [], sup: string[] = [];
    const { container } = render(<FeatureTree {...base} rows={rows} hiddenIds={['F2']} onToggleHide={(id) => hid.push(id)} onToggleSuppress={(id) => sup.push(id)} />);
    const f2 = container.querySelector('.row[data-id="F2"]')!;
    expect(f2.className).toContain('hidden');
    expect(f2.querySelector('.row-hide svg')!.getAttribute('data-icon')).toBe('eye-off');
    expect(container.querySelector('.row[data-id="F1"] .row-hide svg')!.getAttribute('data-icon')).toBe('eye');
    expect(f2.querySelector('.row-sup svg')!.getAttribute('data-icon')).toBe('pause');
    expect(f2.querySelector('.row-sup')!.getAttribute('title')).toContain('rebuilds');
    fireEvent.click(f2.querySelector('.row-hide')!);
    fireEvent.click(f2.querySelector('.row-sup')!);
    expect(hid).toEqual(['F2']); expect(sup).toEqual(['F2']);
  });
});

describe('FeatureTree: blocked rows', () => {
  const rows = [{ id: 'F1', type: 'sketch' }, { id: 'F14', type: 'trimSurface' }, { id: 'F28', type: 'shell' }];
  const status = [
    { id: 'F14', ok: false, code: 'trimNoIntersection', hint: 'The trim tool no longer crosses the surface.' },
    { id: 'F28', ok: false, code: 'nothingToCut', hint: 'F28 removes nothing', blockedBy: 'F14' },
  ];
  it('the cause is red; the consequence is muted with a link to the cause and no red error text', () => {
    const picked: string[] = [];
    const { container } = render(<FeatureTree rows={rows} status={status} selectedId={null} onSelect={(id) => picked.push(id)} onMove={() => {}} onRemove={() => {}} onToggleSuppress={() => {}} />);
    const [, cause, echo] = [...container.querySelectorAll('.row')];
    expect(cause.className).toContain('err');
    expect(echo.className).not.toContain('err');
    expect(echo.className).toContain('blocked');
    expect(echo.querySelector('.row-hint')).toBeNull();
    const chip = echo.querySelector('.row-blocked') as HTMLElement;
    expect(chip.textContent).toContain('blocked by F14');
    fireEvent.click(chip);
    expect(picked).toEqual(['F14']);
  });
});

describe('FeatureTree with a long list', () => {
  it('puts only the rows near the viewport in the DOM and keeps the full height with spacers', () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({ id: `F${i + 1}`, type: 'extrude' }));
    const { container } = render(
      <FeatureTree rows={rows} status={[]} selectedId={null} onSelect={() => {}} onMove={() => {}} onRemove={() => {}} onToggleSuppress={() => {}} onRollback={() => {}} />,
    );
    const n = container.querySelectorAll('.row[data-id]').length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(120);
    const pad = container.querySelector('.tree-pad') as HTMLElement | null;
    expect(pad).not.toBeNull();
    // everything below the window is a spacer of 34 px per hidden row (the marker counts as an entry)
    expect(parseInt(pad!.style.height, 10) % 34).toBe(0);
    expect(container.querySelector('.rb-bar')).toBeNull();   // the marker sits after row 600, outside the window
  });
});
