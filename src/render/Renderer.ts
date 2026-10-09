import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { HorizontalTiltShiftShader } from 'three/examples/jsm/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/examples/jsm/shaders/VerticalTiltShiftShader.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { Terrain, type Building, type CargoId, type Truck, type WorldState } from '../sim/types';
import { InstancedModel, KAYKIT_SCALE, type ModelName, type Models } from './assets';
import { PRODUCTION } from '../sim/config';

const PRODUCTION_CAP = PRODUCTION.stockCap;

/** Low-poly palette (cozy, saturated). */
const C = {
  grass: [0x88c46a, 0x84c066, 0x8cc86e],
  riverbed: 0x3b86b8,
  water: 0x5bb8e8,
  earth: 0x9a7350,
  earthDark: 0x7d5a3c,
  pillar: 0xb9b2a6,
  trunk: 0x8a5a3b,
  leaves: [0x5fae4a, 0x4f9f43, 0x6dbb52, 0x46934a],
  pine: [0x3f8a4a, 0x367d43],
  paddy: [0xb9d85c, 0xc7de63, 0xaad257],
  paddyWater: 0x8fc7c0,
  dyke: 0x9c7b52,
  hut: 0xefdcb1,
  thatch: 0xc9a05e,
  mill: 0xe9e3d6,
  millRoof: 0x9b5b45,
  silo: 0xd6d0c4,
  marketRoof: 0xe0573d,
  awning: [0xf2b134, 0xffffff],
  fruit: 0xf29f3d,
  hover: 0xffffff,
  ghostOk: 0x7fd3ff,
  ghostBad: 0xff6b6b,
  selection: 0xffe066,
};

const TILE_H = 0.2;
const BRIDGE_H = TILE_H; // level with the banks so there is no step at the ramps
const ROAD_THICK = 0.1 * KAYKIT_SCALE;
const LANE_OFFSET = 0.2;

function mat(color: number) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0 });
}

// ---------- road auto-tiling ----------
// Neighbour bits: N = -Z (y-1), E = +X, S = +Z, W = -X.
const N = 1;
const E = 2;
const S = 4;
const W = 8;

/** Mask after rotating a model by +90° around Y (N→W, E→N, S→E, W→S). */
function rot90(m: number) {
  return (m & N ? W : 0) | (m & E ? N : 0) | (m & S ? E : 0) | (m & W ? S : 0);
}

type RoadPiece = 'road_straight' | 'road_straight_crossing' | 'road_corner_curved' | 'road_tsplit' | 'road_junction';
const ROAD_TABLE: { model: RoadPiece; angle: number }[] = [];
for (const [model, base] of [
  ['road_straight', N | S],
  ['road_corner_curved', E | S],
  ['road_tsplit', N | S | E],
  ['road_junction', N | E | S | W],
] as const) {
  let m: number = base;
  for (let k = 0; k < 4; k++) {
    ROAD_TABLE[m] ??= { model, angle: (k * Math.PI) / 2 };
    m = rot90(m);
  }
}
// Dead ends and lone tiles use a straight piece.
ROAD_TABLE[0] = ROAD_TABLE[N] = ROAD_TABLE[S] = { model: 'road_straight', angle: 0 };
ROAD_TABLE[E] = ROAD_TABLE[W] = { model: 'road_straight', angle: Math.PI / 2 };

const bitCount = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

const BUILDINGS: ModelName[] = ['building_A', 'building_B', 'building_E', 'building_F', 'building_C', 'building_D', 'building_G', 'building_H'];
/** Truck colour (from the sim) → KayKit car model. */
const CAR_BY_COLOR: Record<number, ModelName> = {
  0xe8574a: 'car_hatchback',
  0x3d8bd9: 'car_sedan',
  0xf2b134: 'car_taxi',
  0x5cb85c: 'car_stationwagon',
};

const TREE_MODELS: ModelName[] = ['tree_1a', 'tree_1b', 'tree_1c', 'tree_2a', 'tree_2b', 'tree_2c', 'tree_3a', 'tree_3b', 'tree_4a', 'tree_4b'];
const BUSH_MODELS: ModelName[] = ['bush_1a', 'bush_1c', 'bush_2a', 'bush_2c', 'bush_4a'];
const ROCK_MODELS: ModelName[] = ['rock_1a', 'rock_1e', 'rock_2a'];
const GRASS_MODELS: ModelName[] = ['grass_1a', 'grass_2a'];
const WATER_PLANTS: ModelName[] = ['waterlily_a', 'waterlily_b', 'waterplant_a', 'waterplant_b'];
/** Village houses for the outskirts of towns (downtown uses KayKit city buildings). */
const VILLAGE_HOUSES: ModelName[] = ['home_a_red', 'home_b_red', 'home_a_yellow', 'home_b_blue'];

/** What a pile of each cargo looks like; `size` is its footprint width in tiles. */
const CARGO_PILE: Record<CargoId, { model: ModelName; size: number }> = {
  paddy: { model: 'sack', size: 0.2 },
  rice: { model: 'rice_sacks', size: 0.24 },
  fruit: { model: 'crate', size: 0.16 },
};

interface Stockpile {
  building: Building;
  cargo: CargoId;
  piles: THREE.Object3D[];
  shown: number;
}

/** Stable pseudo-random 0..1 per tile, for render-only decoration. */
function hash(x: number, y: number, salt: number) {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Renders the world. Reads WorldState; never mutates it. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: MapControls;

  private composer: EffectComposer;
  private gtao: GTAOPass;
  private tiltH: ShaderPass;
  private tiltV: ShaderPass;

  private world: WorldState;
  private roadModels = new Map<RoadPiece, InstancedModel>();
  private streetlights: InstancedModel;
  private pillars: THREE.InstancedMesh;
  private roadVersionDrawn = -1;
  /** Trees, bushes, rocks, grass tufts and water plants: one InstancedModel per model. */
  private nature = new Map<ModelName, InstancedModel>();
  private treeVersionDrawn = -1;
  private stockpiles: Stockpile[] = [];
  private trucks = new Map<number, THREE.Group>();
  private hoverMesh: THREE.Mesh;
  private ghostMesh: THREE.InstancedMesh;
  private selectionMesh: THREE.Mesh;
  private ground: THREE.Plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TILE_H);
  private raycaster = new THREE.Raycaster();
  private keys = new Set<string>();
  private lastFrame = performance.now();

  constructor(
    private container: HTMLElement,
    world: WorldState,
    private models: Models,
  ) {
    this.world = world;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    this.scene.background = skyGradient();
    this.scene.fog = new THREE.Fog(0xf3e6cf, 80, 160);

    const cx = world.width / 2;
    const cz = world.height / 2;
    this.camera = new THREE.PerspectiveCamera(32, 1, 1, 220);
    this.camera.position.set(cx - 6, 30, cz + 30);

    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.target.set(cx, 0, cz + 2);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 90;
    this.controls.maxPolarAngle = Math.PI * 0.4;
    this.controls.screenSpacePanning = false;
    // Left button is reserved for game tools.
    this.controls.mouseButtons = {
      LEFT: -1 as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.update();

    // Post-processing: ambient occlusion + tilt-shift (miniature look) + vignette.
    const size = new THREE.Vector2(container.clientWidth || 1, container.clientHeight || 1);
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
    this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.5, thickness: 1.5, scale: 1.3, samples: 16 });
    this.gtao.blendIntensity = 0.75;
    this.composer.addPass(this.gtao);
    this.tiltH = new ShaderPass(HorizontalTiltShiftShader);
    this.tiltV = new ShaderPass(VerticalTiltShiftShader);
    this.tiltH.uniforms.r.value = this.tiltV.uniforms.r.value = 0.5;
    this.composer.addPass(this.tiltH);
    this.composer.addPass(this.tiltV);
    this.composer.addPass(new OutputPass());
    const vignette = new ShaderPass(VignetteShader);
    vignette.uniforms.offset.value = 0.95;
    vignette.uniforms.darkness.value = 0.9;
    this.composer.addPass(vignette);

    this.setupLights();
    this.buildTerrain();
    this.buildBuildings();
    this.buildTrees();

    for (const piece of ['road_straight', 'road_straight_crossing', 'road_corner_curved', 'road_tsplit', 'road_junction'] as const) {
      const im = new InstancedModel(models[piece], 256, { cast: false, receive: true });
      this.roadModels.set(piece, im);
      this.scene.add(im.group);
    }
    this.streetlights = new InstancedModel(models.streetlight, 64);
    this.scene.add(this.streetlights.group);
    this.pillars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 1, 0.14), mat(C.pillar), 256);
    this.pillars.count = 0;
    this.pillars.castShadow = true;
    this.pillars.frustumCulled = false;
    this.scene.add(this.pillars);

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
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    this.keys.add(e.key.toLowerCase());
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private onBlur = () => this.keys.clear();

  /** Resizes to the container, or to an explicit size (used for screenshots while the window is hidden). */
  resize(width?: number, height?: number) {
    const w = width ?? this.container.clientWidth;
    const h = height ?? this.container.clientHeight;
    if (!w || !h) return; // hidden window: keep the last real size
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const blur = 2.2;
    this.tiltH.uniforms.h.value = blur / w;
    this.tiltV.uniforms.v.value = blur / h;
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
    if (tile) this.hoverMesh.position.set(tile.x + 0.5, TILE_H + 0.08, tile.y + 0.5);
  }

  setGhost(tiles: number[], ok: boolean) {
    const m = new THREE.Matrix4();
    const n = Math.min(tiles.length, this.ghostMesh.instanceMatrix.count);
    for (let k = 0; k < n; k++) {
      const i = tiles[k];
      const x = i % this.world.width;
      const y = Math.floor(i / this.world.width);
      m.makeTranslation(x + 0.5, TILE_H + 0.1, y + 0.5);
      this.ghostMesh.setMatrixAt(k, m);
    }
    this.ghostMesh.count = n;
    this.ghostMesh.instanceMatrix.needsUpdate = true;
    (this.ghostMesh.material as THREE.MeshBasicMaterial).color.setHex(ok ? C.ghostOk : C.ghostBad);
  }

  setSelection(target: { x: number; y: number; r: number } | null) {
    this.selectionMesh.visible = !!target;
    if (target) {
      this.selectionMesh.position.set(target.x, TILE_H + 0.1, target.y);
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
    if (this.treeVersionDrawn !== this.world.roadVersion) this.syncTrees();
    this.syncTrucks();
    this.syncStockpiles();
    this.selectionMesh.rotation.y = now / 1000;
    this.composer.render(dt);
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
    const hemi = new THREE.HemisphereLight(0xfff4e0, 0x8aa07a, 1.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
    const cx = this.world.width / 2;
    const cz = this.world.height / 2;
    sun.position.set(cx - 24, 40, cz + 18);
    sun.target.position.set(cx, 0, cz);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const s = this.world.width * 0.72;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 120 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
  }

  private buildTerrain() {
    const w = this.world;
    const n = w.width * w.height;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0xffffff), n);
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = i % w.width;
      const y = Math.floor(i / w.width);
      const water = w.terrain[i] === Terrain.Water;
      const h = water ? 0.04 : TILE_H;
      m.makeScale(1, h, 1).setPosition(x + 0.5, h / 2, y + 0.5);
      mesh.setMatrixAt(i, m);
      const hash = Math.abs((x * 73856093) ^ (y * 19349663));
      color.setHex(water ? C.riverbed : C.grass[hash % C.grass.length]);
      mesh.setColorAt(i, color);
    }
    this.scene.add(mesh);

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(w.width, w.height).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: C.water, transparent: true, opacity: 0.82, roughness: 0.15, metalness: 0.05 }),
    );
    water.position.set(w.width / 2, 0.13, w.height / 2);
    water.receiveShadow = true;
    this.scene.add(water);

    // Diorama base under the map: grass lip + layered earth.
    const lip = new THREE.Mesh(new THREE.BoxGeometry(w.width + 0.4, 0.5, w.height + 0.4), mat(C.earth));
    lip.position.set(w.width / 2, -0.25, w.height / 2);
    const deep = new THREE.Mesh(new THREE.BoxGeometry(w.width + 0.4, 1.2, w.height + 0.4), mat(C.earthDark));
    deep.position.set(w.width / 2, -1.1, w.height / 2);
    lip.receiveShadow = deep.receiveShadow = true;
    this.scene.add(lip, deep);
  }

  private buildRoads() {
    const w = this.world;
    const isRoad = (x: number, y: number) => x >= 0 && y >= 0 && x < w.width && y < w.height && w.road[y * w.width + x] === 1;
    const maskAt = (x: number, y: number) =>
      (isRoad(x, y - 1) ? N : 0) | (isRoad(x + 1, y) ? E : 0) | (isRoad(x, y + 1) ? S : 0) | (isRoad(x - 1, y) ? W : 0);

    const markets = w.buildings.filter((b) => b.kind === 'market');
    const nearTown = (x: number, y: number) => markets.some((b) => Math.abs(b.x - x) + Math.abs(b.y - y) <= 8);

    const byPiece = new Map<RoadPiece, THREE.Matrix4[]>();
    const lights: THREE.Matrix4[] = [];
    const pillars: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3(KAYKIT_SCALE, KAYKIT_SCALE, KAYKIT_SCALE);

    for (let i = 0; i < w.road.length; i++) {
      if (!w.road[i]) continue;
      const x = i % w.width;
      const y = Math.floor(i / w.width);
      const water = w.terrain[i] === Terrain.Water;
      const mask = maskAt(x, y);
      let { model, angle } = ROAD_TABLE[mask];

      // Zebra crossings next to intersections, like a real town.
      if (model === 'road_straight' && bitCount(mask) === 2 && !water) {
        const vertical = mask === (N | S);
        const a = vertical ? maskAt(x, y - 1) : maskAt(x - 1, y);
        const b = vertical ? maskAt(x, y + 1) : maskAt(x + 1, y);
        if (bitCount(a) >= 3 || bitCount(b) >= 3) model = 'road_straight_crossing';
      }

      const h = water ? BRIDGE_H : TILE_H;
      q.setFromAxisAngle(up, angle);
      const mtx = new THREE.Matrix4().compose(new THREE.Vector3(x + 0.5, h, y + 0.5), q, scale);
      if (!byPiece.has(model)) byPiece.set(model, []);
      byPiece.get(model)!.push(mtx);

      if (water) {
        for (const [ox, oz] of [
          [-0.35, -0.35],
          [0.35, 0.35],
        ]) {
          pillars.push(new THREE.Matrix4().compose(new THREE.Vector3(x + 0.5 + ox, h / 2, y + 0.5 + oz), new THREE.Quaternion(), new THREE.Vector3(1, h, 1)));
        }
      }

      if (model === 'road_straight' && !water && (x * 7 + y * 13) % 4 === 0 && nearTown(x, y)) {
        // Streetlight on the sidewalk, arm reaching over the road.
        const vertical = mask === (N | S) || mask === N || mask === S || mask === 0;
        const pos = vertical ? new THREE.Vector3(x + 0.5 + 0.43, h + ROAD_THICK, y + 0.5) : new THREE.Vector3(x + 0.5, h + ROAD_THICK, y + 0.5 + 0.43);
        const rot = new THREE.Quaternion().setFromAxisAngle(up, vertical ? 0 : -Math.PI / 2);
        lights.push(new THREE.Matrix4().compose(pos, rot, new THREE.Vector3(0.6, 0.6, 0.6)));
      }
    }

    for (const [piece, im] of this.roadModels) im.set(byPiece.get(piece) ?? []);
    this.streetlights.set(lights);
    if (pillars.length > this.pillars.instanceMatrix.count) {
      pillars.length = this.pillars.instanceMatrix.count;
    }
    pillars.forEach((p, k) => this.pillars.setMatrixAt(k, p));
    this.pillars.count = pillars.length;
    this.pillars.instanceMatrix.needsUpdate = true;
    this.roadVersionDrawn = w.roadVersion;
  }

  private buildTrees() {
    for (const name of [...TREE_MODELS, ...BUSH_MODELS, ...ROCK_MODELS, ...GRASS_MODELS, ...WATER_PLANTS]) {
      const im = new InstancedModel(this.models[name], 64, { cast: !GRASS_MODELS.includes(name), receive: true });
      this.nature.set(name, im);
      this.scene.add(im.group);
    }
    this.syncTrees();
  }

  /**
   * Places trees (from the sim) plus render-only decoration: bushes, rocks and grass tufts on empty
   * grass, lilies along the river. Positions come from a tile hash, so they are stable between rebuilds.
   */
  private widths = new Map<ModelName, number>();
  /** Native footprint width (max of X/Z extent) of a model. */
  private modelWidth(name: ModelName) {
    let w = this.widths.get(name);
    if (w === undefined) {
      const size = new THREE.Box3().setFromObject(this.models[name]).getSize(new THREE.Vector3());
      w = Math.max(size.x, size.z) || 1;
      this.widths.set(name, w);
    }
    return w;
  }

  private syncTrees() {
    const w = this.world;
    const lists = new Map<ModelName, THREE.Matrix4[]>();
    // `size` is the wanted footprint width in tiles; models come in very different native sizes.
    const add = (name: ModelName, x: number, y: number, h: number, size: number, rot: number) => {
      const scale = size / this.modelWidth(name);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, h, y),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot),
        new THREE.Vector3(scale, scale, scale),
      );
      if (!lists.has(name)) lists.set(name, []);
      lists.get(name)!.push(m);
    };
    const isTree = (x: number, y: number) => x >= 0 && y >= 0 && x < w.width && y < w.height && w.tree[y * w.width + x] === 1;
    const isWater = (x: number, y: number) => x >= 0 && y >= 0 && x < w.width && y < w.height && w.terrain[y * w.width + x] === Terrain.Water;

    for (let i = 0; i < w.tree.length; i++) {
      const x = i % w.width;
      const y = Math.floor(i / w.width);
      const r1 = hash(x, y, 1);
      const r2 = hash(x, y, 2);
      const r3 = hash(x, y, 3);
      const cx = x + 0.5 + (r2 - 0.5) * 0.3;
      const cy = y + 0.5 + (r3 - 0.5) * 0.3;

      if (w.terrain[i] === Terrain.Water) {
        const nearBank = !isWater(x - 1, y) || !isWater(x + 1, y);
        if (nearBank && r1 < 0.45) add(WATER_PLANTS[Math.floor(r2 * WATER_PLANTS.length)], cx, cy, 0.13, 0.2 + r1 * 0.15, r3 * 6.28);
        continue;
      }
      if (w.road[i] || w.occupant[i] !== -1) continue;

      if (w.tree[i]) {
        const name = TREE_MODELS[Math.floor(r1 * TREE_MODELS.length)];
        add(name, cx, cy, TILE_H, 0.7 + r2 * 0.35, r3 * 6.28);
        // Undergrowth so forests look dense.
        if (r2 < 0.35) add(BUSH_MODELS[Math.floor(r3 * BUSH_MODELS.length)], x + 0.2 + r3 * 0.6, y + 0.2 + r1 * 0.6, TILE_H, 0.3, r1 * 6.28);
        continue;
      }
      // Open grass: forest edges get bushes, the rest gets the odd rock and grass tuft.
      const forestEdge = isTree(x - 1, y) || isTree(x + 1, y) || isTree(x, y - 1) || isTree(x, y + 1);
      if (forestEdge && r1 < 0.3) add(BUSH_MODELS[Math.floor(r2 * BUSH_MODELS.length)], cx, cy, TILE_H, 0.28 + r3 * 0.2, r3 * 6.28);
      else if (r1 > 0.985) add(ROCK_MODELS[Math.floor(r2 * ROCK_MODELS.length)], cx, cy, TILE_H, 0.22 + r3 * 0.2, r3 * 6.28);
      if (r3 < 0.12) add(GRASS_MODELS[Math.floor(r1 * GRASS_MODELS.length)], x + 0.15 + r2 * 0.7, y + 0.15 + r1 * 0.7, TILE_H, 0.1, r2 * 6.28);
    }

    for (const [name, im] of this.nature) im.set(lists.get(name) ?? []);
    this.treeVersionDrawn = w.roadVersion;
  }

  private buildBuildings() {
    const w = this.world;
    const isRoad = (x: number, y: number) => x >= 0 && y >= 0 && x < w.width && y < w.height && w.road[y * w.width + x] === 1;
    const isWater = (x: number, y: number) => x >= 0 && y >= 0 && x < w.width && y < w.height && w.terrain[y * w.width + x] === Terrain.Water;
    const markets = w.buildings.filter((b) => b.kind === 'market');

    /** Angle that turns a model's +Z front towards the first side of the footprint touching `test`. */
    const facing = (b: Building, test: (x: number, y: number) => boolean): number | null => {
      const sides: [number, () => boolean][] = [
        [0, () => range(b.x, b.w).some((x) => test(x, b.y + b.h))],
        [Math.PI / 2, () => range(b.y, b.h).some((y) => test(b.x + b.w, y))],
        [Math.PI, () => range(b.x, b.w).some((x) => test(x, b.y - 1))],
        [-Math.PI / 2, () => range(b.y, b.h).some((y) => test(b.x - 1, y))],
      ];
      return sides.find(([, ok]) => ok())?.[0] ?? null;
    };
    const near = (b: Building, test: (x: number, y: number) => boolean, dist: number) => {
      for (let y = b.y - dist; y < b.y + b.h + dist; y++) for (let x = b.x - dist; x < b.x + b.w + dist; x++) if (test(x, y)) return true;
      return false;
    };

    for (const b of w.buildings) {
      let g: THREE.Object3D;
      if (b.kind === 'house') {
        // Town centre: city blocks (taller near the market). Outskirts: village houses with tiled roofs.
        const d = Math.min(...markets.map((m) => Math.abs(m.x - b.x) + Math.abs(m.y - b.y)));
        const pick = b.variant + b.x + b.y;
        if (d <= 4) {
          const pool = d <= 2 ? BUILDINGS : BUILDINGS.slice(0, 4);
          g = this.models[pool[pick % pool.length]].clone();
          g.scale.setScalar(KAYKIT_SCALE);
        } else {
          g = this.models[VILLAGE_HOUSES[pick % VILLAGE_HOUSES.length]].clone();
          g.scale.setScalar(0.62);
        }
        g.rotation.y = facing(b, isRoad) ?? (b.variant % 4) * (Math.PI / 2);
      } else {
        // Water mill when there is a river close by (wheel towards the water), windmill otherwise.
        const waterSide = b.kind === 'mill' && near(b, isWater, 3) ? facingWater(b, isWater) : null;
        g = makeBuilding(b, this.models, { front: facing(b, isRoad) ?? 0, waterSide });
        for (const [cargo, spots] of pileSpots(b)) this.addStockpile(b, cargo, spots, g);
      }
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

  /** Piles of goods next to a building that grow with its stock, so bottlenecks are visible at a glance. */
  private addStockpile(b: Building, cargo: CargoId, spots: [number, number][], parent: THREE.Object3D) {
    const look = CARGO_PILE[cargo];
    const scale = look.size / this.modelWidth(look.model);
    const layerHeight = new THREE.Box3().setFromObject(this.models[look.model]).getSize(new THREE.Vector3()).y * scale;
    const piles: THREE.Object3D[] = [];
    for (let layer = 0; layer < 2; layer++) {
      for (const [x, z] of spots) {
        const o = this.models[look.model].clone();
        o.scale.setScalar(scale);
        o.position.set(x, 0.05 + layer * layerHeight, z);
        o.rotation.y = hash(b.id, piles.length, 7) * 0.6 - 0.3;
        o.visible = false;
        parent.add(o);
        piles.push(o);
      }
    }
    this.stockpiles.push({ building: b, cargo, piles, shown: 0 });
  }

  private syncStockpiles() {
    for (const s of this.stockpiles) {
      const perPile = PRODUCTION_CAP / s.piles.length;
      const n = Math.min(s.piles.length, Math.ceil((s.building.stock[s.cargo] ?? 0) / perPile));
      if (n === s.shown) continue;
      s.piles.forEach((p, i) => (p.visible = i < n));
      s.shown = n;
    }
  }

  private syncTrucks() {
    const w = this.world;
    const alive = new Set<number>();
    for (const t of w.trucks) {
      alive.add(t.id);
      let g = this.trucks.get(t.id);
      if (!g) {
        const look = CARGO_PILE[t.cargo];
        g = makeTruck(t, this.models, (look.size * 0.75) / this.modelWidth(look.model));
        this.trucks.set(t.id, g);
        this.scene.add(g);
      }
      // Drive on the right: offset perpendicular to heading so opposing trucks don't overlap.
      const onBridge = w.terrain[w.width * Math.floor(t.y) + Math.floor(t.x)] === Terrain.Water;
      const target = new THREE.Vector3(
        t.x - Math.sin(t.heading) * LANE_OFFSET,
        (onBridge ? BRIDGE_H : TILE_H) + ROAD_THICK + 0.035,
        t.y + Math.cos(t.heading) * LANE_OFFSET,
      );
      if (g.position.distanceToSquared(target) > 4) g.position.copy(target);
      else g.position.lerp(target, 0.35);
      // Car model faces +Z; heading is the angle of travel in the x/z plane.
      const desired = Math.PI / 2 - t.heading;
      let diff = desired - g.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      g.rotation.y += diff * 0.3;
      const cargo = g.getObjectByName('cargo');
      if (cargo) cargo.visible = t.load > 0;
    }
    for (const [id, g] of this.trucks) {
      if (!alive.has(id)) {
        this.scene.remove(g);
        this.trucks.delete(id);
      }
    }
  }
}

function skyGradient(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#8fcbe8');
  grad.addColorStop(0.6, '#d7ecf0');
  grad.addColorStop(1, '#f6e7cc');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- custom low-poly models (built from primitives) ----------

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y + h / 2, z);
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

function kit(models: Models, name: ModelName, x: number, y: number, z: number, scale = KAYKIT_SCALE, rotY = 0) {
  const o = models[name].clone();
  o.position.set(x, y, z);
  o.scale.setScalar(scale);
  o.rotation.y = rotY;
  return o;
}

function range(start: number, count: number) {
  return Array.from({ length: count }, (_, i) => start + i);
}

/** Angle that turns the water mill's wheel (on its -X side) towards the closest water. */
function facingWater(b: Building, isWater: (x: number, y: number) => boolean): number {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  let best = { d: Infinity, dx: -1, dy: 0 };
  for (let y = b.y - 3; y < b.y + b.h + 3; y++) {
    for (let x = b.x - 3; x < b.x + b.w + 3; x++) {
      if (!isWater(x, y)) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = dx * dx + dy * dy;
      if (d < best.d) best = { d, dx, dy };
    }
  }
  // -X → W: 0, E: π, N: -π/2, S: +π/2
  if (Math.abs(best.dx) >= Math.abs(best.dy)) return best.dx < 0 ? 0 : Math.PI;
  return best.dy < 0 ? -Math.PI / 2 : Math.PI / 2;
}

/** Where piles of each stocked cargo sit, in the building's local (unrotated) frame. */
function pileSpots(b: Building): [CargoId, [number, number][]][] {
  switch (b.kind) {
    case 'farm':
      return [['paddy', [[0.8, 0.8], [0.55, 0.88], [-0.8, 0.8], [-0.55, 0.88]]]];
    case 'orchard':
      return [['fruit', [[-0.75, 0.88], [-0.45, 0.88], [0.45, 0.88], [0.75, 0.88]]]];
    case 'mill':
      return [
        ['paddy', [[-0.78, 0.78], [-0.48, 0.82]]],
        ['rice', [[0.48, 0.82], [0.78, 0.78]]],
      ];
    default:
      return [];
  }
}

function makeBuilding(b: Building, models: Models, opts: { front: number; waterSide: number | null }): THREE.Group {
  const g = new THREE.Group();
  const v = b.variant;
  switch (b.kind) {
    case 'farm': {
      // Golden rice field on an earth plot, a thatched hut and a wheelbarrow in the corners.
      g.add(box(1.98, 0.04, 1.98, C.dyke));
      g.add(kit(models, 'grain', 0, 0.03, 0, 0.92, (v % 2) * Math.PI));
      const hut = new THREE.Group();
      hut.add(box(0.3, 0.22, 0.26, C.hut, 0, 0.04));
      hut.add(gableRoof(0.42, 0.2, 0.36, C.thatch, 0.26));
      hut.position.set(-0.76, 0, -0.78);
      g.add(hut);
      g.add(kit(models, 'wheelbarrow', 0.78, 0.04, -0.72, 0.9, 0.6));
      g.add(kit(models, 'sack', 0.62, 0.04, -0.86, 1.2));
      break;
    }
    case 'orchard': {
      // Rows of small fruit trees inside a wooden fence.
      g.add(box(1.96, 0.04, 1.96, 0x9ccc65));
      for (let i = 0; i < 6; i++) {
        const x = ((i % 3) - 1) * 0.6;
        const z = (Math.floor(i / 3) - 0.5) * 0.7 - 0.15;
        g.add(kit(models, (['tree_1a', 'tree_3a', 'tree_1b'] as const)[(i + v) % 3], x, 0.04, z, 0.11, i * 1.3));
        for (let f = 0; f < 4; f++) {
          const fruit = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 0), mat(C.fruit));
          const a = f * 1.7 + i;
          fruit.position.set(x + Math.cos(a) * 0.15, 0.32 + (f % 2) * 0.08, z + Math.sin(a) * 0.15);
          g.add(fruit);
        }
      }
      for (const s of [-1, 1]) {
        g.add(kit(models, 'fence', s * 0.97, 0.04, -0.5, 0.5, Math.PI / 2));
        g.add(kit(models, 'fence', s * 0.97, 0.04, 0.5, 0.5, Math.PI / 2));
      }
      g.add(kit(models, 'fence', -0.5, 0.04, -0.97, 0.5));
      g.add(kit(models, 'fence', 0.5, 0.04, -0.97, 0.5));
      break;
    }
    case 'mill': {
      g.add(kit(models, 'base', 0, 0, 0, 1));
      if (opts.waterSide !== null) {
        g.add(kit(models, 'watermill', 0, 0.05, -0.15, 1.15, opts.waterSide));
      } else {
        g.add(kit(models, 'windmill', 0, 0.05, -0.2, 1.4, opts.front));
      }
      g.add(kit(models, 'barrel', 0.85, 0.05, -0.85, 1.1));
      g.add(kit(models, 'crate_small', -0.85, 0.05, -0.85, 1.4, 0.4));
      break;
    }
    case 'market': {
      g.add(kit(models, 'base', 0, 0, 0, 1));
      g.add(kit(models, 'market', 0, 0.05, 0.05, 1.05, opts.front));
      g.add(kit(models, 'bench', -0.75, 0.05, -0.8, KAYKIT_SCALE));
      g.add(kit(models, 'bush_1a', 0.82, 0.05, -0.82, 0.9));
      break;
    }
    case 'house':
      break;
  }
  return g;
}

function makeTruck(t: Truck, models: Models, cargoScale: number): THREE.Group {
  const g = new THREE.Group();
  const car = models[CAR_BY_COLOR[t.color] ?? 'car_stationwagon'].clone();
  car.scale.setScalar(KAYKIT_SCALE);
  g.add(car);
  // The cargo is visible on the roof while loaded: tarp-covered paddy, rice sacks or fruit crates.
  const cargo = new THREE.Group();
  cargo.name = 'cargo';
  cargo.add(kit(models, CARGO_PILE[t.cargo].model, 0, 0.155, -0.02, cargoScale));
  g.add(cargo);
  return g;
}
