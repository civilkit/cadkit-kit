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
