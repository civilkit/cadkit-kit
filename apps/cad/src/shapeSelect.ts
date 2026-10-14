// The one entry point other parts of the app (the catalog drop, a command) use to select a shape feature: it shows the
// shape's size box at once (see handles/sizeBox.ts and docs/size-box.md). The app registers the handler on start; before
// that, or with no app mounted, selectShapeFeature does nothing and says so.
let handler: ((id: string) => void) | null = null;

/** The app's handler: closes any open editor, selects the feature row and clears the picks. Returns an unregister function. */
export function registerShapeSelect(fn: (id: string) => void): () => void {
  handler = fn;
  return () => { if (handler === fn) handler = null; };
}

/** Select a shape feature (an extrude / cut / revolve / hole) by id so its size box appears. False when no app is mounted. */
export function selectShapeFeature(id: string): boolean {
  if (!handler) return false;
  handler(id);
  return true;
}
