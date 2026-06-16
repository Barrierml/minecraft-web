// ===== world.js =====
// 方块世界运行时状态：功能方块、火把光源、地形 mesh 与常用查询。

import * as D from './data.js';

export const openDoors = new Set();
export const chests = {};
export const torchLights = {};
export const blockEdits = {};

const CHUNK_SIZE = 16;

let sceneRef = null;
let threeRef = null;
const terrainChunks = new Map();
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

function chunkKey(cx, cz) {
  return cx + ',' + cz;
}

function disposeTerrainMesh(mesh) {
  if (!mesh) return;
  sceneRef.remove(mesh);
  mesh.geometry.dispose();
}

function rebuildTerrainChunk(cx, cz) {
  if (!sceneRef || !threeRef || !terrainMat) return;
  const maxCx = Math.ceil(D.WORLD_W / CHUNK_SIZE);
  const maxCz = Math.ceil(D.WORLD_D / CHUNK_SIZE);
  if (cx < 0 || cz < 0 || cx >= maxCx || cz >= maxCz) return;

  const k = chunkKey(cx, cz);
  disposeTerrainMesh(terrainChunks.get(k));
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  const geometry = D.buildMesh(threeRef, {
    x0,
    x1: x0 + CHUNK_SIZE,
    z0,
    z1: z0 + CHUNK_SIZE,
  });
  if (geometry.getAttribute('position').count === 0) {
    geometry.dispose();
    terrainChunks.delete(k);
    return;
  }

  const mesh = new threeRef.Mesh(geometry, terrainMat);
  sceneRef.add(mesh);
  terrainChunks.set(k, mesh);
}

export function rebuildTerrain() {
  if (!sceneRef || !threeRef || !terrainMat) return;
  for (const mesh of terrainChunks.values()) disposeTerrainMesh(mesh);
  terrainChunks.clear();
  const chunkCols = Math.ceil(D.WORLD_W / CHUNK_SIZE);
  const chunkRows = Math.ceil(D.WORLD_D / CHUNK_SIZE);
  for (let cz = 0; cz < chunkRows; cz++) {
    for (let cx = 0; cx < chunkCols; cx++) rebuildTerrainChunk(cx, cz);
  }
}

function rebuildAroundBlock(x, z) {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  const keys = new Set([chunkKey(cx, cz)]);
  if (x % CHUNK_SIZE === 0) keys.add(chunkKey(cx - 1, cz));
  if (x % CHUNK_SIZE === CHUNK_SIZE - 1) keys.add(chunkKey(cx + 1, cz));
  if (z % CHUNK_SIZE === 0) keys.add(chunkKey(cx, cz - 1));
  if (z % CHUNK_SIZE === CHUNK_SIZE - 1) keys.add(chunkKey(cx, cz + 1));
  for (const k of keys) {
    const [ccx, ccz] = k.split(',').map(Number);
    rebuildTerrainChunk(ccx, ccz);
  }
}

export function isSolidAt(x, y, z) {
  const id = D.getBlock(x, y, z);
  if (id === 15 && openDoors.has(keyOf(x, y, z))) return false;
  return D.isSolid(id);
}

export function setDoorOpen(x, y, z, open) {
  const k = keyOf(x, y, z);
  if (open) openDoors.add(k);
  else openDoors.delete(k);
}

export function setChestContents(key, contents = {}) {
  chests[key] = { ...contents };
}

export function snapshotChest(key) {
  return { ...(chests[key] || {}) };
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
  for (const k in state.chests || {}) chests[k] = { ...state.chests[k] };
  (state.openDoors || []).forEach(k => openDoors.add(k));
  Object.assign(blockEdits, state.edits || {});
  (state.torches || []).forEach(k => {
    const [x, y, z] = k.split(',').map(Number);
    addTorchLight(x, y, z);
  });
}

export function snapshotBlockState() {
  const chestSnapshot = {};
  for (const k in chests) chestSnapshot[k] = { ...chests[k] };
  return {
    chests: chestSnapshot,
    openDoors: Array.from(openDoors),
    torches: Object.keys(torchLights),
    edits: { ...blockEdits },
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
  if (rebuild) rebuildAroundBlock(x, z);
}

export function applyBlockEdits(edits = {}) {
  for (const k in edits) {
    const [x, y, z] = k.split(',').map(Number);
    applyBlockEdit(x, y, z, edits[k], { rebuild: false });
  }
  rebuildTerrain();
}
