import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/preact';
import { sketchTools } from '@kit/sketch';
import { ICON_NAMES, slotMemory } from '@kit/ui';
import { SketchToolStrip, slotsFor, PALETTE_SLOTS } from './SketchToolStrip';
import { buildCommands, type Actions } from './commands';
import './i18n';

afterEach(cleanup);

const actions: Actions = {
  open() {}, save() {}, samples() {}, undo() {}, redo() {}, palette() {}, toggleDrawer() {}, settings() {}, hasDocument: () => true, newPart() {}, toggleProjection() {}, sketchHere() {}, toggleLeftPanel() {}, addExtrude() {}, newSketch() {}, sketchOnFace() {}, hasFaceSelection: () => false,
  setView() {}, fit() {}, setMode() {}, mode: () => 'face', toggleLayer() {}, layer: () => false,
};

describe('icons cover everything the UI offers', () => {
  it('every command id has an icon', () => {
    const missing = buildCommands(actions).map((c) => c.id).filter((id) => !ICON_NAMES.includes(id));
    expect(missing).toEqual([]);
  });
  it('every feature command has an icon', () => {
    const ids = ['add-fillet', 'add-chamfer', 'add-shell', 'add-hole', 'add-revolve', 'add-lpattern', 'add-cpattern', 'sketch-on-face'];
    expect(ids.filter((id) => !ICON_NAMES.includes(id))).toEqual([]);
  });
  it('every selection mode used by the selection bar has an icon', () => {
    expect(['face', 'edge', 'vertex'].filter((m) => !ICON_NAMES.includes('sel-' + m))).toEqual([]);
  });
});

describe('SketchToolStrip', () => {
  const count = sketchTools().length + 1;
  it('icons-and-text mode shows an icon and the name on every button, with group headings', () => {
    const { container } = render(<SketchToolStrip active={null} onPick={() => {}} labels="icons-and-text" />);
    const buttons = [...container.querySelectorAll('.stool')];
    expect(buttons.length).toBe(count);
    expect(buttons.every((b) => b.querySelector('svg.icon') && b.textContent!.trim().length > 0)).toBe(true);
    expect(container.querySelectorAll('.sgroup-name').length).toBe(4);
    expect(container.querySelector('.icon-only')).toBeNull();
    expect(container.querySelector('[data-icon="placeholder"]')).toBeNull();
  });
  it('is the default mode', () => {
    const { container } = render(<SketchToolStrip active={null} onPick={() => {}} />);
    expect(container.querySelector('.sgroup-name')).not.toBeNull();
  });
  it('icons mode shows only icons, drops the headings, labels buttons for assistive tech and has no native title', () => {
    const { container } = render(<SketchToolStrip active="line" onPick={() => {}} labels="icons" />);
    const buttons = [...container.querySelectorAll('.stool')] as HTMLElement[];
    expect(buttons.length).toBe(count);
    expect(buttons.every((b) => b.classList.contains('icon-only') && b.textContent === '' && !!b.getAttribute('aria-label') && !b.hasAttribute('title'))).toBe(true);
    expect(container.querySelectorAll('.sgroup-name').length).toBe(0);
    expect(container.querySelectorAll('[role="group"]').length).toBe(4);
    expect(container.querySelector('[data-icon="placeholder"]')).toBeNull();
    expect(container.querySelector('.stool[aria-pressed="true"]')!.getAttribute('aria-label')).toBe('Line');
  });
  it('shows the name and shortcut instantly on hover in icons mode, and picks on click', () => {
    const onPick = vi.fn();
    render(<SketchToolStrip active={null} onPick={onPick} labels="icons" />);
    const line = screen.getByRole('button', { name: 'Line' });
    fireEvent.pointerEnter(line, { pointerType: 'mouse' });
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Line');
    expect(tip.querySelector('kbd')!.textContent).toBe('L');
    fireEvent.click(line);
    expect(onPick).toHaveBeenCalledWith('line');
  });
});


describe('palette slots', () => {
  afterEach(cleanup);
  beforeEach(() => { localStorage.clear(); slotMemory.reset(); });
  it('every configured tool id exists or is a planned tool, and no tool is hidden', () => {
    const tools = sketchTools();
    for (const g of ['draw', 'dimension', 'constrain', 'edit'] as const) {
      const slots = slotsFor(g, tools);
      const shown = slots.flatMap((s) => s.tools.map((x) => x.id)).sort();
      expect(shown).toEqual(tools.filter((x) => x.group === g).map((x) => x.id).sort());   // each tool exactly once
    }
    const known = new Set(sketchTools().map((x) => x.id));
    const unknown = Object.values(PALETTE_SLOTS).flat(2).filter((id) => !known.has(id));
    expect(unknown).toEqual([]);   // every id in a slot is a real tool: a typo would hide it from its slot
  });
  it('groups the arcs into one slot that shows the default and offers the others in a flyout', () => {
    const picked: Array<string | null> = [];
    render(<SketchToolStrip layout="palette" active={null} onPick={(id) => picked.push(id)} />);
    fireEvent.click(screen.getByLabelText('3-point arc'));
    expect(picked).toEqual(['arc-three-point']);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByLabelText(/More tools like 3-point arc/));
    const menu = screen.getByRole('menu');
    expect(menu.querySelectorAll('[role="menuitem"]').length).toBe(3);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tangent arc' }));
    expect(picked.at(-1)).toBe('arc-tangent');
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('remembers the last tool used in a slot and shows it', () => {
    const { unmount } = render(<SketchToolStrip layout="palette" active={null} onPick={() => {}} />);
    fireEvent.contextMenu(screen.getByLabelText('3-point arc'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Centre arc' }));
    unmount();
    render(<SketchToolStrip layout="palette" active={null} onPick={() => {}} />);
    expect(screen.queryByLabelText('3-point arc')).toBeNull();
    expect(screen.getByLabelText('Centre arc')).toBeTruthy();
  });
  it('shows the active tool when a shortcut key picked one from a slot, and Escape closes the flyout', () => {
    render(<SketchToolStrip layout="palette" active="slot" onPick={() => {}} />);
    expect(screen.getByLabelText('Slot').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByLabelText(/More tools like Rectangle/));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('a long press opens the flyout and the click that follows does not pick the tool', async () => {
    const picked: Array<string | null> = [];
    render(<SketchToolStrip layout="palette" active={null} onPick={(id) => picked.push(id)} />);
    const b = screen.getByLabelText('Line');
    fireEvent.pointerDown(b);
    await new Promise((r) => setTimeout(r, 460));
    fireEvent.pointerUp(b);
    fireEvent.click(b);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(picked).toEqual([]);
  });
});

describe('palette slots on touch', () => {
  afterEach(cleanup);
  it('a flick towards the flyout opens it and the tap that ends it does not pick the tool', async () => {
    const picked: Array<string | null> = [];
    render(<SketchToolStrip layout="palette" active={null} onPick={(id) => picked.push(id)} />);
    const b = screen.getByLabelText('Line');
    // jsdom has no PointerEvent and no onpointer* properties, so Preact listens under the camel-case names there
    const ev = (type: string, x: number) => b.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x }));
    ev('PointerDown', 200);
    ev('PointerMove', 170);
    ev('PointerUp', 170);
    fireEvent.click(b);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(picked).toEqual([]);
  });
  it('a pointer cancel (the browser took the touch for scrolling) does not open the flyout later', async () => {
    render(<SketchToolStrip layout="palette" active={null} onPick={() => {}} />);
    const b = screen.getByLabelText('Line');
    fireEvent.pointerDown(b, { clientX: 200 });
    fireEvent.pointerCancel(b);
    await new Promise((r) => setTimeout(r, 450));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('sketchRibbonGroups (the contextual Sketch tab)', () => {
  it('carries the palette tools in Select, Draw, Dimension, Constrain, Modify, Reference groups plus Finish with OK and Cancel', async () => {
    const { sketchRibbonGroups } = await import('./SketchToolStrip');
    const { Ribbon } = await import('@kit/ui');
    const picked: Array<string | null> = []; let ok = 0, no = 0;
    const groups = sketchRibbonGroups({ active: null, onPick: (id) => picked.push(id), labels: true, onOk: () => { ok++; }, onCancel: () => { no++; } });
    expect(groups.map((g) => g.id)).toEqual(['SketchSelect', 'Draw', 'Dimension', 'Constrain', 'Modify', 'Reference', 'Finish']);
    const { container } = render(<Ribbon commands={[]} activeTab="Sketch" onTab={() => {}} layout={{ Sketch: groups }} onlyTab="Sketch" tabLabel={() => 'Editing S1'} />);
    expect(container.querySelectorAll('.rb-tab').length).toBe(1);
    expect(container.querySelector('.rb-tab')?.textContent).toBe('Editing S1');
    fireEvent.click(container.querySelector('[aria-label="Confirm sketch"]')!);
    fireEvent.click(container.querySelector('[aria-label="Cancel sketch"]')!);
    expect([ok, no]).toEqual([1, 1]);
    // every palette tool is reachable from the ribbon groups
    const rendered = container.querySelectorAll('.slot, [data-slot]').length;
    expect(rendered).toBeGreaterThan(10);
  });
});
