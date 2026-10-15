import { Slot, commandToItem, type Command, type RibbonEntry, type SlotItem } from '@kit/ui';
import { t } from './i18n';
import { RAIL_SECTIONS } from './toolbarModel';
import { MENU_COMMANDS, type SelectionKind } from './menuModel';

/** The commands that apply to the current selection, most relevant first (the right-click menu's list without the
 *  selection helpers). Empty when nothing is selected. */
export function contextIds(kind: SelectionKind): string[] {
  return (MENU_COMMANDS[kind] ?? []).filter((id) => id !== '-' && !id.startsWith('select-') && id !== 'move-body' && id !== 'fit');
}

/** The tool palette: the main way to reach every modelling command. Sections of slots; a slot shows the tool used last
 *  and opens the rest of its family on a long press, a flick to the right, a right click or the corner triangle. */
export function ToolRail(p: { commands: Command[]; kind: SelectionKind; labels?: boolean; caption?(c: SlotItem): string }) {
  const byId = new Map(p.commands.map((c) => [c.id, c]));
  const cell = (e: RibbonEntry, key: string) => {
    if (typeof e === 'string') {
      const c = byId.get(e);
      return c ? <Slot key={key} id={c.id} items={[commandToItem(c)]} variant="rail" side="right" /> : null;
    }
    const items = e.ids.map((id) => byId.get(id)).filter((c): c is Command => !!c).map(commandToItem);
    return items.length ? <Slot key={key} id={e.slot} items={items} variant="rail" side="right" radio={e.radio} labels={p.labels} caption={p.caption} /> : null;
  };
  const ctx: SlotItem[] = contextIds(p.kind).map((id) => byId.get(id)).filter((c): c is Command => !!c).map(commandToItem);
  return (
    <div class={'tool-rail' + (p.labels ? ' labels' : '')} role="toolbar" aria-label={t('rail.label')} aria-orientation="vertical">
      {ctx.length && p.kind !== 'none' ? (
        <div class="rail-sec rail-context" role="group" aria-label={t('rail.context')}>
          <span class="rail-title rail-sel-title">{t('rail.context')}</span>
          <div class="rail-grid">
            {/* the memory key includes the kind so "last used" for a face never decides what a body shows */}
            <Slot key={'ctx' + p.kind} id={'rail-for-' + p.kind} items={orderFirstEnabled(ctx)} variant="rail" side="right" class="sel" labels={p.labels} caption={p.caption} />
          </div>
        </div>
      ) : null}
      {RAIL_SECTIONS.map((s) => {
        const cells = s.entries.map((e, i) => cell(e, s.id + i)).filter(Boolean);
        if (!cells.length) return null;
        return (
          <div class="rail-sec" key={s.id} role="group" aria-label={t('rail.' + s.id)}>
            <span class="rail-title">{t('rail.' + s.id)}</span>
            <div class="rail-grid">{cells}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Enabled commands first, so the cell opens on one that can run. */
const orderFirstEnabled = (items: SlotItem[]): SlotItem[] => [...items.filter((x) => x.enabled?.() ?? true), ...items.filter((x) => !(x.enabled?.() ?? true))];
