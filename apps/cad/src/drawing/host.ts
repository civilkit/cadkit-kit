// Connects the Drawings workspace to the controller: the part's features, the kernel query, thread pitches, mass and the assembly BOM.
import type { Controller } from '../controller';
import { bomItems, bomTotal } from '../assembly/model';
import { densityOf, massText, massView } from '../inspect/mass';
import type { DrawingHost } from './DrawingWorkspace';
import type { DrawingDoc } from './model';
import type { BomRow } from './render';

/** A short signature of what the drawing is made from: the features and the material. It changes when the part does. */
export function partRevision(doc: { features?: unknown[]; material?: string } | null): string {
  if (!doc) return '';
  const s = JSON.stringify([doc.features ?? [], doc.material ?? '']);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${h}`;
}

export function makeDrawingHost(c: Controller, io: {
  save(name: string, data: string | Uint8Array, mime: string): Promise<void>;
  notify(text: string, level?: 'info' | 'warn' | 'error'): void;
  changed(): void;
  close(): void;
}): DrawingHost | null {
  const doc = c.document();
  if (!doc) return null;
  const features = (doc.features ?? []) as unknown as Array<Record<string, unknown>>;
  return {
    partName: doc.name ?? '', material: String((doc as { material?: string }).material ?? ''),
    stored: (doc as unknown as { drawing?: unknown }).drawing,
    features, revision: partRevision(doc as never), query: c.drawingQuery(), hasBody: c.hasSolid(),
    async pitches() {
      const out: Record<string, number> = {};
      for (const f of features) {
        if (f.type !== 'thread' || typeof f.size !== 'string') continue;
        const std = typeof f.standard === 'string' ? f.standard : 'metric';
        const row = await c.threadRow(std, f.size);
        if (row) out[`${std}|${f.size}`] = row.pitch;
      }
      return out;
    },
    async mass() {
      const raw = await c.massProps();
      const dens = densityOf(String((doc as { material?: string }).material ?? ''));
      return raw && dens !== null ? massView(raw, dens).mass : null;
    },
    async bom(): Promise<BomRow[]> {
      if (!features.some((f) => f.type === 'insertPart')) return [];
      const vols = new Map<string, number | null>();
      for (const f of features) if (f.type === 'insertPart' && f.part) vols.set(JSON.stringify(f.part), (await c.partMass(f.part)).volume);
      const items = bomItems(doc as never, (p) => vols.get(JSON.stringify(p)) ?? null);
      const rows: BomRow[] = items.map((i) => ({ no: i.no, part: i.part, qty: i.qty, material: i.material, mass: i.massTotal === null ? '' : massText(i.massTotal).replace(/ g$/, ''), components: i.components }));
      const tot = bomTotal(items);
      void tot;
      return rows;
    },
    onChange(d: DrawingDoc) { c.setDocExtra('drawing', d); io.changed(); },
    save: io.save, notify: io.notify, close: io.close,
  };
}
