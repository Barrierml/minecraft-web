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
let fluidCursor = 0;

export function keyOf(x, y, z) {
  return x + ',' + y + ',' + z;
}

export function initWorldRuntime(THREE, scene) {
  threeRef = THREE;
  sceneRef = scene;
  blockTexture = makeTerrainAtlas(THREE);
  terrainMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: blockTexture,
    alphaTest: 0.35,
  });
}

function fillFallbackTile(ctx, x, y, size, hue) {
  ctx.fillStyle = `hsl(${hue}, 28%, 58%)`;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  for (let yy = 0; yy < size; yy += 16) {
    for (let xx = 0; xx < size; xx += 16) {
      if ((xx + yy) % 32 === 0) ctx.fillRect(x + xx, y + yy, 16, 16);
    }
  }
}

function makeTerrainAtlas(THREE) {
  const tileSize = 128;
  const atlasSize = D.TERRAIN_ATLAS_SIZE * tileSize;
  const cv = document.createElement('canvas');
  cv.width = cv.height = atlasSize;
  const ctx = cv.getContext('2d');

  D.TERRAIN_TEXTURES.forEach((name, i) => {
    const x = (i % D.TERRAIN_ATLAS_SIZE) * tileSize;
    const y = Math.floor(i / D.TERRAIN_ATLAS_SIZE) * tileSize;
    fillFallbackTile(ctx, x, y, tileSize, (i * 47) % 360);
  });

  const tex = new THREE.CanvasTexture(cv);
  // UVs are generated in canvas row order (top row first). Three's default
  // flipY=true would invert the atlas and make blocks sample the wrong tile.
  tex.flipY = false;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.animateOffset = false;

  D.TERRAIN_TEXTURES.forEach((name, i) => {
    const img = new Image();
    img.onload = () => {
      const x = (i % D.TERRAIN_ATLAS_SIZE) * tileSize;
      const y = Math.floor(i / D.TERRAIN_ATLAS_SIZE) * tileSize;
      ctx.clearRect(x, y, tileSize, tileSize);
      ctx.drawImage(img, x, y, tileSize, tileSize);
      tex.needsUpdate = true;
    };
    img.onerror = () => console.warn('Texture failed to load:', name);
    img.src = new URL(`../assets/textures/kenney/${name}`, import.meta.url).href;
  });

  return tex;
}

export function updateBlockTexture(dt) {
  if (blockTexture?.userData.animateOffset) {
    blockTexture.offset.x = (blockTexture.offset.x + dt * 0.02) % 1;
  }
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

function canSandFallInto(id) {
  return id === D.AIR || id === 7;
}

function recordRuntimeBlock(x, y, z, id) {
  D.setBlock(x, y, z, id);
  blockEdits[keyOf(x, y, z)] = id;
}

function settleSandColumn(x, z) {
  if (x < 0 || x >= D.WORLD_W || z < 0 || z >= D.WORLD_D) return [];
  const changed = [];
  for (let y = 1; y < D.WORLD_H; y++) {
    if (D.getBlock(x, y, z) !== 6) continue;
    let ny = y;
    while (ny > 0 && canSandFallInto(D.getBlock(x, ny - 1, z))) ny--;
    if (ny === y) continue;
    recordRuntimeBlock(x, y, z, D.AIR);
    recordRuntimeBlock(x, ny, z, 6);
    changed.push([x, z]);
  }
  return changed;
}

function canWaterFlowInto(id) {
  return id === D.AIR;
}

function waterSupported(x, y, z) {
  const below = D.getBlock(x, y - 1, z);
  return y <= 0 || D.isSolid(below) || below === 7;
}

function trySetWater(x, y, z, dirty, out) {
  if (!D.inBounds(x, y, z) || !canWaterFlowInto(D.getBlock(x, y, z))) return false;
  recordRuntimeBlock(x, y, z, 7);
  dirty.add(`${x},${z}`);
  out.push({ x, y, z, id: 7 });
  return true;
}

export function updateFluidPhysics({ scan = 1400, maxChanges = 36 } = {}) {
  const dirty = new Set();
  const out = [];
  const total = D.world.length;
  for (let checked = 0; checked < scan && out.length < maxChanges; checked++) {
    const i = fluidCursor;
    fluidCursor = (fluidCursor + 1) % total;
    if (D.world[i] !== 7) continue;

    const y = Math.floor(i / (D.WORLD_W * D.WORLD_D));
    const rem = i - y * D.WORLD_W * D.WORLD_D;
    const z = Math.floor(rem / D.WORLD_W);
    const x = rem - z * D.WORLD_W;

    if (y > 0 && trySetWater(x, y - 1, z, dirty, out)) continue;
    if (!waterSupported(x, y, z)) continue;

    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    const start = (x * 13 + z * 7 + y) & 3;
    for (let d = 0; d < 4 && out.length < maxChanges; d++) {
      const [dx, dz] = dirs[(start + d) % dirs.length];
      const nx = x + dx, nz = z + dz;
      if (!D.inBounds(nx, y, nz)) continue;
      if (y > 0 && !waterSupported(nx, y, nz)) continue;
      trySetWater(nx, y, nz, dirty, out);
    }
  }
  for (const k of dirty) {
    const [x, z] = k.split(',').map(Number);
    rebuildAroundBlock(x, z);
  }
  return out;
}

export function applyBlockEdit(x, y, z, id, { rebuild = true } = {}) {
  const prev = D.getBlock(x, y, z);
  D.setBlock(x, y, z, id);
  if (prev === 14 && id !== 14) removeTorchLight(x, y, z);
  if (id === 14) addTorchLight(x, y, z);
  if (prev === 15 && id !== 15) openDoors.delete(keyOf(x, y, z));
  if (prev === 17 && id !== 17) delete chests[keyOf(x, y, z)];
  blockEdits[keyOf(x, y, z)] = id;
  const dirtyColumns = new Set([`${x},${z}`]);
  for (const [sx, sz] of settleSandColumn(x, z)) dirtyColumns.add(`${sx},${sz}`);
  if (rebuild) {
    for (const k of dirtyColumns) {
      const [rx, rz] = k.split(',').map(Number);
      rebuildAroundBlock(rx, rz);
    }
  }
}

export function applyBlockEdits(edits = {}) {
  for (const k in edits) {
    const [x, y, z] = k.split(',').map(Number);
    applyBlockEdit(x, y, z, edits[k], { rebuild: false });
  }
  rebuildTerrain();
}
