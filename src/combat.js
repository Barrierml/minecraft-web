// ===== combat.js =====
// ECS-backed raycast helpers for player attacks.

import { Body, NetIdentity, Position } from './ecs/components.js';
import { queries } from './ecs/world.js';

export function raycastCreature(world, THREE, player, opts) {
  const origin = player.pos.clone();
  const dir = new THREE.Vector3(0, 0, -1)
    .applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'))
    .normalize();
  let best = -1;
  let bestT = opts.range;
  const ents = opts.kind === 'mob' ? queries.mobs(world) : queries.animals(world);
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    const min = new THREE.Vector3(
      Position.x[eid] - Body.radius[eid],
      Position.y[eid] - Body.height[eid],
      Position.z[eid] - Body.radius[eid]
    );
    const max = new THREE.Vector3(
      Position.x[eid] + Body.radius[eid],
      Position.y[eid],
      Position.z[eid] + Body.radius[eid]
    );
    const t = rayBoxIntersect(origin, dir, min, max);
    if (t !== null && t < bestT) {
      bestT = t;
      best = eid;
    }
  }
  return best;
}

export function netIdFor(eid) {
  return NetIdentity.id[eid];
}

export function findByNetId(world, kind, netId) {
  const ents = kind === 'mob'
    ? queries.mobs(world)
    : kind === 'animal'
      ? queries.animals(world)
      : queries.drops(world);
  for (const eid of ents) {
    if (NetIdentity.id[eid] === netId) return eid;
  }
  return -1;
}

export function rayBoxIntersect(o, d, min, max) {
  let tmin = 0;
  let tmax = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    if (Math.abs(d[ax]) < 1e-8) {
      if (o[ax] < min[ax] || o[ax] > max[ax]) return null;
    } else {
      let t1 = (min[ax] - o[ax]) / d[ax];
      let t2 = (max[ax] - o[ax]) / d[ax];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}
