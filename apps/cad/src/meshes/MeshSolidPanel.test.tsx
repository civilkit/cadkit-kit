import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { MeshSolidPanel, faceChips, fitLine, inventedLine, optionsOf, refusalAdvice, refusalTitle, type MeshSolidPanelProps } from './MeshSolidPanel';
import { DEFAULT_MESH_SOLID_OPTIONS, readOutcome, REFUSAL_CODES } from './meshSolid';
import { fileCommands, type FileActions } from '../files/fileCommands';
import { isFileCommand, notOnRail } from '../toolbarModel';
import { t } from '../i18n';
import '../i18n';

afterEach(() => cleanup());

const props = (o: Partial<MeshSolidPanelProps> = {}): MeshSolidPanelProps => ({
  sources: [{ id: 'mesh1', name: 'Bracket', tris: 1200 }], sourceId: 'mesh1', onSource: vi.fn(), busy: false, outcome: null, show: 'both', onShow: vi.fn(),
  focus: null, onFocus: vi.fn(), unit: 'mm', onRun: vi.fn(), onCancelRun: vi.fn(), onClose: vi.fn(), onAccept: vi.fn(), ...o,
});

describe('MeshSolidPanel: options', () => {
  it('shows the mesh, its triangles against the limit, and that it is a preview; Convert sends the defaults', () => {
    const p = props();
    const r = render(<MeshSolidPanel {...p} />);
    expect(r.getByTestId('m2s-name').textContent).toBe('Bracket');
    expect(r.getByTestId('m2s-tris').textContent).toBe('1,200 triangles (limit 200,000)');
    expect(r.getByText('Preview only: nothing is added to the part yet.')).toBeTruthy();
    expect(r.getByTestId('m2s-intro').textContent).toMatch(/^Turns the mesh into a solid you can model on\./);
    expect(document.activeElement).toBe(r.getByTestId('m2s-run'));   // focus on Convert when the panel opens
    expect((r.getByTestId('m2s-close') as HTMLInputElement).checked).toBe(false);
    expect(r.queryByTestId('m2s-close-options')).toBeNull();
    fireEvent.click(r.getByTestId('m2s-run'));
    expect(p.onRun).toHaveBeenCalledWith({ ...DEFAULT_MESH_SOLID_OPTIONS });
  });
  it('Close gaps and holes opens its options; what is typed goes in, an empty field stays the default', () => {
    const p = props();
    const r = render(<MeshSolidPanel {...p} />);
    fireEvent.click(r.getByTestId('m2s-close'));
    expect(r.getByTestId('m2s-close-options')).toBeTruthy();
    fireEvent.input(r.getByTestId('m2s-maxHoleEdges'), { target: { value: '40' } });
    fireEvent.input(r.getByTestId('m2s-planeTol'), { target: { value: '0.01' } });
    fireEvent.click(r.getByTestId('m2s-analytic'));
    fireEvent.click(r.getByTestId('m2s-run'));
    expect(p.onRun).toHaveBeenCalledWith({ ...DEFAULT_MESH_SOLID_OPTIONS, close: true, maxHoleEdges: 40, planeTol: 0.01, analytic: false });
    // Fill holes off hides the hole size
    fireEvent.click(r.getByTestId('m2s-fill'));
    expect(r.queryByTestId('m2s-maxHoleEdges')).toBeNull();
  });
  it('Enter in a field converts; the labels carry their unit inside the field and auto explains itself', () => {
    const p = props();
    const r = render(<MeshSolidPanel {...p} />);
    fireEvent.click(r.getByTestId('m2s-close'));
    const gap = r.getByTestId('m2s-closeTolerance');
    expect(gap.getAttribute('aria-label')).toBe('Gap size');
    expect(gap.getAttribute('title')).toBe('auto = from the size of the mesh');
    expect(gap.parentElement!.textContent).toBe('mm');
    expect(r.getByTestId('m2s-maxHoleEdges').getAttribute('aria-label')).toBe('Fill holes up to');
    expect(r.getByTestId('m2s-maxHoleEdges').parentElement!.textContent).toBe('edges');
    fireEvent.input(gap, { target: { value: '0.2' } });
    fireEvent.keyDown(gap, { key: 'Enter' });
    expect(p.onRun).toHaveBeenCalledWith({ ...DEFAULT_MESH_SOLID_OPTIONS, close: true, closeTolerance: 0.2 });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalled();
  });
  it('a field that is not a number above 0 disables Convert and says so', () => {
    const r = render(<MeshSolidPanel {...props()} />);
    fireEvent.input(r.getByTestId('m2s-fitTol'), { target: { value: '-2' } });
    expect((r.getByTestId('m2s-run') as HTMLButtonElement).disabled).toBe(true);
    expect(r.getByTestId('m2s-invalid')).toBeTruthy();
    expect(r.getByTestId('m2s-fitTol').getAttribute('aria-invalid')).toBe('true');
  });
  it('a junk value in a switched-off field does not block', () => {
    const f = { closeTolerance: 'x', maxHoleEdges: 'y', planeTol: '', angleTolDeg: '', fitTol: '' };
    expect(optionsOf(f, false, true, true).invalid).toEqual([]);
    expect(optionsOf(f, true, false, true).invalid).toEqual(['closeTolerance']);
  });
  it('warns above 20 000 triangles and refuses above 200 000', () => {
    let r = render(<MeshSolidPanel {...props({ sources: [{ id: 'mesh1', name: 'Scan', tris: 50000 }] })} />);
    expect(r.getByTestId('m2s-tris-warn')).toBeTruthy();
    expect((r.getByTestId('m2s-run') as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    r = render(<MeshSolidPanel {...props({ sources: [{ id: 'mesh1', name: 'Scan', tris: 250000 }] })} />);
    expect(r.getByTestId('m2s-tris-over').textContent).toContain('200,000');
    expect((r.getByTestId('m2s-run') as HTMLButtonElement).disabled).toBe(true);
  });
  it('several meshes: a choice; a file mesh says it is not in the part and the unit it was read in', () => {
    const p = props({ sources: [{ id: 'mesh1', name: 'A', tris: 12 }, { id: 'm2s-file', name: 'b', tris: 24, fileUnit: 'mm' }], sourceId: 'm2s-file' });
    const r = render(<MeshSolidPanel {...p} />);
    const sel = r.getByTestId('m2s-source') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['A', 'b (file, not in the part)']);
    expect(r.getByText(/Read as mm/)).toBeTruthy();
    fireEvent.change(sel, { target: { value: 'mesh1' } });
    expect(p.onSource).toHaveBeenCalledWith('mesh1');
  });
  it('busy: Convert becomes Cancel, which stops waiting; Escape does the same', () => {
    const p = props({ busy: true });
    const r = render(<MeshSolidPanel {...p} />);
    expect(r.getByTestId('m2s-busy').textContent).toContain('Converting 1,200 triangles');
    expect(r.queryByTestId('m2s-run')).toBeNull();
    fireEvent.click(r.getByTestId('m2s-cancel-run'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(p.onCancelRun).toHaveBeenCalledTimes(2);
    expect(p.onClose).not.toHaveBeenCalled();
  });
});

const SOLID = readOutcome({ ok: true, result: { errors: [], body: {}, import: {
  triangles: 140, faces: 34, diagonal: 17.3, faceTypes: { plane: 33, cylinder: 1 }, volume: { mesh: 780.3, body: 785.4, relative: 0.0065 },
  analytic: { applied: true, faceted: 30 }, deviation: { max: 0.0193, rms: 0.0145 },
  closing: { openEdges: 32, mergedVertices: 0, stitched: 0, filledHoles: 1, filledTriangles: 30, filledArea: 78.5, holes: [{ edges: 32, area: 78.5, planar: true, method: 'ear', at: [0, 0, 10] }] },
} } }, 2400);
const CUBE = readOutcome({ ok: true, result: { errors: [], body: {}, import: {
  triangles: 12, faces: 6, diagonal: 34.6, faceTypes: { plane: 6 }, volume: { mesh: 8000, body: 8000.0000000000055, relative: 5.7e-16 },
  analytic: { applied: false, reason: 'nothing to fit', faceted: 0 }, deviation: { max: 3.2e-15, rms: 1.06e-15 },
} } }, 19);
const nb = (x: string | null | undefined): string => (x ?? '').replace(/\u00a0/g, ' ');
const report = (o: typeof SOLID) => { if (!o.ok) throw new Error('not a solid'); return o.report; };

describe('MeshSolidPanel: the result', () => {
  it('a green card leads: faces, volume and time, the kinds as chips, one sentence on the fit', () => {
    const r = render(<MeshSolidPanel {...props({ outcome: CUBE })} />);
    expect(nb(r.getByTestId('m2s-headline').textContent)).toBe('Solid made: 6 faces · 8 000 mm³');
    expect(nb(r.getByTestId('m2s-took').textContent)).toBe('19 ms');   // the time sits beside the chips, so the headline fits one line
    expect([...r.getByTestId('m2s-kinds').querySelectorAll('li')].map((x) => x.textContent)).toEqual(['6 planar']);
    expect(r.getByTestId('m2s-faceted').textContent).toBe('No curved faces to fit.');
    // the Show control comes right after the card, the details after it
    const order = [...r.getByTestId('m2s-report').children].map((x) => x.getAttribute('data-testid') ?? x.className);
    expect(order.indexOf('m2s-show')).toBe(1);
    expect(r.getByTestId('m2s-run').textContent).toBe('Convert again');
  });
  it('the noise of an exact conversion reads as exact, an unchanged volume as the same', () => {
    const r = render(<MeshSolidPanel {...props({ outcome: CUBE })} />);
    expect(r.getByTestId('m2s-deviation').textContent).toBe('Exact (no measurable deviation)');
    expect(nb(r.getByTestId('m2s-volume').textContent)).toBe('mesh 8 000 mm³solid 8 000 mm³same volume');
    expect((r.getByTestId('m2s-details') as HTMLDetailsElement).open).toBe(false);   // nothing invented: the details stay shut
  });
  it('a real deviation in two figures without an exponent, the volume change in percent', () => {
    const r = render(<MeshSolidPanel {...props({ outcome: SOLID })} />);
    expect(nb(r.getByTestId('m2s-headline').textContent)).toBe('Solid made: 34 faces · 785 mm³');
    expect([...r.getByTestId('m2s-kinds').querySelectorAll('li')].map((x) => x.textContent)).toEqual(['3 planar', '1 cylinder', '30 small flat faces']);
    expect(r.getByTestId('m2s-faceted').textContent).toBe('30 small flat faces stayed on curved areas: they did not fit a cylinder, cone or sphere.');
    expect(nb(r.getByTestId('m2s-deviation').textContent)).toBe('max 0.019 mm, rms 0.015 mm');
    expect(nb(r.getByTestId('m2s-volume').textContent)).toBe('mesh 780 mm³solid 785 mm³+0.65 % change');
    expect(nb(r.getByTestId('m2s-time').textContent)).toBe('2.4 s');
  });
  it('invented geometry opens the details, says only what happened, and lists each hole; a click points the view at it', () => {
    const p = props({ outcome: SOLID });
    const r = render(<MeshSolidPanel {...p} />);
    expect((r.getByTestId('m2s-details') as HTMLDetailsElement).open).toBe(true);
    expect(nb(r.getByTestId('m2s-invented-line').textContent)).toBe('Filled 1 hole (78.5 mm²); 32 open edges found');
    expect(nb(r.getByTestId('m2s-place-0').textContent)).toBe('Hole 1: 32 edges, 78.5 mm², flat cap');
    fireEvent.click(r.getByTestId('m2s-place-0'));
    expect(p.onFocus).toHaveBeenCalledWith(0);
  });
  it('Show is a segmented control', () => {
    const p = props({ outcome: SOLID });
    const r = render(<MeshSolidPanel {...p} />);
    const seg = r.getByTestId('m2s-show');
    expect(seg.querySelector('[aria-checked="true"]')!.textContent).toBe('Both');
    fireEvent.click(seg.querySelector('[data-show="solid"]')!);
    expect(p.onShow).toHaveBeenCalledWith('solid');
  });
  it('Add to part is disabled until the kernel can keep the result, with a visible note and a tooltip', () => {
    const r = render(<MeshSolidPanel {...props({ outcome: SOLID })} />);
    const b = r.getByTestId('m2s-accept') as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.parentElement!.getAttribute('title')).toMatch(/Not available yet/);
    expect(r.getByTestId('m2s-accept-note').textContent).toBe('Keeping the result in the part arrives with the next update.');
  });
  it('the words: plurals, nothing printed for what did not happen', () => {
    const c = { openEdges: 1, mergedVertices: 2, stitched: 0, filledHoles: 3, filledTriangles: 9, filledArea: 12, holes: [] };
    expect(nb(inventedLine(c, 'mm'))).toBe('Filled 3 holes (12 mm²); welded 2 vertices; 1 open edge found');
    expect(inventedLine({ ...c, openEdges: 0, mergedVertices: 0, filledHoles: 0, stitched: 1 }, 'mm')).toBe('Stitched 1 crack');
    expect(inventedLine({ ...c, openEdges: 0, mergedVertices: 0, filledHoles: 0 }, 'mm')).toBe('Nothing needed closing.');
    const rep = report(SOLID);
    expect(fitLine(rep, false)).toBe('Analytic fit is off: curved areas stay as small flat faces.');
    expect(fitLine({ ...rep, kinds: { ...rep.kinds, faceted: 1 } }, true)).toBe('1 small flat face stayed on a curved area: it did not fit a cylinder, cone or sphere.');
    expect(fitLine({ ...rep, kinds: { ...rep.kinds, faceted: 0 } }, true)).toBe('Every curved area became an exact cylinder, cone or sphere.');
    expect(faceChips({ ...rep, kinds: { planar: 0, faceted: 0, cylinder: 2, cone: 1, sphere: 0, other: 0 } }).map((c) => c.text)).toEqual(['2 cylinders', '1 cone']);
  });
});

describe('MeshSolidPanel: refusals', () => {
  const HINT = 'close the holes in a mesh tool, or raise opts.weldTol if the gaps are cracks between vertices that should be one';
  const refused = readOutcome({ ok: true, result: { errors: [['import', { code: 'meshNotWatertight', params: {
    message: '4 open edges in 1 gap(s): the mesh does not enclose a volume', hint: HINT, positions: [[10, 5, 0], [10, 10, 5]] } }]] } }, 40);
  it('a red card with our title and advice; the kernel`s words kept under Technical detail; the places listed', () => {
    const p = props({ outcome: refused });
    const r = render(<MeshSolidPanel {...p} />);
    expect(r.getByTestId('m2s-refusal').getAttribute('data-code')).toBe('meshNotWatertight');
    expect(r.getByText('Not converted: The mesh has gaps')).toBeTruthy();
    expect(r.getByTestId('m2s-advice').textContent).toBe('Tick Close gaps and holes to let the program weld cracks and fill small holes, or repair the mesh in a mesh tool.');
    expect(r.getByText('2 places are marked in the view.')).toBeTruthy();
    expect((r.getByTestId('m2s-details') as HTMLDetailsElement).open).toBe(true);
    expect((r.getByTestId('m2s-technical') as HTMLDetailsElement).open).toBe(false);
    expect(r.getByTestId('m2s-message').textContent).toBe('Kernel: 4 open edges in 1 gap(s): the mesh does not enclose a volume');
    expect(r.getByTestId('m2s-hint').textContent).toBe('Kernel hint: ' + HINT);
    fireEvent.click(r.getByTestId('m2s-place-1'));
    expect(p.onFocus).toHaveBeenCalledWith(1);
  });
  it('gaps with Close off: one button ticks Close gaps and holes and converts again', () => {
    const p = props({ outcome: refused });
    const r = render(<MeshSolidPanel {...p} />);
    expect((r.getByTestId('m2s-close') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(r.getByTestId('m2s-retry-closed'));
    expect(p.onRun).toHaveBeenCalledWith({ ...DEFAULT_MESH_SOLID_OPTIONS, close: true });
    expect((r.getByTestId('m2s-close') as HTMLInputElement).checked).toBe(true);
    // once Close is on (or for a refusal ticking it cannot cure) the button is gone
    expect(r.queryByTestId('m2s-retry-closed')).toBeNull();
    cleanup();
    const big = readOutcome({ ok: true, result: { errors: [['import', { code: 'meshHoleTooLarge', params: { message: 'm', hint: 'h' } }]] } }, 1);
    expect(render(<MeshSolidPanel {...props({ outcome: big })} />).queryByTestId('m2s-retry-closed')).toBeNull();
  });
  it('every refusal code has a title and advice of its own; an unknown code generic ones', () => {
    const titles = REFUSAL_CODES.map(refusalTitle);
    const advice = REFUSAL_CODES.map((c) => refusalAdvice(c, false));
    expect(new Set(titles).size).toBe(REFUSAL_CODES.length);
    expect(new Set(advice).size).toBe(REFUSAL_CODES.length);
    for (const x of [...titles, ...advice]) { expect(x).not.toMatch(/^m2s\./); expect(x).not.toMatch(/opts\./); }
    expect(refusalTitle('meshSomethingNew')).toBe('The mesh was refused');
    expect(refusalAdvice('meshSomethingNew', false)).toBe('Check the mesh in a mesh tool, then convert it again.');
    expect(refusalTitle('meshTooLarge')).toBe('Too many triangles');
    expect(refusalTitle('meshNonManifold')).toBe('Edges shared by more than two triangles');
    // with closing on, the gaps advice no longer tells you to tick it
    expect(refusalAdvice('meshNotWatertight', true)).toMatch(/Raise Gap size/);
  });
  it('a failure that is not a refusal', () => {
    const r = render(<MeshSolidPanel {...props({ outcome: { ok: false, failed: 'unknown request type' } })} />);
    expect(r.getByTestId('m2s-failed').textContent).toBe('The conversion did not run: unknown request type');
  });
});

describe('the Convert mesh to solid command', () => {
  const f = { meshToSolid: vi.fn() } as unknown as FileActions;
  it('is a file command (top bar menu and command search), enabled with a part open', () => {
    let open = false;
    const c = fileCommands(f, () => open).find((x) => x.id === 'mesh-to-solid')!;
    expect(c.label).toBe('Convert mesh to solid');
    expect(c.enabled?.()).toBe(false);
    open = true;
    expect(c.enabled?.()).toBe(true);
    c.run();
    expect(f.meshToSolid).toHaveBeenCalledOnce();
    expect(isFileCommand('mesh-to-solid')).toBe(true);
    expect(notOnRail('mesh-to-solid')).toBe(true);
    expect(t('cmd.mesh-to-solid.tip')).toMatch(/preview/i);
  });
});
