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

/** The pen that is touching the canvas, and the touches that land beside it (a resting palm or knuckle). iPadOS usually cancels those itself; when it does not, they arrive as
 *  ordinary touches and would orbit the view, move the sketch preview or add a second finger to a pinch while the pen draws. `drop` says which events to throw away. */
export class PenGuard {
  private penId: number | null = null;
  private palm = new Set<number>();
  /** True while the pen is on the screen. */
  get penDown(): boolean { return this.penId !== null; }
  /** Feed every pointerdown, pointermove, pointerup and pointercancel that reaches the canvas (`onCanvas`: the target is the canvas). Returns true when the event is a palm's and must go no further. */
  drop(e: { type: string; pointerType: string; pointerId: number }, onCanvas: boolean): boolean {
    const ends = e.type === 'pointerup' || e.type === 'pointercancel';
    if (e.pointerType === 'pen') {
      if (e.type === 'pointerdown' && onCanvas) this.penId = e.pointerId;
      else if (ends && this.penId === e.pointerId) this.penId = null;
      return false;
    }
    if (e.pointerType !== 'touch') return false;
    if (e.type === 'pointerdown') { if (this.penId !== null && onCanvas) { this.palm.add(e.pointerId); return true; } return false; }
    if (!this.palm.has(e.pointerId)) return false;
    if (ends) this.palm.delete(e.pointerId);
    return true;
  }
}
