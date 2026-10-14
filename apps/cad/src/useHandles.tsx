// Wires the contextual handles and the canvas context menu into the app: builds the handle session for the current
// selection, hands its handles to the viewport, and runs drags through the controller's preview. main.tsx only calls this.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Command } from '@kit/ui';
import type { EditOp } from '@ck/session';
import type { Store, SelectionMode } from '@kit/store';
import type { PickMode, Viewport } from '@kit/viewport';
import type { Controller } from './controller';
import { planHandles, type PlanCtx } from './handles/plan';
import { HandleRunner } from './handles/runner';
import { ABOUT_MODES, DEFAULT_ABOUT, planSizeBox, shapeSelection, type AboutMode } from './handles/sizeBox';
import type { ThreadHandleCtx } from './handles/threadHandle';
import type { HandleSession } from './handles/session';
import { ContextMenu } from './ContextMenu';
import { t } from './i18n';
import { whyNot } from './select/selectCommands';
import { gestureHint, menuItems, selectionKind, type MenuItem } from './menuModel';

export interface HandlesDeps {
  controller: Controller;
  store: Store;
  viewport(): Viewport | null;
  commands: Command[];
  /** Add a feature from ops and open the Editor on it (main's createFeature). */
  create(ops: EditOp[]): Promise<void>;
  /** Commit ops that edit an existing feature in place. */
  commitInPlace(ops: EditOp[]): Promise<void>;
  editingId: string | null;
  /** The row selected in the history tree: a shape feature there shows its size box. */
  selectedId?: string | null;
  sketching: boolean;
  enabled: boolean;
  /** The Thread editor is open on this thread: the length handle at its far end (see handles/threadHandle.ts). */
  thread?: ThreadHandleCtx | null;
  /** A handle gesture that edits the open editor's draft (the thread length) hands its patch here instead of committing. */
  onDraftPatch?(patch: Record<string, unknown>): void;
  /** After a handle drag was cancelled: show the editor's own draft again (cancelPreview dropped it). */
  restorePreview?(): void;
}

export function useHandles(p: HandlesDeps) {
  const ref = useRef(p);
  ref.current = p;
  const [hint, setHint] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; hint: string | null } | null>(null);
  const runner = useRef<HandleRunner | null>(null);
  // a drag in progress keeps its handle: the preview it causes changes the thread entry and must not rebuild the handle under the pointer
  const dragging = useRef(false);
  const [tick, setTick] = useState(0);
  const [about, setAboutState] = useState<AboutMode>(() => { try { const v = localStorage.getItem('cad.sizeBoxAbout'); return (ABOUT_MODES as string[]).includes(v ?? '') ? (v as AboutMode) : DEFAULT_ABOUT; } catch { return DEFAULT_ABOUT; } });
  const aboutRef = useRef(about);
  aboutRef.current = about;
  const setAbout = (m: AboutMode) => { setAboutState(m); try { localStorage.setItem('cad.sizeBoxAbout', m); } catch { /* private window */ } };
  const [boxOn, setBoxOn] = useState(false);
  if (!runner.current) {
    runner.current = new HandleRunner({
      preview: async (ops) => { const r = await ref.current.controller.preview(ops, 0); return { ok: r.ok, stale: r.stale, hint: r.hint }; },
      cancelPreview: async () => { await ref.current.controller.cancelPreview(); ref.current.restorePreview?.(); },
      busy: (on) => { dragging.current = on; if (!on) setTick((n) => n + 1); },
      commit: async (c) => { if (c.notice) ref.current.store.notify(c.notice, 'warn'); if (c.draft) { ref.current.onDraftPatch?.(c.draft); return; } if (c.create) await ref.current.create(c.ops); else await ref.current.commitInPlace(c.ops); },
      hint: setHint,
    });
  }

  const plan = (): HandleSession | null => {
    const { controller, store } = ref.current;
    const c: PlanCtx = {
      doc: controller.document(), selection: store.selection.value, mode: store.mode.value,
      edges: controller.bodyEdges(), mesh: controller.bodyFaces(), box: controller.bodyBox(),
      editingId: ref.current.editingId, sketching: ref.current.sketching, enabled: ref.current.enabled,
      placement: null,   // the kernel has no moveBody yet: the placement gizmo stays off
      thread: ref.current.thread ?? null,
    };
    // a shape (extrude / cut / revolve / hole, picked in the tree or by its faces) shows its size box; edges keep the fillet dot
    if (c.enabled && !c.sketching && !c.editingId) {
      const shapeId = shapeSelection(c.doc, c.selection, c.mode, ref.current.selectedId ?? null);
      if (shapeId) {
        const s = planSizeBox({ doc: c.doc, shapeId, frameOf: (id) => controller.sketchFrameOf(id), bodyBox: c.box, mode: aboutRef.current });
        if (s) return s;
      }
    }
    return planHandles(c);
  };

  // Re-plan whenever the selection, the pick mode, the document (revision) or the reasons to hide change.
  const sel = p.store.selection.value;
  const th = p.thread;
  const threadKey = th ? [th.id, th.entry.start, th.entry.dir, th.entry.length, th.maxLength].join('|') : '';
  useEffect(() => {
    const vp = p.viewport();
    if (!vp || dragging.current) return;
    const s = plan();
    setBoxOn(s?.kind === 'size-box');
    vp.setHandles(s ? s.specs : null, s ? runner.current!.sink(s) : null);
  }, [sel, p.store.mode.value, p.controller.revision, p.editingId, p.selectedId, p.sketching, p.enabled, threadKey, tick, about]);
  useEffect(() => () => { p.viewport()?.setHandles(null, null); }, []);

  const onContextMenu = (name: string | null, x: number, y: number, mode: PickMode) => {
    const { store, commands } = ref.current;
    if (ref.current.sketching) return;
    const mode2: SelectionMode = mode;
    if (name && !store.selection.value.includes(name)) { store.mode.value = mode2; store.select([name]); }
    else if (!name) store.select([]);
    const kind = selectionKind(store.selection.value, store.mode.value);
    const items = menuItems(kind, commands, true, (id) => whyNot(id, store.mode.value, store.selection.value));
    setMenu({ x, y, items, hint: gestureHint(plan()?.kind ?? null) });
  };

  const menuEl = menu ? (
    <ContextMenu x={menu.x} y={menu.y} items={menu.items} hint={menu.hint}
      onClose={() => setMenu(null)}
      onRun={(id) => { setMenu(null); const c = ref.current.commands.find((x) => x.id === (id === 'move-body' ? 'triball' : id)); if (c && (c.enabled?.() ?? true)) c.run(); }} />
  ) : null;
  const aboutEl = boxOn ? (
    <div class="sizebox-about" role="radiogroup" aria-label={t('sizebox.about')}>
      <span class="sizebox-about-title">{t('sizebox.about')}</span>
      {ABOUT_MODES.map((m) => (
        <button key={m} type="button" role="radio" aria-checked={about === m} class={about === m ? 'on' : ''} title={t(`sizebox.about.${m}.tip`)} onClick={() => setAbout(m)}>{t(`sizebox.about.${m}`)}</button>
      ))}
    </div>
  ) : null;
  const hintEl = hint ? <div class="handle-hint" role="status">{hint}</div> : null;
  return { onContextMenu, menuEl, hintEl, aboutEl };
}
