import { useEffect, useRef } from 'preact/hooks';

/** The sketch session the app shows (`active`) lost its controller session: the feature was deleted or undone away, or another part
 *  was loaded. The shell must then drop its own sketch state too (tool, entity selection, dimension chips, readout), or the overlay
 *  stays up with nothing behind it. `hasSession` reads the controller each render; `onGone` runs once per loss. */
export function useSketchSessionGone(active: boolean, hasSession: () => boolean, onGone: () => void): boolean {
  const gone = active && !hasSession();
  const cb = useRef(onGone); cb.current = onGone;
  useEffect(() => { if (gone) cb.current(); }, [gone]);
  return gone;
}

/** An open feature editor whose feature disappeared from the document (delete or undo) closes: it has nothing to show and must not
 *  stand in for the feature tree. Only a feature that was seen first counts as gone (an editor opened ahead of its feature does not). */
export function useEditorGone(editingId: string | null, exists: boolean, hasDoc: boolean, onGone: () => void): boolean {
  const seen = useRef<string | null>(null);
  if (exists) seen.current = editingId; else if (!editingId) seen.current = null;
  const gone = !!editingId && hasDoc && !exists && seen.current === editingId;
  const cb = useRef(onGone); cb.current = onGone;
  useEffect(() => {
    if (!gone) return;
    seen.current = null;
    cb.current();
  }, [gone]);
  return gone;
}
