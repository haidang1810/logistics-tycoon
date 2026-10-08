import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** KayKit City Builder Bits (CC0, Kay Lousberg). One KayKit tile = 2 units, so models are scaled 0.5 to fit our 1-unit tiles. */
export const KAYKIT_SCALE = 0.5;

export const MODEL_NAMES = [
  'road_straight',
  'road_straight_crossing',
  'road_corner_curved',
  'road_tsplit',
  'road_junction',
  'base',
  'building_A',
  'building_B',
  'building_C',
  'building_D',
  'building_E',
  'building_F',
  'building_G',
  'building_H',
  'car_sedan',
  'car_hatchback',
  'car_stationwagon',
  'car_taxi',
  'box_A',
  'box_B',
  'bush',
  'bench',
  'streetlight',
  'firehydrant',
  'dumpster',
  'watertower',
] as const;

export type ModelName = (typeof MODEL_NAMES)[number];
export type Models = Record<ModelName, THREE.Group>;

export async function loadModels(onProgress?: (done: number, total: number) => void): Promise<Models> {
  const loader = new GLTFLoader();
  let done = 0;
  const entries = await Promise.all(
    MODEL_NAMES.map(async (name) => {
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/kaykit/${name}.gltf`);
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
