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

