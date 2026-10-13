import * as THREE from 'three';
import { groupByFace, edgeSegments, pickFace, BodyMesh, Grouped } from './meshgeom';

export interface ViewportOptions { onPick(names: string[], additive: boolean, mode: 'face' | 'edge'): void; onHover(name: string | null): void; }

export class Viewport {
  private renderer!: THREE.WebGLRenderer;
  private camera!: THREE.PerspectiveCamera;
  private scene!: THREE.Scene;
  private controls!: THREE.OrbitControls;
  private host!: HTMLElement;
  private animId!: number;
  private dirty = false;

  constructor(host: HTMLElement, opts: ViewportOptions) {
    this.host = host;
    this.initThree();
    self.addEventListener('pointerup', (ev: PointerEvent) => this.handlePointerUp(ev), { passive: false });
    self.addEventListener('pointermove', (ev: PointerEvent) => this.handlePointerMove(ev), { passive: false });
  }

  private initThree(): void {
    this.scene = new THREE.Scene();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.host.clientWidth, this.host.clientHeight);
    this.host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(60, this.host.clientWidth / Math.max(1, this.host.clientHeight), 0.1, 1000);
    this.camera.position.z = 10;

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    const hem = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(5, 5, 5);
    this.scene.add(hem, dir);

    this.scene.background = new THREE.Color('rgb(184, 196, 214)');

    window.addEventListener('resize', () => this.onResize(), false);
  }

  private onResize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.dirty = true;
  }

  setBody(body: { mesh: BodyMesh; edges: Array<{ pts: number[] }> } | null): void {
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
        this.scene.remove(obj);
      }
    });

    if (!body) {
      this.dirty = true;
      this.render();
      return;
    }

    const g = groupByFace(body.mesh);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0xb8c4d6, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide });
    const highlightMat = new THREE.MeshStandardMaterial({ color: 0xffa500, metalness: 0.5, roughness: 0.2, emissive: 0xffa500, emissiveIntensity: 0.3, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));

    const baseMesh = new THREE.Mesh(geo, baseMat);
    this.scene.add(baseMesh);

    const edgeData = edgeSegments(body.edges);
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgeData, 3));
    const edgeMesh = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0x202020 }));
    this.scene.add(edgeMesh);

    this.controls.target.set(0, 0, 0);
    this.dirty = true;
    this.render();
  }

  setHighlight(names: string[]): void {
    this.scene.traverse((obj) => {
      if (obj.userData?.isHighlight) {
        this.scene.remove(obj);
      }
    });

    if (names.length > 0) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ emissive: 0xffa500, emissiveIntensity: 0.3 }));
      hl.userData.isHighlight = true;
      this.scene.add(hl);
    }

    this.dirty = true;
    this.render();
  }

  setView(v: 'iso' | 'front' | 'top' | 'right'): void {
    switch (v) {
      case 'iso': this.camera.position.set(5, 5, 5); break;
      case 'front': this.camera.position.set(0, 0, 10); break;
      case 'top': this.camera.position.set(0, 10, 0); break;
      case 'right': this.camera.position.set(10, 0, 0); break;
    }
    this.controls.target.set(0, 0, 0);
    this.dirty = true;
    this.render();
  }

  fit(): void {
    this.controls.reset();
    this.dirty = true;
    this.render();
  }

  resize(): void {
    this.onResize();
  }

  dispose(): void {
    window.removeEventListener('resize', () => this.onResize(), false);
    self.removeEventListener('pointerup', (ev: PointerEvent) => this.handlePointerUp(ev), { passive: false });
    self.removeEventListener('pointermove', (ev: PointerEvent) => this.handlePointerMove(ev), { passive: false });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    if (this.animId) cancelAnimationFrame(this.animId);
  }

  render = (): void => {
    if (this.dirty) {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
    this.animId = requestAnimationFrame(this.render);
  };
}