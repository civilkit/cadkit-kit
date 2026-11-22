// The Washer wizard's side of the app: what App used to hold for it. It owns the picked-hole state, reads a face or edge picked while it is open as a hole,
// previews every change, and commits on Add washer. App keeps only the open flag (many panels exclude each other on it) and passes in what it shares.
// This is the pattern for the other wizards: one host component per wizard, props for what App owns, the wizard form unchanged.
import { useEffect, useRef, useState } from 'preact/hooks';
import { BODY, type createStore } from '@kit/store';
import type { Viewport } from '@kit/viewport';
import type { Controller } from '../controller';
import { t } from '../i18n';
import { useSignals } from '../useSignals';
import { washerIssue, washerOps, type WasherParams } from '../washer';
import { holeFromPick, type HoleResult } from '../washerHole';
import { WasherWizard } from '../WasherWizard';

export interface WasherWizardHostProps {
  params: WasherParams;
  doc: unknown;
  controller: Controller;
  store: ReturnType<typeof createStore>;
  viewport: () => Viewport | null;
  /** Runs a commit and records how long the rebuild took. */
  timed: <T>(f: () => Promise<T>) => Promise<T>;
  hint: string | null;
  setHint: (h: string | null) => void;
  /** Hands a preview result to App (hint and breakage diagnosis). */
  onPreviewResult: (r: { ok: boolean; hint?: string; diagnosis?: never | null }) => void;
  /** The wizard is finished (applied or cancelled): App closes it and returns to the feature list. */
  onClose: () => void;
}

export function WasherWizardHost(p: WasherWizardHostProps) {
  const { controller, store } = p;
  useSignals(() => { store.selection.value; });
  const sel = store.selection.value;
  const [picked, setPicked] = useState<{ id: number; result: HoleResult } | null>(null);
  const pick = useRef({ n: 0, openSel: store.selection.peek().join('|') });
  /** Washer on a hole: a face or an edge picked while the wizard is open is read as a hole. What was already selected when it opened only counts when it is a hole. */
  useEffect(() => {
    if (sel.length !== 1 || sel[0] === BODY) return;
    const result = holeFromPick(sel[0], controller.bodyEdges() as never, controller.bodyFaces());
    if (!result.ok && sel.join('|') === pick.current.openSel) return;
    setPicked({ id: ++pick.current.n, result });
  }, [sel]);
  // every change previews the washer (the same features the Script tab's washer() makes); Add washer commits them as one folder, one undo step
  const onDraft = (next: WasherParams) => {
    if (!p.doc || washerIssue(next)) return;
    void controller.preview(washerOps(p.doc as never, next), 400).then(p.onPreviewResult as never);
  };
  const onCancel = async () => { await controller.cancelPreview(); p.onClose(); };
  const onApply = async (next: WasherParams) => {
    if (!p.doc) return;
    let ops;
    try { ops = washerOps(p.doc as never, next); } catch (e) { p.setHint((e as Error).message); return; }
    await controller.cancelPreview();
    const r = await p.timed(() => controller.commit(ops, 'washer'));
    if (!r.ok) { p.setHint(t('washer.failed', { reason: r.hints?.map((h) => h.hint).join('; ') || (r as { schemaError?: string }).schemaError || 'edit failed' })); return; }
    store.notify(t('washer.created'), 'success');
    p.onClose();
  };
  return <WasherWizard params={p.params} picked={picked} onPickHole={() => { store.mode.value = 'face'; p.viewport()?.setPickMode('face'); }} onDraft={onDraft} onApply={onApply} onCancel={onCancel} hint={p.hint} />;
}

