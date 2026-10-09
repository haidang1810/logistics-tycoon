// Dev-only page: lays out models in a grid with +X (red) / +Z (blue) markers to check scale and orientation.
// Usage: /debug-models.html?m=forest/Tree_1_A_Color1,medieval/building_grain&s=1  (s = scale)
// After loading it saves a screenshot to .shots/models.jpg via the dev server.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const params = new URLSearchParams(location.search);
const names = (params.get('m') ?? 'kaykit/road_straight,kaykit/road_corner_curved,kaykit/road_tsplit,kaykit/road_junction').split(',');
const scale = Number(params.get('s') ?? 1);
const cols = Math.ceil(Math.sqrt(names.length));
const cell = 2.4;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(1280, 720);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x446644);
scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(-3, 6, 4);
scene.add(sun);

const size = cols * cell;
const cam = new THREE.PerspectiveCamera(35, 1280 / 720, 0.1, 200);
cam.position.set(size / 2 - cell / 2, size * 0.9, size * 1.25);
cam.lookAt(size / 2 - cell / 2, 0, size / 2 - cell / 2);

const loader = new GLTFLoader();
await Promise.all(
  names.map(async (n, i) => {
    const g = await loader.loadAsync(`/models/${n}.gltf`);
    const x = (i % cols) * cell;
    const z = Math.floor(i / cols) * cell;
    g.scene.scale.setScalar(scale);
    g.scene.position.set(x, 0, z);
    scene.add(g.scene);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(2, 0.02, 2), new THREE.MeshStandardMaterial({ color: 0x557755 }));
    plate.position.set(x, -0.01, z);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    r.position.set(x + 1, 0.06, z);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0x0000ff }));
    b.position.set(x, 0.06, z + 1);
    scene.add(plate, r, b);
  }),
);
renderer.render(scene, cam);
const data = renderer.domElement.toDataURL('image/jpeg', 0.85);
await fetch('/__shot', { method: 'POST', body: JSON.stringify({ name: params.get('shot') ?? 'models', data }) });
document.title = 'done';
