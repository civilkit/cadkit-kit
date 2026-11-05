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

describe('geometry reference fields', () => {
  it('a draft shows its neutral plane object as text, a plane feature its mode, offset and flip', () => {
    const draft = sectionsOf({ type: 'draft', id: 'F3', neutral: { kind: 'std', id: 'front' }, faces: ['F2.S.e1'], angle: 3 });
    const neutral = draft.flatMap((s) => s.fields).find((f) => f.path === 'neutral')!;
    expect(neutral.value).toBe('std front');
    const plane = sectionsOf({ type: 'plane', id: 'F4', mode: 'offset', base: { kind: 'std', id: 'top' }, offset: 10, flip: false });
    expect(plane[0].fields.map((f) => f.path)).toEqual(['mode', 'offset', 'flip']);
    // a sketch's plane is not an editable reference field
    expect(sectionsOf({ type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' } }).flatMap((s) => s.fields).map((f) => f.path)).not.toContain('plane');
  });
  it('the plane mode dropdown offers plane modes only', () => {
    const { container } = render(<FeatureEditor feature={{ type: 'plane', id: 'F4', mode: 'offset', offset: 10 }} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} />);
    const opts = [...container.querySelectorAll('[data-path="mode"] option')].map((o) => (o as HTMLOptionElement).value);
    expect(opts).toContain('mid');
    expect(opts).not.toContain('delete');
  });
  it('a faceted knurl band offers its pattern as a dropdown', () => {
    const feature = { type: 'knurlBand', id: 'F3', axis: 'z', center: [0, 0], radius: 10, from: 0, to: 12, pattern: 'diamond', count: 24, depth: 0.5 };
    const { container } = render(<FeatureEditor feature={feature} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} />);
    const opts = [...container.querySelectorAll('[data-path="pattern"] option')].map((o) => (o as HTMLOptionElement).value);
    expect(opts).toEqual(['diamond', 'pyramid']);
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
    const input = container.querySelector('[data-path="depth"] input') as HTMLInputElement;
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
    const input = container.querySelector('[data-path="depth"] input') as HTMLInputElement;
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

  it('a region picked in the view lands once: the Shapes checkboxes still work afterwards', () => {
    const drafts: Array<Record<string, unknown>> = [];
    const shapes = [{ id: 's1', label: 'one' }, { id: 's2', label: 'two' }, { id: 's3', label: 'three' }];
    const props = { feature: EXTRUDE, shapes, onDraft: (v: Record<string, unknown>) => drafts.push(v), onConfirm: () => {}, onCancel: () => {} };
    const { container, rerender } = render(<FeatureEditor {...props} />);
    const pick = { path: 'regions', value: ['s1', 's2'] };
    rerender(<FeatureEditor {...props} picked={pick} />);
    expect(drafts.at(-1)).toEqual({ regions: ['s1', 's2'] });
    const box = (id: string) => container.querySelector(`[data-shape="${id}"] input`) as HTMLInputElement;
    expect(box('s3').checked).toBe(false);
    fireEvent.click(box('s3'));   // the pick prop is still set: it must not undo this
    expect(drafts.at(-1)).toEqual({ regions: null });
    expect(box('s3').checked).toBe(true);
    fireEvent.click(box('s1'));
    expect(drafts.at(-1)).toEqual({ regions: ['s2', 's3'] });
    expect(box('s1').checked).toBe(false);
    rerender(<FeatureEditor {...props} picked={{ path: 'regions', value: ['s3'] }} />);   // a new pick lands again
    expect(drafts.at(-1)).toEqual({ regions: ['s3'] });
  });

  it('a hole is unticked by default; ticking every box lists every shape (the hole is filled), unticking it again is the default', () => {
    const drafts: Array<Record<string, unknown>> = [];
    const shapes = [{ id: 'outer', label: 'outer' }, { id: 'ring', label: 'ring', byDefault: false }, { id: 'hole', label: 'hole' }];
    const { container } = render(<FeatureEditor feature={EXTRUDE} shapes={shapes} onDraft={(v) => drafts.push(v)} onConfirm={() => {}} onCancel={() => {}} />);
    const box = (id: string) => container.querySelector(`[data-shape="${id}"] input`) as HTMLInputElement;
    expect([box('outer').checked, box('ring').checked, box('hole').checked]).toEqual([true, false, true]);
    fireEvent.click(box('ring'));
    expect(drafts.at(-1)).toEqual({ regions: ['outer', 'ring', 'hole'] });
    fireEvent.click(box('ring'));
    expect(drafts.at(-1)).toEqual({ regions: null });
    fireEvent.click(box('outer'));
    expect(drafts.at(-1)).toEqual({ regions: ['hole'] });
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
    expect(fld.querySelector('.fedit-chip-text')!.textContent).toBe('A|B');
    expect(fld.querySelector('.fedit-pick')!.textContent).toBe('Use selection');
    const shell = render(<FeatureEditor feature={{ type: 'shell', id: 'F4', faces: ['F2.C1'], thickness: 1 }} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} />);
    expect((shell.container.querySelector('[data-path="faces"] input') as HTMLInputElement).value).toBe('F2.C1');
  });

  it('the button asks for the selection; a picked list lands in the draft and is confirmed', () => {
    const asked: string[] = [];
    const drafts: Array<Record<string, unknown>> = [];
    const confirms: Array<Record<string, unknown>> = [];
    const props = { feature: FILLET, onDraft: (d: Record<string, unknown>) => drafts.push(d), onConfirm: (d: Record<string, unknown>) => confirms.push(d), onCancel: () => {}, onPickRequest: (p: string) => asked.push(p) };
    const { container, rerender } = render(<FeatureEditor {...props} />);
    fireEvent.click(container.querySelector('[data-path="edges"] .fedit-pick')!);
    expect(asked).toEqual(['edges']);
    rerender(<FeatureEditor {...props} pickingPath="edges" picked={{ path: 'edges', value: EDGES }} />);
    expect(drafts.at(-1)).toEqual({ edges: EDGES });
    expect([...container.querySelectorAll('[data-path="edges"] .fedit-chip-text')].map((c) => c.textContent)).toEqual(['A|B', 'A|C']);
    expect(container.querySelector('[data-path="edges"] .fedit-pick')!.textContent).toBe('Done');
    fireEvent.click(container.querySelector('.fedit-confirm')!);
    expect(confirms.at(-1)).toEqual({ edges: EDGES });
  });

  it('the edges show as chips with their count; a chip\'s x takes that one edge out', () => {
    const drafts: Array<Record<string, unknown>> = [];
    const feature = { ...FILLET, edges: EDGES };
    const { container } = render(<FeatureEditor feature={feature} onDraft={(d) => drafts.push(d)} onConfirm={() => {}} onCancel={() => {}} onPickRequest={() => {}} pickingPath="edges" />);
    const fld = container.querySelector('[data-path="edges"]')!;
    expect(fld.tagName).toBe('DIV');   // not a label: a tap on its text must not press the first chip's x
    expect(fld.querySelector('.fedit-count')!.textContent).toBe('2 edges');
    expect(fld.querySelector('.fedit-pick-note')).toBeTruthy();
    fireEvent.click(fld.querySelectorAll('.fedit-chip-x')[0]);
    expect(drafts.at(-1)).toEqual({ edges: [EDGES[1]] });
    expect(fld.querySelector('.fedit-count')!.textContent).toBe('1 edge');
    expect([...fld.querySelectorAll('.fedit-chip-text')].map((c) => c.textContent)).toEqual(['A|C']);
  });

  it('picks arriving one after another each land in the draft', () => {
    const drafts: Array<Record<string, unknown>> = [];
    const props = { feature: FILLET, onDraft: (d: Record<string, unknown>) => drafts.push(d), onConfirm: () => {}, onCancel: () => {}, onPickRequest: () => {}, pickingPath: 'edges' };
    const { container, rerender } = render(<FeatureEditor {...props} />);
    rerender(<FeatureEditor {...props} picked={{ path: 'edges', value: [FILLET.edges[0], EDGES[0]] }} />);
    rerender(<FeatureEditor {...props} picked={{ path: 'edges', value: [FILLET.edges[0], EDGES[0], EDGES[1]] }} />);
    expect(drafts.at(-1)).toEqual({ edges: [FILLET.edges[0], EDGES[0], EDGES[1]] });
    expect(container.querySelector('[data-path="edges"] .fedit-count')!.textContent).toBe('3 edges');
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

describe('FeatureEditor: a draft that breaks the model', () => {
  it('Confirm is greyed with the tooltip and does nothing, unless Shift is held', () => {
    const confirmed: unknown[] = [];
    const { container } = render(<FeatureEditor feature={EXTRUDE} onDraft={() => {}} onConfirm={(n) => confirmed.push(n)} onCancel={() => {}} okBlocked="This change breaks the model (F14). Cancel or adjust." diag={<div class="diag">card</div>} hint="plain hint" />);
    const ok = container.querySelector('.fedit-confirm') as HTMLElement;
    expect(ok.getAttribute('aria-disabled')).toBe('true');
    expect(ok.getAttribute('title')).toBe('This change breaks the model (F14). Cancel or adjust.');
    fireEvent.click(ok);
    expect(confirmed.length).toBe(0);
    fireEvent.click(ok, { shiftKey: true });
    expect(confirmed.length).toBe(1);
    expect(container.querySelector('.diag')!.textContent).toBe('card');
    expect(container.querySelector('.fedit-hint')).toBeNull();
  });
});

describe('inject (the depth arrow in the viewport)', () => {
  it('a patch lands in the draft once per seq and is confirmed with it; mounting with an old seq does nothing', () => {
    const drafts: Array<Record<string, unknown>> = [];
    const confirmed: Array<Record<string, unknown>> = [];
    const props = { feature: EXTRUDE, onDraft: (d: Record<string, unknown>) => { drafts.push(d); }, onConfirm: (d: Record<string, unknown>) => { confirmed.push(d); }, onCancel: () => {} };
    const { container, rerender } = render(<FeatureEditor {...props} inject={{ seq: 3, patch: { depth: 99 } }} />);
    expect(drafts).toEqual([]);
    rerender(<FeatureEditor {...props} inject={{ seq: 4, patch: { depth: 12.5, flip: true } }} />);
    expect(drafts.at(-1)).toEqual({ depth: 12.5, flip: true });
    expect((container.querySelector('[data-path="depth"] input') as HTMLInputElement).value).toBe('12.5');
    const n = drafts.length;
    rerender(<FeatureEditor {...props} inject={{ seq: 4, patch: { depth: 12.5, flip: true } }} />);
    expect(drafts.length).toBe(n);
    fireEvent.click(container.querySelector('.fedit-confirm')!);
    expect(confirmed.at(-1)).toEqual({ depth: 12.5, flip: true });
  });
});

describe('FeatureEditor automation hooks', () => {
  it('OK and Cancel have test ids and accessible names', () => {
    let ok = 0, no = 0;
    const { container } = render(<FeatureEditor feature={EXTRUDE} onDraft={() => {}} onConfirm={() => { ok++; }} onCancel={() => { no++; }} />);
    const a = container.querySelector('[data-testid="feature-ok"]') as HTMLElement, b = container.querySelector('[data-testid="feature-cancel"]') as HTMLElement;
    expect([a.getAttribute('aria-label'), b.getAttribute('aria-label')]).toEqual(['Confirm', 'Cancel']);
    fireEvent.click(a); fireEvent.click(b);
    expect([ok, no]).toEqual([1, 1]);
  });
});

describe('numeric keypads', () => {
  it('Depth asks for the decimal keypad with a Done key, and has a formula key and a sign key', () => {
    const { container } = render(<FeatureEditor feature={EXTRUDE} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} />);
    const i = container.querySelector('[data-path="depth"] input') as HTMLInputElement;
    expect(i.getAttribute('inputmode')).toBe('decimal');
    expect(i.getAttribute('enterkeyhint')).toBe('done');
    expect(container.querySelector('[data-path="depth"] .expr-kb')).toBeTruthy();
    expect(container.querySelector('[data-path="depth"] .expr-sign')).toBeTruthy();
  });
  it('a count asks for the digit pad', () => {
    const { container } = render(<FeatureEditor feature={{ type: 'cpattern', id: 'F5', seed: 'F2', count: 6, angle: 360 }} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} />);
    expect((container.querySelector('[data-path="count"] input') as HTMLInputElement).getAttribute('inputmode')).toBe('numeric');
    expect((container.querySelector('[data-path="angle"] input') as HTMLInputElement).getAttribute('inputmode')).toBe('decimal');
  });
});
