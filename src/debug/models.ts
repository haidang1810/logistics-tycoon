// Dev-only page: shows KayKit road pieces from above with axis markers, to check orientation.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const names = ['road_straight', 'road_corner', 'road_corner_curved', 'road_tsplit', 'road_junction', 'road_straight_crossing', 'car_sedan', 'building_A'];
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x335533);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 3));
const cam = new THREE.OrthographicCamera(-1, 17, 2, -2, 0.1, 100);
cam.position.set(0, 20, 0);
cam.up.set(0, 0, -1); // screen up = -Z, screen right = +X
cam.lookAt(0, 0, 0);
cam.position.x = 0; 
const loader = new GLTFLoader();
names.forEach((n, i) => {
  loader.load(`/models/kaykit/${n}.gltf`, (g) => {
    g.scene.position.set(i * 2.2 + 0.2, 0, 0);
    scene.add(g.scene);
    // red marker at +X edge, blue marker at +Z edge
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.3, 0.15), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    r.position.set(i * 2.2 + 0.2 + 0.95, 0.5, 0);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.3, 0.15), new THREE.MeshBasicMaterial({ color: 0x0000ff }));
    b.position.set(i * 2.2 + 0.2, 0.5, 0.95);
    scene.add(r, b);
    renderer.render(scene, cam);
  });
});
cam.left = -1; cam.right = names.length * 2.2; cam.top = (cam.right + 1) * innerHeight / innerWidth / 2; cam.bottom = -cam.top;
cam.updateProjectionMatrix();
renderer.render(scene, cam);
