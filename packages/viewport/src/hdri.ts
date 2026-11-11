// HDRI environments (Poly Haven and other libraries, fetched by the app, never by the viewport): the app registers a provider that turns an environment id into the
// URL of a Radiance .hdr image; the viewport loads it, prefilters it with PMREM (the same way as the built-in studio light) and uses it for the reflections
// and the image based light instead of the studio environment. Until it is there, or when there is no provider, the studio light stays.
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export type HdriProvider = (id: string) => Promise<string | null>;
let provider: HdriProvider | null = null;
const listeners = new Set<() => void>();

/** The app's way to get the image; set once at start. Viewports forget what they could not load, so they ask again. */
export function setHdriProvider(p: HdriProvider | null): void { provider = p; for (const l of listeners) l(); }
/** Call back when the provider changed or `retryHdris` was called. Returns the unsubscribe function. */
export function onHdriProviderChanged(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
/** After the user allowed online libraries: environments that were not available are asked for again. */
export function retryHdris(): void { for (const l of listeners) l(); }

/** Load an environment and prefilter it for `renderer`; null when there is no provider or the image is not available. The caller owns (and disposes) the texture. */
export async function loadHdri(id: string, renderer: THREE.WebGLRenderer): Promise<THREE.Texture | null> {
  const p = provider;
  if (!p) return null;
  try {
    const url = await p(id);
    if (!url) return null;
    const src = await new RGBELoader().loadAsync(url);
    src.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromEquirectangular(src);
    pm.dispose(); src.dispose();
    return rt.texture;
  } catch { return null; }
}
