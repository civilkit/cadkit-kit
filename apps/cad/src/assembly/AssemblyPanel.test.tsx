import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import type { EditOp } from '@ck/session';
import type { AsmReport } from './kernel';
import { AssemblyPanel, type AsmHost, type Section } from './AssemblyPanel';
import { NO_EXPLODE } from './model';
import '../i18n';

afterEach(() => cleanup());

const part = (name: string, material = 'steel') => ({ format: 'ck-part', version: 1, name, material, features: [{ type: 'sketch', id: 'F1' }] });
const DOC = {
  name: 'Asm',
  features: [
    { id: 'F1', type: 'insertPart', name: 'Block', part: part('Block', 'aluminium'), fixed: true },
    { id: 'F2', type: 'insertPart', name: 'Bolt', part: part('Bolt') },
    { id: 'F3', type: 'mate', kind: 'coincident', name: 'Seat', a: 'F2.C0@F2.1', b: 'F2.C1@F1.1' },
  ],
};
const FACES = ['F2.C1@F1.1', 'F2.S.e1@F1.1', 'F2.C0@F2.1', 'F4.S.e1@F2.1'];

function host(over: Partial<AsmHost> = {}) {
  const calls = { edits: [] as EditOp[][], selects: [] as string[][], saved: [] as Array<[string, string]>, notes: [] as string[], explode: [] as unknown[], hidden: [] as string[] };
  const h: AsmHost = {
    doc: DOC as never, dof: new Map([['F2', 1], ['F1', 0]]), errors: new Map(), hidden: [], explode: NO_EXPLODE, selection: [],
    faceNames: () => FACES, bodyFaces: (n) => [n], select: (n) => { calls.selects.push(n); }, frame: () => {},
    edit: async (ops) => { calls.edits.push(ops); return true; }, preview: async () => ({ ok: true }), cancelPreview: async () => {},
    samples: async () => [{ id: 's1', title: 'Sample one', url: '/s1.ckpart' }], readUrl: async () => JSON.stringify(part('Sample one')),
    openFile: async () => null, saveFile: async (n, d) => { calls.saved.push([n, d]); }, partVolume: async (p) => ((p as { name: string }).name === 'Bolt' ? 2000 : 30000),
    notify: (t) => { calls.notes.push(t); }, toggleHidden: (id) => { calls.hidden.push(id); }, setExplode: (p) => { calls.explode.push(p); },
    interference: { data: null, stale: false, busy: false, run: () => {} },
    ...over,
  };
  return { h, calls };
}
const mount = (h: AsmHost, section: Section = 'parts') => render(<AssemblyPanel host={h} section={section} onSection={() => {}} />);
const btn = (c: HTMLElement, label: string) => c.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

describe('AssemblyPanel parts', () => {
  it('lists components with their DOF and fixed state', () => {
    const { h } = host();
    const r = mount(h);
    const rows = [...r.container.querySelectorAll('.asm-row')].map((x) => x.textContent);
    expect(rows[0]).toContain('Block'); expect(rows[0]).toContain('fixed');
    expect(rows[1]).toContain('1 DOF remaining');
  });
  it('inserts a chosen sample with its placement', async () => {
    const { h, calls } = host();
    const r = mount(h);
    await waitFor(() => expect(r.container.querySelectorAll('option').length).toBeGreaterThan(1));
    fireEvent.change(r.getByLabelText('Sample part'), { target: { value: '/s1.ckpart' } });
    await waitFor(() => expect(r.container.querySelector('.asm-chosen')?.textContent).toBe('Sample one'));
    fireEvent.input(r.getByLabelText('X'), { target: { value: '12' } });
    fireEvent.click(r.getByText('Insert'));
    await waitFor(() => expect(calls.edits.length).toBe(1));
    expect(calls.edits[0][0]).toMatchObject({ op: 'add', feature: { type: 'insertPart', name: 'Sample one', dx: 12, source: 's1' } });
  });
  it('a component row has an Edit part button that asks the app to open that component\'s own part', () => {
    const opened: string[] = [];
    const r = mount(host({ editPart: (id) => { opened.push(id); } }).h);
    const b = [...r.container.querySelectorAll('button[data-action="edit-part"]')] as HTMLButtonElement[];
    expect(b.length).toBe(2);   // the two components, not the mate
    fireEvent.click(b[1]);
    expect(opened).toEqual(['F2']);
    cleanup();
    expect(mount(host().h).container.querySelector('button[data-action="edit-part"]')).toBeNull();   // an app that cannot edit parts shows no button
  });
  it('shows, suppresses, floats and deletes a component (with its mate) through ops', async () => {
    const { h, calls } = host();
    const r = mount(h);
    const bolt = r.container.querySelectorAll('.asm-row')[1] as HTMLElement;
    fireEvent.click(btn(bolt, 'Hide')); expect(calls.hidden).toEqual(['F2']);
    fireEvent.click(btn(bolt, 'Suppress')); expect(calls.edits[0]).toEqual([{ op: 'set', id: 'F2', path: 'suppressed', value: true }]);
    fireEvent.click(btn(bolt, 'Fix')); expect(calls.edits[1]).toEqual([{ op: 'set', id: 'F2', path: 'fixed', value: true }]);
    fireEvent.click(btn(bolt, 'Delete component'));
    await waitFor(() => expect(calls.edits.length).toBe(3));
    expect(calls.edits[2].map((o) => (o as { id: string }).id)).toEqual(['F3', 'F2']);
  });
  it('rename commits a set of name; a click selects the faces of the component', async () => {
    const { h, calls } = host();
    const r = mount(h);
    const bolt = r.container.querySelectorAll('.asm-row')[1] as HTMLElement;
    fireEvent.click(bolt);
    expect(calls.selects.at(-1)).toEqual(['F2.C0@F2.1', 'F4.S.e1@F2.1']);
    fireEvent.click(btn(bolt, 'Rename'));
    const input = r.container.querySelector('input.inline-name') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'Screw' } }); input.value = 'Screw';
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(calls.edits.at(-1)).toEqual([{ op: 'set', id: 'F2', path: 'name', value: 'Screw' }]);
  });
});

describe('AssemblyPanel mates', () => {
  it('lists mates with their components and edits or deletes them', () => {
    const { h, calls } = host();
    const r = mount(h, 'mates');
    expect(r.container.querySelector('.asm-tip')?.textContent).toContain('Bolt: 1 DOF remaining');
    const row = r.container.querySelector('.asm-row') as HTMLElement;
    expect(row.textContent).toContain('Seat'); expect(row.textContent).toContain('Bolt to Block');
    fireEvent.click(btn(row, 'Delete'));
    expect(calls.edits[0]).toEqual([{ op: 'remove', id: 'F3' }]);
  });
  it('a new mate: kind, pick two faces from the selection, flip, apply adds the feature; pending kinds are disabled', async () => {
    const { h, calls } = host();
    const r = mount(h, 'mates');
    fireEvent.click(r.getByText('New mate'));
    expect((r.container.querySelector('option[value="cam"]') as HTMLOptionElement).disabled).toBe(true);
    expect((r.getByText('Apply') as HTMLButtonElement).disabled).toBe(true);
    const picks = r.getAllByText('Pick');
    fireEvent.click(picks[0]);
    r.rerender(<AssemblyPanel host={{ ...h, selection: ['F2.C0@F2.1'] }} section="mates" onSection={() => {}} />);
    await waitFor(() => expect(r.container.textContent).toContain('Bolt: F2.C0@F2.1'));
    r.rerender(<AssemblyPanel host={{ ...h, selection: [] }} section="mates" onSection={() => {}} />);   // arming a pick clears the selection
    fireEvent.click(r.getAllByText('Pick')[1]);
    r.rerender(<AssemblyPanel host={{ ...h, selection: ['F2.C1@F1.1'] }} section="mates" onSection={() => {}} />);
    await waitFor(() => expect(r.container.textContent).toContain('Block: F2.C1@F1.1'));
    fireEvent.click(r.getByLabelText('Flip'));
    fireEvent.click(r.getByText('Apply'));
    await waitFor(() => expect(calls.edits.length).toBe(1));
    expect(calls.edits[0][0]).toEqual({ op: 'add', feature: { type: 'mate', kind: 'coincident', a: 'F2.C0@F2.1', b: 'F2.C1@F1.1', flip: true } });
  });
  it('editing a mate sets only the changed fields; a failed mate shows the kernel code', async () => {
    const { h, calls } = host({ errors: new Map([['F3', 'mateGeometry']]) });
    const r = mount(h, 'mates');
    expect(r.container.textContent).toContain('mateGeometry');
    fireEvent.click(btn(r.container.querySelector('.asm-row') as HTMLElement, 'Edit'));
    fireEvent.click(r.getByLabelText('Flip'));
    fireEvent.click(r.getByText('Update'));
    await waitFor(() => expect(calls.edits.length).toBe(1));
    expect(calls.edits[0]).toEqual([{ op: 'set', id: 'F3', path: 'flip', value: true }]);
  });
});

const REPORT: AsmReport = {
  dof: { total: 2, translational: 1, rotational: 1 },
  components: [{ id: 'F1', fixed: true, dof: 0, translational: 0, rotational: 0 }, { id: 'F2', fixed: false, dof: 2, translational: 1, rotational: 1 }],
  overConstrained: true, redundant: ['F4'], conflicts: [{ mate: 'F5', with: ['F3', 'F4'] }],
};
const DOC2 = { ...DOC, features: [...DOC.features,
  { id: 'F4', type: 'mate', kind: 'parallel', a: 'F2.C0@F2.1', b: 'F2.C1@F1.1' },
  { id: 'F5', type: 'mate', kind: 'hinge', a: 'F2.C0@F2.1', b: 'F2.C1@F1.1' },
  { id: 'F6', type: 'mate', kind: 'width', a: 'F2.C0@F2.1', b: 'F2.C1@F1.1' }] };

describe('AssemblyPanel degrees-of-freedom report', () => {
  it('shows the total with its split, each component, and the over-constrained banner naming redundant and conflicting mates', () => {
    const { h } = host({ doc: DOC2 as never, report: REPORT });
    const r = mount(h, 'mates');
    expect(r.container.querySelector('.asm-rep-total')?.textContent).toContain('2 DOF remaining');
    expect(r.container.querySelector('.asm-rep-total')?.textContent).toContain('1 translational, 1 rotational');
    const comps = [...r.container.querySelectorAll('.asm-rep-comps li')].map((x) => x.textContent);
    expect(comps[0]).toContain('Block'); expect(comps[0]).toContain('fixed');
    expect(comps[1]).toContain('Bolt'); expect(comps[1]).toContain('2 DOF (1 T, 1 R)');
    const banner = r.container.querySelector('.asm-banner')!;
    expect(banner.textContent).toContain('Over-constrained');
    expect(banner.textContent).toContain('Parallel F4');
    expect(banner.textContent).toContain('Hinge F5 conflicts with Seat, Parallel F4');
  });
  it('a click on a conflict row selects that mate and its faces', () => {
    const { h, calls } = host({ doc: DOC2 as never, report: REPORT });
    const r = mount(h, 'mates');
    fireEvent.click(r.container.querySelector('.asm-pair.conflict') as HTMLElement);
    expect(calls.selects.at(-1)).toEqual(['F2.C0@F2.1', 'F2.C1@F1.1']);
    expect([...r.container.querySelectorAll('.asm-row.sel .row-id')].map((x) => x.textContent)).toEqual(['F5']);
  });
  it('names the rolled-back mates with the kernel detail', () => {
    const { h } = host({ doc: DOC2 as never, report: null, featureErrors: new Map([['F5', { code: 'mateConflict', mates: ['F5', 'F3'] }], ['F6', { code: 'mateGeometry', detail: 'width needs parallel planes' }]]) });
    const r = mount(h, 'mates');
    const notes = [...r.container.querySelectorAll('.asm-report .asm-note')].map((x) => x.textContent);
    expect(notes[0]).toContain('Hinge F5 was rolled back'); expect(notes[0]).toContain('together with Seat');
    expect(notes[1]).toContain('width needs parallel planes');
    expect(r.container.textContent).toContain('rolled back');
  });
});

describe('AssemblyPanel mate kinds', () => {
  const pick = async (r: ReturnType<typeof mount>, h: AsmHost, i: number, face: string) => {
    fireEvent.click(r.getAllByText('Pick')[i]);
    r.rerender(<AssemblyPanel host={{ ...h, selection: [face] }} section="mates" onSection={() => {}} />);
    await waitFor(() => expect(r.container.textContent).toContain(face));
    r.rerender(<AssemblyPanel host={{ ...h, selection: [] }} section="mates" onSection={() => {}} />);
  };
  it('offers every kernel kind, disables the announced ones with their reason', () => {
    const { h } = host();
    const r = mount(h, 'mates');
    fireEvent.click(r.getByText('New mate'));
    for (const k of ['angle', 'perpendicular', 'tangent', 'lock', 'symmetric', 'width', 'limits', 'hinge', 'slot', 'screw', 'gear', 'rackPinion']) expect((r.container.querySelector(`option[value="${k}"]`) as HTMLOptionElement).disabled).toBe(false);
    for (const k of ['profileCenter', 'path', 'linearCoupler', 'cam', 'universalJoint']) {
      const o = r.container.querySelector(`option[value="${k}"]`) as HTMLOptionElement;
      expect(o.disabled).toBe(true); expect(o.title).toContain('Not in the kernel yet');
    }
  });
  it('a gear mate: ratio and Drive fields, the test slider previews the motion, Apply writes ratio and angle', async () => {
    const previews: EditOp[][] = [];
    const { h, calls } = host({ preview: async (ops) => { previews.push(ops); return { ok: true }; } });
    const r = mount(h, 'mates');
    fireEvent.click(r.getByText('New mate'));
    fireEvent.change(r.getByLabelText('Kind'), { target: { value: 'gear' } });
    await pick(r, h, 0, 'F2.C0@F2.1'); await pick(r, h, 1, 'F2.C1@F1.1');
    fireEvent.input(r.getByLabelText('Ratio'), { target: { value: '2' } });
    fireEvent.input(r.getByLabelText('Test drive'), { target: { value: '40' } });
    await waitFor(() => expect(previews.length).toBeGreaterThan(0));
    expect(previews.at(-1)![0]).toMatchObject({ op: 'add', feature: { kind: 'gear', ratio: 2, angle: 40, flip: false } });
    expect((r.getByLabelText('Drive') as HTMLInputElement).value).toBe('40');
    fireEvent.click(r.getByText('Apply'));
    await waitFor(() => expect(calls.edits.length).toBe(1));
    expect(calls.edits[0][0]).toMatchObject({ op: 'add', feature: { type: 'mate', kind: 'gear', a: 'F2.C0@F2.1', b: 'F2.C1@F1.1', ratio: 2, angle: 40 } });
  });
  it('a hinge needs two refs; clearing its optional stop replaces the feature', async () => {
    const doc = { ...DOC, features: [...DOC.features, { id: 'F4', type: 'mate', kind: 'hinge', a: 'F2.C0@F2.1', b: 'F2.C1@F1.1', a2: 'F2.S.e1@F1.1' }] };
    const { h, calls } = host({ doc: doc as never });
    const r = mount(h, 'mates');
    fireEvent.click(btn(r.container.querySelectorAll('.asm-row')[1] as HTMLElement, 'Edit'));
    fireEvent.click(r.container.querySelector('button[aria-label^="Clear"]') as HTMLElement);
    fireEvent.click(r.getByText('Update'));
    await waitFor(() => expect(calls.edits.length).toBe(1));
    expect(calls.edits[0][0]).toEqual({ op: 'replace', id: 'F4', feature: { type: 'mate', kind: 'hinge', id: 'F4', a: 'F2.C0@F2.1', b: 'F2.C1@F1.1' } });
  });
});

describe('AssemblyPanel interference, BOM and explode', () => {
  it('lists interfering pairs by component with the shared volume and selects both bodies', () => {
    const { h, calls } = host({ interference: { data: { bodies: 2, pairs: [{ a: 'F2.C0@F2.1', b: 'F2.C1@F1.1', volume: 12.5 }, { a: 'F2.C0@F2.1', b: 'F2.S.e1@F1.1', error: 'booleanFailed' }] }, stale: false, busy: false, run: () => {} } });
    const r = mount(h, 'interference');
    const pairs = r.container.querySelectorAll('.asm-pair');
    expect(pairs[0].textContent).toContain('Bolt ∩ Block'); expect(pairs[0].textContent).toContain('12.5 mm');
    expect(pairs[1].textContent).toContain('booleanFailed');
    fireEvent.click(pairs[0]);
    expect(calls.selects.at(-1)).toEqual(['F2.C0@F2.1', 'F2.C1@F1.1']);
  });
  it('BOM: quantity by part, mass from volume and density, total, row click selects, CSV through saveFile', async () => {
    const { h, calls } = host();
    const r = mount(h, 'bom');
    await waitFor(() => expect(r.container.querySelectorAll('.asm-bom-row').length).toBe(2));
    await waitFor(() => expect(r.container.querySelector('tfoot')?.textContent).toContain('g'));
    const rows = [...r.container.querySelectorAll('.asm-bom-row')].map((x) => x.textContent);
    expect(rows[0]).toContain('Block'); expect(rows[0]).toContain('81 g');
    expect(rows[1]).toContain('15.7 g');
    fireEvent.click(r.container.querySelectorAll('.asm-bom-row')[1]);
    expect(calls.selects.at(-1)).toEqual(['F2.C0@F2.1', 'F4.S.e1@F2.1']);
    fireEvent.click(r.getByText('Save CSV'));
    await waitFor(() => expect(calls.saved.length).toBe(1));
    expect(calls.saved[0][0]).toBe('bom.csv');
    expect(calls.saved[0][1].split('\r\n')[2]).toBe('2,Bolt,1,steel,15.7,15.7');
  });
  it('explode: spread, direction, reset and an axis drag patch the state', () => {
    const { h, calls } = host();
    const r = mount(h, 'explode');
    fireEvent.input(r.getByLabelText('Spread'), { target: { value: '1.5' } });
    fireEvent.change(r.getByLabelText('Direction'), { target: { value: 'z' } });
    fireEvent.input(r.getByLabelText('Offset (mm)'), { target: { value: '40' } });
    fireEvent.click(r.getByText('Reset'));
    expect(calls.explode).toEqual([{ spread: 1.5 }, { dir: 'z' }, { manual: { F1: [0, 0, 40] } }, { spread: 0, dir: 'auto', manual: {} }]);
  });
});
