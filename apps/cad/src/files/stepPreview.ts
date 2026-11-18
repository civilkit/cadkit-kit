// Large STEP files (assemblies) open as a mesh-only preview: see stepPreviewMesh.ts. Exact import stays for small files.
import type { ViewBody } from '@ck/session';
import type { PreviewMesh, PreviewNode } from './stepPreviewMesh';

/** STEP text longer than this opens as a preview (the kernel's exact import does not finish on a 40 MB assembly). */
export const PREVIEW_MIN_CHARS = 8_000_000;

export type StepPreviewResult =
  | { ok: true; view: ViewBody; triangles: number; products: number; nodes: PreviewNode[]; seconds: number; /** faces the mesher could not do (holes in the preview) */ unmeshed: number }
  | { ok: false; code: 'cancelled' | 'failed'; message: string };

/** What the preview needs of a worker, so a test can stand one in. */
export interface PreviewWorker { postMessage(m: { bytes: ArrayBuffer; skip: number[] }, t: Transferable[]): void; terminate(): void; onmessage: ((e: { data: { ok: true; mesh: PreviewMesh; unmeshed?: number } | { ok: false; message: string } | { retry: number } }) => void) | null; onerror: ((e: { message?: string }) => void) | null }

export function viewOfPreview(m: PreviewMesh): ViewBody {
  return {
    mesh: { positions: m.positions, normals: m.normals, triFace: m.triFace, faceIds: m.faceIds },
    edges: [], box: m.box, sketches: [], curves: [], planes: [], markers: [],
  };
}

const defaultWorker = (): PreviewWorker => new Worker(new URL('./stepPreview.worker.ts', import.meta.url), { type: 'module' }) as unknown as PreviewWorker;

/** A trapped face is skipped and the read restarted in a fresh worker; this many restarts at most. */
const MAX_RETRIES = 12;

export function previewStep(text: string, opts: { signal?: AbortSignal; spawn?: () => PreviewWorker } = {}): Promise<StepPreviewResult> {
  const t0 = Date.now();
  const bytes = new TextEncoder().encode(text);
  return new Promise((resolve) => {
    let w: PreviewWorker | null = null;
    const done = (r: StepPreviewResult) => { opts.signal?.removeEventListener('abort', onAbort); w?.terminate(); resolve(r); };
    const onAbort = () => done({ ok: false, code: 'cancelled', message: 'cancelled' });
    if (opts.signal?.aborted) return onAbort();
    opts.signal?.addEventListener('abort', onAbort);
    const skip: number[] = [];
    const run = () => {
      w?.terminate();
      const me = w = (opts.spawn ?? defaultWorker)();
      me.onmessage = (e) => {
        const d = e.data;
        if ('retry' in d) {
          if (skip.length >= MAX_RETRIES || skip.includes(d.retry)) return done({ ok: false, code: 'failed', message: 'the mesher stopped on a face it could not skip' });
          skip.push(d.retry);
          return run();
        }
        if (!d.ok) return done({ ok: false, code: 'failed', message: d.message });
        if (!d.mesh.triangles) return done({ ok: false, code: 'failed', message: 'no solid in the file' });
        done({ ok: true, view: viewOfPreview(d.mesh), triangles: d.mesh.triangles, products: d.mesh.products, nodes: d.mesh.nodes, unmeshed: d.unmeshed ?? 0, seconds: Math.round((Date.now() - t0) / 100) / 10 });
      };
      me.onerror = (e) => done({ ok: false, code: 'failed', message: e.message ?? 'the preview worker failed' });
      const copy = bytes.slice().buffer as ArrayBuffer;
      me.postMessage({ bytes: copy, skip: [...skip] }, [copy]);
    };
    run();
  });
}
