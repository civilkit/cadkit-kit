import type { ComponentChildren } from 'preact';
import { Icon } from './icons';

/** One item of a chip list. `key` identifies it to the callbacks; `kind` styles it (an `edge` has a dashed outline); `count` is how many
 *  things it stands for when that is more than one (a run of edges), shown as "(n)" after the label by the caller's label text. */
export interface ChipItem { key: string; label: string; kind?: string; title?: string; count?: number }

/** The one chip list of the app: the Selection tray and the editors' list fields (edges, corners) both draw it. It scrolls inside its own
 *  max-height (the page around it stays in view), each chip has an x to take it out (a fingertip-sized target on a touch screen), a hover
 *  fill, and `onHover` reports the chip under the pointer (null when it leaves) so the host can light the item in the view. */
export function ChipList(p: {
  items: ChipItem[];
  /** The accessible name and tooltip of a chip's x. */
  removeLabel(item: ChipItem): string;
  onRemove(item: ChipItem, index: number): void;
  onHover?(item: ChipItem | null): void;
  /** Click on a chip's name (the tray shows the feature that owns it); `canReveal` says which chips have one. */
  onReveal?(item: ChipItem): void;
  canReveal?(item: ChipItem): boolean;
  revealLabel?: string;
  class?: string;
  children?: ComponentChildren;
}) {
  return (
    <ul class={'chips' + (p.class ? ' ' + p.class : '')} onMouseLeave={() => p.onHover?.(null)}>
      {p.items.map((c, i) => (
        <li key={c.key} class={'chip' + (c.kind ? ' ' + c.kind : '')} title={c.title ?? c.key} data-run={c.count && c.count > 1 ? String(c.count) : undefined} onMouseEnter={() => p.onHover?.(c)}>
          {p.onReveal && (p.canReveal?.(c) ?? true) ? (
            <button type="button" class="chip-name" title={p.revealLabel} aria-label={`${p.revealLabel}: ${c.label}`} onClick={() => p.onReveal!(c)}>{c.label}</button>
          ) : <span class="chip-text">{c.label}</span>}
          <button type="button" class="chip-x" aria-label={p.removeLabel(c)} title={p.removeLabel(c)} onClick={() => { p.onHover?.(null); p.onRemove(c, i); }}>
            <Icon name="close" size={12} />
          </button>
        </li>
      ))}
      {p.children}
    </ul>
  );
}
