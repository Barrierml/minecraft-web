// ===== ecs/factories.js =====
// Entity creation/removal helpers. Keep business side effects outside factories.

import { addComponent, addEntity, removeEntity } from 'bitecs';
import {
  Animal, Body, Drop, Health, Mob, NetIdentity, Position, Velocity,
  dropMesh, getMesh, setMesh,
} from './components.js';
import { ecsWorld } from './world.js';

let sceneRef = null;
let threeRef = null;
let dropGeo = null;
let dropMatFor = null;
let mobTypeKeysRef = [];
let mobTypesRef = {};
let animalTypeKeysRef = [];
let animalTypesRef = {};
let nextNetId = 1;
const geometryCache = new Map();

export function initFactories({
  THREE,
  scene,
  dropGeometry,
  dropMaterial,
  mobTypeKeys = [],
  mobTypes = {},
  animalTypeKeys = [],
  animalTypes = {},
}) {
  threeRef = THREE;
  sceneRef = scene;
  dropGeo = dropGeometry;
  dropMatFor = dropMaterial;
  mobTypeKeysRef = mobTypeKeys;
  mobTypesRef = mobTypes;
  animalTypeKeysRef = animalTypeKeys;
  animalTypesRef = animalTypes;
}

export function getNextNetId() {
  return nextNetId;
}

export function setNextNetId(id) {
  nextNetId = Math.max(1, id | 0);
}

export function reserveNetId(id) {
  if (id >= nextNetId) nextNetId = id + 1;
  return id;
}

function assignNetId(eid, netId) {
  addComponent(ecsWorld, eid, NetIdentity);
  NetIdentity.id[eid] = netId ?? nextNetId++;
}

export function getMobTypeKey(eid) {
  return mobTypeKeysRef[Mob.type[eid]];
}

export function getAnimalTypeKey(eid) {
  return animalTypeKeysRef[Animal.type[eid]];
}

function boxGeometry(key, w, h, d) {
  const fullKey = `${key}:${w},${h},${d}`;
  if (!geometryCache.has(fullKey)) geometryCache.set(fullKey, new threeRef.BoxGeometry(w, h, d));
  return geometryCache.get(fullKey);
}

function addBox(group, key, size, pos, color) {
  const mat = new threeRef.MeshLambertMaterial({ color });
  const mesh = new threeRef.Mesh(boxGeometry(key, size[0], size[1], size[2]), mat);
  mesh.position.set(pos[0], pos[1], pos[2]);
  group.add(mesh);
  return { mesh, mat };
}

function addKinematicBody(eid, x, y, z, radius, height) {
  addComponent(ecsWorld, eid, Position);
  addComponent(ecsWorld, eid, Velocity);
  addComponent(ecsWorld, eid, Body);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Position.z[eid] = z;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Velocity.z[eid] = 0;
  Body.radius[eid] = radius;
  Body.height[eid] = height;
  Body.onGround[eid] = 0;
}

export function spawnDrop(x, y, z, itemId, netId) {
  const eid = addEntity(ecsWorld);
  addKinematicBody(eid, x + 0.5, y + 0.4, z + 0.5, 0.15, 0.3);
  addComponent(ecsWorld, eid, Drop);
  assignNetId(eid, netId);

  Velocity.x[eid] = 0;
  Velocity.y[eid] = 2;
  Velocity.z[eid] = 0;
  Drop.itemId[eid] = itemId;
  Drop.age[eid] = 0;

  const mesh = new threeRef.Mesh(dropGeo, dropMatFor(itemId));
  mesh.position.set(Position.x[eid], Position.y[eid], Position.z[eid]);
  sceneRef.add(mesh);
  setMesh(eid, mesh);
  return eid;
}

export function makeMobMesh(typeKey) {
  const t = mobTypesRef[typeKey];
  const g = new threeRef.Group();
  let bodyMat;

  if (typeKey === 'creeper') {
    bodyMat = addBox(g, 'creeperBody', [0.56, 1.08, 0.36], [0, 0.78, 0], t.body).mat;
    addBox(g, 'creeperHead', [0.62, 0.62, 0.62], [0, 1.48, 0], t.head);
    const feet = [
      addBox(g, 'creeperFoot', [0.24, 0.28, 0.24], [-0.22, 0.14, -0.14], 0x1f6a2d).mesh,
      addBox(g, 'creeperFoot', [0.24, 0.28, 0.24], [0.22, 0.14, -0.14], 0x1f6a2d).mesh,
      addBox(g, 'creeperFoot', [0.24, 0.28, 0.24], [-0.22, 0.14, 0.14], 0x1f6a2d).mesh,
      addBox(g, 'creeperFoot', [0.24, 0.28, 0.24], [0.22, 0.14, 0.14], 0x1f6a2d).mesh,
    ];
    g.userData.walkParts = feet;
    addBox(g, 'facePixel', [0.12, 0.12, 0.025], [-0.14, 1.56, -0.325], 0x101010);
    addBox(g, 'facePixel', [0.12, 0.12, 0.025], [0.14, 1.56, -0.325], 0x101010);
    addBox(g, 'facePixel', [0.12, 0.22, 0.025], [0, 1.38, -0.325], 0x101010);
  } else if (typeKey === 'skeleton') {
    bodyMat = addBox(g, 'skeletonRib', [0.46, 0.82, 0.22], [0, 0.82, 0], t.body).mat;
    addBox(g, 'skeletonHead', [0.48, 0.48, 0.48], [0, 1.44, 0], t.head);
    g.userData.walkParts = [
      addBox(g, 'boneLimb', [0.14, 0.9, 0.14], [-0.36, 0.78, 0], 0xe8e8df).mesh,
      addBox(g, 'boneLimb', [0.14, 0.9, 0.14], [0.36, 0.78, 0], 0xe8e8df).mesh,
      addBox(g, 'boneLimb', [0.16, 0.72, 0.16], [-0.14, 0.28, 0], 0xe8e8df).mesh,
      addBox(g, 'boneLimb', [0.16, 0.72, 0.16], [0.14, 0.28, 0], 0xe8e8df).mesh,
    ];
    addBox(g, 'facePixel', [0.1, 0.1, 0.025], [-0.12, 1.5, -0.255], 0x101010);
    addBox(g, 'facePixel', [0.1, 0.1, 0.025], [0.12, 1.5, -0.255], 0x101010);
    addBox(g, 'facePixel', [0.18, 0.06, 0.025], [0, 1.34, -0.255], 0x101010);
  } else {
    bodyMat = addBox(g, 'zombieBody', [0.68, 1.08, 0.36], [0, 0.78, 0], t.body).mat;
    addBox(g, 'zombieHead', [0.54, 0.54, 0.54], [0, 1.46, 0], t.head);
    const leftArm = addBox(g, 'zombieArm', [0.18, 0.84, 0.18], [-0.45, 0.82, -0.08], 0x4f8a3e).mesh;
    const rightArm = addBox(g, 'zombieArm', [0.18, 0.84, 0.18], [0.45, 0.82, -0.08], 0x4f8a3e).mesh;
    leftArm.rotation.x = -0.42;
    rightArm.rotation.x = -0.42;
    const leftLeg = addBox(g, 'zombieLeg', [0.22, 0.7, 0.22], [-0.16, 0.27, 0], 0x2b4b8f).mesh;
    const rightLeg = addBox(g, 'zombieLeg', [0.22, 0.7, 0.22], [0.16, 0.27, 0], 0x2b4b8f).mesh;
    g.userData.walkParts = [leftArm, rightArm, leftLeg, rightLeg];
    addBox(g, 'facePixel', [0.1, 0.08, 0.025], [-0.12, 1.51, -0.285], 0x121212);
    addBox(g, 'facePixel', [0.1, 0.08, 0.025], [0.12, 1.51, -0.285], 0x121212);
    addBox(g, 'facePixel', [0.2, 0.05, 0.025], [0, 1.36, -0.285], 0x2a1b1b);
  }

  g.userData.bodyMat = bodyMat;
  g.userData.disposeMaterials = true;
  return g;
}

export function makeAnimalMesh(typeKey) {
  const t = animalTypesRef[typeKey];
  const g = new threeRef.Group();
  const bodyMat = addBox(g, 'animalBody', [0.62, 0.62, 0.98], [0, 0.52, 0], t.body).mat;
  addBox(g, 'animalHead', [0.42, 0.42, 0.42], [0, 0.76, 0.62], t.head);
  const hoofColor = typeKey === 'sheep' ? 0xd8d8d8 : 0x2b2018;
  g.userData.walkParts = [
    addBox(g, 'animalLeg', [0.14, 0.42, 0.14], [-0.22, 0.18, -0.28], hoofColor).mesh,
    addBox(g, 'animalLeg', [0.14, 0.42, 0.14], [0.22, 0.18, -0.28], hoofColor).mesh,
    addBox(g, 'animalLeg', [0.14, 0.42, 0.14], [-0.22, 0.18, 0.28], hoofColor).mesh,
    addBox(g, 'animalLeg', [0.14, 0.42, 0.14], [0.22, 0.18, 0.28], hoofColor).mesh,
  ];
  addBox(g, 'facePixel', [0.06, 0.06, 0.02], [-0.09, 0.82, 0.835], 0x111111);
  addBox(g, 'facePixel', [0.06, 0.06, 0.02], [0.09, 0.82, 0.835], 0x111111);
  g.userData.bodyMat = bodyMat;
  g.userData.disposeMaterials = true;
  return g;
}

function disposeOwnedMaterials(root) {
  if (!root.userData.disposeMaterials) return;
  root.traverse(obj => {
    const material = obj.material;
    if (!material) return;
    if (Array.isArray(material)) material.forEach(mat => mat.dispose());
    else material.dispose();
  });
}

export function spawnMob({ type, x, y, z, radius, height, netId }) {
  const typeIndex = mobTypeKeysRef.indexOf(type);
  if (typeIndex < 0) throw new Error(`Unknown mob type: ${type}`);
  const t = mobTypesRef[type];
  const eid = addEntity(ecsWorld);
  addKinematicBody(eid, x, y, z, radius, height);
  addComponent(ecsWorld, eid, Health);
  addComponent(ecsWorld, eid, Mob);
  assignNetId(eid, netId);

  Health.hp[eid] = t.health;
  Health.max[eid] = t.health;
  Health.hitFlash[eid] = 0;
  Mob.type[eid] = typeIndex;
  Mob.attackCd[eid] = 0;
  Mob.soundCd[eid] = 2 + Math.random() * 6;
  Mob.fuse[eid] = -1;

  const mesh = makeMobMesh(type);
  mesh.position.set(x, y - height, z);
  sceneRef.add(mesh);
  setMesh(eid, mesh);
  return eid;
}

export function spawnAnimal({ type, x, y, z, radius, height, netId }) {
  const typeIndex = animalTypeKeysRef.indexOf(type);
  if (typeIndex < 0) throw new Error(`Unknown animal type: ${type}`);
  const t = animalTypesRef[type];
  const eid = addEntity(ecsWorld);
  addKinematicBody(eid, x, y, z, radius, height);
  addComponent(ecsWorld, eid, Health);
  addComponent(ecsWorld, eid, Animal);
  assignNetId(eid, netId);

  Health.hp[eid] = t.health;
  Health.max[eid] = t.health;
  Health.hitFlash[eid] = 0;
  Animal.type[eid] = typeIndex;
  Animal.wanderDir[eid] = Math.random() * Math.PI * 2;
  Animal.wanderTimer[eid] = 0;

  const mesh = makeAnimalMesh(type);
  mesh.position.set(x, y - height, z);
  sceneRef.add(mesh);
  setMesh(eid, mesh);
  return eid;
}

export function removeEcsEntity(eid) {
  const mesh = getMesh(eid);
  if (mesh && sceneRef) {
    sceneRef.remove(mesh);
    disposeOwnedMaterials(mesh);
  }
  dropMesh(eid);
  removeEntity(ecsWorld, eid);
}
