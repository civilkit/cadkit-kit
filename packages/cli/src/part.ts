// Part loading, WASM discovery, and mesh-body extraction for the headless CLI.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PartDoc } from '@ck/part-model';
import type { MeshBody } from '@kit/io';
import { bodyKey, bodyOrigin, lumps } from '@kit/snapshot';

/** Locate ck_wasm.wasm: explicit `--wasm`, `CK_WASM`, beside the bundled CLI, or in the repo checkout. */
export function resolveWasmPath(explicit?: string, env: Record<string, string | undefined> = process.env): string | undefined {
  if (explicit) return resolve(explicit);
  if (env.CK_WASM) return resolve(env.CK_WASM);
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, 'ck_wasm.wasm'),
    resolve(here, '../../../apps/cad/public/kernel/ck_wasm.wasm'),
    resolve(here, '../../../../rebuild/target/wasm32-unknown-unknown/release/ck_wasm.wasm'),
  ];
  return candidates.find((p) => existsSync(p));
}

/** Read and structurally validate a `.ckpart` JSON file from disk. */
export function loadPartFile(filePath: string): PartDoc {
  const abs = resolve(filePath);
  if (!existsSync(abs)) {
    throw new Error(`file not found: ${filePath}`);
  }
  const raw = readFileSync(abs, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`invalid JSON in ${filePath}: ${String((e as Error)?.message ?? e)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`invalid .ckpart document in ${filePath}: expected a JSON object`);
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.features)) {
    throw new Error(`invalid .ckpart document in ${filePath}: missing "features" array`);
  }
  const fallbackName = basename(abs, extname(abs)) || 'Part';
  if (typeof obj.name !== 'string' || !obj.name.trim()) {
    obj.name = fallbackName;
  }
  return obj as unknown as PartDoc;
}

export interface MeshLike {
  positions: ArrayLike<number>;
  normals?: ArrayLike<number>;
  triFace: ArrayLike<number>;
  faceIds: string[];
}

export interface EdgeLike {
  key?: string;
}

interface DocAppearanceShape {
  name?: string;
  features?: Array<Record<string, unknown>>;
  appearance?: Record<string, { color?: string; colour?: string; opacity?: number; metallic?: number; roughness?: number }>;
  bodyNames?: Record<string, string>;
}

const featureNum = (id: string): number => {
  const m = /^F(\d+)/.exec(id);
  return m ? Number(m[1]) : Infinity;
};

/**
 * Partition a tessellated kernel mesh into per-body `MeshBody[]` using edge connectivity (`@kit/snapshot` `lumps`)
 * and document names/appearances. Falls back to a single body when face/edge connectivity is absent.
 */
export function extractMeshBodies(
  mesh: MeshLike,
  edges: readonly EdgeLike[],
  doc: PartDoc,
): MeshBody[] {
  const totalTris = Math.floor(mesh.positions.length / 9);
  if (totalTris === 0) return [];

  const d = doc as unknown as DocAppearanceShape;
  const partName = d.name?.trim() || 'Part';
  const hasNormals = !!mesh.normals && mesh.normals.length >= totalTris * 9;

  if (!mesh.faceIds.length) {
    return [{
      name: partName,
      positions: mesh.positions,
      ...(hasNormals ? { normals: mesh.normals } : {}),
    }];
  }

  const faceGroups = lumps(mesh.faceIds, edges as unknown as Parameters<typeof lumps>[1]);
  if (!faceGroups.length) {
    return [{
      name: partName,
      positions: mesh.positions,
      ...(hasNormals ? { normals: mesh.normals } : {}),
    }];
  }

  const rows = faceGroups.map((faces) => ({
    faces,
    key: bodyKey(faces),
    origin: bodyOrigin(faces),
  }));
  rows.sort(
    (a, b) =>
      (a.origin ? featureNum(a.origin) : Infinity) - (b.origin ? featureNum(b.origin) : Infinity) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );

  // Map each faceId to its body index.
  const faceToBody = new Map<string, number>();
  rows.forEach((r, bi) => {
    for (const f of r.faces) faceToBody.set(f, bi);
  });

  // Bucket triangles per body.
  const posBuckets: number[][] = rows.map(() => []);
  const norBuckets: number[][] = rows.map(() => []);
  for (let t = 0; t < totalTris; t++) {
    const fi = mesh.triFace[t];
    const fid = mesh.faceIds[fi];
    const bi = fid !== undefined ? (faceToBody.get(fid) ?? 0) : 0;
    const o = t * 9;
    const pb = posBuckets[bi];
    for (let k = 0; k < 9; k++) pb.push(mesh.positions[o + k]);
    if (hasNormals && mesh.normals) {
      const nb = norBuckets[bi];
      for (let k = 0; k < 9; k++) nb.push(mesh.normals[o + k]);
    }
  }

  const feats = new Map((d.features ?? []).map((f) => [String(f.id), f]));
  const bodyNames = d.bodyNames ?? {};
  const appearance = d.appearance ?? {};
  const perOrigin = new Map<string, number>();
  for (const r of rows) if (r.origin) perOrigin.set(r.origin, (perOrigin.get(r.origin) ?? 0) + 1);
  const seenOrigin = new Map<string, number>();

  const out: MeshBody[] = [];
  rows.forEach((r, i) => {
    if (posBuckets[i].length < 9) return;
    const f = r.origin ? feats.get(r.origin) : undefined;
    const featLabel =
      (typeof f?.body === 'string' && f.body.trim()) ||
      (typeof f?.name === 'string' && f.name.trim()) ||
      '';
    let name = bodyNames[r.key]?.trim() || '';
    if (!name && r.origin) {
      const base = bodyNames[r.origin]?.trim() || featLabel;
      if (base) {
        const k = (seenOrigin.get(r.origin) ?? 0) + 1;
        seenOrigin.set(r.origin, k);
        name = (perOrigin.get(r.origin) ?? 1) > 1 ? `${base} ${k}` : base;
      }
    }
    if (!name) name = rows.length === 1 ? partName : `Body ${i + 1}`;

    const look = { ...(r.origin ? appearance[r.origin] : {}), ...appearance[r.key] };
    const color = look.color ?? look.colour;
    out.push({
      name,
      positions: Float32Array.from(posBuckets[i]),
      ...(hasNormals ? { normals: Float32Array.from(norBuckets[i]) } : {}),
      ...(typeof color === 'string' ? { color } : {}),
      ...(typeof look.opacity === 'number' ? { opacity: look.opacity } : {}),
      ...(typeof look.metallic === 'number' ? { metallic: look.metallic } : {}),
      ...(typeof look.roughness === 'number' ? { roughness: look.roughness } : {}),
    });
  });

  return out;
}
