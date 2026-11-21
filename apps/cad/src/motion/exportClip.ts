// Export a solved study as a clip: WebM or MP4 (the browser's own MediaRecorder on the viewport's canvas, played at the study's speed), an animated
// GIF, or a PNG sequence (a ZIP). Frames come from the same cache the player uses; the view shows each pose through `deps.show`. Everything the
// browser provides is passed in, so the order of events is tested without one.
import { encodeGif, zipStore, type RgbaFrame } from '@kit/motion';

export type ClipFormat = 'webm' | 'mp4' | 'gif' | 'png';
export const CLIP_FORMATS: ClipFormat[] = ['webm', 'mp4', 'gif', 'png'];

export class ClipError extends Error {
  constructor(readonly code: 'noFrames' | 'mp4Unsupported' | 'webmUnsupported' | 'noCanvas' | 'cancelled', message: string) { super(message); }
}

export interface Recorder { start(): void; stop(): void; ondata: ((b: Blob) => void) | null; onstop: (() => void) | null }
export interface ClipDeps {
  /** Number of frames and the study's duration (seconds): a frame lasts duration / (frames - 1). */
  frames: number;
  duration: number;
  /** Show frame `i` (the view has it drawn once this returns). */
  show(i: number): void | Promise<void>;
  /** The view as a PNG now. */
  capture(): Promise<Blob | null>;
  /** A MediaRecorder on the canvas for `mime`, or null where it cannot be had. */
  recorder(mime: string): Recorder | null;
  supports(mime: string): boolean;
  /** PNG blob to RGBA, scaled so it is at most `maxWidth` wide. */
  decode(png: Blob, maxWidth: number): Promise<RgbaFrame>;
  bytes(b: Blob): Promise<Uint8Array>;
  sleep(ms: number): Promise<void>;
  save(name: string, data: Uint8Array, mime: string): Promise<void>;
  progress?(done: number, of: number): void;
  cancelled?(): boolean;
}

const MIMES: Record<'webm' | 'mp4', string[]> = {
  webm: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
  mp4: ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'],
};
/** The first MIME type of the format the browser can write, or null. */
export const pickMime = (f: 'webm' | 'mp4', supports: (m: string) => boolean): string | null => MIMES[f].find(supports) ?? null;

const safe = (s: string): string => s.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'study';

/** Write the clip; returns the file name. Throws ClipError (`mp4Unsupported`: this browser cannot write MP4, use WebM or GIF). */
export async function exportClip(format: ClipFormat, name: string, d: ClipDeps, o: { maxWidth?: number; gifFps?: number } = {}): Promise<string> {
  if (d.frames < 1) throw new ClipError('noFrames', 'the study has no frames');
  const base = safe(name);
  const check = () => { if (d.cancelled?.()) throw new ClipError('cancelled', 'cancelled'); };
  if (format === 'png') {
    const files: Array<{ name: string; data: Uint8Array }> = [];
    for (let i = 0; i < d.frames; i++) {
      check();
      await d.show(i);
      const b = await d.capture();
      if (!b) throw new ClipError('noCanvas', 'the view could not be read');
      files.push({ name: `${base}_${String(i + 1).padStart(4, '0')}.png`, data: await d.bytes(b) });
      d.progress?.(i + 1, d.frames);
    }
    await d.save(`${base}.zip`, zipStore(files), 'application/zip');
    return `${base}.zip`;
  }
  if (format === 'gif') {
    const stepFps = o.gifFps ?? 15;
    const fps = d.frames > 1 ? (d.frames - 1) / d.duration : 30;
    const stride = Math.max(1, Math.round(fps / stepFps));
    const picks: number[] = [];
    for (let i = 0; i < d.frames; i += stride) picks.push(i);
    const shots: RgbaFrame[] = [];
    for (let k = 0; k < picks.length; k++) {
      check();
      await d.show(picks[k]);
      const b = await d.capture();
      if (!b) throw new ClipError('noCanvas', 'the view could not be read');
      shots.push(await d.decode(b, o.maxWidth ?? 640));
      d.progress?.(k + 1, picks.length);
    }
    await d.save(`${base}.gif`, encodeGif(shots, { fps: fps / stride }), 'image/gif');
    return `${base}.gif`;
  }
  const mime = pickMime(format, d.supports);
  if (!mime) throw new ClipError(format === 'mp4' ? 'mp4Unsupported' : 'webmUnsupported', `this browser cannot write ${format}`);
  const rec = d.recorder(mime);
  if (!rec) throw new ClipError('noCanvas', 'the view cannot be recorded');
  const chunks: Blob[] = [];
  rec.ondata = (b) => { chunks.push(b); };
  const stopped = new Promise<void>((res) => { rec.onstop = () => res(); });
  const every = d.frames > 1 ? (d.duration * 1000) / (d.frames - 1) : 0;
  await d.show(0);
  rec.start();
  try {
    for (let i = 0; i < d.frames; i++) {
      check();
      await d.show(i);
      d.progress?.(i + 1, d.frames);
      if (every) await d.sleep(every);
    }
  } finally { rec.stop(); }
  await stopped;
  const ext = format;
  await d.save(`${base}.${ext}`, await d.bytes(new Blob(chunks, { type: mime.split(';')[0] })), mime.split(';')[0]);
  return `${base}.${ext}`;
}

// ---- the browser's side -----------------------------------------------------------------------------------------------------------------

export async function browserDecode(png: Blob, maxWidth: number): Promise<RgbaFrame> {
  const bmp = await createImageBitmap(png);
  const k = Math.min(1, maxWidth / bmp.width);
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new ClipError('noCanvas', 'no 2d canvas');
  ctx.drawImage(bmp, 0, 0, w, h);
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
}
export const browserBytes = async (b: Blob): Promise<Uint8Array> => new Uint8Array(await b.arrayBuffer());
export const browserSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
