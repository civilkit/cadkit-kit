// The open documents of the app as tabs: which exist, which is active, and what happens when one is added or closed.
// Pure list logic; what a tab holds (a controller, its file, its camera) is the app's business (`T` only needs an `id`).

/** Most documents open at once (each holds a kernel state and its own undo history). */
export const MAX_TABS = 32;

export class TabSet<T extends { id: number }> {
  tabs: T[] = [];
  activeId = -1;
  private seq = 0;

  /** A fresh id, never reused during a run. */
  nextId(): number { return ++this.seq; }
  get count(): number { return this.tabs.length; }
  get active(): T | null { return this.tabs.find((t) => t.id === this.activeId) ?? null; }
  index(id: number): number { return this.tabs.findIndex((t) => t.id === id); }
  get(id: number): T | null { return this.tabs.find((t) => t.id === id) ?? null; }
  full(): boolean { return this.tabs.length >= MAX_TABS; }

  /** Insert `t` right after the active tab (at the end when there is none) and make it active. False when the limit is reached. */
  add(t: T): boolean {
    if (this.full()) return false;
    const at = this.index(this.activeId);
    this.tabs.splice(at < 0 ? this.tabs.length : at + 1, 0, t);
    this.activeId = t.id;
    return true;
  }

  activate(id: number): boolean {
    if (this.index(id) < 0) return false;
    this.activeId = id;
    return true;
  }

  /** Take tab `id` out. When it was the active one the next tab on its right becomes active (else the one on its left). Returns the tab now active, or null when none is left. */
  remove(id: number): T | null {
    const i = this.index(id);
    if (i < 0) return this.active;
    const wasActive = this.activeId === id;
    this.tabs.splice(i, 1);
    if (this.tabs.length === 0) { this.activeId = -1; return null; }
    if (wasActive) this.activeId = this.tabs[Math.min(i, this.tabs.length - 1)].id;
    return this.active;
  }

  /** Move tab `id` to position `to` (a drag in the strip). */
  move(id: number, to: number): void {
    const i = this.index(id);
    if (i < 0) return;
    const [t] = this.tabs.splice(i, 1);
    this.tabs.splice(Math.max(0, Math.min(to, this.tabs.length)), 0, t);
  }
}
