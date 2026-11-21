// A picture to trace on a sketch: the records the part keeps (viewer-side data like the reference meshes: the kernel never sees them), the
// rules for placing and calibrating one, and the shape the viewport draws. No DOM except `readImage`, which needs an image decoder.
//
//   doc.underlays = [{ id, sketch, name, mime, data (base64), pxW, pxH, w (mm), x, y (centre, sketch coordinates), rot (degrees),
//                      opacity, locked, visible }]
// One per sketch. The picture lies on the plane of the sketch it was added to; it is only drawn while that sketch is open.
import type { UnderlayFrame, UnderlayShape } from '@kit/viewport';

export interface Underlay {
  id: string;
  /** the sketch (feature id) it lies on */
  sketch: string;
  name: string;
  mime: string;
  /** the file, base64 */
  data: string;
  pxW: number;
  pxH: number;
  /** width in mm (the height follows from the pixels) */
  w: number;
  x: number;
  y: number;
  rot: number;
  opacity: number;
  /** a locked picture cannot be moved by the panel's fields or calibrated: it is a fixed reference */
  locked: boolean;
  visible: boolean;
}

export const UNDERLAY_KEY = 'underlays';
/** What the panel takes: a picture of more than this is refused (the part file carries it as text, a third bigger). */
export const MAX_UNDERLAY_BYTES = 6 * 1024 * 1024;
export const UNDERLAY_MIMES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
export const UNDERLAY_ACCEPT = Object.keys(UNDERLAY_MIMES).map((e) => '.' + e);
/** The width a new picture starts at, mm (the longest side): large enough to see, and the calibration sets the true size. */
export const START_SIZE = 100;
export const MIN_OPACITY = 0.05;

/** The mime type of a picture file by its name; null for a type the panel does not take. */
export const mimeOfName = (name: string): string | null => UNDERLAY_MIMES[name.toLowerCase().split('.').pop() ?? ''] ?? null;

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The records of a document, each made safe to use (a hand-edited file may hold anything). */
export function underlaysOf(doc: unknown): Underlay[] {
  const raw = (doc as { underlays?: unknown } | null | undefined)?.underlays;
  if (!Array.isArray(raw)) return [];
  const out: Underlay[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r !== 'object' || !str(r.id) || !str(r.sketch) || !str(r.data) || !str(r.mime).startsWith('image/')) continue;
    const pxW = num(r.pxW, 0), pxH = num(r.pxH, 0), w = num(r.w, 0);
    if (!(pxW > 0 && pxH > 0 && w > 0)) continue;
    out.push({ id: str(r.id), sketch: str(r.sketch), name: str(r.name) || 'image', mime: str(r.mime), data: str(r.data), pxW, pxH, w, x: num(r.x, 0), y: num(r.y, 0), rot: num(r.rot, 0),
      opacity: Math.min(1, Math.max(MIN_OPACITY, num(r.opacity, 0.5))), locked: r.locked === true, visible: r.visible !== false });
  }
  return out;
}

export const underlayFor = (list: Underlay[], sketch: string): Underlay | null => list.find((u) => u.sketch === sketch) ?? null;

/** A new record, centred on the sketch's origin, its longest side START_SIZE mm. */
export function newUnderlay(sketch: string, name: string, mime: string, data: string, pxW: number, pxH: number, id = 'u1'): Underlay {
  const w = pxW >= pxH ? START_SIZE : (START_SIZE * pxW) / pxH;
  return { id, sketch, name, mime, data, pxW, pxH, w, x: 0, y: 0, rot: 0, opacity: 0.5, locked: false, visible: true };
}

/** The list with this record in it (it replaces the one on the same sketch: one picture per sketch). */
export const withUnderlay = (list: Underlay[], u: Underlay): Underlay[] => [...list.filter((x) => x.sketch !== u.sketch), u];
export const withoutUnderlay = (list: Underlay[], id: string): Underlay[] => list.filter((x) => x.id !== id);

/** The records whose sketch is no longer in the part (a cancelled sketch leaves nothing behind). `keep` is the sketch being edited, not yet a feature. */
export const pruneUnderlays = (list: Underlay[], featureIds: ReadonlySet<string>, keep?: string): Underlay[] => list.filter((u) => featureIds.has(u.sketch) || u.sketch === keep);

/** Height in mm. */
export const heightOf = (u: Underlay): number => (u.w * u.pxH) / u.pxW;

/** Where a point of the sketch (mm) is on the picture, in pixels from its upper left corner: the answer to "which pixel is this". */
export function pixelAt(u: Underlay, p: { x: number; y: number }): { px: number; py: number } {
  const a = (-u.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = p.x - u.x, dy = p.y - u.y;
  const lx = dx * c - dy * s, ly = dx * s + dy * c;   // the point in the picture's own axes, mm from its centre
  const k = u.pxW / u.w;
  return { px: u.pxW / 2 + lx * k, py: u.pxH / 2 - ly * k };
}

/**
 * Calibrate: two points of the sketch that are `mm` apart in the real object. The picture is scaled about the first point, so what lies under it stays
 * under it, until the points are that far apart. Null when the points coincide or the distance is not a number above 0.
 */
export function calibrated(u: Underlay, a: { x: number; y: number }, b: { x: number; y: number }, mm: number): Underlay | null {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(d > 1e-9) || !Number.isFinite(mm) || !(mm > 0)) return null;
  const f = mm / d;
  return { ...u, w: u.w * f, x: a.x + (u.x - a.x) * f, y: a.y + (u.y - a.y) * f };
}

/** The shape the viewport draws, or null while the picture is hidden. */
export function shapeOf(u: Underlay | null, frame: UnderlayFrame | null): UnderlayShape | null {
  if (!u || !frame || !u.visible) return null;
  return { frame, url: `data:${u.mime};base64,${u.data}`, pxW: u.pxW, pxH: u.pxH, w: u.w, x: u.x, y: u.y, rot: u.rot, opacity: u.opacity };
}

/** A field's text as a number; null when it is not one (the panel then leaves the record as it was). */
export function parseField(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Decode a picture to read its pixel size. Throws a short reason when the browser cannot read it. */
export async function readImage(bytes: Uint8Array, mime: string): Promise<{ pxW: number; pxH: number }> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  if (typeof createImageBitmap === 'function') {
    const bm = await createImageBitmap(blob);
    const r = { pxW: bm.width, pxH: bm.height };
    bm.close?.();
    if (r.pxW > 0 && r.pxH > 0) return r;
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => (im.naturalWidth > 0 && im.naturalHeight > 0 ? res({ pxW: im.naturalWidth, pxH: im.naturalHeight }) : rej(new Error('empty image')));
      im.onerror = () => rej(new Error('not a picture the browser can read'));
      im.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}
