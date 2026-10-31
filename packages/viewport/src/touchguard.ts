/** The touch pointers that are down on the canvas. Two or more is a pinch or a two-finger pan, which the orbit controls handle on their own:
 *  while it lasts, the canvas's own click, drag and rubber-band handling must stand aside, so a pinch never selects or moves anything. */
export class TouchGuard {
  private ids = new Set<number>();
  /** True from the second finger down until the last finger is up. */
  multi = false;

  /** A pointer went down. Returns true when this press turned the gesture into a multi-touch one (cancel whatever the first finger began). */
  down(e: { pointerType: string; pointerId: number; isPrimary: boolean }): boolean {
    if (e.pointerType !== 'touch') return false;
    // The primary touch is by definition the first finger: a pointerup that never reached us (lost outside the window) cannot leave the guard stuck.
    if (e.isPrimary) { this.ids.clear(); this.multi = false; }
    this.ids.add(e.pointerId);
    if (this.ids.size > 1 && !this.multi) { this.multi = true; return true; }
    return false;
  }

  /** A pointer went up or was cancelled. */
  end(e: { pointerType: string; pointerId: number }): void {
    if (e.pointerType !== 'touch') return;
    this.ids.delete(e.pointerId);
    if (!this.ids.size) this.multi = false;
  }
}
