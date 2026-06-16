// ===== world.js =====
// 方块世界运行时状态：功能方块、火把光源、地形 mesh 与常用查询。

import * as D from './data.js';

export const openDoors = new Set();
export const chests = {};
export const torchLights = {};
export const blockEdits = {};

let sceneRef = null;
let threeRef = null;
let terrainMesh = null;
let terrainMat = null;
let blockTexture = null;

export function keyOf(x, y, z) {
  return x + ',' + y + ',' + z;
}

export function initWorldRuntime(THREE, scene) {
  threeRef = THREE;
  sceneRef = scene;
  blockTexture = makeNoiseTexture(THREE);
  terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: blockTexture });
}

function makeNoiseTexture(THREE) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(16, 16);
  for (let i = 0; i < 16 * 16; i++) {
    const v = 200 + Math.floor(Math.random() * 56);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function updateBlockTexture(dt) {
  if (blockTexture) blockTexture.offset.x = (blockTexture.offset.x + dt * 0.02) % 1;
}

export function rebuildTerrain() {
  if (!sceneRef || !threeRef || !terrainMat) return;
  if (terrainMesh) {
    sceneRef.remove(terrainMesh);
    terrainMesh.geometry.dispose();
  }
  terrainMesh = new threeRef.Mesh(D.buildMesh(threeRef), terrainMat);
  sceneRef.add(terrainMesh);
}

export function isSolidAt(x, y, z) {
  const id = D.getBlock(x, y, z);
  if (id === 15 && openDoors.has(keyOf(x, y, z))) return false;
  return D.isSolid(id);
}

export function surfaceY(x, z) {
  for (let y = D.WORLD_H - 1; y >= 0; y--) {
    if (D.isSolid(D.getBlock(x, y, z))) return y + 1;
  }
  return D.SEA_LEVEL + 1;
}

export function addTorchLight(x, y, z) {
  if (!sceneRef || !threeRef) return;
  const k = keyOf(x, y, z);
  if (torchLights[k]) return;
  const light = new threeRef.PointLight(0xffbb66, 0.9, 8);
  light.position.set(x + 0.5, y + 0.5, z + 0.5);
  sceneRef.add(light);
  torchLights[k] = light;
}

export function removeTorchLight(x, y, z) {
  const k = keyOf(x, y, z);
  if (!torchLights[k]) return;
  sceneRef.remove(torchLights[k]);
  delete torchLights[k];
}

export function clearTorchLights() {
  for (const k in torchLights) {
    sceneRef.remove(torchLights[k]);
    delete torchLights[k];
  }
}

export function clearBlockState() {
  for (const k in chests) delete chests[k];
  for (const k in blockEdits) delete blockEdits[k];
  openDoors.clear();
  clearTorchLights();
}

export function restoreBlockState(state = {}) {
  clearBlockState();
  Object.assign(chests, state.chests || {});
  (state.openDoors || []).forEach(k => openDoors.add(k));
  Object.assign(blockEdits, state.edits || {});
  (state.torches || []).forEach(k => {
    const [x, y, z] = k.split(',').map(Number);
    addTorchLight(x, y, z);
  });
}

export function snapshotBlockState() {
  return {
    chests,
    openDoors: Array.from(openDoors),
    torches: Object.keys(torchLights),
    edits: blockEdits,
  };
}

export function applyBlockEdit(x, y, z, id, { rebuild = true } = {}) {
  const prev = D.getBlock(x, y, z);
  D.setBlock(x, y, z, id);
  if (prev === 14 && id !== 14) removeTorchLight(x, y, z);
  if (id === 14) addTorchLight(x, y, z);
  if (prev === 15 && id !== 15) openDoors.delete(keyOf(x, y, z));
  if (prev === 17 && id !== 17) delete chests[keyOf(x, y, z)];
  blockEdits[keyOf(x, y, z)] = id;
  if (rebuild) rebuildTerrain();
}

export function applyBlockEdits(edits = {}) {
  for (const k in edits) {
    const [x, y, z] = k.split(',').map(Number);
    applyBlockEdit(x, y, z, edits[k], { rebuild: false });
  }
  rebuildTerrain();
}
