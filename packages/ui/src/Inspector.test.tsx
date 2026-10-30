import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { Inspector, fieldsOf } from './Inspector';

afterEach(cleanup);

describe('fieldsOf', () => {
  it('returns flat primitive fields only', () => {
    const fields = fieldsOf({ type: 'extrude', id: 'F2', op: 'add', end: 'blind', depth: 10, sketch: 'F1', points: [[0, 0]], entities: [] });
    const byPath = Object.fromEntries(fields.map((f) => [f.path, f.kind]));
    expect(byPath.depth).toBe('number');
    expect(byPath.op).toBe('text');
    expect(byPath.id).toBeUndefined();
    expect(byPath.type).toBeUndefined();
    expect(byPath.points).toBeUndefined();
    expect(byPath.entities).toBeUndefined();
  });

  it('maps booleans and skips objects and arrays', () => {
    const fields = fieldsOf({ flip: true, centered: false, edges: ['a'], box: { min: [0] } });
    expect(fields.map((f) => [f.path, f.kind, f.value])).toEqual([
      ['flip', 'boolean', true],
      ['centered', 'boolean', false],
    ]);
  });
});

describe('Inspector', () => {
  it('calls onSet with a number for the depth input', () => {
    const sets: Array<[string, unknown]> = [];
    const { container } = render(
      <Inspector feature={{ type: 'extrude', id: 'F2', depth: 10 }} onSet={(path, value) => sets.push([path, value])} />,
    );
    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12' } });
    expect(sets).toEqual([['depth', 12]]);
  });

  it('ignores an input that is not a finite number', () => {
    const sets: Array<[string, unknown]> = [];
    const { container } = render(
      <Inspector feature={{ type: 'extrude', id: 'F2', depth: 10 }} onSet={(path, value) => sets.push([path, value])} />,
    );
    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'not-a-number' } });
    expect(sets).toEqual([]);
  });

  it('renders nothing for a null feature', () => {
    const { container } = render(<Inspector feature={null} onSet={() => {}} />);
    expect(container.querySelector('.insp')?.textContent).toBe('');
  });
});

describe('bookkeeping fields', () => {
  it('autoName and draftNew are not editable fields', () => {
    const paths = fieldsOf({ type: 'plane', id: 'P1', offset: 5, autoName: true, draftNew: true, name: 'x' }).map((f) => f.path);
    expect(paths).toEqual(['offset']);
  });
});

describe('Inspector warnings', () => {
  it('shows the feature warnings above the fields', () => {
    const { container } = render(<Inspector feature={{ type: 'extrude', depth: 5 }} onSet={() => {}} warnings={[{ code: 'unknownField', hint: 'sketch has no field `x`; it is ignored' }]} />);
    const w = container.querySelector('.insp-warn')!;
    expect(w.getAttribute('data-warning')).toBe('unknownField');
    expect(w.textContent).toContain('it is ignored');
    expect(container.querySelector('.insp')!.firstElementChild).toBe(w);
  });
  it('shows nothing without warnings', () => {
    const { container } = render(<Inspector feature={{ type: 'extrude', depth: 5 }} onSet={() => {}} />);
    expect(container.querySelector('.insp-warn')).toBeNull();
  });
});
