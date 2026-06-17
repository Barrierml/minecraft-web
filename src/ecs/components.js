// ===== ecs/components.js =====
// bitECS 0.4 core component stores and sparse object refs.

export const Position = {
  x: [],
  y: [],
  z: [],
};

export const Velocity = {
  x: [],
  y: [],
  z: [],
};

export const Body = {
  radius: [],
  height: [],
  onGround: [],
};

export const Health = {
  hp: [],
  max: [],
  hitFlash: [],
};

export const Mob = {
  type: [],
  attackCd: [],
  soundCd: [],
  fuse: [],
};

export const Animal = {
  type: [],
  wanderDir: [],
  wanderTimer: [],
};

export const Drop = {
  itemId: [],
  age: [],
};

export const NetIdentity = {
  id: [],
};

export const meshRefs = new Map();

export function setMesh(eid, mesh) {
  meshRefs.set(eid, mesh);
}

export function getMesh(eid) {
  return meshRefs.get(eid);
}

export function dropMesh(eid) {
  meshRefs.delete(eid);
}
