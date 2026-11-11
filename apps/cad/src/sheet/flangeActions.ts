// What the edge flange and hem editors need from the app beyond the draft: picking two points in the view, making or converting the outline sketch
// and opening it in the sketcher. main.tsx fills `flangeActions.current` (the viewport and the sketcher live there); the forms call it.
import { useEffect, useState } from 'preact/hooks';

type Wire = Record<string, unknown>;

export interface FlangeActions {
  /** Start (or stop) picking the two span points: each click in the view gives a point; the second one sets the span. */
  pickSpan(): void;
  /** A new sketch for the leg outline on the flange's plane, drawn in its (v, h) frame, opened in the sketcher; the flange then follows it. */
  newSketch(): void;
  /** An imported outline as an editable sketch (null when it cannot be carried over exactly: the reason comes back for the note). */
  convert(): void;
  /** Open an existing sketch in the sketcher. */
  editSketch(id: string): void;
  /** The length of the picked edge, to start a length from (null when the edge is not known). */
  edgeLength(eff: Wire): number | null;
}
export const flangeActions: { current: FlangeActions | null } = { current: null };

// how many of the two span points the current pick has (0: none yet, 1: the first is in)
let picked = 0;
const subs = new Set<(n: number) => void>();
export function setSpanPicked(n: number): void { if (n === picked) return; picked = n; for (const f of subs) f(n); }
export function useSpanPicked(): number {
  const [n, set] = useState(picked);
  useEffect(() => { subs.add(set); set(picked); return () => { subs.delete(set); }; }, []);
  return n;
}
