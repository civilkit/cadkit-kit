// The Sheet metal tab's commands. One table (SHEET_COMMANDS): each entry says its group, when it is enabled and either the edit it makes
// (the app then opens the feature's editor) or what it runs. Pure functions of the document and the selection, so they are tested
// against the real kernel without a DOM. To add a command (a new sheet feature) append one
// entry with `registerSheetCommand`; the ribbon puts a command its layout does not place into the tab and group the entry names,
// and the command search lists it. Strings: `cmd.<id>`, `why.<id>`, `tip.<id>` in locales/sheet.ts.
import type { Command } from '@kit/ui';
import type { EditOp } from '@ck/session';
import { t } from '../i18n';
import { edgeRefs, type Ctx } from '../featureCommands';
import { isClosedSketch, isOpenSketch, sketchWhere } from '../featureCreators';
import { activeRule, defaultRule, hasSheetBase, isUnfolded, rulesOf, sheetThickness } from './model';
import { cornerPoints } from './options';
import './register';

type Feat = { id: string; type: string; [k: string]: unknown };
type Ent = { id: string; type: string; construction?: boolean };

export const SHEET_TAB = 'Sheet';
export type SheetGroup = 'Rules' | 'Create' | 'Flatten' | 'FlatExport' | (string & {});

/** What the commands need from the app. */
export interface SheetActions {
  context(): Ctx;
  /** Run the edit and open the Editor on the new feature. */
  create(ops: EditOp[]): void;
  /** Run the edit without an editor (unfold, refold). */
  apply(ops: EditOp[]): void;
  /** Open the Editor on an existing feature. */
  edit(id: string): void;
  notify(text: string, level?: 'error' | 'warn' | 'info'): void;
  /** Show the flat pattern view. */
  flatView(): void;
  /** Open the DXF options. */
  exportDxf(): void;
  /** Download the bend table. */
  exportBends(format: 'csv' | 'json'): void;
  flatViewOpen?(): boolean;
}

export interface SheetCommandDef {
  id: string;
  group: SheetGroup;
  keys?: string;
  /** Has a longer description in the locale (`tip.<id>`). */
  tip?: boolean;
  enabled(c: Ctx): boolean;
  /** Why the command is off (a sentence for the tooltip). */
  why?(c: Ctx): string | undefined;
  /** The edit this command makes; the app opens the new feature's Editor. Null: nothing to make (the command says so). */
  ops?(c: Ctx): EditOp[] | null;
  /** Make the edit without opening an Editor. */
  applyOps?(c: Ctx): EditOp[] | null;
  /** Anything else the command does. */
  run?(a: SheetActions, c: Ctx): void;
  pressed?(a: SheetActions): boolean;
}

// ---- what the commands read from the document ----

const feats = (c: Ctx): Feat[] => ((c.doc?.features ?? []) as unknown as Feat[]).filter((f) => !f.suppressed);
const ents = (s: Feat): Ent[] => (s.entities as Ent[] | undefined) ?? [];
/** Sketches a base or contour flange already uses: a fold line is drawn in another one. */
const usedBySheet = (c: Ctx): Set<string> => new Set(feats(c).filter((f) => f.type === 'baseFlange' || f.type === 'contourFlange').map((f) => String(f.sketch)));

/** The sketch a base flange is made of: the one selected in the tree if it is closed, else the last closed sketch. */
export const baseSketch = (c: Ctx): Feat | null => sketchWhere(c, isClosedSketch);
/** The open chain of lines a contour flange follows: the selected or last open sketch. */
export const contourSketch = (c: Ctx): Feat | null => sketchWhere(c, isOpenSketch);
/** The sketch and line a fold follows: the selected sketch with a line, else the last that has one and is not the sheet's own outline. The line is the last one. */
export function foldLine(c: Ctx): { sketch: string; curve: string } | null {
  const used = usedBySheet(c);
  const s = sketchWhere(c, (x) => ents(x).some((e) => e.type === 'line') && !used.has(x.id));
  if (!s) return null;
  const lines = ents(s).filter((e) => e.type === 'line');
  return { sketch: s.id, curve: lines[lines.length - 1].id };
}

/** The sketch a cut across bends is made from: the selected closed sketch, else the last one that is neither a plate's outline nor already a cut. Drawn on a plane parallel to the base, its coordinates are flat coordinates. */
export function cutSketch(c: Ctx): Feat | null {
  const used = usedBySheet(c);
  for (const f of feats(c)) if (f.type === 'sheetCut') used.add(String(f.sketch));
  return sketchWhere(c, (x) => isClosedSketch(x) && !used.has(x.id));
}
/** The corners a Corner command rounds: the vertices selected in the view, as world points. */
export const cornerPicks = (c: Ctx): number[][] => cornerPoints(c.selection);

export const sheetReady = (c: Ctx): boolean => !!c.doc && hasSheetBase(c.doc) && !isUnfolded(c.doc);
const flangeEdges = (c: Ctx) => (c.mode === 'edge' || c.mode === 'vertex' ? edgeRefs(c.selection, c.edges) : []);

/** The rule feature the Rules command edits: the one selected in the tree, else the active one, else the last. Null when the part has none. */
export function rulesTarget(c: Ctx): Feat | null {
  const all = rulesOf(c.doc) as Feat[];
  return all.find((r) => r.id === c.selectedId) ?? (activeRule(c.doc) as Feat | null) ?? all[all.length - 1] ?? null;
}
/** The rule a first plate adds when the part has none, so the flange has stock to be made of. */
const withRule = (c: Ctx, ops: EditOp[]): EditOp[] => (rulesOf(c.doc).length ? ops : [{ op: 'add', feature: defaultRule(t('sheet.rule.defaultName')) } as EditOp, ...ops]);

/** Whether the part has a solid a convert can start from (a body in the view). */
const hasBody = (c: Ctx): boolean => !!c.box;
const whyConvert = (c: Ctx): string | undefined => {
  if (!c.doc) return t('why.noDocument');
  if (hasSheetBase(c.doc)) return t('why.sheet.hasBase');
  if (!hasBody(c)) return t('why.sheet.noSolid');
  return undefined;
};

const whyBase = (c: Ctx): string | undefined => {
  if (!c.doc) return t('why.noDocument');
  if (hasSheetBase(c.doc)) return t('why.sheet.hasBase');
  return undefined;
};
const whySheet = (c: Ctx): string | undefined => {
  if (!c.doc) return t('why.noDocument');
  if (!hasSheetBase(c.doc)) return t('why.sheet.noBase');
  if (isUnfolded(c.doc)) return t('why.sheet.unfolded');
  return undefined;
};

// ---- the table ----

export const SHEET_COMMANDS: SheetCommandDef[] = [
  { id: 'sheet-rules', group: 'Rules', tip: true, enabled: (c) => !!c.doc, why: (c) => (c.doc ? undefined : t('why.noDocument')),
    run: (a, c) => {
      const r = rulesTarget(c);
      if (r) a.edit(r.id); else a.create([{ op: 'add', feature: defaultRule(t('sheet.rule.defaultName')) } as EditOp]);
    } },
  { id: 'add-base-flange', group: 'Create', tip: true,
    enabled: (c) => !!c.doc && !hasSheetBase(c.doc) && baseSketch(c) !== null,
    why: (c) => whyBase(c) ?? (baseSketch(c) ? undefined : t('why.sheet.noClosedSketch')),
    ops: (c) => { const s = baseSketch(c); return s ? withRule(c, [{ op: 'add', feature: { type: 'baseFlange', sketch: s.id } } as EditOp]) : null; } },
  { id: 'add-edge-flange', group: 'Create', tip: true,
    enabled: sheetReady, why: whySheet,
    // with nothing picked the editor opens with an empty edge list that takes taps (no modifier key needed, so it works on a phone)
    ops: (c) => [{ op: 'add', feature: { type: 'edgeFlange', edges: flangeEdges(c), height: +(10 * sheetThickness(c.doc)).toPrecision(6) } } as EditOp] },
  { id: 'add-contour-flange', group: 'Create', tip: true,
    enabled: (c) => !!c.doc && !hasSheetBase(c.doc) && contourSketch(c) !== null,
    why: (c) => whyBase(c) ?? (contourSketch(c) ? undefined : t('why.sheet.noOpenSketch')),
    ops: (c) => { const s = contourSketch(c); return s ? withRule(c, [{ op: 'add', feature: { type: 'contourFlange', sketch: s.id, distance: 50 } } as EditOp]) : null; } },
  { id: 'add-sheet-convert', group: 'Create', tip: true,
    enabled: (c) => !!c.doc && !hasSheetBase(c.doc) && hasBody(c),
    why: whyConvert,
    ops: (c) => {
      const rule = activeRule(c.doc);
      return [{ op: 'add', feature: { type: 'sheetConvert', ...(rule?.name ? { rule: String(rule.name) } : {}) } } as EditOp];
    } },
  { id: 'add-hem', group: 'Create', tip: true,
    enabled: sheetReady, why: whySheet,
    ops: (c) => [{ op: 'add', feature: { type: 'hem', edges: flangeEdges(c), length: +(5 * sheetThickness(c.doc)).toPrecision(6) } } as EditOp] },
  { id: 'add-fold', group: 'Create', tip: true,
    enabled: (c) => sheetReady(c) && foldLine(c) !== null,
    why: (c) => whySheet(c) ?? t('why.sheet.noLine'),
    ops: (c) => { const l = foldLine(c); return l ? [{ op: 'add', feature: { type: 'fold', line: l, angle: 90 } } as EditOp] : null; } },
  { id: 'add-sheet-cut', group: 'Create', tip: true,
    enabled: (c) => sheetReady(c) && cutSketch(c) !== null,
    why: (c) => whySheet(c) ?? t('why.sheet.noCutSketch'),
    ops: (c) => { const s = cutSketch(c); return s ? [{ op: 'add', feature: { type: 'sheetCut', sketch: s.id } } as EditOp] : null; } },
  { id: 'add-sheet-corner', group: 'Create', tip: true,
    enabled: sheetReady, why: whySheet,
    ops: (c) => [{ op: 'add', feature: { type: 'sheetCorner', corners: cornerPicks(c), mode: 'round', radius: +(3 * sheetThickness(c.doc)).toPrecision(6) } } as EditOp] },
  { id: 'sheet-unfold', group: 'Flatten', tip: true,
    enabled: sheetReady, why: whySheet,
    applyOps: () => [{ op: 'add', feature: { type: 'unfold' } } as EditOp] },
  { id: 'sheet-refold', group: 'Flatten', tip: true,
    enabled: (c) => !!c.doc && hasSheetBase(c.doc) && isUnfolded(c.doc),
    why: (c) => (!c.doc ? t('why.noDocument') : !hasSheetBase(c.doc) ? t('why.sheet.noBase') : t('why.sheet.notUnfolded')),
    applyOps: () => [{ op: 'add', feature: { type: 'refold' } } as EditOp] },
  { id: 'sheet-flat', group: 'Flatten', tip: true,
    enabled: (c) => !!c.doc && hasSheetBase(c.doc), why: (c) => (c.doc ? t('why.sheet.noBase') : t('why.noDocument')),
    run: (a) => a.flatView(), pressed: (a) => !!a.flatViewOpen?.() },
  { id: 'sheet-dxf', group: 'FlatExport', tip: true,
    enabled: (c) => !!c.doc && hasSheetBase(c.doc), why: (c) => (c.doc ? t('why.sheet.noBase') : t('why.noDocument')),
    run: (a) => a.exportDxf() },
  { id: 'sheet-bends-csv', group: 'FlatExport', enabled: (c) => !!c.doc && hasSheetBase(c.doc), why: (c) => (c.doc ? t('why.sheet.noBase') : t('why.noDocument')),
    run: (a) => a.exportBends('csv') },
  { id: 'sheet-bends-json', group: 'FlatExport', enabled: (c) => !!c.doc && hasSheetBase(c.doc), why: (c) => (c.doc ? t('why.sheet.noBase') : t('why.noDocument')),
    run: (a) => a.exportBends('json') },
];

/** Add (or replace, by id) a command of the Sheet tab. Other sheet metal modules call this once at load. */
export function registerSheetCommand(def: SheetCommandDef): void {
  const at = SHEET_COMMANDS.findIndex((d) => d.id === def.id);
  if (at >= 0) SHEET_COMMANDS[at] = def; else SHEET_COMMANDS.push(def);
}

/** The ribbon and palette commands of the Sheet tab. */
export function sheetCommands(a: SheetActions): Command[] {
  const c = () => a.context();
  return SHEET_COMMANDS.map((d): Command => ({
    id: d.id, label: t('cmd.' + d.id), tab: SHEET_TAB, group: d.group, ...(d.keys ? { keys: d.keys } : {}), ...(d.tip ? { tip: t('tip.' + d.id) } : {}),
    enabled: () => d.enabled(c()),
    why: () => (d.enabled(c()) ? undefined : d.why?.(c())),
    ...(d.pressed ? { pressed: () => d.pressed!(a) } : {}),
    run: () => {
      const ctx = c();
      if (d.ops) { const ops = d.ops(ctx); if (ops) a.create(ops); else a.notify(d.why?.(ctx) ?? t('app.creator.nothing'), 'warn'); return; }
      if (d.applyOps) { const ops = d.applyOps(ctx); if (ops) a.apply(ops); return; }
      d.run?.(a, ctx);
    },
  }));
}
