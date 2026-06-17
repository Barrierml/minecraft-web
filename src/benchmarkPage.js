// ===== benchmarkPage.js =====
// Standalone benchmark entry. It avoids touching the main game bootstrap.

import * as THREE from 'three';
import * as D from './data.js';
import { seedFromString } from './save.js';
import {
  BENCHMARK_LIMITS,
  buildBenchmarkConfig,
  createBenchmarkRunner,
  readBenchmarkConfig,
} from './benchmark.js';
import {
  initWorldRuntime, rebuildTerrain, updateBlockTexture,
  clearBlockState, surfaceY, isSolidAt,
} from './world.js';
import { createPlayer } from './player.js';
import { createClouds } from './clouds.js';
import { createDayCycle } from './daycycle.js';
import { createHand } from './hand.js';
import * as FX from './fx.js';
import { ecsWorld, queries } from './ecs/world.js';
import { initFactories, setNextNetId, spawnAnimal, spawnDrop, spawnMob } from './ecs/factories.js';
import { clearDrops, updateDropsSystem } from './ecs/systems/drops.js';
import { clearAnimals, ensureAnimals, updateAnimalsSystem } from './ecs/systems/animals.js';
import { clearMobs, ensureMobs, updateMobsSystem } from './ecs/systems/mobs.js';
import { syncMeshSystem, updateFlashSystem } from './ecs/systems/render.js';
import { updateSunburnSystem } from './ecs/systems/sunburn.js';

const {
  WORLD_W, WORLD_H, WORLD_D,
  GRAVITY, JUMP_SPEED, PLAYER_HEIGHT, DROP_LIFETIME,
  MOB_COUNT, MOB_SIGHT, MOB_RADIUS, MOB_HEIGHT, MOB_ATTACK_CD, MOB_TYPES, MOB_TYPE_KEYS,
  ANIMAL_COUNT, ANIMAL_TYPES, ANIMAL_TYPE_KEYS,
  world, generateWorld, getBlock, isSolid, itemColor,
} = D;

const configOptions = {
  defaultSeed: 1337,
  parseSeed: seedFromString,
};
let config = readBenchmarkConfig(configOptions);

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x88bbee);
scene.fog = new THREE.Fog(0x88bbee, 40, 90);

initWorldRuntime(THREE, scene);

const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
scene.add(camera);
const hand = createHand(THREE, { camera });

const ambient = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(0.5, 1, 0.3);
scene.add(sun);

const stars = FX.makeStars(THREE);
scene.add(stars);
const particles = FX.makeParticleSystem(THREE, scene);
const clouds = createClouds(THREE, { scene, worldW: WORLD_W, worldH: WORLD_H, worldD: WORLD_D });
const player = createPlayer(THREE, {
  worldW: WORLD_W,
  worldH: WORLD_H,
  worldD: WORLD_D,
  maxHealth: 20,
  maxHunger: 20,
});
const dayCycle = createDayCycle(THREE, { scene, sun, ambient, stars, player });

const dropGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
const dropMatCache = {};
function dropMat(id) {
  if (!dropMatCache[id]) dropMatCache[id] = new THREE.MeshLambertMaterial({ color: itemColor(id) });
  return dropMatCache[id];
}
initFactories({
  THREE,
  scene,
  dropGeometry: dropGeo,
  dropMaterial: dropMat,
  mobTypeKeys: MOB_TYPE_KEYS,
  mobTypes: MOB_TYPES,
  animalTypeKeys: ANIMAL_TYPE_KEYS,
  animalTypes: ANIMAL_TYPES,
});

let gameTime = 0;
let benchmarkElapsed = 0;
let particleAccumulator = 0;
let benchmark = null;
let last = performance.now();
let animationId = 0;
const stressProps = [];
const stressLights = [];
const stressLightMarkers = [];
const propGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
const lightMarkerGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
const propMats = [
  new THREE.MeshLambertMaterial({ color: 0x9a9a9a }),
  new THREE.MeshLambertMaterial({ color: 0x8a6a3a }),
  new THREE.MeshLambertMaterial({ color: 0x3f7d2f }),
  new THREE.MeshLambertMaterial({ color: 0xc9a86a }),
];
const lightMarkerMat = new THREE.MeshBasicMaterial({ color: 0xffcc66 });
const controlsForm = document.getElementById('benchControls');
const statusEl = document.getElementById('benchStatus');
const reportEl = document.getElementById('benchReport');
const runButton = document.getElementById('runBenchBtn');

function field(name) {
  return controlsForm?.elements.namedItem(name);
}

function writeField(name, value) {
  const el = field(name);
  if (el) el.value = value;
}

function writeDerivedStressFields(value) {
  const derived = buildBenchmarkConfig({ stress: value }, configOptions);
  writeField('extraMobs', derived.extraMobs);
  writeField('extraAnimals', derived.extraAnimals);
  writeField('drops', derived.drops);
  writeField('props', derived.props);
  writeField('lights', derived.lights);
  writeField('particleRate', derived.particleBurstsPerSecond);
  writeField('particleSize', derived.particleBurstSize);
}

function writeControls(nextConfig) {
  writeField('title', nextConfig.title);
  writeField('seed', nextConfig.seed);
  writeField('duration', nextConfig.duration);
  writeField('warmup', nextConfig.warmup);
  writeField('stress', nextConfig.stress);
  writeField('time', nextConfig.fixedTime);
  writeField('height', nextConfig.cameraHeight);
  writeField('loops', nextConfig.cameraLoops);
  writeField('extraMobs', nextConfig.extraMobs);
  writeField('extraAnimals', nextConfig.extraAnimals);
  writeField('drops', nextConfig.drops);
  writeField('props', nextConfig.props);
  writeField('lights', nextConfig.lights);
  writeField('particleRate', nextConfig.particleBurstsPerSecond);
  writeField('particleSize', nextConfig.particleBurstSize);
}

function readControls() {
  if (!controlsForm) return config;
  const source = {};
  for (const el of controlsForm.elements) {
    if (!el.name) continue;
    source[el.name] = el.value;
  }
  source.enabled = true;
  return buildBenchmarkConfig(source, configOptions);
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function configureInputLimits() {
  const mapping = {
    duration: BENCHMARK_LIMITS.duration,
    warmup: BENCHMARK_LIMITS.warmup,
    stress: BENCHMARK_LIMITS.stress,
    time: BENCHMARK_LIMITS.fixedTime,
    height: BENCHMARK_LIMITS.cameraHeight,
    loops: BENCHMARK_LIMITS.cameraLoops,
    extraMobs: BENCHMARK_LIMITS.extraMobs,
    extraAnimals: BENCHMARK_LIMITS.extraAnimals,
    drops: BENCHMARK_LIMITS.drops,
    props: BENCHMARK_LIMITS.props,
    lights: BENCHMARK_LIMITS.lights,
    particleRate: BENCHMARK_LIMITS.particleBurstsPerSecond,
    particleSize: BENCHMARK_LIMITS.particleBurstSize,
  };
  for (const [name, limit] of Object.entries(mapping)) {
    const el = field(name);
    if (!el) continue;
    el.min = String(limit.min);
    el.max = String(limit.max);
  }
}

function bindControls() {
  if (!controlsForm) return;
  configureInputLimits();
  writeControls(config);
  controlsForm.addEventListener('submit', e => {
    e.preventDefault();
    startBenchmark(readControls());
  });
  field('stress')?.addEventListener('input', e => writeDerivedStressFields(e.target.value));
  for (const btn of controlsForm.querySelectorAll('[data-preset]')) {
    btn.addEventListener('click', () => {
      writeField('stress', btn.dataset.preset);
      writeDerivedStressFields(btn.dataset.preset);
      startBenchmark(readControls());
    });
  }
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);

function baseCreatureCtx(extra = {}) {
  return {
    world: ecsWorld,
    player,
    gameTime,
    worldW: WORLD_W,
    worldH: WORLD_H,
    worldD: WORLD_D,
    radius: MOB_RADIUS,
    height: MOB_HEIGHT,
    gravity: GRAVITY,
    jumpSpeed: JUMP_SPEED,
    surfaceY,
    isSolidAt,
    spawnDrop,
    ...extra,
  };
}

function mobCtx(extra = {}) {
  return baseCreatureCtx({
    count: MOB_COUNT,
    sight: MOB_SIGHT,
    attackCooldown: MOB_ATTACK_CD,
    mobTypes: MOB_TYPES,
    mobTypeKeys: MOB_TYPE_KEYS,
    dayCycle,
    getBlock,
    isSolid,
    damagePlayer: () => {},
    spawnDamageText: () => {},
    playSound: () => {},
    particles,
    ...extra,
  });
}

function animalCtx(extra = {}) {
  return baseCreatureCtx({
    count: ANIMAL_COUNT,
    animalTypes: ANIMAL_TYPES,
    animalTypeKeys: ANIMAL_TYPE_KEYS,
    ...extra,
  });
}

function rand(index, salt = 0) {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function worldSpot(index, salt = 0, margin = 4) {
  const x = margin + Math.floor(rand(index, salt) * (WORLD_W - margin * 2));
  const z = margin + Math.floor(rand(index, salt + 11) * (WORLD_D - margin * 2));
  return { x, y: surfaceY(x, z), z };
}

function clearStressObjects() {
  for (const obj of stressProps) scene.remove(obj);
  for (const obj of stressLights) scene.remove(obj);
  for (const obj of stressLightMarkers) scene.remove(obj);
  stressProps.length = 0;
  stressLights.length = 0;
  stressLightMarkers.length = 0;
}

function clearParticles() {
  for (const particle of particles.particles) scene.remove(particle.mesh);
  particles.particles.length = 0;
}

function createStressProps() {
  for (let i = 0; i < config.props; i++) {
    const p = worldSpot(i, 31);
    const mesh = new THREE.Mesh(propGeo, propMats[i % propMats.length]);
    mesh.position.set(p.x + 0.5, p.y + 0.35 + (i % 3) * 0.35, p.z + 0.5);
    mesh.rotation.set(rand(i, 4) * 0.4, rand(i, 5) * Math.PI, rand(i, 6) * 0.4);
    mesh.scale.setScalar(0.7 + rand(i, 7) * 0.9);
    scene.add(mesh);
    stressProps.push(mesh);
  }
}

function createStressLights() {
  for (let i = 0; i < config.lights; i++) {
    const p = worldSpot(i, 51, 6);
    const light = new THREE.PointLight(0xffbb66, 0.65, 20);
    light.position.set(p.x + 0.5, p.y + 4 + (i % 4), p.z + 0.5);
    scene.add(light);
    stressLights.push(light);

    const marker = new THREE.Mesh(lightMarkerGeo, lightMarkerMat);
    marker.position.copy(light.position);
    scene.add(marker);
    stressLightMarkers.push(marker);
  }
}

function spawnStressCreatures() {
  for (let i = 0; i < config.extraMobs; i++) {
    const p = worldSpot(i, 71, 5);
    spawnMob({
      type: MOB_TYPE_KEYS[i % MOB_TYPE_KEYS.length],
      x: p.x + 0.5,
      y: p.y + MOB_HEIGHT,
      z: p.z + 0.5,
      radius: MOB_RADIUS,
      height: MOB_HEIGHT,
    });
  }
  for (let i = 0; i < config.extraAnimals; i++) {
    const p = worldSpot(i, 91, 5);
    spawnAnimal({
      type: ANIMAL_TYPE_KEYS[i % ANIMAL_TYPE_KEYS.length],
      x: p.x + 0.5,
      y: p.y + MOB_HEIGHT,
      z: p.z + 0.5,
      radius: MOB_RADIUS,
      height: MOB_HEIGHT,
    });
  }
}

function spawnStressDrops() {
  const itemIds = [2, 3, 4, 8, 9, 10, 11, 101, 105, 106, 107, 108];
  for (let i = 0; i < config.drops; i++) {
    const p = worldSpot(i, 111, 4);
    spawnDrop(p.x, p.y, p.z, itemIds[i % itemIds.length]);
  }
}

function spawnStressParticles(dt) {
  if (config.particleBurstsPerSecond <= 0) return;
  particleAccumulator += dt * config.particleBurstsPerSecond;
  while (particleAccumulator >= 1) {
    particleAccumulator--;
    const i = Math.floor((gameTime + particleAccumulator) * 10);
    const p = worldSpot(i, 131, 8);
    const color = [0xff8844, 0xffcc44, 0x88ccff, 0xaaff88][i % 4];
    particles.burst(p.x + 0.5, p.y + 1.2, p.z + 0.5, color, config.particleBurstSize, 4.5, 0.75);
  }
}

function resetBenchmarkWorld() {
  world.fill(0);
  generateWorld(config.seed);
  clearBlockState();
  clearDrops(ecsWorld);
  clearMobs(ecsWorld);
  clearAnimals(ecsWorld);
  clearParticles();
  setNextNetId(1);
  rebuildTerrain();
  clouds.make();
  dayCycle.setTime(config.fixedTime);
  gameTime = 0;
  benchmarkElapsed = 0;
  particleAccumulator = 0;
  clearStressObjects();

  ensureMobs(ecsWorld, mobCtx());
  ensureAnimals(ecsWorld, animalCtx());
  spawnStressCreatures();
  spawnStressDrops();
  createStressProps();
  createStressLights();
}

function terrainStats() {
  let chunks = 0;
  let chunkVertices = 0;
  let chunkTriangles = 0;
  let objects = 0;
  let meshes = 0;
  scene.traverse(obj => {
    objects++;
    if (obj.isMesh) meshes++;
    const mat = obj.material;
    const geo = obj.geometry;
    if (!obj.isMesh || !geo || !mat?.vertexColors || !geo.getAttribute('color')) return;
    const position = geo.getAttribute('position');
    const index = geo.getIndex();
    chunks++;
    chunkVertices += position ? position.count : 0;
    chunkTriangles += index ? index.count / 3 : (position ? position.count / 3 : 0);
  });
  return { chunks, chunkVertices, chunkTriangles, objects, meshes };
}

function getRuntimeStats() {
  const renderInfo = renderer.info.render;
  const memoryInfo = renderer.info.memory;
  const terrain = terrainStats();
  return {
    drawCalls: renderInfo.calls,
    triangles: renderInfo.triangles,
    lines: renderInfo.lines,
    points: renderInfo.points,
    geometries: memoryInfo.geometries,
    textures: memoryInfo.textures,
    chunks: terrain.chunks,
    chunkVertices: terrain.chunkVertices,
    chunkTriangles: terrain.chunkTriangles,
    torches: 0,
    mobs: queries.mobs(ecsWorld).length,
    animals: queries.animals(ecsWorld).length,
    drops: queries.drops(ecsWorld).length,
    particles: particles.particles.length,
    props: stressProps.length,
    lights: stressLights.length,
    objects: terrain.objects,
    meshes: terrain.meshes,
  };
}

function updateBenchmark(dt) {
  gameTime += dt;
  benchmarkElapsed += dt;
  benchmark.updateCamera(benchmarkElapsed);

  updateMobsSystem(ecsWorld, dt, mobCtx());
  updateSunburnSystem(ecsWorld, dt, mobCtx());
  updateAnimalsSystem(ecsWorld, dt, animalCtx());
  ensureMobs(ecsWorld, mobCtx());
  ensureAnimals(ecsWorld, animalCtx());

  updateDropsSystem(ecsWorld, dt, {
    player,
    playerHeight: PLAYER_HEIGHT,
    gravity: GRAVITY,
    pickupRange: -1,
    dropLifetime: DROP_LIFETIME,
    getBlock,
    isSolid,
    pickup: () => {},
  });

  hand.update(dt);
  spawnStressParticles(dt);
  updateFlashSystem(ecsWorld, dt, {
    mobTypes: MOB_TYPES,
    animalTypes: ANIMAL_TYPES,
    gameTime,
  });
  syncMeshSystem(ecsWorld, { player, dt });
}

function createRunner() {
  return createBenchmarkRunner({
    config,
    renderer,
    camera,
    player,
    worldSize: { width: WORLD_W, height: WORLD_H, depth: WORLD_D },
    getStats: getRuntimeStats,
  });
}

function startBenchmark(nextConfig) {
  if (animationId) cancelAnimationFrame(animationId);
  config = nextConfig;
  window.__perfReport = null;
  window.__benchmarkConfig = config;
  writeControls(config);
  if (reportEl) reportEl.textContent = 'Benchmark is running...';
  if (runButton) runButton.textContent = 'Restart benchmark';
  setStatus('Preparing scene...');
  resetBenchmarkWorld();
  onResize();
  benchmark = createRunner();
  last = performance.now();
  animationId = requestAnimationFrame(animate);
}

function animate(now) {
  try {
    const frameMs = now - last;
    const dt = Math.min(frameMs / 1000, 0.05);
    last = now;

    const frameStart = performance.now();
    updateBenchmark(dt);
    const gameUpdateEnd = performance.now();

    dayCycle.update(dt);
    clouds.update(dt);
    particles.update(dt, GRAVITY);
    updateBlockTexture(dt);

    const renderStart = performance.now();
    renderer.render(scene, camera);
    const renderEnd = performance.now();

    if (benchmark.record(now, {
      frameMs,
      gameUpdateMs: gameUpdateEnd - frameStart,
      worldEffectsMs: renderStart - gameUpdateEnd,
      renderMs: renderEnd - renderStart,
      totalJsMs: renderEnd - frameStart,
    })) {
      animationId = 0;
      if (runButton) runButton.textContent = 'Run benchmark';
      return;
    }
  } catch (err) {
    window.__animErr = (err && err.stack) || String(err);
    if (reportEl) reportEl.textContent = 'ERR: ' + ((err && err.stack) || String(err));
    animationId = 0;
    if (runButton) runButton.textContent = 'Run benchmark';
    return;
  }
  animationId = requestAnimationFrame(animate);
}

bindControls();
startBenchmark(config);
