// The three reference planes and the origin, drawn for an empty part and when a plane is chosen in the tree.
// Front is XY, Top is XZ, Right is ZY (the kernel's standard planes); each is a faint quad with an outline and a label.
import * as THREE from 'three';

export type RefPlaneId = 'front' | 'top' | 'right';
export const REF_PLANES: RefPlaneId[] = ['front', 'top', 'right'];

/** Rotation that turns the XY quad into each standard plane. */
const ROT: Record<RefPlaneId, [number, number, number]> = { front: [0, 0, 0], top: [-Math.PI / 2, 0, 0], right: [0, Math.PI / 2, 0] };

const BASE = 0x6f7f99;
const HOT = 0xe0801a;

function labelSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.font = '600 30px system-ui, sans-serif';
    g.fillStyle = color;
    g.textBaseline = 'middle';
    g.fillText(text, 6, 32);
  }
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.13, 0.0325, 1);          // fixed size on screen (the viewport rescales it when the field of view changes)
  s.userData.base = [0.13, 0.0325];
  s.center.set(0, 0.5);
  s.renderOrder = 10;
  return s;
}

/** One plane sheet outlined in screen pixels (the four corners, in order). */
export interface ScreenSheet { id: RefPlaneId; poly: Array<[number, number]> }

/** Pixel reach of a plane pick when the ray misses every sheet (an edge-on sheet, a point just outside one): a fingertip needs far more than a mouse. */
export const PLANE_PICK_TOL = { mouse: 8, touch: 28 } as const;

const segDist = (px: number, py: number, a: [number, number], b: [number, number]): number => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
};

/** The sheet whose outline lies closest to a screen point and within `tol` px of it (inside a sheet counts as distance 0; the earlier sheet wins a tie), else null.
 *  Pure: this is the generous fallback behind the exact ray test, so a thin or edge-on sheet can still be tapped. */
export function nearestSheet(sheets: readonly ScreenSheet[], x: number, y: number, tol: number): RefPlaneId | null {
  let best: RefPlaneId | null = null, bestD = Infinity;
  for (const s of sheets) {
    const n = s.poly.length;
    if (n < 2) continue;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = s.poly[i]!, [xj, yj] = s.poly[j]!;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    let d = inside ? 0 : Infinity;
    for (let i = 0; i < n && d > 0; i++) d = Math.min(d, segDist(x, y, s.poly[i]!, s.poly[(i + 1) % n]!));
    if (d <= tol && d < bestD) { best = s.id; bestD = d; }
  }
  return best;
}

interface Entry { id: RefPlaneId; group: THREE.Group; fill: THREE.Mesh; line: THREE.LineLoop; label: THREE.Sprite; labelText: string }

export class RefPlanes {
  readonly group = new THREE.Group();
  private entries: Entry[] = [];
  private origin = new THREE.Group();
  private size = 0;
  /** Plane-picking mode: the sheets are drawn stronger (a sketch is being started). */
  emphasis = false;

  constructor() {
    this.group.userData.pickable = false;
    this.group.visible = false;
  }

  private build(size: number, labels: Record<RefPlaneId, string>): void {
    this.dispose();
    this.size = size;
    const h = size / 2;
    for (const id of REF_PLANES) {
      const g = new THREE.Group();
      const [rx, ry, rz] = ROT[id];
      g.rotation.set(rx, ry, rz);
      const fill = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ color: BASE, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
      );
      fill.userData.refPlane = id;
      fill.renderOrder = 1;
      const pts = [new THREE.Vector3(-h, -h, 0), new THREE.Vector3(h, -h, 0), new THREE.Vector3(h, h, 0), new THREE.Vector3(-h, h, 0)];
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: BASE, transparent: true, opacity: 0.6 }));
      line.userData.pickable = false;
      const label = labelSprite(labels[id], '#b45f06');
      label.position.set(h, h, 0);
      label.visible = false;
      g.add(fill, line, label);
      this.group.add(g);
      this.entries.push({ id, group: g, fill, line, label, labelText: labels[id] });
    }
    // the origin: three short axes and a dot
    const len = size * 0.18;
    const axis = (to: [number, number, number], color: number) => {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(...to)]), new THREE.LineBasicMaterial({ color }));
      l.userData.pickable = false;
      return l;
    };
    this.origin.add(axis([len, 0, 0], 0xd1242f), axis([0, len, 0], 0x2da44e), axis([0, 0, len], 0x1f6feb));
    this.group.add(this.origin);
  }

  /** Show the listed planes (faint), the highlighted one in orange with its label. Rebuilds when the size or the label texts change. */
  set(size: number, show: RefPlaneId[], highlight: RefPlaneId | null, labels: Record<RefPlaneId, string>): void {
    const stale = !this.entries.length || Math.abs(size - this.size) > this.size * 0.01 || this.entries.some((e) => e.labelText !== labels[e.id]);
    if (stale) this.build(size, labels);
    const any = show.length > 0 || highlight !== null;
    this.group.visible = any;
    for (const e of this.entries) {
      const on = show.includes(e.id) || e.id === highlight;
      const hot = e.id === highlight;
      e.group.visible = on;
      (e.fill.material as THREE.MeshBasicMaterial).color.setHex(hot ? HOT : BASE);
      (e.fill.material as THREE.MeshBasicMaterial).opacity = hot ? (this.emphasis ? 0.32 : 0.22) : this.emphasis ? 0.14 : 0.07;
      (e.line.material as THREE.LineBasicMaterial).color.setHex(hot ? HOT : BASE);
      (e.line.material as THREE.LineBasicMaterial).opacity = hot || this.emphasis ? 0.95 : 0.6;
      e.label.visible = hot || (show.includes(e.id) && highlight === null);
    }
    this.origin.visible = any;
  }

  /** The planes under a ray, nearest first (only visible ones). */
  pick(raycaster: THREE.Raycaster): RefPlaneId | null {
    if (!this.group.visible) return null;
    const meshes = this.entries.filter((e) => e.group.visible).map((e) => e.fill);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    return (hit?.object.userData.refPlane as RefPlaneId | undefined) ?? null;
  }

  /** The visible sheets as screen outlines; `project` maps a world point to client pixels. */
  screenSheets(project: (v: THREE.Vector3) => [number, number]): ScreenSheet[] {
    if (!this.group.visible || !this.size) return [];
    const h = this.size / 2;
    return this.entries.filter((e) => e.group.visible).map((e) => {
      e.group.updateWorldMatrix(true, false);
      const poly = ([[-h, -h], [h, -h], [h, h], [-h, h]] as const).map(([x, y]) => project(new THREE.Vector3(x, y, 0).applyMatrix4(e.group.matrixWorld)));
      return { id: e.id, poly };
    });
  }

  /** The plane under a ray, else (plane-picking mode only) the one whose outline is within `tol` px of the point. */
  pickNear(project: (v: THREE.Vector3) => [number, number], x: number, y: number, tol: number): RefPlaneId | null {
    return nearestSheet(this.screenSheets(project), x, y, tol);
  }

  dispose(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
      });
    }
    this.entries = [];
    this.origin = new THREE.Group();
  }
}
