// The app's side of the Sheet metal tab: the actions its commands call, the flat pattern panel and the DXF options dialog.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { PartDoc } from '@ck/part-model';
import type { EditOp } from '@ck/session';
import type { Controller } from '../controller';
import type { Ctx } from '../featureCommands';
import { t } from '../i18n';
import { FlatPatternView } from './FlatPatternView';
import { SheetDxfDialog } from './SheetDxfDialog';
import { BEND_MIME, bendFileName, bendTableRequest, dxfFileName, dxfRequest, loadDxfOptions, saveDxfOptions, type BendFormat, type BendTableReply, type DxfOptions, type DxfReply } from './exportSheet';
import { hasSheetBase, lastFlat, panelInfo, type SheetEntry } from './model';
import { setPanels } from './panels';
import type { SheetActions } from './sheetCommands';

type Notify = (text: string, level?: 'error' | 'warn' | 'info') => void;

/** `doc` with the open editor's draft applied to its feature (a null in the draft removes the field), for a live flat pattern. */
export function withDraft(doc: PartDoc, id: string | null, draft: Record<string, unknown>): PartDoc {
  if (!id || !Object.keys(draft).length) return doc;
  return { ...doc, features: doc.features.map((f) => {
    if (f.id !== id) return f;
    const next: Record<string, unknown> = { ...(f as unknown as Record<string, unknown>), ...draft };
    for (const k of Object.keys(next)) if (next[k] === null) delete next[k];
    return next as never;
  }) };
}

export function useSheet(d: {
  controller: Controller; doc: PartDoc | null; editingId: string | null; draft: Record<string, unknown>;
  context(): Ctx; create(ops: EditOp[]): void; startEditing(id: string): void; redraw(): void; notify: Notify;
  save(name: string, data: string, mime: string): Promise<void>;
}): { actions: SheetActions; nodes: JSX.Element | null; isSheet: boolean; flatOpen: boolean } {
  const [flatOpen, setFlatOpen] = useState(false);
  const [entries, setEntries] = useState<SheetEntry[]>([]);
  const [dxf, setDxf] = useState<{ flat: SheetEntry } | null>(null);
  const seq = useRef(0);
  const isSheet = hasSheetBase(d.doc);

  // the flat pattern follows the document, and the open editor's draft while there is one
  const key = JSON.stringify([d.editingId, d.draft]);
  useEffect(() => {
    if (!flatOpen || !d.doc) return;
    const mine = ++seq.current;
    void d.controller.sheetMetal(withDraft(d.doc, d.editingId, d.draft)).then((e) => { if (mine === seq.current) setEntries(e); }).catch(() => { if (mine === seq.current) setEntries([]); });
  }, [flatOpen, d.doc, key]);

  // the Panel lists of the edge flange, hem and fold editors: the panels of the sheet as it is before the feature being edited
  useEffect(() => {
    const at = d.editingId && d.doc ? d.doc.features.findIndex((f) => f.id === d.editingId) : -1;
    const type = at >= 0 ? d.doc!.features[at].type : '';
    if (!['edgeFlange', 'hem', 'fold'].includes(type)) { setPanels(null); return; }
    let stale = false;
    void d.controller.sheetMetal({ ...d.doc!, features: d.doc!.features.slice(0, at) }).then((e) => { if (!stale) setPanels(panelInfo(lastFlat(e))); }).catch(() => { if (!stale) setPanels(null); });
    return () => { stale = true; };
  }, [d.editingId, d.doc]);

  const committedFlat = async (): Promise<SheetEntry | null> => {
    const flat = lastFlat(await d.controller.sheetMetal());
    if (!flat) d.notify(t('sheet.export.noSheet'), 'warn');
    return flat;
  };
  const partName = () => d.controller.document()?.name;
  const writeDxf = async (flat: SheetEntry, o: DxfOptions) => {
    saveDxfOptions(o);
    try {
      const r = await d.controller.sheetRequest<DxfReply>(dxfRequest(flat.flatPattern, o));
      const name = dxfFileName(partName());
      await d.save(name, r.dxf, 'application/dxf');
      d.notify(t('sheet.dxf.done', { name, bends: r.bends }), 'info');
    } catch (e) { d.notify(t('sheet.dxf.failed', { message: (e as Error).message }), 'error'); }
  };
  const writeBends = async (format: BendFormat) => {
    const flat = await committedFlat();
    if (!flat) return;
    try {
      const r = await d.controller.sheetRequest<BendTableReply>(bendTableRequest(flat.flatPattern, format, partName()));
      const name = bendFileName(partName(), format);
      await d.save(name, r.text, BEND_MIME[format]);
      d.notify(t('sheet.bends.done', { name }), 'info');
    } catch (e) { d.notify(t('sheet.bends.failed', { message: (e as Error).message }), 'error'); }
  };

  const actions: SheetActions = {
    context: d.context,
    create: d.create,
    apply: (ops) => void (async () => {
      const r = await d.controller.edit(ops);
      d.redraw();
      if (!r.ok) d.notify(d.controller.rejection()?.summary ?? r.hints?.map((h) => h.hint).join('; ') ?? (r as { schemaError?: string }).schemaError ?? '', 'error');
    })(),
    edit: d.startEditing,
    notify: d.notify,
    flatView: () => setFlatOpen((v) => !v),
    flatViewOpen: () => flatOpen,
    exportDxf: () => void committedFlat().then((flat) => { if (flat) setDxf({ flat }); }),
    exportBends: (format) => void writeBends(format),
  };

  const nodes = (
    <>
      {flatOpen && d.doc ? <FlatPatternView entry={lastFlat(entries)} onClose={() => setFlatOpen(false)} onDxf={actions.exportDxf} onBends={(f) => void writeBends(f)} /> : null}
      {dxf ? <SheetDxfDialog initial={loadDxfOptions()} bends={dxf.flat.flatPattern.bends.length} onCancel={() => setDxf(null)} onWrite={(o) => { const f = dxf.flat; setDxf(null); void writeDxf(f, o); }} /> : null}
    </>
  );
  return { actions, nodes: flatOpen || dxf ? nodes : null, isSheet, flatOpen };
}
