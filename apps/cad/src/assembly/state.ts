// Viewer state of the assembly panel that lives outside the document: which components are hidden. (The exploded view is saved in the
// document, see Controller.setDocExtra.) A signal each, so the panel and the viewer follow without prop plumbing.
import { signal } from '@preact/signals-core';
import { NO_EXPLODE, readExplode, type ExplodeState } from './model';

export function createAssemblyState() {
  const hidden = signal<string[]>([]);
  const explode = signal<ExplodeState>(NO_EXPLODE);
  return {
    hidden, explode,
    toggleHidden(id: string) { hidden.value = hidden.value.includes(id) ? hidden.value.filter((x) => x !== id) : [...hidden.value, id]; },
    setExplode(patch: Partial<ExplodeState>) { explode.value = { ...explode.value, ...patch }; },
    /** A document was opened: nothing hidden, the exploded view it was saved with. */
    reset(doc: unknown) { hidden.value = []; explode.value = readExplode((doc as { explode?: unknown } | null)?.explode); },
  };
}
export type AssemblyState = ReturnType<typeof createAssemblyState>;
