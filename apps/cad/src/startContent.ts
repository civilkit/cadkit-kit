// The "Start here" card on an empty part: when it may show, and the per-tab dismissal. Pure and DOM-free, so each content source is tested.
import { signal } from '@preact/signals-core';

/** Everything that can put something in the main viewport (or take the viewport over). One flag per source: a new source is one line here. */
export interface ViewportSources {
  /** the document, or null when none is open */
  doc: { features: readonly unknown[]; blobs?: object; drawing?: unknown; cosmeticKnurls?: readonly unknown[] } | null;
  /** reference meshes in `doc.meshes` (an imported STL, a SketchUp reference) */
  meshes: number;
  /** a solid is drawn (a part built from features, a loaded part, a library part) */
  hasSolid: boolean;
  /** a view-only body (STEP, SketchUp, SolidWorks) is drawn */
  hasImportedBody: boolean;
  /** a 2D sketch is open */
  sketching: boolean;
  /** any feature dialog or tool panel is open: feature editor, wizards, 3D Sketch, Mesh, Frame, import dialogs, mesh picking */
  panelOpen: boolean;
  /** the Drawing workspace is shown */
  drawingOpen: boolean;
}

/** True when the viewport shows anything, or a tool is open over it. The card is for an empty document only. */
export function viewportHasContent(s: ViewportSources): boolean {
  const d = s.doc;
  if (!d) return false;   // no document: the "No part open" state, nothing to start on
  return d.features.length > 0 || s.meshes > 0 || s.hasSolid || s.hasImportedBody || s.sketching || s.panelOpen || s.drawingOpen
    || (!!d.blobs && Object.keys(d.blobs).length > 0) || !!d.drawing || (d.cosmeticKnurls?.length ?? 0) > 0;
}

/** The card shows on an open document with nothing in the viewport that the user has not closed. */
export function showStartCard(s: ViewportSources, dismissed: boolean): boolean {
  return !!s.doc && !dismissed && !viewportHasContent(s);
}

/** Bumped whenever what the viewport draws changes outside the document (a view-only body arrives or goes): re-renders the card. */
export const viewportContentRev = signal(0);
export const bumpViewportContent = (): void => { viewportContentRev.value++; };

/** Tabs whose card the user closed. Reset when the tab loads another document (New part, Open). */
export const startDismissed = signal<ReadonlySet<number>>(new Set());
export const isStartDismissed = (tab: number): boolean => startDismissed.value.has(tab);
export const dismissStart = (tab: number): void => { if (!startDismissed.value.has(tab)) startDismissed.value = new Set([...startDismissed.value, tab]); };
export const resetStartDismissal = (tab: number): void => { if (startDismissed.value.has(tab)) { const n = new Set(startDismissed.value); n.delete(tab); startDismissed.value = n; } };
