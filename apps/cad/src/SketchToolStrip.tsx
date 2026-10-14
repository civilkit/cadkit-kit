import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { sketchTools, type ToolEntry, type ToolGroup } from '@kit/sketch';
import { Icon, Tip } from '@kit/ui';
import { t } from './i18n';

const GROUPS: ToolGroup[] = ['draw', 'dimension', 'constrain', 'edit'];

/** The palette shows one button per *slot*; a slot with several tools shows the one used last and opens the others in a
 *  flyout (a small corner arrow, a long press or a right click). The first tool of a slot is its default. Tools that are in
 *  no slot still appear, each in a slot of its own, so a new tool is never hidden. */
export const PALETTE_SLOTS: Record<ToolGroup, string[][]> = {
  draw: [
    ['line', 'centerline'], ['arc-three-point', 'arc-centre', 'arc-tangent'], ['circle', 'ellipse'],
    ['rectangle', 'center-rectangle', 'slot', 'polygon'], ['spline', 'cvspline', 'bridge'], ['point'],
  ],
  dimension: [['dimension']],
  constrain: [
    ['horizontal', 'vertical'], ['coincident', 'midpoint', 'fix'], ['equal', 'parallel', 'perpendicular', 'collinear'],
    ['tangent', 'concentric', 'symmetric'],
  ],
  edit: [['trim', 'extend'], ['fillet', 'chamfer'], ['offset', 'mirror', 'pattern-linear', 'pattern-circular'], ['project', 'construction']],
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

const LAST_KEY = 'cad.paletteLast';
const loadLast = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Record<string, string>; } catch { return {}; } };
const saveLast = (m: Record<string, string>) => { try { localStorage.setItem(LAST_KEY, JSON.stringify(m)); } catch { /* private window */ } };

function SlotButton(p: { slot: PaletteSlot; active: string | null; last: string | undefined; onPick(id: string): void; onRemember(slotId: string, toolId: string): void }) {
  const { slot } = p;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ right: number; top: number }>({ right: 0, top: 0 });
  const btn = useRef<HTMLDivElement>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const startX = useRef<number | null>(null);
  // the tool shown: the active one if it belongs to this slot (a shortcut key picked it), else the last used, else the default
  const shown = slot.tools.find((x) => x.id === p.active) ?? slot.tools.find((x) => x.id === p.last) ?? slot.tools[0];
  const multi = slot.tools.length > 1;
  const openFlyout = () => {
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ right: Math.max(8, window.innerWidth - r.left + 6), top: r.top });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!(e.target as Element | null)?.closest?.('.spal-flyout, .spal-slot')) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', key); };
  }, [open]);
  const choose = (x: ToolEntry) => { setOpen(false); p.onRemember(slot.id, x.id); p.onPick(x.id); };
  const name = t('app.sketch.tool.' + shown.id);
  return (
    <div class={'spal-slot' + (multi ? ' multi' : '')} ref={btn}>
      <Tip label={name} keys={shown.key?.toUpperCase()} side="left">
        <button
          class="stool icon-only" aria-pressed={p.active === shown.id} aria-label={name} aria-haspopup={multi ? 'true' : undefined} aria-expanded={multi ? open : undefined}
          onPointerDown={(e) => {
            held.current = false;
            startX.current = (e as PointerEvent).clientX;
            if (multi) hold.current = setTimeout(() => { held.current = true; openFlyout(); }, 380);
          }}
          // a flick towards the flyout opens it at once (the touch way: no waiting for a long press)
          onPointerMove={(e) => {
            if (multi && hold.current && startX.current !== null && startX.current - (e as PointerEvent).clientX > 12) {
              clearTimeout(hold.current); hold.current = null; held.current = true; openFlyout();
            }
          }}
          onPointerUp={() => { if (hold.current) clearTimeout(hold.current); hold.current = null; startX.current = null; }}
          onPointerCancel={() => { if (hold.current) clearTimeout(hold.current); hold.current = null; startX.current = null; }}
          onPointerLeave={() => { if (hold.current) clearTimeout(hold.current); hold.current = null; }}
          onContextMenu={(e) => { if (multi) { e.preventDefault(); openFlyout(); } }}
          onClick={() => { if (held.current) { held.current = false; return; } setOpen(false); p.onRemember(slot.id, shown.id); p.onPick(shown.id); }}
        ><Icon name={shown.id} size={20} /></button>
      </Tip>
      {multi ? (
        <button class="spal-more" tabIndex={-1} aria-label={t('app.sketch.moreTools', { name: t('app.sketch.tool.' + slot.tools[0].id) })} onClick={(e) => { e.stopPropagation(); if (open) setOpen(false); else openFlyout(); }} />
      ) : null}
      {open ? createPortal(
        <div class="spal-flyout" role="menu" style={{ right: pos.right + 'px', top: pos.top + 'px' }}>
          {slot.tools.map((x) => (
            <Tip key={x.id} label={t('app.sketch.tool.' + x.id)} keys={x.key?.toUpperCase()} side="bottom">
              <button class="stool icon-only" role="menuitem" aria-pressed={p.active === x.id} aria-label={t('app.sketch.tool.' + x.id)} onClick={() => choose(x)}><Icon name={x.id} size={20} /></button>
            </Tip>
          ))}
        </div>, document.body) : null}
    </div>
  );
}

/** The sketch tools as a strip under the sketch banner: Select (drag points), then the tools by group. With
 *  `labels="icons"` each tool is a square icon button whose name shows at once on hover or focus, and the group
 *  headings shrink to thin separators; otherwise each button shows its icon and its name. */
function Palette(p: { tools: ToolEntry[]; active: string | null; onPick(id: string | null): void }) {
  const [last, setLast] = useState<Record<string, string>>(loadLast);
  const remember = (slotId: string, toolId: string) => setLast((m) => { const n = { ...m, [slotId]: toolId }; saveLast(n); return n; });
  return (
    <div class="sketch-palette" role="toolbar" aria-label={t('app.sketch.tools')}>
      <div class="spal-group">
        <Tip label={t('app.sketch.select')} side="left">
          <button class="stool icon-only" aria-pressed={p.active === null} aria-label={t('app.sketch.select')} onClick={() => p.onPick(null)}><Icon name="select" size={20} /></button>
        </Tip>
      </div>
      {GROUPS.map((g) => {
        const slots = slotsFor(g, p.tools);
        if (!slots.length) return null;
        return (
          <div class="spal-group" key={g} role="group" aria-label={t('app.sketch.group.' + g)}>
            <span class="spal-name">{t('app.sketch.group.' + g)}</span>
            <div class="spal-grid">
              {slots.map((sl) => <SlotButton key={sl.id} slot={sl} active={p.active} last={last[sl.id]} onPick={p.onPick} onRemember={remember} />)}
            </div>
          </div>
        );
      })}
    </div>
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
    return <Palette tools={tools} active={p.active} onPick={p.onPick} />;
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
