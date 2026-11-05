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
