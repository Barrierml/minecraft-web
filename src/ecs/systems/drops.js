// ===== ecs/systems/drops.js =====
// Drop physics, pickup, lifetime, and mesh sync.

import { Body, Drop, NetIdentity, Position, Velocity, getMesh } from '../components.js';
import { queries } from '../world.js';
import { removeEcsEntity, reserveNetId, spawnDrop } from '../factories.js';

export function updateDropsSystem(world, dt, ctx) {
  const ents = queries.drops(world);
  const feetY = ctx.player.pos.y - ctx.playerHeight;
  for (let i = ents.length - 1; i >= 0; i--) {
    const eid = ents[i];
    Drop.age[eid] += dt;

    Velocity.y[eid] -= ctx.gravity * dt;
    Position.y[eid] += Velocity.y[eid] * dt;

    const below = ctx.getBlock(
      Math.floor(Position.x[eid]),
      Math.floor(Position.y[eid] - 0.2),
      Math.floor(Position.z[eid])
    );
    if (ctx.isSolid(below) && Velocity.y[eid] < 0) {
      Position.y[eid] = Math.floor(Position.y[eid] - 0.2) + 1 + 0.2;
      Velocity.y[eid] = 0;
      Body.onGround[eid] = 1;
    }

    const dist = Math.hypot(
      Position.x[eid] - ctx.player.pos.x,
      Position.y[eid] - feetY,
      Position.z[eid] - ctx.player.pos.z
    );
    if (dist < ctx.pickupRange) {
      ctx.pickup(Drop.itemId[eid], 1, eid);
      removeEcsEntity(eid);
      continue;
    }

    if (Drop.age[eid] > ctx.dropLifetime) removeEcsEntity(eid);
  }
}

export function clearDrops(world) {
  const ents = Array.from(queries.drops(world));
  for (const eid of ents) removeEcsEntity(eid);
}

export function despawnDrop(eid) {
  removeEcsEntity(eid);
}

export function snapshotDrops(world) {
  return queries.drops(world).map(eid => ({
    id: NetIdentity.id[eid],
    itemId: Drop.itemId[eid],
    x: Position.x[eid],
    y: Position.y[eid],
    z: Position.z[eid],
    vx: Velocity.x[eid],
    vy: Velocity.y[eid],
    vz: Velocity.z[eid],
    age: Drop.age[eid],
  }));
}

export function syncNetDrops(world, list) {
  const byId = new Map(queries.drops(world).map(eid => [NetIdentity.id[eid], eid]));
  const seen = new Set();
  for (const d of list || []) {
    let eid = byId.get(d.id);
    if (eid === undefined || Drop.itemId[eid] !== d.itemId) {
      if (eid !== undefined) removeEcsEntity(eid);
      eid = spawnDrop(0, 0, 0, d.itemId, d.id == null ? undefined : reserveNetId(d.id));
    }
    seen.add(NetIdentity.id[eid]);
    Position.x[eid] = d.x;
    Position.y[eid] = d.y;
    Position.z[eid] = d.z;
    Velocity.x[eid] = d.vx || 0;
    Velocity.y[eid] = d.vy || 0;
    Velocity.z[eid] = d.vz || 0;
    Drop.age[eid] = d.age || 0;
    const mesh = getMesh(eid);
    if (mesh) mesh.position.set(d.x, d.y, d.z);
  }
  for (const eid of queries.drops(world)) {
    if (!seen.has(NetIdentity.id[eid])) removeEcsEntity(eid);
  }
}
