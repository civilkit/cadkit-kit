// Image textures for the body material (Poly Haven and other libraries, fetched by the app, never by the viewport): the app registers a provider
// that turns a texture id into image URLs; the viewport loads them once per id and shows the body with a triplanar mapping (see lookshader.ts),
// so no texture coordinates are needed. Until the images are there, or when there is no provider, the body keeps its plain colour.
import * as THREE from 'three';

/** Image URLs of one texture: the colour map and, if there are any, the roughness map and the OpenGL normal map (all usually JPEG, 1K). */
export interface TextureMaps { map: string; rough?: string; normal?: string }
export type TextureProvider = (id: string) => Promise<TextureMaps | null>;
export interface LoadedTexture { map: THREE.Texture; rough: THREE.Texture | null; normal: THREE.Texture | null }

let provider: TextureProvider | null = null;
const loaded = new Map<string, LoadedTexture | null>();   // null: asked for and not available
const pending = new Set<string>();
const listeners = new Set<() => void>();

/** The app's way to get images; set once at start. Clears what a previous provider gave. */
export function setTextureProvider(p: TextureProvider | null): void {
  provider = p;
  for (const v of loaded.values()) { v?.map.dispose(); v?.rough?.dispose(); v?.normal?.dispose(); }
  loaded.clear(); pending.clear();
  for (const l of listeners) l();
}
/** Call back when a texture finished loading (or the provider changed) so the view can redraw. Returns the unsubscribe function. */
export function onTexturesChanged(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
/** Forget the textures that were not available, so the next look asks the provider again (after the user allowed online libraries). */
export function retryTextures(): void {
  for (const [k, v] of [...loaded]) if (v === null) loaded.delete(k);
  for (const l of listeners) l();
}

const load = (url: string, srgb: boolean): Promise<THREE.Texture> => new Promise((res, rej) => {
  new THREE.TextureLoader().load(url, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    res(t);
  }, undefined, () => rej(new Error('texture image did not load')));
});

/** The textures for an id when they are ready; otherwise null, and the load starts (once) and listeners are told when it is done. */
export function textureFor(id: string): LoadedTexture | null {
  if (loaded.has(id)) return loaded.get(id) ?? null;
  if (!provider || pending.has(id)) return null;
  pending.add(id);
  const p = provider;
  void p(id).then(async (m) => {
    if (!m || p !== provider) return null;
    // the roughness and normal maps are extras: when one does not load, the texture still shows without it
    const [map, rough, normal] = await Promise.all([load(m.map, true), m.rough ? load(m.rough, false).catch(() => null) : Promise.resolve(null), m.normal ? load(m.normal, false).catch(() => null) : Promise.resolve(null)]);
    return { map, rough, normal } as LoadedTexture;
  }).catch(() => null).then((t) => {
    if (p !== provider) return;
    pending.delete(id); loaded.set(id, t);
    for (const l of listeners) l();
  });
  return null;
}
