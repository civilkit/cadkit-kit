// A picture lying on the sketch plane to trace: where its corners go in the world. Pure (no WebGL), so the placement can be tested; the viewport draws
// the textured plane (viewport.ts setSketchUnderlay). The picture sits on the plane of the sketch, its centre at (x, y) in sketch coordinates, turned
// by `rot` degrees counter-clockwise about the plane's normal, `w` mm wide and as high as its pixels say.
export interface UnderlayFrame { o: number[]; x: number[]; y: number[]; z: number[] }
export interface UnderlayShape {
  frame: UnderlayFrame;
  /** the picture as a data URL (a new URL makes a new texture) */
  url: string;
  /** the picture's pixels: only the proportion matters */
  pxW: number;
  pxH: number;
  /** width in mm; the height follows from the pixels */
  w: number;
  x: number;
  y: number;
  /** degrees, counter-clockwise seen from the plane's normal */
  rot: number;
  opacity: number;
}

const add = (a: number[], b: number[], k = 1): number[] => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const scale = (a: number[], k: number): number[] => [a[0] * k, a[1] * k, a[2] * k];

/** Height in mm of a picture `w` mm wide. */
export const underlayHeight = (pxW: number, pxH: number, w: number): number => (pxW > 0 ? (w * pxH) / pxW : w);

/** The world position of the centre, and the world directions of the picture's own right (u), up (v) and normal, for the plane's frame. */
export function underlayPlacement(s: UnderlayShape): { centre: number[]; right: number[]; up: number[]; normal: number[]; width: number; height: number } {
  const a = (s.rot * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  const right = add(scale(s.frame.x, c), s.frame.y, sn);
  const up = add(scale(s.frame.y, c), s.frame.x, -sn);
  const centre = add(add(s.frame.o, s.frame.x, s.x), s.frame.y, s.y);
  return { centre, right, up, normal: s.frame.z, width: s.w, height: underlayHeight(s.pxW, s.pxH, s.w) };
}

/** The four corners in the world, counter-clockwise from the lower left (for tests and for a bounding box). */
export function underlayCorners(s: UnderlayShape): number[][] {
  const p = underlayPlacement(s);
  const hx = p.width / 2, hy = p.height / 2;
  return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([u, v]) => add(add(p.centre, p.right, u), p.up, v));
}
