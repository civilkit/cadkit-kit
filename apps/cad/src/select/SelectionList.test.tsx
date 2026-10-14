import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import '../i18n';
import { SelModel } from './model';
import { chipsOf, SelectionList } from './SelectionList';
import { FilterMenu } from './FilterMenu';
import { ALL_PICKABLE } from '@kit/store';
import { twoBoxes } from './fixtures';

afterEach(cleanup);
const model = () => new SelModel(twoBoxes());

describe('chipsOf', () => {
  it('labels faces by name, edges by number, corners by position, bodies by order', () => {
    const c = chipsOf(['A+z', 'Ax00|0', 'v:1,2,3', '@body:C+x', '@body:A+x'], model());
    expect(c.map((x) => x.label)).toEqual(['Face A+z', 'Edge 1', 'Corner 1,2,3', 'Body 2', 'Body 1']);
    expect(c.map((x) => x.kind)).toEqual(['face', 'edge', 'corner', 'body', 'body']);
  });
  it('a surface body is labelled as one', () => {
    const d = twoBoxes();
    const m = new SelModel({ ...d, surfaceOf: (n) => (n.startsWith('C') ? 'F2' : null) });
    expect(chipsOf(['@body:C+x'], m)[0].label).toBe('Surface body 2');
  });
});

describe('SelectionList', () => {
  const props = () => ({ onRemove: vi.fn(), onClear: vi.fn(), onHover: vi.fn() });
  it('renders nothing for an empty selection', () => {
    const { container } = render(<SelectionList selection={[]} model={model()} {...props()} />);
    expect(container.querySelector('.sel-list')).toBeNull();
  });
  it('shows the count and a chip per item; × removes one, Clear clears', () => {
    const p = props();
    render(<SelectionList selection={['A+z', 'A-z']} model={model()} {...p} />);
    expect(screen.getByText('2')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Remove from selection: Face A\+z/));
    expect(p.onRemove).toHaveBeenCalledWith('A+z');
    fireEvent.click(screen.getByText('Clear'));
    expect(p.onClear).toHaveBeenCalled();
  });
  it('hovering a chip lights the item; leaving clears it', () => {
    const p = props();
    const { container } = render(<SelectionList selection={['A+z', 'A-z']} model={model()} {...p} />);
    fireEvent.mouseEnter(container.querySelectorAll('.sel-chip')[1]);
    expect(p.onHover).toHaveBeenLastCalledWith('A-z');
    fireEvent.mouseLeave(container.querySelector('.sel-chips')!);
    expect(p.onHover).toHaveBeenLastCalledWith(null);
  });
  it('the header folds the chips away', () => {
    const { container } = render(<SelectionList selection={['A+z']} model={model()} {...props()} />);
    fireEvent.click(container.querySelector('.sel-list-toggle')!);
    expect(container.querySelector('.sel-chips')).toBeNull();
  });
});

describe('FilterMenu', () => {
  it('opens a popover with the six pick types; unchecking one reports it and shows a count', () => {
    const onChange = vi.fn();
    const { rerender } = render(<FilterMenu filters={ALL_PICKABLE} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Selection filters'));
    for (const l of ['Faces', 'Edges', 'Corners', 'Bodies', 'Sketches', 'Planes']) expect(screen.getByLabelText(l)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Edges'));
    expect(onChange).toHaveBeenCalledWith('edges', false);
    rerender(<FilterMenu filters={{ ...ALL_PICKABLE, edges: false }} onChange={onChange} />);
    expect(screen.getByText('1')).toBeTruthy();
  });
  it('Escape closes it', () => {
    render(<FilterMenu filters={ALL_PICKABLE} onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText('Selection filters'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('Faces')).toBeNull();
  });
});
