// What "saved" means once a write finishes. The write takes time (a picker, a thumbnail, the disk), and the part can
// change meanwhile: the file holds the document as it was when the write began, so only that document is clean.

/** The signature to remember as clean after a successful write of `saved`. A part edited during the write has a
 *  different signature from it, so it stays marked unsaved; without `saved` the current part is taken as written. */
export function cleanSigAfterSave<D>(saved: D | null, current: D | null, sigOf: (d: D | null) => string | null): string | null {
  return sigOf(saved ?? current);
}

/** Whether the autosave copy may be dropped after a write of `saved`: only when nothing changed since, or the copy would lose the later edits. */
export function mayClearAutosave<D>(saved: D | null, current: D | null): boolean {
  return saved === null || saved === current;
}
