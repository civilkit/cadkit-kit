// THROWAWAY spike: load a sample through the browser kernel and show it in @kit/viewport.
// Replaced by the real app shell (plan Task 9, step 4). Not part of the product.
import { createBrowserKernel } from '@ck/kernel-client/browser';
import { Viewport, type ViewBody } from '@kit/viewport';

const SAMPLES = [
  'coupling-sample', 'stepper-bracket', 'stepper-sample', 'bench-bolt',
  'bench-spur_gear', 'bench-torus_link', 'bench-pan_head_screw_top_slot', 'bench-bellows', 'bench-clevis', 'brepjs-o_ring',
];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const st = $('st'), hover = $('hover'), sel = $<HTMLSelectElement>('sel');
sel.innerHTML = SAMPLES.map((s) => `<option>${s}</option>`).join('');

type Buf = { data: Float32Array | Int32Array };
const arr = (v: unknown) => (v as Buf).data;

async function main() {
  const kernel = await createBrowserKernel('/kernel/ck_wasm.wasm');
  const vp = new Viewport($('vp'), {
    onPick: (names) => { vp.setHighlight(names); st.textContent = names.length ? `picked ${names.join(', ')}` : 'nothing picked'; },
    onHover: (n) => { hover.textContent = n ? `hover: ${n}` : ''; },
  });
  addEventListener('resize', () => vp.resize());
  document.querySelectorAll<HTMLButtonElement>('button[data-v]').forEach((b) =>
    b.addEventListener('click', () => vp.setView(b.dataset.v as 'iso')));
  $('fit').addEventListener('click', () => vp.fit());
  document.querySelectorAll<HTMLInputElement>('input[name=m]').forEach((r) =>
    r.addEventListener('change', () => vp.setPickMode(r.value as 'face' | 'edge')));

  async function load(name: string) {
    st.textContent = `regen ${name}...`;
    const part = await (await fetch(`/spike/${name}.ckpart`)).json();
    const t0 = performance.now();
    const r = await kernel.request({ type: 'regen', tag: 'spike', part });
    const ms = Math.round(performance.now() - t0);
    const res = r.result as { errors?: unknown[]; body?: Record<string, any> } | undefined;
    const body = res?.body;
    if (!r.ok || !body?.mesh) {
      vp.setBody(null);
      st.textContent = `${name}: no body (${r.trap ?? r.error ?? JSON.stringify(res?.errors)})`;
      return;
    }
    const view: ViewBody = {
      mesh: {
        positions: arr(body.mesh.positions) as Float32Array,
        normals: arr(body.mesh.normals) as Float32Array,
        triFace: arr(body.mesh.triFace) as Int32Array,
        faceIds: (body.faces as Array<{ id: string }>).map((f) => f.id),
      },
      edges: (body.edges as Array<{ key?: string; pts: number[][] }>) ?? [],
      box: body.box,
    };
    vp.setBody(view);
    vp.setHighlight([]);
    const errs = (res?.errors ?? []).length;
    st.textContent = `${name}: ${view.mesh.faceIds.length} faces, ${view.mesh.triFace.length} triangles, ${ms} ms${errs ? `, ${errs} feature error(s)` : ''}`;
  }
  sel.addEventListener('change', () => load(sel.value));
  await load(SAMPLES[0]);
}
main().catch((e) => { st.textContent = `error: ${e?.message ?? e}`; console.error(e); });
