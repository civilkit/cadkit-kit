import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { FeatureEditor, sectionsOf } from './FeatureEditor';

afterEach(cleanup);

const EXTRUDE = { type: 'extrude', id: 'F2', name: 'Boss', op: 'add', sketch: 'F1', end: 'blind', depth: 5, flip: false };

describe('sectionsOf', () => {
  it('groups an extrude into profile and operation', () => {
    const secs = sectionsOf(EXTRUDE);
    expect(secs.map((s) => s.id)).toEqual(['profile', 'operation']);
    expect(secs[0].fields.map((f) => f.path)).toEqual(['sketch']);
    expect(secs[1].fields.map((f) => f.path).sort()).toEqual(['depth', 'end', 'flip', 'op']);
    expect(secs[0].title).not.toContain('ui.editor');
  });

  it('a feature type with no grouping gets one section with every field', () => {
    const secs = sectionsOf({ type: 'nonsense', id: 'F9', alpha: 1, beta: 'x', on: true });
    expect(secs.length).toBe(1);
    expect(secs[0].fields.map((f) => f.path).sort()).toEqual(['alpha', 'beta', 'on']);
  });
});

describe('FeatureEditor', () => {
  it('shows the feature title and section headings', () => {
    const { container } = render(
      <FeatureEditor feature={EXTRUDE} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container.querySelector('.fedit-title')!.textContent).toContain('Extrude');
    expect(container.querySelector('.fedit-title')!.textContent).toContain('Boss');
    const heads = [...container.querySelectorAll('.fedit-sec-head')].map((h) => h.textContent);
    expect(heads.length).toBe(2);
    expect(heads.join(' ')).toContain('Profile');
    expect(heads.join(' ')).toContain('Operation');
  });

  it('holds a draft in component state and reports changes through onDraft', () => {
    const drafts: Array<Record<string, unknown>> = [];
    const { container } = render(
      <FeatureEditor feature={EXTRUDE} onDraft={(v) => drafts.push(v)} onConfirm={() => {}} onCancel={() => {}} />,
    );
    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12' } });
    expect(drafts.at(-1)).toEqual({ depth: 12 });
    expect(input.value).toBe('12'); // the component state, not the original feature
  });

  it('confirm sends the whole draft once; cancel calls onCancel and confirms nothing more', () => {
    const confirms: Array<Record<string, unknown>> = [];
    let cancelled = 0;
    const { container } = render(
      <FeatureEditor
        feature={EXTRUDE}
        onDraft={() => {}}
        onConfirm={(v) => confirms.push(v)}
        onCancel={() => { cancelled += 1; }}
      />,
    );
    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(container.querySelector('.fedit-confirm')!);
    expect(confirms).toEqual([{ depth: 12 }]);
    fireEvent.click(container.querySelector('.fedit-cancel')!);
    expect(cancelled).toBe(1);
    expect(confirms.length).toBe(1);
  });

  it('Enter confirms and Escape cancels', () => {
    const confirms: unknown[] = [];
    let cancelled = 0;
    const { container } = render(
      <FeatureEditor
        feature={EXTRUDE}
        onDraft={() => {}}
        onConfirm={(v) => confirms.push(v)}
        onCancel={() => { cancelled += 1; }}
      />,
    );
    fireEvent.keyDown(container.querySelector('.fedit')!, { key: 'Enter' });
    expect(confirms.length).toBe(1);
    fireEvent.keyDown(container.querySelector('.fedit')!, { key: 'Escape' });
    expect(cancelled).toBe(1);
  });

  it('reference fields show a picking state while pickingPath names them', () => {
    const { container, rerender } = render(
      <FeatureEditor feature={EXTRUDE} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} pickingPath={null} />,
    );
    const sketch = container.querySelector('[data-path="sketch"]')!;
    expect(sketch.className).not.toContain('picking');
    rerender(
      <FeatureEditor feature={EXTRUDE} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} pickingPath="sketch" />,
    );
    expect(container.querySelector('[data-path="sketch"]')!.className).toContain('picking');
  });

  it('clicking a reference field pick control requests picking for that path', () => {
    const picks: string[] = [];
    const { container } = render(
      <FeatureEditor
        feature={EXTRUDE}
        onDraft={() => {}}
        onConfirm={() => {}}
        onCancel={() => {}}
        onPickRequest={(path) => picks.push(path)}
      />,
    );
    fireEvent.click(container.querySelector('[data-path="sketch"] .fedit-pick')!);
    expect(picks).toEqual(['sketch']);
  });

  it('a picked value arriving through props lands in the draft', () => {
    const drafts: Array<Record<string, unknown>> = [];
    const feature = EXTRUDE;
    const { rerender } = render(
      <FeatureEditor feature={feature} onDraft={(v) => drafts.push(v)} onConfirm={() => {}} onCancel={() => {}} />,
    );
    rerender(
      <FeatureEditor
        feature={feature}
        onDraft={(v) => drafts.push(v)}
        onConfirm={() => {}}
        onCancel={() => {}}
        picked={{ path: 'sketch', value: 'F7' }}
      />,
    );
    expect(drafts.at(-1)).toEqual({ sketch: 'F7' });
  });

  it('sections collapse and expand', () => {
    const { container } = render(
      <FeatureEditor feature={EXTRUDE} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container.querySelectorAll('.fedit-sec-fields').length).toBe(2);
    fireEvent.click(container.querySelectorAll('.fedit-sec-head')[0]);
    expect(container.querySelectorAll('.fedit-sec-fields').length).toBe(1);
    fireEvent.click(container.querySelectorAll('.fedit-sec-head')[0]);
    expect(container.querySelectorAll('.fedit-sec-fields').length).toBe(2);
  });

  it('renders an empty hint for a null feature', () => {
    const { container } = render(
      <FeatureEditor feature={null} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container.querySelector('.fedit')!.className).toContain('empty');
  });
});

describe('edge and face list fields', () => {
  const FILLET = { type: 'fillet', id: 'F3', radius: 2, edges: [{ faces: ['A', 'B'], at: [0, 0, 0] }] };
  const EDGES = [{ faces: ['A', 'B'], at: [1, 2, 3] }, { faces: ['A', 'C'], at: [4, 5, 6] }];

  it('shows the edges and faces of a feature as editable reference fields with a Use selection button', () => {
    const { container } = render(<FeatureEditor feature={FILLET} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} onPickRequest={() => {}} />);
    const fld = container.querySelector('[data-path="edges"]')!;
    expect((fld.querySelector('input') as HTMLInputElement).value).toBe('A|B');
    expect(fld.querySelector('button')!.textContent).toBe('Use selection');
    const shell = render(<FeatureEditor feature={{ type: 'shell', id: 'F4', faces: ['F2.C1'], thickness: 1 }} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} />);
    expect((shell.container.querySelector('[data-path="faces"] input') as HTMLInputElement).value).toBe('F2.C1');
  });

  it('the button asks for the selection; a picked list lands in the draft and is confirmed', () => {
    const asked: string[] = [];
    const drafts: Array<Record<string, unknown>> = [];
    const confirms: Array<Record<string, unknown>> = [];
    const props = { feature: FILLET, onDraft: (d: Record<string, unknown>) => drafts.push(d), onConfirm: (d: Record<string, unknown>) => confirms.push(d), onCancel: () => {}, onPickRequest: (p: string) => asked.push(p) };
    const { container, rerender } = render(<FeatureEditor {...props} />);
    fireEvent.click(container.querySelector('[data-path="edges"] button')!);
    expect(asked).toEqual(['edges']);
    rerender(<FeatureEditor {...props} pickingPath="edges" picked={{ path: 'edges', value: EDGES }} />);
    expect(drafts.at(-1)).toEqual({ edges: EDGES });
    expect((container.querySelector('[data-path="edges"] input') as HTMLInputElement).value).toBe('A|B, A|C');
    expect(container.querySelector('[data-path="edges"] button')!.textContent).toBe('Done');
    fireEvent.click(container.querySelector('.fedit-confirm')!);
    expect(confirms.at(-1)).toEqual({ edges: EDGES });
  });
});

describe('FeatureEditor: look', () => {
  it('uses dropdowns for operation and end condition, shows units, and marks an empty reference', () => {
    const { container } = render(
      <FeatureEditor feature={{ type: 'extrude', id: 'F2', op: 'add', sketch: '', end: 'blind', depth: 5 }} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container.querySelector('[data-path="op"] select')).toBeTruthy();
    expect(container.querySelector('[data-path="end"] select')).toBeTruthy();
    expect(container.querySelector('[data-path="depth"] .fedit-unit')!.textContent).toBe('mm');
    expect(container.querySelector('[data-path="sketch"]')!.className).toContain('missing');
    expect(container.querySelector('.fedit-confirm')!.getAttribute('aria-label')).toBe('Confirm');
  });
  it('keeps an unknown current value selectable', () => {
    const { container } = render(
      <FeatureEditor feature={{ type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'upToFace', depth: 5 }} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect((container.querySelector('[data-path="end"] select') as HTMLSelectElement).value).toBe('upToFace');
  });
});
