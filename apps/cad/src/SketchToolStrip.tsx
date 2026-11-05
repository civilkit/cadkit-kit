import { sketchTools, type ToolEntry, type ToolGroup } from '@kit/sketch';
import { Icon, Slot, Tip, type SlotItem, type RibbonGroup } from '@kit/ui';
import { t } from './i18n';
import { SketchConstruction, SketchFinish, SketchStatus, type SketchControls } from './SketchBar';

const GROUPS: ToolGroup[] = ['draw', 'dimension', 'constrain', 'edit'];

/** The palette shows one button per *slot*; a slot with several tools shows the one used last and opens the others in a
 *  flyout (a small corner arrow, a long press or a right click). The first tool of a slot is its default. Tools that are in
 *  no slot still appear, each in a slot of its own, so a new tool is never hidden. */
export const PALETTE_SLOTS: Record<ToolGroup, string[][]> = {
  draw: [
    ['line', 'centerline'], ['arc-three-point', 'arc-centre', 'arc-tangent'], ['circle', 'ellipse'],
    ['rectangle', 'center-rectangle', 'slot', 'polygon'], ['spline', 'cvspline', 'bridge', 'equation'], ['point'], ['text'],
  ],
  dimension: [['dimension']],
  constrain: [
    ['horizontal', 'vertical'], ['coincident', 'midpoint', 'fix'], ['equal', 'parallel', 'perpendicular', 'collinear'],
    ['tangent', 'concentric', 'symmetric'],
  ],
  edit: [['trim', 'extend', 'split'], ['fillet', 'chamfer'], ['offset', 'mirror', 'pattern-linear', 'pattern-circular'], ['project', 'construction'], ['move', 'copy', 'rotate', 'scale']],
};

export interface PaletteSlot { id: string; tools: ToolEntry[] }

/** The slots of one group for the tools that exist: configured slots first (only the tools present), then every other tool alone. */
export function slotsFor(group: ToolGroup, tools: ToolEntry[]): PaletteSlot[] {
  const inGroup = tools.filter((x) => x.group === group);
  const byId = new Map(inGroup.map((x) => [x.id, x]));
  const used = new Set<string>();
  const out: PaletteSlot[] = [];
  for (const ids of PALETTE_SLOTS[group]) {
    const list = ids.map((id) => byId.get(id)).filter((x): x is ToolEntry => !!x);
    if (!list.length) continue;
    list.forEach((x) => used.add(x.id));
    out.push({ id: list[0].id, tools: list });
  }
  for (const x of inGroup) if (!used.has(x.id)) out.push({ id: x.id, tools: [x] });
  return out;
}

const toItem = (x: ToolEntry, active: string | null, onPick: (id: string | null) => void): SlotItem => ({
  id: x.id, label: t('app.sketch.tool.' + x.id), keys: x.key?.toUpperCase(), pressed: () => active === x.id, run: () => onPick(x.id),
});

/** The sketch tools as a palette on the right edge: sections (Draw, Dimension, Constrain, Edit) of slots. A slot shows the tool
 *  used last and opens its family in a list with names and keys; the active tool is drawn pressed. In the text mode each cell
 *  carries a short name, in the icons-only mode it is the icon alone. */
function Palette(p: { tools: ToolEntry[]; active: string | null; onPick(id: string | null): void; labels: boolean }) {
  return (
    <div class={'sketch-palette' + (p.labels ? ' labels' : '')} role="toolbar" aria-label={t('app.sketch.tools')}>
      <div class="spal-group" role="group" aria-label={t('app.sketch.select')}>
        <span class="spal-name">{t('app.sketch.select')}</span>
        <div class="spal-grid">
          <Slot id="sketch-select" variant="icon" side="left" labels={p.labels}
            items={[{ id: 'select', label: t('app.sketch.select'), pressed: () => p.active === null, run: () => p.onPick(null) }]} />
        </div>
      </div>
      {GROUPS.map((g) => {
        const slots = slotsFor(g, p.tools);
        if (!slots.length) return null;
        return (
          <div class="spal-group" key={g} role="group" aria-label={t('app.sketch.group.' + g)}>
            <span class="spal-name">{t('app.sketch.group.' + g)}</span>
            <div class="spal-grid">
              {slots.map((sl) => <Slot key={sl.id} id={sl.id} variant="icon" side="left" labels={p.labels} items={sl.tools.map((x) => toItem(x, p.active, p.onPick))} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The sketch tools as sections of the left tool column (Plasticity preset): the same groups, slots and last-used memory as the Sketch tab. */
export function SketchRailSections(p: { active: string | null; onPick(id: string | null): void; tools?: ToolEntry[]; labels: boolean }) {
  const tools = p.tools ?? sketchTools();
  const sec = (id: string, title: string, cells: preact.ComponentChildren) => (
    <div class="rail-sec" key={id} role="group" aria-label={title}><span class="rail-title">{title}</span><div class="rail-grid">{cells}</div></div>
  );
  const slotCell = (sl: PaletteSlot) => <Slot key={sl.id} id={sl.id} variant="rail" side="right" labels={p.labels} items={sl.tools.map((x) => toItem(x, p.active, p.onPick))} />;
  const edit = slotsFor('edit', tools);
  const isRef = (sl: PaletteSlot) => sl.tools.some((x) => x.id === 'project' || x.id === 'construction');
  const parts: Array<[string, string, PaletteSlot[]]> = [
    ['draw', t('app.sketch.group.draw'), slotsFor('draw', tools)],
    ['dimension', t('app.sketch.group.dimension'), slotsFor('dimension', tools)],
    ['constrain', t('app.sketch.group.constrain'), slotsFor('constrain', tools)],
    ['modify', t('group.Modify'), edit.filter((sl) => !isRef(sl))],
    ['reference', t('group.Reference'), edit.filter(isRef)],
  ];
  return (
    <>
      {sec('select', t('app.sketch.select'), <Slot id="sketch-select" variant="rail" side="right" labels={p.labels}
        items={[{ id: 'select', label: t('app.sketch.select'), pressed: () => p.active === null, run: () => p.onPick(null) }]} />)}
      {parts.filter(([, , sls]) => sls.length).map(([id, title, sls]) => sec(id, title, sls.map(slotCell)))}
    </>
  );
}

export function SketchToolStrip(p: { active: string | null; onPick(id: string | null): void; tools?: ToolEntry[]; labels?: 'icons' | 'icons-and-text'; layout?: 'strip' | 'palette' }) {
  const tools = p.tools ?? sketchTools();
  const iconsOnly = p.labels === 'icons';
  const button = (id: string, name: string, pressed: boolean, onClick: () => void, keys?: string) => (
    <Tip label={name} keys={keys}>
      <button class={'stool' + (iconsOnly ? ' icon-only' : '')} aria-pressed={pressed} aria-label={iconsOnly ? name : undefined} onClick={onClick}>
        <Icon name={id} size={iconsOnly ? 20 : 16} />
        {iconsOnly ? null : <span>{name}</span>}
      </button>
    </Tip>
  );
  if (p.layout === 'palette') {
    // a vertical palette at the screen edge: groups of icons in two columns, names on hover
    return <Palette tools={tools} active={p.active} onPick={p.onPick} labels={!iconsOnly} />;
  }
  return (
    <div class={'sketch-tools' + (iconsOnly ? ' icons-only' : '')} role="toolbar" aria-label={t('app.sketch.tools')}>
      {button('select', t('app.sketch.select'), p.active === null, () => p.onPick(null))}
      {GROUPS.map((g) => {
        const inGroup = tools.filter((x) => x.group === g);
        if (!inGroup.length) return null;
        return (
          <div class="sgroup" key={g} role="group" aria-label={t('app.sketch.group.' + g)}>
            {iconsOnly ? null : <span class="sgroup-name">{t('app.sketch.group.' + g)}</span>}
            {inGroup.map((x) => button(x.id, t('app.sketch.tool.' + x.id), p.active === x.id, () => p.onPick(x.id), x.key?.toUpperCase()))}
          </div>
        );
      })}
    </div>
  );
}

/** The groups of the ribbon's contextual Sketch tab: the same slots, tools and memory as the palette, drawn as ribbon buttons.
 *  Left to right: Select, Finish (OK / Cancel), Make (Extrude, Revolve), Draw, Dimension, Constrain, Modify, Reference (project, construction
 *  tools plus the Construction toggle), Status (definition badge, Fully define, Snaps, Look normal). The last four need `controls`; without it
 *  only the tool groups are drawn (the floating bar carries the rest). */
export function sketchRibbonGroups(p: {
  tools?: ToolEntry[]; active: string | null; onPick(id: string | null): void; labels: boolean; controls?: SketchControls;
}): RibbonGroup[] {
  const tools = p.tools ?? sketchTools();
  const c = p.controls;
  const cell = (sl: PaletteSlot) => ({ key: 'sk-' + sl.id, node: <Slot id={sl.id} variant="ribbon" side="bottom" labels={p.labels} items={sl.tools.map((x) => toItem(x, p.active, p.onPick))} /> });
  const edit = slotsFor('edit', tools);
  const isRef = (sl: PaletteSlot) => sl.tools.some((x) => x.id === 'project' || x.id === 'construction');
  const node = (key: string, el: preact.JSX.Element) => ({ key, node: el });
  /** A big ribbon tile (icon over label), the same shape as Select and the drawing tools. */
  const tile = (id: string, icon: string, label: string, tip: string, run: () => void, pressed?: () => boolean) =>
    ({ key: id, node: <Slot id={id} variant="ribbon" side="bottom" labels={p.labels} items={[{ id, label, icon, tip, pressed, run }]} /> });
  const groups: RibbonGroup[] = [
    { id: 'SketchSelect', entries: [{ key: 'sk-select', node: <Slot id="sketch-select" variant="ribbon" side="bottom" labels={p.labels} items={[{ id: 'select', label: t('app.sketch.select'), pressed: () => p.active === null, run: () => p.onPick(null) }]} /> }] },
    { id: 'Finish', entries: c ? [node('sk-finish', <SketchFinish onOk={c.onOk} onCancel={c.onCancel} />)] : [] },
    { id: 'Make', entries: c ? [
      c.onExtrude ? tile('sketch-extrude', 'add-extrude', t('cmd.add-extrude'), t('app.sketch.extrude.tip'), c.onExtrude) : null,
      c.onRevolve ? tile('sketch-revolve', 'add-revolve', t('cmd.add-revolve'), t('app.sketch.revolve.tip'), c.onRevolve) : null,
    ].filter((e): e is { key: string; node: preact.JSX.Element } => e !== null) : [] },
    { id: 'Draw', entries: slotsFor('draw', tools).map(cell) },
    { id: 'Dimension', entries: slotsFor('dimension', tools).map(cell) },
    { id: 'Constrain', entries: slotsFor('constrain', tools).map(cell) },
    { id: 'Modify', entries: edit.filter((sl) => !isRef(sl)).map(cell) },
    { id: 'Reference', entries: [...edit.filter(isRef).map(cell), ...(c ? [node('sk-construction', <SketchConstruction construction={c.construction} onConstruction={c.onConstruction} onToggleSelected={c.onToggleSelected} />)] : [])] },
    { id: 'Status', entries: c ? [node('sk-status', <SketchStatus status={c.status} busy={c.busy} prefs={c.prefs} onPrefs={c.onPrefs} onFullyDefine={c.onFullyDefine} list={c.list} onLookNormal={c.onLookNormal} lookChip={c.lookChip} onReport={c.onReport} reportOpen={c.reportOpen} />)] : [] },
  ];
  return groups.filter((g) => g.entries.length);
}
