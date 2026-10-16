// Binary exporters that need no kernel: glb from a triangle mesh (positions + flat normals).
export function meshToGlb(positions: ArrayLike<number>, name = 'part'): Uint8Array {
  const nTri = Math.floor(positions.length / 9);
  const n = nTri * 3;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < nTri; t++) {
    const o = t * 9;
    const ux = positions[o + 3] - positions[o], uy = positions[o + 4] - positions[o + 1], uz = positions[o + 5] - positions[o + 2];
    const vx = positions[o + 6] - positions[o], vy = positions[o + 7] - positions[o + 1], vz = positions[o + 8] - positions[o + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 3; k++) {
      for (let c = 0; c < 3; c++) {
        const x = positions[o + k * 3 + c];
        pos[(t * 3 + k) * 3 + c] = x;
        if (x < min[c]) min[c] = x;
        if (x > max[c]) max[c] = x;
      }
      nor.set([nx, ny, nz], (t * 3 + k) * 3);
    }
  }
  const bin = new Uint8Array(pos.byteLength + nor.byteLength);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(nor.buffer), pos.byteLength);
  const json = {
    asset: { version: '2.0', generator: 'ck-cad' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, mode: 4 }] }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 }, { buffer: 0, byteOffset: pos.byteLength, byteLength: nor.byteLength, target: 34962 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: 'VEC3', min: nTri ? min : [0, 0, 0], max: nTri ? max : [0, 0, 0] },
      { bufferView: 1, componentType: 5126, count: n, type: 'VEC3' },
    ],
  };
  let js = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (js.length % 4)) % 4;
  if (jpad) { const p = new Uint8Array(js.length + jpad).fill(0x20); p.set(js); js = p; }
  const bpad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + js.length + 8 + bin.length + bpad;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
  const bo = 20 + js.length;
  dv.setUint32(bo, bin.length + bpad, true); dv.setUint32(bo + 4, 0x004e4942, true); out.set(bin, bo + 8);
  return out;
}
