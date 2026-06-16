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
  const bodyMat = new threeRef.MeshLambertMaterial({ color: t.body });
  const body = new threeRef.Mesh(new threeRef.BoxGeometry(0.7, 1.1, 0.4), bodyMat);
  body.position.y = 0.55;
  const head = new threeRef.Mesh(
    new threeRef.BoxGeometry(0.5, 0.5, 0.5),
    new threeRef.MeshLambertMaterial({ color: t.head })
  );
  head.position.y = 1.35;
  g.add(body);
  g.add(head);
  g.userData.bodyMat = bodyMat;
  return g;
}

export function makeAnimalMesh(typeKey) {
  const t = animalTypesRef[typeKey];
  const g = new threeRef.Group();
  const bodyMat = new threeRef.MeshLambertMaterial({ color: t.body });
  const body = new threeRef.Mesh(new threeRef.BoxGeometry(0.6, 0.7, 1.0), bodyMat);
  body.position.y = 0.55;
  const head = new threeRef.Mesh(
    new threeRef.BoxGeometry(0.45, 0.45, 0.45),
    new threeRef.MeshLambertMaterial({ color: t.head })
  );
  head.position.set(0, 0.75, 0.6);
  g.add(body);
  g.add(head);
  g.userData.bodyMat = bodyMat;
  return g;
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
  }
  dropMesh(eid);
  removeEntity(ecsWorld, eid);
}
