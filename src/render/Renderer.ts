import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { Terrain, type Building, type Truck, type WorldState } from '../sim/types';

/** Low-poly palette (cozy, saturated). */
const C = {
  grass: [0x8cc66b, 0x84bf63, 0x93cc72, 0x7fb95e],
  water: 0x4fa3d9,
  riverbed: 0x3f8fc4,
  road: 0x5d5a63,
  bridge: 0xa0714a,
  trunk: 0x7a5236,
  leaves: [0x4f9a45, 0x5aa84c, 0x3f8a3d],
  paddy: [0xb7d65a, 0xc9db5f, 0xa8cf54],
  hut: 0xe9d3a5,
  thatch: 0xc49a5a,
  roofs: [0xd9583b, 0xe07a3f, 0x4a7fb5, 0x3e9b7e, 0xc94f6d, 0xe0a83d],
  walls: [0xf4ead5, 0xf6dfc7, 0xe8efe1, 0xf3e3b5],
  mill: 0xd8d3c8,
  millRoof: 0x8a5a44,
  silo: 0xc7c2b8,
  marketRoof: 0xe0573d,
  awning: [0xf2b134, 0xffffff],
  orchardTree: 0xf29f3d,
  hover: 0xffffff,
  ghostOk: 0x7fd3ff,
  ghostBad: 0xff6b6b,
  selection: 0xffe066,
};

const TILE_H = 0.2;

function mat(color: number) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95, metalness: 0 });
}

/** Renders the world. Reads WorldState; never mutates it. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: MapControls;

  private world: WorldState;
  private roadMesh!: THREE.InstancedMesh;
  private roadVersionDrawn = -1;
  private treeTrunks!: THREE.InstancedMesh;
  private treeLeaves!: THREE.InstancedMesh;
  private treeVersionKey = '';
  private trucks = new Map<number, THREE.Group>();
  private hoverMesh: THREE.Mesh;
  private ghostMesh: THREE.InstancedMesh;
  private selectionMesh: THREE.Mesh;
  private ground: THREE.Plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TILE_H);
  private raycaster = new THREE.Raycaster();
  private keys = new Set<string>();
  private lastFrame = performance.now();

  constructor(private container: HTMLElement, world: WorldState) {
    this.world = world;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xbfe3f2);
    this.scene.fog = new THREE.Fog(0xbfe3f2, 70, 140);

    const cx = world.width / 2;
    const cz = world.height / 2;
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 400);
    this.camera.position.set(cx, 34, cz + 30);

    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.target.set(cx, 0, cz);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 90;
    this.controls.maxPolarAngle = Math.PI * 0.42;
    this.controls.screenSpacePanning = false;
    // Left button is reserved for game tools.
    this.controls.mouseButtons = {
      LEFT: -1 as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.update();

    this.setupLights();
    this.buildTerrain();
    this.buildBuildings();
    this.buildTrees();

    this.hoverMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.04, 1),
      new THREE.MeshBasicMaterial({ color: C.hover, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.hoverMesh.visible = false;
    this.scene.add(this.hoverMesh);

    this.ghostMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.96, 0.06, 0.96),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
      world.width * 4,
    );
    this.ghostMesh.count = 0;
    this.ghostMesh.frustumCulled = false;
    this.scene.add(this.ghostMesh);

    this.selectionMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.05, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: C.selection, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.selectionMesh.visible = false;
    this.scene.add(this.selectionMesh);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    this.keys.add(e.key.toLowerCase());
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private onBlur = () => this.keys.clear();

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- picking ----------

  /** Tile under a screen point (client coords), or null if off-map. */
  pickTile(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, hit)) return null;
    const x = Math.floor(hit.x);
    const y = Math.floor(hit.z);
    if (x < 0 || y < 0 || x >= this.world.width || y >= this.world.height) return null;
    return { x, y };
  }

  /** Truck closest to a screen point within a small radius. */
  pickTruck(clientX: number, clientY: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    let best: number | null = null;
    let bestD = 28;
    const v = new THREE.Vector3();
    for (const [id, g] of this.trucks) {
      v.copy(g.position).project(this.camera);
      const sx = ((v.x + 1) / 2) * rect.width + rect.left;
      const sy = ((1 - v.y) / 2) * rect.height + rect.top;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  /** Projects a world point (tile units) to container pixels. */
  project(x: number, y: number, height = 1.6): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, height, y).project(this.camera);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, visible: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 };
  }

  setHover(tile: { x: number; y: number } | null) {
    this.hoverMesh.visible = !!tile;
    if (tile) this.hoverMesh.position.set(tile.x + 0.5, TILE_H + 0.03, tile.y + 0.5);
  }

  setGhost(tiles: number[], ok: boolean) {
    const m = new THREE.Matrix4();
    const n = Math.min(tiles.length, this.ghostMesh.instanceMatrix.count);
    for (let k = 0; k < n; k++) {
      const i = tiles[k];
      const x = i % this.world.width;
      const y = Math.floor(i / this.world.width);
      m.makeTranslation(x + 0.5, TILE_H + 0.06, y + 0.5);
      this.ghostMesh.setMatrixAt(k, m);
    }
    this.ghostMesh.count = n;
    this.ghostMesh.instanceMatrix.needsUpdate = true;
    (this.ghostMesh.material as THREE.MeshBasicMaterial).color.setHex(ok ? C.ghostOk : C.ghostBad);
  }

  setSelection(target: { x: number; y: number; r: number } | null) {
    this.selectionMesh.visible = !!target;
    if (target) {
      this.selectionMesh.position.set(target.x, TILE_H + 0.05, target.y);
      this.selectionMesh.scale.setScalar(target.r);
    }
  }

  // ---------- per-frame ----------

  render() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.panWithKeys(dt);
    this.controls.update();

    if (this.roadVersionDrawn !== this.world.roadVersion) this.buildRoads();
    this.syncTrees();
    this.syncTrucks();
    const t = now / 1000;
    this.selectionMesh.rotation.y = t;
    this.renderer.render(this.scene, this.camera);
  }

  private panWithKeys(dt: number) {
    let dx = 0;
    let dz = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) dz -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dz += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    if (!dx && !dz) return;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    const speed = this.camera.position.distanceTo(this.controls.target) * 0.9 * dt;
    const move = forward.multiplyScalar(-dz * speed).add(right.multiplyScalar(dx * speed));
    this.camera.position.add(move);
    this.controls.target.add(move);
  }

  // ---------- scene construction ----------

  private setupLights() {
    const hemi = new THREE.HemisphereLight(0xfff6e0, 0x6a8f5a, 1.4);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    const cx = this.world.width / 2;
    const cz = this.world.height / 2;
    sun.position.set(cx - 25, 40, cz - 15);
    sun.target.position.set(cx, 0, cz);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const s = this.world.width * 0.75;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 140 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);
  }

  private buildTerrain() {
    const w = this.world;
    const n = w.width * w.height;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geo, mat(0xffffff), n);
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = i % w.width;
      const y = Math.floor(i / w.width);
      const water = w.terrain[i] === Terrain.Water;
      const h = water ? 0.05 : TILE_H;
      m.makeScale(1, h, 1).setPosition(x + 0.5, h / 2, y + 0.5);
      mesh.setMatrixAt(i, m);
      const hash = (x * 73856093) ^ (y * 19349663);
      color.setHex(water ? C.riverbed : C.grass[Math.abs(hash) % C.grass.length]);
      mesh.setColorAt(i, color);
    }
    this.scene.add(mesh);

    // Water surface
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(w.width, w.height).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: C.water, transparent: true, opacity: 0.85, roughness: 0.3 }),
    );
    water.position.set(w.width / 2, 0.13, w.height / 2);
    this.scene.add(water);

    // Base under the map, so edges look like a diorama.
    const base = new THREE.Mesh(new THREE.BoxGeometry(w.width + 0.6, 1.2, w.height + 0.6), mat(0x8a6a4a));
    base.position.set(w.width / 2, -0.6, w.height / 2);
    base.receiveShadow = true;
    this.scene.add(base);
  }

  private buildRoads() {
    const w = this.world;
    if (this.roadMesh) {
      this.scene.remove(this.roadMesh);
      this.roadMesh.dispose();
    }
    let count = 0;
    for (let i = 0; i < w.road.length; i++) if (w.road[i]) count++;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.08, 1), mat(0xffffff), Math.max(1, count));
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    let k = 0;
    for (let i = 0; i < w.road.length; i++) {
      if (!w.road[i]) continue;
      const x = i % w.width;
      const y = Math.floor(i / w.width);
      const water = w.terrain[i] === Terrain.Water;
      m.makeTranslation(x + 0.5, (water ? 0.32 : TILE_H) + 0.04, y + 0.5);
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, color.setHex(water ? C.bridge : C.road));
      k++;
    }
    mesh.count = count;
    this.roadMesh = mesh;
    this.scene.add(mesh);
    this.roadVersionDrawn = w.roadVersion;
  }

  private buildTrees() {
    const w = this.world;
    const max = w.width * w.height;
    this.treeTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 0.4, 5), mat(C.trunk), max);
    this.treeLeaves = new THREE.InstancedMesh(new THREE.ConeGeometry(0.34, 0.8, 6), mat(0xffffff), max);
    this.treeTrunks.castShadow = this.treeLeaves.castShadow = true;
    this.scene.add(this.treeTrunks, this.treeLeaves);
    this.syncTrees(true);
  }

  private syncTrees(force = false) {
    const w = this.world;
    // Trees only disappear when road is built, so the road version is a good change key.
    const key = String(w.roadVersion);
    if (!force && key === this.treeVersionKey) return;
    this.treeVersionKey = key;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const color = new THREE.Color();
    let k = 0;
    for (let i = 0; i < w.tree.length; i++) {
      if (!w.tree[i]) continue;
      const x = i % w.width;
      const y = Math.floor(i / w.width);
      const r = ((x * 928371 + y * 123457) % 1000) / 1000;
      const ox = (r - 0.5) * 0.4;
      const oz = (((r * 7.31) % 1) - 0.5) * 0.4;
      const scale = 0.8 + r * 0.5;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * 6.28);
      s.set(scale, scale, scale);
      p.set(x + 0.5 + ox, TILE_H + 0.2 * scale, y + 0.5 + oz);
      this.treeTrunks.setMatrixAt(k, m.compose(p, q, s));
      p.y = TILE_H + 0.75 * scale;
      this.treeLeaves.setMatrixAt(k, m.compose(p, q, s));
      this.treeLeaves.setColorAt(k, color.setHex(C.leaves[Math.floor(r * 3) % 3]));
      k++;
    }
    this.treeTrunks.count = this.treeLeaves.count = k;
    this.treeTrunks.instanceMatrix.needsUpdate = true;
    this.treeLeaves.instanceMatrix.needsUpdate = true;
    if (this.treeLeaves.instanceColor) this.treeLeaves.instanceColor.needsUpdate = true;
  }

  private buildBuildings() {
    for (const b of this.world.buildings) {
      const g = makeBuilding(b);
      g.position.set(b.x + b.w / 2, TILE_H, b.y + b.h / 2);
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.scene.add(g);
    }
  }

  private syncTrucks() {
    const w = this.world;
    const alive = new Set<number>();
    for (const t of w.trucks) {
      alive.add(t.id);
      let g = this.trucks.get(t.id);
      if (!g) {
        g = makeTruck(t);
        this.trucks.set(t.id, g);
        this.scene.add(g);
      }
      // Smooth towards the sim position so 20Hz ticks look fluid at 60fps.
      // Drive on the right: offset perpendicular to heading so opposing trucks don't overlap.
      const lane = 0.17;
      const onBridge = w.terrain[w.width * Math.floor(t.y) + Math.floor(t.x)] === Terrain.Water;
      const target = new THREE.Vector3(
        t.x - Math.sin(t.heading) * lane,
        TILE_H + 0.04 + (onBridge ? 0.16 : 0),
        t.y + Math.cos(t.heading) * lane,
      );
      if (g.position.distanceToSquared(target) > 4) g.position.copy(target);
      else g.position.lerp(target, 0.35);
      const desired = -t.heading;
      let diff = desired - g.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      g.rotation.y += diff * 0.3;
      const cargoBox = g.getObjectByName('cargo');
      if (cargoBox) cargoBox.visible = t.load > 0;
    }
    for (const [id, g] of this.trucks) {
      if (!alive.has(id)) {
        this.scene.remove(g);
        this.trucks.delete(id);
      }
    }
  }
}

// ---------- low-poly models (built from primitives) ----------

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y + h / 2, z);
  return m;
}

function pyramidRoof(w: number, h: number, d: number, color: number, y: number) {
  const geo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4);
  const m = new THREE.Mesh(geo, mat(color));
  m.scale.set(w, h, d);
  m.position.y = y + h / 2;
  return m;
}

function gableRoof(w: number, h: number, d: number, color: number, y: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
  const m = new THREE.Mesh(geo, mat(color));
  m.position.y = y;
  return m;
}

function makeBuilding(b: Building): THREE.Group {
  const g = new THREE.Group();
  const v = b.variant;
  switch (b.kind) {
    case 'house': {
      const wall = C.walls[v % C.walls.length];
      const roof = C.roofs[v % C.roofs.length];
      const h = 0.35 + (v % 3) * 0.12;
      g.add(box(0.62, h, 0.62, wall));
      g.add(v % 2 ? pyramidRoof(0.78, 0.32, 0.78, roof, h) : gableRoof(0.78, 0.3, 0.72, roof, h));
      g.rotation.y = (v % 4) * (Math.PI / 2);
      break;
    }
    case 'farm': {
      // Paddy plots with a little hut.
      for (let i = 0; i < 4; i++) {
        const px = (i % 2) - 0.5;
        const pz = Math.floor(i / 2) - 0.5;
        g.add(box(0.9, 0.06, 0.9, C.paddy[(i + v) % C.paddy.length], px * 0.98, 0, pz * 0.98));
        for (let r = 0; r < 3; r++) g.add(box(0.8, 0.12, 0.08, 0x8fbf3f, px * 0.98, 0.04, pz * 0.98 - 0.28 + r * 0.28));
      }
      g.add(box(0.4, 0.3, 0.35, C.hut, 0.55, 0.06, -0.55));
      g.add(gableRoof(0.55, 0.25, 0.45, C.thatch, 0.36).translateX(0.55).translateZ(-0.55));
      break;
    }
    case 'orchard': {
      g.add(box(1.9, 0.04, 1.9, 0x9ccc6a));
      for (let i = 0; i < 9; i++) {
        const x = ((i % 3) - 1) * 0.6;
        const z = (Math.floor(i / 3) - 1) * 0.6;
        g.add(box(0.08, 0.25, 0.08, C.trunk, x, 0.04, z));
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), mat(0x4f9a45));
        crown.position.set(x, 0.45, z);
        g.add(crown);
        const fruit = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), mat(C.orchardTree));
        fruit.position.set(x + 0.15, 0.4, z + 0.12);
        g.add(fruit);
      }
      break;
    }
    case 'mill': {
      g.add(box(1.9, 0.05, 1.9, 0xb9b1a0));
      g.add(box(1.2, 0.7, 0.9, C.mill, -0.25, 0.05, 0.2));
      g.add(gableRoof(1.3, 0.4, 1.0, C.millRoof, 0.75).translateX(-0.25).translateZ(0.2));
      for (let i = 0; i < 2; i++) {
        const silo = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.1, 8), mat(C.silo));
        silo.position.set(0.6, 0.6, -0.5 + i * 0.5);
        g.add(silo);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.22, 8), mat(C.millRoof));
        cap.position.set(0.6, 1.26, -0.5 + i * 0.5);
        g.add(cap);
      }
      g.add(box(0.5, 0.25, 0.4, 0xf2c14e, -0.5, 0.05, -0.6)); // rice sacks
      break;
    }
    case 'market': {
      g.add(box(1.95, 0.05, 1.95, 0xd9c7a3));
      g.add(box(1.5, 0.45, 1.2, 0xf4ead5, 0, 0.05, 0.2));
      g.add(gableRoof(1.7, 0.5, 1.4, C.marketRoof, 0.5).translateZ(0.2));
      // Striped awning stalls in front
      for (let i = 0; i < 3; i++) {
        const x = -0.6 + i * 0.6;
        g.add(box(0.06, 0.4, 0.06, 0x7a5236, x - 0.2, 0.05, -0.75));
        g.add(box(0.06, 0.4, 0.06, 0x7a5236, x + 0.2, 0.05, -0.75));
        g.add(box(0.5, 0.06, 0.4, C.awning[i % 2], x, 0.45, -0.7));
        g.add(box(0.3, 0.12, 0.2, [0xf29f3d, 0x8cc66b, 0xe8574a][i], x, 0.05, -0.75));
      }
      break;
    }
  }
  return g;
}

function makeTruck(t: Truck): THREE.Group {
  const g = new THREE.Group();
  // Model faces +X; heading rotation is applied by the caller.
  const body = new THREE.Group();
  body.add(box(0.26, 0.2, 0.3, t.color, 0.17, 0.06, 0));
  body.add(box(0.08, 0.1, 0.26, 0x9fd4ff, 0.27, 0.16, 0)); // windscreen
  body.add(box(0.4, 0.06, 0.32, 0x333333, -0.1, 0.04, 0)); // chassis
  const cargo = box(0.38, 0.2, 0.3, 0xf2d48f, -0.12, 0.1, 0);
  cargo.name = 'cargo';
  body.add(cargo);
  for (const [x, z] of [
    [0.2, 0.16],
    [0.2, -0.16],
    [-0.18, 0.16],
    [-0.18, -0.16],
  ]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 8).rotateX(Math.PI / 2), mat(0x222222));
    wheel.position.set(x, 0.06, z);
    body.add(wheel);
  }
  body.scale.setScalar(1.6);
  body.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  g.add(body);
  return g;
}
