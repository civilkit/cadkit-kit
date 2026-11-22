// Rename by a slow second click: clicking a row that is already the only selection, a little after the first click (not a double
// click), starts renaming it in place, as a file manager does. A double click still edits; any other click cancels the pending rename.
export const SLOW_MIN_MS = 450;   // closer than this is a double click, which already does something else
export const SLOW_MAX_MS = 2500;  // further apart than this is just another click
const SETTLE_MS = 350;            // wait out a double click that could still follow

export function createSlowClick(fire: (id: string) => void, now: () => number = () => Date.now()) {
  let last: { id: string; at: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  return {
    /** A click on row `id`. `soleSelected`: it was the only selected row before this click; `plain`: no Ctrl / Shift / Cmd held. */
    click(id: string, soleSelected: boolean, plain: boolean): void {
      cancel();
      const at = now();
      const prev = last;
      last = { id, at };
      if (plain && soleSelected && prev && prev.id === id && at - prev.at >= SLOW_MIN_MS && at - prev.at <= SLOW_MAX_MS) timer = setTimeout(() => { timer = undefined; fire(id); }, SETTLE_MS);
    },
    /** A double click, a drag, a key: no rename follows. */
    cancel(): void { cancel(); last = null; },
  };
}
