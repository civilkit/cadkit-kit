// Overall size of the body drawn in the 3D view: three dimension lines (length, height, depth) with end ticks and labels.
import * as THREE from 'three';

export interface Box { min: number[]; max: number[] }

/** "30", "12.5", "0.25": at most 2 decimals, no trailing zeros. */
export function formatLength(v: number): string {
  const s = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

export function label(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = '600 28px system-ui, sans-serif';
  c.width = 220; c.height = 56;
  if (g) {
    g.font = font;
    const w = Math.min(c.width - 4, g.measureText(text).width + 28);
    const x = (c.width - w) / 2;
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.strokeStyle = '#1f6feb';
    g.lineWidth = 2.5;
    g.beginPath();
    g.roundRect?.(x, 6, w, 44, 12);
    g.fill(); g.stroke();
    g.fillStyle = '#143a7a';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, c.width / 2, 29);
  }
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, sizeAttenuation: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.11, 0.028, 1);   // fixed size on screen (the viewport rescales it when the field of view changes)
  s.userData.base = [0.11, 0.028];
  s.renderOrder = 12;
  return s;
}

/** The three overall dimensions of a box, offset from it so they do not sit on the part. Null for a degenerate box. */
export function buildBoxDimensions(box: Box): THREE.Group | null {
  const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max;
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const diag = Math.hypot(dx, dy, dz);
  if (!(diag > 1e-6)) return null;
  const off = diag * 0.07, tick = diag * 0.025;
  const group = new THREE.Group();
  group.userData.pickable = false;
  const mat = new THREE.LineBasicMaterial({ color: 0x1f6feb, depthTest: false, transparent: true });
  const seg = (a: number[], b: number[]) => {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...(a as [number, number, number])), new THREE.Vector3(...(b as [number, number, number]))]), mat);
    l.renderOrder = 11; l.userData.pickable = false;
    group.add(l);
  };
  const dim = (a: number[], b: number[], tickDir: number[], len: number) => {
    seg(a, b);
    for (const p of [a, b]) seg([p[0] - tickDir[0] * tick, p[1] - tickDir[1] * tick, p[2] - tickDir[2] * tick], [p[0] + tickDir[0] * tick, p[1] + tickDir[1] * tick, p[2] + tickDir[2] * tick]);
    const s = label(formatLength(len));
    s.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    group.add(s);
  };
  // length along X: in front of the part (+Z side), at the bottom
  if (dx > 1e-9) dim([x0, y0, z1 + off], [x1, y0, z1 + off], [0, 1, 0], dx);
  // height along Y: beside the front-right corner
  if (dy > 1e-9) dim([x1 + off, y0, z1 + off], [x1 + off, y1, z1 + off], [1, 0, 0], dy);
  // depth along Z: along the right side, at the bottom
  if (dz > 1e-9) dim([x1 + off, y0, z0], [x1 + off, y0, z1], [0, 1, 0], dz);
  return group;
}
