import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { FeatureEditor } from '@kit/ui';
import type { PartDoc } from '@ck/part-model';
import { optionsFor } from '../FeatureOptions';
import { FlatPatternDrawing, FlatPatternView } from './FlatPatternView';
import { SheetDxfDialog } from './SheetDxfDialog';
import { DEFAULT_DXF } from './exportSheet';
import type { FlatPattern, SheetEntry } from './model';
import { setPanelCount, setPanels } from './panels';
import '../i18n';

afterEach(cleanup);
type Wire = Record<string, unknown>;

const DOC = { features: [
  { type: 'sheetRules', id: 'R1', name: 'Steel2', thickness: 2 }, { type: 'sheetRules', id: 'R2', name: 'Alu15', thickness: 1.5 },
  { type: 'sketch', id: 'S1', name: 'Outline', entities: [{ id: 'e1', type: 'line' }, { id: 'e2', type: 'line' }, { id: 'e3', type: 'line' }] },
  { type: 'sketch', id: 'S2', name: 'Fold line', entities: [{ id: 'f1', type: 'line' }, { id: 'f2', type: 'line' }] },
] } as unknown as PartDoc;

function mount(feature: Wire) {
  const drafts: Wire[] = [];
  const picks: string[] = [];
  const r = render(<FeatureEditor feature={feature} onDraft={(d) => drafts.push(d)} onConfirm={() => {}} onCancel={() => {}} onPickRequest={(p) => picks.push(p)} options={(a) => optionsFor(a, DOC)} />);
  const q = (path: string) => r.container.querySelector(`[data-path="${path}"]`) as HTMLElement | null;
  const sel = (path: string) => q(path)!.querySelector('select') as HTMLSelectElement;
  const num = (path: string) => q(path)!.querySelector('input') as HTMLInputElement;
  const box = (path: string) => q(path)!.querySelector('input[type="checkbox"]') as HTMLInputElement;
  const texts = (el: HTMLSelectElement) => [...el.options].map((o) => o.textContent);
  const last = () => drafts.at(-1)!;
  return { ...r, drafts, picks, q, sel, num, box, texts, last };
}

describe('sheet rules editor', () => {
  const RULE = { type: 'sheetRules', id: 'R1', name: 'Steel2', thickness: 2, kFactor: 0.44, bendRadius: 2, active: true };
  it('has the stock and relief settings in one form, titled with the feature name', () => {
    const m = mount(RULE);
    expect(m.container.querySelector('.fedit-title')!.textContent).toContain('Sheet metal rules');
    for (const p of ['thickness', 'kFactor', 'bendRadius', 'reliefWidth', 'reliefDepth', 'cornerRelief', 'cornerReliefShape', 'gap', 'hemGap', 'active', 'name']) expect(m.q(p), p).not.toBeNull();
    expect(m.num('thickness').value).toBe('2');
    expect(m.num('kFactor').value).toBe('0.44');
    expect(m.texts(m.sel('cornerReliefShape'))).toEqual(['Notch', 'Round', 'Rectangular', 'Tear']);
  });
  it('edits write into the draft: numbers, the shape, the name, the active flag', () => {
    const m = mount(RULE);
    fireEvent.change(m.num('thickness'), { target: { value: '3' } });
    expect(m.last().thickness).toBe(3);
    fireEvent.change(m.num('reliefWidth'), { target: { value: '4' } });
    expect(m.last().reliefWidth).toBe(4);
    fireEvent.change(m.sel('cornerReliefShape'), { target: { value: 'round' } });
    expect(m.last().cornerReliefShape).toBe('round');
    expect(m.container.querySelector('[data-note="shape"]')).not.toBeNull();       // only a notch is built for now
    fireEvent.change(m.q('name')!.querySelector('input')!, { target: { value: 'Mild 3' } });
    expect(m.last().name).toBe('Mild 3');
    fireEvent.click(m.box('active'));
    expect(m.last().active).toBe(false);
  });
  it('takes an expression in a number field', () => {
    const m = mount(RULE);
    fireEvent.input(m.num('bendRadius'), { target: { value: '=Thickness*2' } });
    expect(m.last().bendRadius).toBe('=Thickness*2');
  });
  it('"Follow the thickness again" clears the fields that default from it', () => {
    const m = mount({ ...RULE, reliefWidth: 5, gap: 3, cornerRelief: 9 });
    fireEvent.click(m.container.querySelector('[data-act="reset-defaults"]')!);
    expect(m.last()).toMatchObject({ bendRadius: null, reliefWidth: null, reliefDepth: null, cornerRelief: null, gap: null });
    expect(m.last().thickness).toBeUndefined();
  });
});

describe('panel picks and the new features', () => {
  it('the Panel lists are not shown while the sheet has one panel', () => {
    setPanelCount(1);
    const edge = mount({ type: 'edgeFlange', id: 'E1', edges: [{ faces: ['a', 'b'], at: [0, 0, 0] }], height: 10 });
    expect(edge.q('panel')).toBeNull();
    expect(mount({ type: 'fold', id: 'F1', line: { sketch: 'S2', curve: 'f1' } }).q('panel')).toBeNull();
  });
  it('an edge flange adds an edge of a panel by role or ring number once the sheet has several panels', () => {
    setPanelCount(3);
    try {
      const m = mount({ type: 'edgeFlange', id: 'E1', edges: [{ faces: ['a', 'b'], at: [0, 0, 0] }], height: 10 });
      expect(m.texts(m.sel('panel'))).toEqual(['Panel P0', 'Panel P1', 'Panel P2']);
      expect(m.texts(m.sel('panelWall'))).toEqual(['Free end (tip)', 'Start side', 'End side', 'Edge of the panel outline, by number']);
      fireEvent.change(m.sel('panel'), { target: { value: '2' } });
      fireEvent.click(m.container.querySelector('[data-act="add-panel-edge"]')!);
      expect(m.last().edges).toEqual([{ faces: ['a', 'b'], at: [0, 0, 0] }, 'P2.tip']);
      fireEvent.change(m.sel('panelWall'), { target: { value: 'ring' } });
      fireEvent.input(m.num('panelRing'), { target: { value: '3' } });
      fireEvent.click(m.container.querySelector('[data-act="add-panel-edge"]')!);
      expect((m.last().edges as unknown[]).at(-1)).toEqual({ edge: 3, panel: 2 });
    } finally { setPanelCount(1); }
  });
  it('the wall list of a panel is the walls the kernel names for it', () => {
    setPanels({ count: 2, walls: [['side.w2', 'side.w1'], ['side.w6', 'tip']] });
    try {
      const m = mount({ type: 'edgeFlange', id: 'E1', edges: [], height: 10 });
      fireEvent.change(m.sel('panel'), { target: { value: '1' } });
      expect(m.texts(m.sel('panelWall'))).toEqual(['Wall w6', 'Free end (tip)', 'Edge of the panel outline, by number']);
      fireEvent.click(m.container.querySelector('[data-act="add-panel-edge"]')!);
      expect(m.last().edges).toEqual(['P1.side.w6']);
    } finally { setPanelCount(1); }
  });
  it('the chips of the edges field name role and ring picks', () => {
    const m = mount({ type: 'hem', id: 'H1', edges: ['P2.tip', { edge: 1, panel: 2 }, { faces: ['a', 'b'], at: [0, 0, 0] }], length: 10 });
    expect([...m.container.querySelectorAll('.fedit-chip-text')].map((x) => x.textContent)).toEqual(['P2.tip', 'P2 edge 1', 'a|b']);
  });
  it('a hem has the panel adder too, and a fold chooses its panel (Automatic removes it)', () => {
    setPanelCount(2);
    try {
      expect(mount({ type: 'hem', id: 'H1', edges: ['P1.tip'], length: 10 }).q('panel')).not.toBeNull();
      const m = mount({ type: 'fold', id: 'F1', line: { sketch: 'S2', curve: 'f1' }, angle: 90 });
      expect(m.texts(m.sel('panel'))).toEqual(['Automatic', 'Panel P0', 'Panel P1']);
      fireEvent.change(m.sel('panel'), { target: { value: '1' } });
      expect(m.last().panel).toBe(1);
      fireEvent.change(m.sel('panel'), { target: { value: '' } });
      expect(m.last().panel).toBeNull();
    } finally { setPanelCount(1); }
  });
  it('a fold that already names a panel shows it even on a one-panel sheet', () => {
    setPanelCount(1);
    expect(mount({ type: 'fold', id: 'F1', line: { sketch: 'S2', curve: 'f1' }, panel: 2 }).sel('panel').value).toBe('2');
  });
  it('Convert has a thickness (read from the body when empty), the rule list and a button for the active rule\'s thickness', () => {
    const m = mount({ type: 'sheetConvert', id: 'V1' });
    expect(m.container.querySelector('[data-note="thicknessAuto"]')).not.toBeNull();
    expect(m.texts(m.sel('rule'))).toEqual(['The active rule', 'Steel2', 'Alu15']);
    fireEvent.click(m.container.querySelector('[data-act="use-rule-thickness"]')!);
    expect(m.last().thickness).toBe(1.5);                           // the last active rule (Alu15)
    fireEvent.change(m.sel('rule'), { target: { value: 'Steel2' } });
    expect(m.last().rule).toBe('Steel2');
    const set = mount({ type: 'sheetConvert', id: 'V1', thickness: 2 });
    expect(set.num('thickness').value).toBe('2');
    fireEvent.click(set.container.querySelector('[data-act="read-thickness"]')!);
    expect(set.last().thickness).toBeNull();
  });
  it('Cut keeps the sketch picker and lists the regions of its sketch as shapes', () => {
    const drafts: Wire[] = [];
    const r = render(<FeatureEditor feature={{ type: 'sheetCut', id: 'X1', sketch: 'S1' }} onDraft={(d) => drafts.push(d)} onConfirm={() => {}} onCancel={() => {}}
      options={(a) => optionsFor(a, DOC)} shapes={[{ id: 'R1', label: 'Rectangle' }, { id: 'R2', label: 'Circle' }]} />);
    expect(r.container.querySelector('[data-path="sketch"]')).not.toBeNull();
    expect(r.container.querySelectorAll('.fedit-shape')).toHaveLength(2);
    expect(r.container.querySelector('[data-note="cut"]')).not.toBeNull();
    fireEvent.click(r.container.querySelector('[data-shape="R1"] input')!);                  // untick the first: only the second is cut
    expect(drafts.at(-1)!.regions).toEqual(['R2']);
  });
  describe('Corner', () => {
    const CORNER = { type: 'sheetCorner', id: 'K1', corners: [[50, 30, 2], { panel: 1, vertex: 2 }], mode: 'round', radius: 5 };
    it('shows the corners as chips, takes one out, and the Pick button asks for the corners field', () => {
      const m = mount(CORNER);
      expect([...m.container.querySelectorAll('.fedit-chip-text')].map((x) => x.textContent)).toEqual(['50, 30, 2', 'P1 vertex 2']);
      fireEvent.click(m.container.querySelector('[data-act="pick-corners"]')!);
      expect(m.picks).toEqual(['corners']);
      fireEvent.click(m.container.querySelector('.fedit-chip-x')!);
      expect(m.last().corners).toEqual([{ panel: 1, vertex: 2 }]);
    });
    it('a round has a radius, a chamfer a distance; switching keeps the size', () => {
      const m = mount(CORNER);
      expect(m.q('distance')).toBeNull();
      expect(m.num('radius').value).toBe('5');
      fireEvent.change(m.num('radius'), { target: { value: '8' } });
      expect(m.last()).toMatchObject({ radius: 8 });
      fireEvent.change(m.sel('mode'), { target: { value: 'chamfer' } });
      expect(m.last()).toMatchObject({ mode: 'chamfer', distance: 8, radius: null });
    });
    it('a chamfer shows its distance', () => {
      const m = mount({ ...CORNER, mode: 'chamfer', radius: undefined, distance: 3 });
      expect(m.q('radius')).toBeNull();
      expect(m.num('distance').value).toBe('3');
      fireEvent.change(m.num('distance'), { target: { value: '4' } });
      expect(m.last().distance).toBe(4);
    });
    it('marks the corners field as missing until one is picked', () => {
      const m = mount({ type: 'sheetCorner', id: 'K1', corners: [], mode: 'round', radius: 5 });
      expect(m.q('corners')!.className).toContain('missing');
    });
  });
});

describe('flange editors', () => {
  const FLANGE = { type: 'edgeFlange', id: 'E1', edges: [{ faces: ['B1.C1', 'B1.S.e1'], at: [50, 0, 2] }], height: 20 };
  it('an edge flange keeps the edge picker (chips, Use selection) and adds height, angle, radius, reference, position and flip', () => {
    const m = mount(FLANGE);
    expect(m.container.querySelectorAll('.fedit-chip')).toHaveLength(1);
    fireEvent.click(m.container.querySelector('.fedit-pick')!);
    expect(m.picks).toEqual(['edges']);
    expect(m.texts(m.sel('heightFrom'))).toEqual(['To the outer sharp', 'To the inner sharp', 'To the end of the bend']);
    expect(m.texts(m.sel('position'))).toEqual(['Inside the outline', 'Outside the outline', 'Middle']);
    expect(m.num('angle').value).toBe('90');
    fireEvent.change(m.num('height'), { target: { value: '25' } });
    expect(m.last().height).toBe(25);
    fireEvent.change(m.sel('position'), { target: { value: 'outside' } });
    expect(m.last().position).toBe('outside');
    fireEvent.change(m.sel('heightFrom'), { target: { value: 'inner' } });
    expect(m.last().heightFrom).toBe('inner');
    fireEvent.click(m.box('flip'));
    expect(m.last().flip).toBe(true);
    fireEvent.click(m.box('flip'));
    expect(m.last().flip).toBeNull();                    // unticked removes the field
  });
  it('chains bends after the flange, each with its own angle, height and flip', () => {
    const m = mount(FLANGE);
    fireEvent.click(m.container.querySelector('[data-act="add-then"]')!);
    expect(m.last().then).toEqual([{ angle: 90, height: 10 }]);
    fireEvent.change(m.num('then0height'), { target: { value: '12' } });
    expect(m.last().then).toEqual([{ angle: 90, height: 12 }]);
    fireEvent.click(m.box('then0flip'));
    expect((m.last().then as Wire[])[0].flip).toBe(true);
    fireEvent.click(m.container.querySelector('[data-act="remove-then"]')!);
    expect(m.last().then).toBeNull();
  });
  it('a hem has length, gap and flip', () => {
    const m = mount({ type: 'hem', id: 'H1', edges: [{ faces: ['a', 'b'], at: [0, 0, 0] }], length: 10 });
    fireEvent.change(m.num('length'), { target: { value: '8' } });
    expect(m.last().length).toBe(8);
    fireEvent.change(m.num('gap'), { target: { value: '0.1' } });
    expect(m.last().gap).toBe(0.1);
    fireEvent.click(m.box('flip'));
    expect(m.last().flip).toBe(true);
  });
  it('a base flange lists the rules of the part and keeps the sketch picker', () => {
    const m = mount({ type: 'baseFlange', id: 'B1', sketch: 'S1' });
    expect(m.texts(m.sel('rule'))).toEqual(['The active rule', 'Steel2', 'Alu15']);
    fireEvent.change(m.sel('rule'), { target: { value: 'Alu15' } });
    expect(m.last().rule).toBe('Alu15');
    fireEvent.change(m.sel('rule'), { target: { value: '' } });
    expect(m.last().rule).toBeNull();
    expect(m.q('sketch')).not.toBeNull();
  });
  it('a contour flange chooses its lines, distance and sides', () => {
    const m = mount({ type: 'contourFlange', id: 'C1', sketch: 'S1', distance: 40 });
    fireEvent.click(m.box('curve.e2'));
    expect(m.last().curves).toEqual(['e1', 'e3']);
    fireEvent.change(m.num('distance'), { target: { value: '60' } });
    expect(m.last().distance).toBe(60);
    fireEvent.click(m.box('reverse'));
    expect(m.last().reverse).toBe(true);
  });
  it('a fold chooses its sketch line, angle, radius and where the line sits in the bend', () => {
    const m = mount({ type: 'fold', id: 'F1', line: { sketch: 'S2', curve: 'f1' }, angle: 90 });
    expect(m.texts(m.sel('foldSketch'))).toEqual(['Outline', 'Fold line']);
    expect(m.texts(m.sel('foldCurve'))).toEqual(['f1', 'f2']);
    fireEvent.change(m.sel('foldCurve'), { target: { value: 'f2' } });
    expect(m.last().line).toEqual({ sketch: 'S2', curve: 'f2' });
    fireEvent.change(m.num('angle'), { target: { value: '60' } });
    expect(m.last().angle).toBe(60);
    fireEvent.change(m.sel('position'), { target: { value: 'mould' } });
    expect(m.last().position).toBe('mould');
  });
});

const FLAT: FlatPattern = {
  rule: 'Steel2', thickness: 2, kFactor: 0.44, flatSize: [100, 76.5238934, 2],
  outline: [[[100, -16.5238934], [100, 60], [0, 60], [0, -16.5238934]], [[20, 20], [30, 20], [30, 30], [20, 30]]],
  bends: [{ bend: 1, feature: 'E1', direction: 'up', angleDeg: 90, includedAngleDeg: 90, radius: 2, allowance: 4.5238934, length: 100, start: [0, 1.738], end: [100, 1.738] },
    { bend: 2, direction: 'down', angleDeg: 45, includedAngleDeg: 135, radius: 3, allowance: 3, length: 50, start: [50, 0], end: [50, 50] }],
  bendZones: [[0, 100, -0.5238934, 4]], unfolded: false,
};
const ENTRY: SheetEntry = { id: 'E1', type: 'edgeFlange', flatPattern: FLAT };

describe('flat pattern view', () => {
  it('draws the outline with its hole, a dashed line and label per bend, and the sizes', () => {
    const { container } = render(<FlatPatternDrawing flat={FLAT} />);
    const path = container.querySelector('path.sheet-outline')!;
    expect((path.getAttribute('d')!.match(/M/g) ?? []).length).toBe(2);             // outer loop and the hole
    expect(path.getAttribute('fill-rule')).toBe('evenodd');
    expect(container.querySelectorAll('.sheet-bend')).toHaveLength(2);
    expect(container.querySelector('.sheet-bend.down')).not.toBeNull();
    expect(container.querySelector('.sheet-bend[data-bend="1"] text')!.textContent).toBe('B1 90°');
    expect(container.querySelector('.sheet-bend line')!.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(container.querySelectorAll('.sheet-zone')).toHaveLength(1);
    expect(container.querySelector('[data-dim="width"]')!.textContent).toBe('100');
    expect(container.querySelector('[data-dim="length"]')!.textContent).toBe('76.524');
    // flat y runs up, the drawing runs down: the bend near y = 1.7 is below the top edge (y = 60)
    const y1 = Number(container.querySelector('.sheet-bend[data-bend="1"] line')!.getAttribute('y1'));
    expect(y1).toBeGreaterThan(50);
  });
  it('lists the size, rule, holes and a row per bend, and offers the exports', () => {
    const onDxf = vi.fn(), onBends = vi.fn(), onClose = vi.fn();
    const { container } = render(<FlatPatternView entry={ENTRY} onClose={onClose} onDxf={onDxf} onBends={onBends} />);
    const facts = container.querySelector('[data-testid="sheet-flat-facts"]')!.textContent!;
    expect(facts).toContain('100 x 76.524 mm, 2 mm thick');
    expect(facts).toContain('Rule Steel2, k-factor 0.44');
    expect(facts).toContain('1 holes');
    const rows = [...container.querySelectorAll('[data-testid="sheet-flat-bends"] li')].map((x) => x.textContent);
    expect(rows[0]).toBe('B1 up 90 deg, radius 2 mm, allowance 4.524 mm, length 100 mm');
    expect(rows[1]).toContain('B2 down 45 deg');
    fireEvent.click(container.querySelector('[data-act="dxf"]')!);
    fireEvent.click(container.querySelector('[data-act="csv"]')!);
    fireEvent.click(container.querySelector('[data-act="json"]')!);
    fireEvent.click(container.querySelector('[data-act="close"]')!);
    expect(onDxf).toHaveBeenCalledTimes(1);
    expect(onBends.mock.calls).toEqual([['csv'], ['json']]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('says so when there is no sheet yet, and when the sheet is unfolded', () => {
    const none = render(<FlatPatternView entry={null} onClose={() => {}} onDxf={() => {}} onBends={() => {}} />);
    expect(none.container.textContent).toContain('No flat pattern yet');
    expect((none.container.querySelector('[data-act="dxf"]') as HTMLButtonElement).disabled).toBe(true);
    none.unmount();
    const flat = render(<FlatPatternView entry={{ ...ENTRY, flatPattern: { ...FLAT, unfolded: true, bends: [] } }} onClose={() => {}} onDxf={() => {}} onBends={() => {}} />);
    expect(flat.container.textContent).toContain('The sheet is unfolded');
    expect(flat.container.textContent).toContain('No bends');
  });
  it('Escape closes the view', () => {
    const onClose = vi.fn();
    render(<FlatPatternView entry={ENTRY} onClose={onClose} onDxf={() => {}} onBends={() => {}} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('flat pattern DXF dialog', () => {
  it('writes with the chosen options', () => {
    const onWrite = vi.fn();
    const { container } = render(<SheetDxfDialog initial={DEFAULT_DXF} bends={2} onWrite={onWrite} onCancel={() => {}} />);
    fireEvent.change(container.querySelector('[data-opt="version"]')!, { target: { value: 'R12' } });
    fireEvent.change(container.querySelector('[data-opt="units"]')!, { target: { value: 'in' } });
    fireEvent.click(container.querySelector('[data-opt="bendNotes"]')!);
    fireEvent.change(container.querySelector('[data-opt="noteHeight"]')!, { target: { value: '5' } });
    fireEvent.click(container.querySelector('[data-opt="tangentLines"]')!);
    fireEvent.change(container.querySelector('[data-opt="layerNames"]')!, { target: { value: 'reference' } });
    fireEvent.click(container.querySelector('[data-act="write"]')!);
    expect(onWrite).toHaveBeenCalledWith({ ...DEFAULT_DXF, version: 'R12', units: 'in', bendNotes: true, noteHeight: 5, tangentLines: true, layerNames: 'reference' });
  });
  it('greys the bend options of a flat part with no bends, and the layer names when everything goes on layer 0', () => {
    const { container } = render(<SheetDxfDialog initial={DEFAULT_DXF} bends={0} onWrite={() => {}} onCancel={() => {}} />);
    for (const k of ['bendLines', 'tangentLines', 'bendNotes']) expect((container.querySelector(`[data-opt="${k}"]`) as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-opt="layers"]')!, { target: { value: 'single' } });
    expect((container.querySelector('[data-opt="layerNames"]') as HTMLSelectElement).disabled).toBe(true);
  });
  it('cancel and Escape close it', () => {
    const onCancel = vi.fn();
    const { container } = render(<SheetDxfDialog initial={DEFAULT_DXF} bends={1} onWrite={() => {}} onCancel={onCancel} />);
    fireEvent.click(container.querySelector('[data-act="cancel"]')!);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

describe('edge flange and hem: width, leg shape, holes and relief', () => {
  const FL = { type: 'edgeFlange', id: 'E1', edges: [{ faces: ['a', 'b'], at: [50, 0, 2] }], height: 20 };
  const act = (m: { container: Element }, name: string) => m.container.querySelector(`[data-act="${name}"]`) as HTMLElement | null;
  const SK = {
    type: 'sketch', id: 'S5', name: 'Leg', points: [{ id: 'O', x: 0, y: 0 }, { id: 'c', x: 5, y: 5 }, { id: 'd', x: 50, y: 50 }],
    entities: [{ id: 'e1', type: 'line', p1: 'O', p2: 'c' }, { id: 'e2', type: 'circle', c: 'd', r: 4 }],
  };
  const DOC2 = { features: [...DOC.features, SK, { type: 'sheetRules', id: 'R3', name: 'R', thickness: 3, reliefWidth: 4, reliefDepth: 2, active: true }] } as unknown as PartDoc;
  function mount2(feature: Wire, doc: PartDoc = DOC2, picking: string | null = null) {
    const drafts: Wire[] = [];
    const picks: string[] = [];
    const r = render(<FeatureEditor feature={feature} onDraft={(d) => drafts.push(d)} onConfirm={() => {}} onCancel={() => {}} onPickRequest={(p) => picks.push(p)} pickingPath={picking} options={(a) => optionsFor(a, doc)} />);
    const q = (path: string) => r.container.querySelector(`[data-path="${path}"]`) as HTMLElement | null;
    return { ...r, drafts, picks, q, last: () => drafts.at(-1)!, sel: (p: string) => q(p)!.querySelector('select') as HTMLSelectElement, num: (p: string) => q(p)!.querySelector('input') as HTMLInputElement,
      texts: (el: HTMLSelectElement) => [...el.options].map((o) => o.textContent) };
  }

  it('the Width list starts at the whole edge; Start and length takes numbers into the feature; the note explains where Start counts from', () => {
    const m = mount2(FL);
    expect(m.sel('spanMode').value).toBe('whole');
    expect(m.texts(m.sel('spanMode'))).toEqual(['The whole edge', 'Start and length', 'Between two points']);
    expect(m.q('start')).toBeNull();
    expect(m.container.querySelector('[data-note="relief"]')).toBeNull();           // a relief means something only for part of the edge
    fireEvent.change(m.sel('spanMode'), { target: { value: 'length' } });
    expect(m.last().length).toBeGreaterThan(0);
    expect(m.q('start')).not.toBeNull();
    fireEvent.input(m.num('start'), { target: { value: '20' } });
    fireEvent.input(m.num('length'), { target: { value: '40' } });
    expect(m.last()).toMatchObject({ start: 20, length: 40 });
    expect(m.last().edges).toBeUndefined();                                          // the pick itself is not rewritten
    expect(m.container.querySelector('[data-note="span"]')!.textContent).toMatch(/start vertex/);
    expect(m.container.querySelector('[data-note="relief"]')).not.toBeNull();       // now there is a relief to choose
  });
  it('Between two points: typed points set from and to; Pick two points asks the app', () => {
    const m = mount2(FL);
    fireEvent.change(m.sel('spanMode'), { target: { value: 'points' } });
    expect(m.q('from')).not.toBeNull();
    fireEvent.change(m.q('from')!.querySelector('input')!, { target: { value: '20, 0, 1' } });
    expect(m.last().from).toBeUndefined();                                           // both points are needed
    fireEvent.change(m.q('to')!.querySelector('input')!, { target: { value: '60, 0, 1' } });
    expect(m.last()).toMatchObject({ from: [20, 0, 1], to: [60, 0, 1] });
    fireEvent.click(act(m, 'pick-span')!);
    expect(m.picks).toEqual(['span']);
    const on = mount2(FL, DOC2, 'span');
    fireEvent.change(on.sel('spanMode'), { target: { value: 'points' } });
    expect(on.container.querySelector('[data-note="pickSpan"]')!.textContent).toMatch(/first point/);
  });
  it('an imported flange shows its points, its outline and its hole; a field edit leaves them alone', () => {
    const outline = [{ line: [[0, 5], [10, 5]] }, { line: [[10, 5], [10, 20]] }, { line: [[10, 20], [0, 20]] }, { line: [[0, 20], [0, 5]] }];
    const imp = { type: 'edgeFlange', id: 'F5', edges: [{ at: [-2.25, 0, 36], from: [-1.5, -94.5, 36], to: [-1.5, 94.5, 36] }], angle: 90, radius: 2, position: 'outside', profile: outline, holes: [{ circle: { center: [4, 12], radius: 2 } }] };
    const m = mount2(imp);
    expect(m.sel('spanMode').value).toBe('points');
    expect((m.q('from')!.querySelector('input') as HTMLInputElement).value).toBe('-1.5, -94.5, 36');
    expect(m.sel('legShape').value).toBe('inline');
    expect(m.texts(m.sel('legShape'))).toEqual(['Rectangle', 'Sketch outline', 'Imported outline']);
    expect(m.container.querySelector('[data-note="legInline"]')!.textContent).toMatch(/4 lines and 0 arcs/);
    expect(m.num('holes0v').value).toBe('4');
    expect(m.num('holes0r').value).toBe('2');
    fireEvent.input(m.num('radius'), { target: { value: '3' } });
    expect(m.last()).toEqual({ radius: 3 });                                          // only the edited field is in the draft
    // its outline starts 5 mm above the bend line, so it converts (through its bottom edge); an outline that cannot is explained
    expect((act(m, 'convert-profile') as HTMLButtonElement).disabled).toBe(true);     // the app (flangeActions) is not there in this test
    expect(m.container.querySelector('[data-note="noConvert"]')).toBeNull();
    const bad = mount2({ ...imp, profile: [{ line: [[3, 5], [10, 5]] }, { line: [[10, 5], [10, 20]] }, { line: [[10, 20], [3, 20]] }, { line: [[3, 20], [3, 5]] }] });
    expect(bad.container.querySelector('[data-note="noConvert"]')!.textContent).toMatch(/3 mm/);
  });
  it('Shape: Rectangle by default; Sketch outline lists the sketches and writes the profile; back to Rectangle removes profile and holes', () => {
    const m = mount2(FL);
    expect(m.sel('legShape').value).toBe('rect');
    expect(m.container.querySelector('[data-note="holesNeedOutline"]')).not.toBeNull();
    fireEvent.change(m.sel('legShape'), { target: { value: 'sketch' } });
    expect(m.texts(m.sel('legSketch'))).toEqual(['Choose a sketch', 'Outline', 'Fold line', 'Leg']);
    fireEvent.change(m.sel('legSketch'), { target: { value: 'S5' } });
    expect(m.last().profile).toEqual({ sketch: 'S5' });
    expect(act(m, 'edit-profile-sketch')).not.toBeNull();
    expect(m.container.querySelector('[data-note="legHeight"]')).not.toBeNull();
    expect(m.container.querySelector('[data-note="holesNeedOutline"]')).toBeNull();
    fireEvent.click(act(m, 'add-hole')!);
    expect(m.last().holes).toHaveLength(1);
    fireEvent.change(m.sel('legShape'), { target: { value: 'rect' } });
    expect(m.last().profile).toBeNull();
    expect(m.last().holes).toBeNull();
  });
  it('Holes: a circle of the sketch is ticked into the list, measured from the outline\'s corner, and unticked out of it', () => {
    const m = mount2({ ...FL, profile: { sketch: 'S5' } });
    const box = (m.q('holeCircles')!.querySelector('input[type="checkbox"]') as HTMLInputElement);
    expect(m.q('holeCircles')!.textContent).toMatch(/Circle e2, diameter 8 mm/);
    fireEvent.click(box);
    expect(m.last().holes).toEqual([{ circle: { center: [50, 50], radius: 4 } }]);     // the outline sketch's lines start at (0, 0)
    fireEvent.click(act(m, 'remove-hole')!);
    expect(m.last().holes).toBeNull();
  });
  it('Relief: for part of the edge, none / the rule\'s size / your own; the rule\'s numbers are in the list', () => {
    const m = mount2({ ...FL, length: 30 });
    expect(m.texts(m.sel('relief'))).toEqual(['None (only the notch)', 'By the rule (4 x 2 mm)', 'My own size']);
    fireEvent.change(m.sel('relief'), { target: { value: 'rectangular' } });
    expect(m.last().relief).toBe('rectangular');
    fireEvent.change(m.sel('relief'), { target: { value: 'custom' } });
    expect(m.last().relief).toEqual({ width: 4, depth: 2 });
    fireEvent.input(m.num('reliefW'), { target: { value: '6' } });
    expect(m.last().relief).toEqual({ width: 6, depth: 2 });
    fireEvent.change(m.sel('relief'), { target: { value: 'none' } });
    expect(m.last().relief).toBeNull();
  });
  it('a hem has the width section and the relief but no length field for the span or shape', () => {
    const m = mount2({ type: 'hem', id: 'H1', edges: [{ faces: ['a', 'b'], at: [0, 0, 0] }], length: 10 });
    expect(m.texts(m.sel('spanMode'))).toEqual(['The whole edge', 'From a start to the end', 'Between two points']);
    expect(m.q('legShape')).toBeNull();
    fireEvent.change(m.sel('spanMode'), { target: { value: 'length' } });
    expect(m.last().start).toBe(0);
    expect(m.q('length')!.textContent).toMatch(/Length/);                           // the hem's own length stays
    expect(m.container.querySelectorAll('[data-path="length"]')).toHaveLength(1);
    expect(m.container.querySelector('[data-note="span"]')!.textContent).toMatch(/end of the edge/);
  });
  it('several edges with a width of their own: the form says so and one click gives them all the same width', () => {
    const m = mount2({ ...FL, edges: [{ at: [0, 0, 0], start: 1, length: 5 }, { at: [1, 0, 0] }] });
    expect(m.container.querySelector('[data-note="perEdge"]')).not.toBeNull();
    fireEvent.click(act(m, 'clear-spans')!);
    expect(m.last().edges).toEqual([{ at: [0, 0, 0] }, { at: [1, 0, 0] }]);
  });
  it('the chip of an edge named by a point shows the point', () => {
    const m = mount2({ ...FL, edges: [{ at: [-2.25, 0.123456, 36], from: [0, 0, 0], to: [1, 0, 0] }] });
    expect([...m.container.querySelectorAll('.fedit-chip-text')].map((x) => x.textContent)).toEqual(['-2.25, 0.12, 36']);
  });
});
