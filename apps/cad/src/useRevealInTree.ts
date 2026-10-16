// "Show in tree": the feature row that owns the face / edge picked in the view. A new pick asks the tree to reveal the row (it scrolls
// only when the row is out of view and the pointer is away from the tree); `show()` asks again and forces the scroll (the chip's name,
// the context menu). The marker stays on the row(s) for as long as the pick lasts.
import { useEffect, useState } from 'preact/hooks';
import { revealTargets, viewOwner } from './treeActions';

export interface RevealRequest { id: string; also?: string[]; n: number; force?: boolean }

/** The row(s) for the last picked name; assemblies map a name to the component row that holds it. */
export function revealFor(selection: readonly string[], rowIds: readonly string[], inserts: ReadonlySet<string>): { id: string; also: string[] } | null {
  const last = selection.at(-1);
  if (!last || !rowIds.length) return null;
  if (inserts.size) { const o = viewOwner(last, inserts); return o && rowIds.includes(o) ? { id: o, also: [] } : null; }
  return revealTargets(last, rowIds);
}

export function useRevealInTree(selection: readonly string[], rowIds: readonly string[], inserts: ReadonlySet<string>, enabled = true) {
  const [tick, setTick] = useState<{ n: number; force: boolean; name?: string }>({ n: 0, force: false });
  const key = selection.join('|');
  useEffect(() => { if (selection.length) setTick((t) => ({ n: t.n + 1, force: false })); }, [key]);
  // a forced request names the chip that was clicked; a plain pick reveals the last name picked
  const target = enabled ? revealFor(tick.name && selection.includes(tick.name) ? [tick.name] : selection, rowIds, inserts) : null;
  const reveal: RevealRequest | null = target ? { ...target, n: tick.n, force: tick.force } : null;
  return {
    reveal,
    /** Reveal `name` (a picked name; default the last one) and scroll to it even when it is in view or the pointer is on the tree. */
    show: (name?: string) => setTick((t) => ({ n: t.n + 1, force: true, ...(name ? { name } : {}) })),
    canShow: (name?: string) => !!revealFor(name ? [name] : selection, rowIds, inserts),
  };
}
