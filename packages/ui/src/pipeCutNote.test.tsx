import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { FeatureEditor } from './FeatureEditor';

afterEach(cleanup);
const noop = () => {};

describe('Pipe cut editor', () => {
  it('says it leaves a surface body and points to Hole', () => {
    const { container } = render(<FeatureEditor feature={{ type: 'pipeCut', id: 'F3', radius: 1, edges: [], faces: [] }} onDraft={noop} onConfirm={noop} onCancel={noop} />);
    const note = container.querySelector('[data-note="pipeCut"]')!;
    expect(note.textContent).toMatch(/surface body/);
    expect(note.textContent).toMatch(/Hole/);
  });
  it('other features have no such note', () => {
    const { container } = render(<FeatureEditor feature={{ type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 5, flip: false }} onDraft={noop} onConfirm={noop} onCancel={noop} />);
    expect(container.querySelector('[data-note="pipeCut"]')).toBeNull();
  });
});
