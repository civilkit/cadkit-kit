// Test fixture shared by the io tests (not exported from the package).
/** A unit cube as 12 outward-facing counter-clockwise triangles (36 vertices, xyz). */
export function cube(s = 1): Float32Array {
  const v = (x: number, y: number, z: number) => [x * s, y * s, z * s];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d];
  return Float32Array.from([
    ...quad(v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)), // -z
    ...quad(v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)), // +z
    ...quad(v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)), // -y
    ...quad(v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)), // +y
    ...quad(v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)), // -x
    ...quad(v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)), // +x
  ]);
}


/** A closed cylinder (axis Z, from z = 0 to `h`) of `n` side facets, outward counter-clockwise. */
export function cylinder(r = 5, h = 10, n = 32): Float32Array {
  const out: number[] = [];
  const pt = (i: number, z: number) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n), z];
  for (let i = 0; i < n; i++) {
    const a = pt(i, 0), b = pt(i + 1, 0), c = pt(i + 1, h), d = pt(i, h);
    out.push(...a, ...b, ...c, ...a, ...c, ...d);   // side
    out.push(0, 0, 0, ...b, ...a);                  // bottom, faces down
    out.push(0, 0, h, ...d, ...c);                  // top, faces up
  }
  return Float32Array.from(out);
}

/** A head-like closed surface: an ellipsoid (70 x 90 x 100 mm half axes) with a nose, brow, chin and two ears pushed out of it,
 *  `nLat` rings of `nLon` quads (about 2 x nLat x nLon triangles), outward counter-clockwise, as a triangle soup. Synthetic, so tests
 *  and demos need no scan. Z is up, the face looks along +Y. */
export function headLike(nLat = 224, nLon = 224): Float32Array {
  const bump = (x: number, y: number, z: number, cx: number, cy: number, cz: number, s: number, h: number) => h * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) / (2 * s * s));
  const vert = (i: number, j: number): [number, number, number] => {
    const th = (Math.PI * i) / nLat, ph = (2 * Math.PI * (j % nLon)) / nLon;
    const pole = i === 0 || i === nLat;   // exact poles, so the fan shares one vertex bit for bit
    const ux = pole ? 0 : Math.sin(th) * Math.cos(ph), uy = pole ? 0 : Math.sin(th) * Math.sin(ph), uz = pole ? (i === 0 ? 1 : -1) : Math.cos(th);
    const x = 70 * ux, y = 90 * uy, z = 100 * uz;
    const grow = 1 + (bump(x, y, z, 0, 90, -10, 14, 0.30) + bump(x, y, z, 0, 80, 45, 22, 0.08) + bump(x, y, z, 0, 75, -70, 18, 0.10)
      + bump(x, y, z, 70, 0, 0, 14, 0.18) + bump(x, y, z, -70, 0, 0, 14, 0.18));
    return [x * grow, y * grow, z * grow];
  };
  const out: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => { for (const q of [a, b, c]) { out.push(q[0], q[1], q[2]); } };
  const rows: Array<Array<[number, number, number]>> = [];
  for (let i = 0; i <= nLat; i++) { const r: Array<[number, number, number]> = []; for (let j = 0; j <= nLon; j++) r.push(vert(i, j)); rows.push(r); }
  for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) {
    const v00 = rows[i][j], v01 = rows[i][j + 1], v10 = rows[i + 1][j], v11 = rows[i + 1][j + 1];
    if (i > 0) tri(v00, v10, v01);
    if (i < nLat - 1) tri(v10, v11, v01);
  }
  return Float32Array.from(out);
}

/** Signed volume of an indexed mesh (counter-clockwise outward is positive). */
export function volumeOf(v: Float32Array, idx: Uint32Array): number {
  let s = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    s += (v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c])) / 6;
  }
  return s;
}
