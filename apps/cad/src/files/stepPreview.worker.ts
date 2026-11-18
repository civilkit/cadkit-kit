// Reads a STEP file with Foxtrot (Rust, built to wasm: civilkit/foxtrot) off the main thread and sends the flat mesh back.
// A face Foxtrot cannot mesh and panics on traps the wasm (it cannot unwind): the worker then reports which face, and
// the caller starts a fresh worker with that face skipped.
import init, { step_to_preview, skip_face, current_face } from './foxtrot/foxtrot.js';
import wasmUrl from './foxtrot/foxtrot_bg.wasm?url';
import { buildPreviewMesh, resultOfBodies } from './stepPreviewMesh';

export type Reply =
  | { ok: true; mesh: ReturnType<typeof buildPreviewMesh>; unmeshed: number }
  | { ok: false; message: string }
  | { retry: number };
const post = (r: Reply, transfer: Transferable[] = []) => (self as unknown as { postMessage(m: Reply, t: Transferable[]): void }).postMessage(r, transfer);

self.onmessage = async (e: MessageEvent<{ bytes: ArrayBuffer; skip: number[] }>) => {
  try {
    await init({ module_or_path: wasmUrl });
    for (const f of e.data.skip) skip_face(f);
    let p;
    try { p = step_to_preview(new Uint8Array(e.data.bytes)); } catch (err) {
      if (err instanceof WebAssembly.RuntimeError) return post({ retry: current_face() });
      throw err;
    }
    const positions = p.positions, normals = p.normals, unmeshed = p.errors + p.panics;
    const names = p.body_names, paths = p.body_paths, tris = p.body_tris;
    p.free();
    const r = resultOfBodies(positions, normals, names, paths, tris);
    const mesh = buildPreviewMesh(r);
    post({ ok: true, mesh, unmeshed }, [mesh.positions.buffer, mesh.normals.buffer, mesh.triFace.buffer]);
  } catch (err) { post({ ok: false, message: (err as Error).message }); }
};
