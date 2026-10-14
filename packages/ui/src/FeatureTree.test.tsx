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
