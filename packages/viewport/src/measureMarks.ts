// Measurement leaders drawn in the 3D view: a line between two points with a dot at each end and the value in a label
// (the same label sprites as the overall-size dimensions).
import * as THREE from 'three';
import { label } from './dimensions';

export interface MeasureMark { a: number[]; b: number[]; text: string }

export function buildMeasureMarks(marks: MeasureMark[], diag: number): THREE.Group | null {
  if (!marks.length) return null;
  const group = new THREE.Group();
  group.userData.pickable = false;
  const lineMat = new THREE.LineBasicMaterial({ color: 0xd1242f, depthTest: false, transparent: true });
  const dotGeo = new THREE.SphereGeometry(Math.max(diag, 1) * 0.008, 10, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xd1242f, depthTest: false });
  for (const m of marks) {
    const a = new THREE.Vector3(...(m.a as [number, number, number])), b = new THREE.Vector3(...(m.b as [number, number, number]));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), lineMat);
    line.renderOrder = 13; line.userData.pickable = false;
    group.add(line);
    for (const p of [a, b]) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      d.position.copy(p); d.renderOrder = 13; d.userData.pickable = false;
      group.add(d);
    }
    const s = label(m.text);
    s.position.copy(a).add(b).multiplyScalar(0.5);
    group.add(s);
  }
  return group;
}
