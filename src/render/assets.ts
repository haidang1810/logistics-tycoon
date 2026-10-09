import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** KayKit City Builder Bits (CC0, Kay Lousberg). One KayKit tile = 2 units, so models are scaled 0.5 to fit our 1-unit tiles. */
export const KAYKIT_SCALE = 0.5;

/** Model key → file under public/models (all KayKit packs by Kay Lousberg, CC0). */
const MODEL_FILES = {
  // City Builder Bits
  road_straight: 'kaykit/road_straight',
  road_straight_crossing: 'kaykit/road_straight_crossing',
  road_corner_curved: 'kaykit/road_corner_curved',
  road_tsplit: 'kaykit/road_tsplit',
  road_junction: 'kaykit/road_junction',
  base: 'kaykit/base',
  building_A: 'kaykit/building_A',
  building_B: 'kaykit/building_B',
  building_C: 'kaykit/building_C',
  building_D: 'kaykit/building_D',
  building_E: 'kaykit/building_E',
  building_F: 'kaykit/building_F',
  building_G: 'kaykit/building_G',
  building_H: 'kaykit/building_H',
  car_sedan: 'kaykit/car_sedan',
  car_hatchback: 'kaykit/car_hatchback',
  car_stationwagon: 'kaykit/car_stationwagon',
  car_taxi: 'kaykit/car_taxi',
  bench: 'kaykit/bench',
  streetlight: 'kaykit/streetlight',
  firehydrant: 'kaykit/firehydrant',
  dumpster: 'kaykit/dumpster',
  // Forest Nature Pack
  tree_1a: 'forest/Tree_1_A_Color1',
  tree_1b: 'forest/Tree_1_B_Color1',
  tree_1c: 'forest/Tree_1_C_Color1',
  tree_2a: 'forest/Tree_2_A_Color1',
  tree_2b: 'forest/Tree_2_B_Color1',
  tree_2c: 'forest/Tree_2_C_Color1',
  tree_3a: 'forest/Tree_3_A_Color1',
  tree_3b: 'forest/Tree_3_B_Color1',
  tree_4a: 'forest/Tree_4_A_Color1',
  tree_4b: 'forest/Tree_4_B_Color1',
  bush_1a: 'forest/Bush_1_A_Color1',
  bush_1c: 'forest/Bush_1_C_Color1',
  bush_2a: 'forest/Bush_2_A_Color1',
  bush_2c: 'forest/Bush_2_C_Color1',
  bush_4a: 'forest/Bush_4_A_Color1',
  rock_1a: 'forest/Rock_1_A_Color1',
  rock_1e: 'forest/Rock_1_E_Color1',
  rock_2a: 'forest/Rock_2_A_Color1',
  grass_1a: 'forest/Grass_1_A_Color1',
  grass_2a: 'forest/Grass_2_A_Color1',
  // Medieval Hexagon Pack
  watermill: 'medieval/building_watermill_red',
  windmill: 'medieval/building_windmill_red',
  home_a_red: 'medieval/building_home_A_red',
  home_b_red: 'medieval/building_home_B_red',
  home_a_yellow: 'medieval/building_home_A_yellow',
  home_b_blue: 'medieval/building_home_B_blue',
  market: 'medieval/building_market_red',
  well: 'medieval/building_well_red',
  grain: 'medieval/building_grain',
  fence: 'medieval/fence_wood_straight',
  waterlily_a: 'medieval/waterlily_A',
  waterlily_b: 'medieval/waterlily_B',
  waterplant_a: 'medieval/waterplant_A',
  waterplant_b: 'medieval/waterplant_B',
  sack: 'medieval/sack',
  crate: 'medieval/crate_A_big',
  crate_small: 'medieval/crate_B_small',
  barrel: 'medieval/barrel',
  wheelbarrow: 'medieval/wheelbarrow',
  // Resource Bits
  pallet: 'resources/Pallet_Wood',
  pallet_covered: 'resources/Pallet_Wood_Covered_B',
  rice_sacks: 'resources/Textiles_B',
  fuel_barrel: 'resources/Fuel_A_Barrel',
  log_stack: 'resources/Wood_Log_Stack',
} as const;

export type ModelName = keyof typeof MODEL_FILES;
export type Models = Record<ModelName, THREE.Group>;
const MODEL_NAMES = Object.keys(MODEL_FILES) as ModelName[];

export async function loadModels(onProgress?: (done: number, total: number) => void): Promise<Models> {
  const loader = new GLTFLoader();
  let done = 0;
  const entries = await Promise.all(
    MODEL_NAMES.map(async (name) => {
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${MODEL_FILES[name]}.gltf`);
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      onProgress?.(++done, MODEL_NAMES.length);
      return [name, gltf.scene] as const;
    }),
  );
  return Object.fromEntries(entries) as Models;
}

/**
 * Draws many copies of a (possibly multi-mesh) model with one InstancedMesh per sub-mesh.
 * Call `set()` with one matrix per copy whenever the set of copies changes.
 */
export class InstancedModel {
  readonly group = new THREE.Group();
  private parts: { mesh: THREE.InstancedMesh; local: THREE.Matrix4 }[] = [];
  private tmp = new THREE.Matrix4();

  constructor(
    private template: THREE.Object3D,
    private capacity: number,
    private shadows = { cast: true, receive: true },
  ) {
    this.build();
  }

  private build() {
    for (const p of this.parts) {
      this.group.remove(p.mesh);
      p.mesh.dispose();
    }
    this.parts = [];
    this.template.updateMatrixWorld(true);
    const rootInv = this.template.matrixWorld.clone().invert();
    this.template.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const local = rootInv.clone().multiply(o.matrixWorld);
      const mesh = new THREE.InstancedMesh(o.geometry, o.material, this.capacity);
      mesh.count = 0;
      mesh.castShadow = this.shadows.cast;
      mesh.receiveShadow = this.shadows.receive;
      mesh.frustumCulled = false;
      this.parts.push({ mesh, local });
      this.group.add(mesh);
    });
  }

  set(matrices: THREE.Matrix4[]) {
    if (matrices.length > this.capacity) {
      this.capacity = Math.max(matrices.length, this.capacity * 2);
      this.build();
    }
    for (const { mesh, local } of this.parts) {
      for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, this.tmp.multiplyMatrices(matrices[i], local));
      mesh.count = matrices.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
