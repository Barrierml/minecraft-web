// ===== ecs/snapshot.js =====
// Serialize/hydrate ECS entities for the new save schema.

import { Body, Drop, Position, Velocity, getMesh } from './components.js';
import { getNextNetId, reserveNetId, setNextNetId, spawnDrop } from './factories.js';
import { hydrateAnimals, snapshotAnimals } from './systems/animals.js';
import { snapshotDrops } from './systems/drops.js';
import { hydrateMobs, snapshotMobs } from './systems/mobs.js';

export function snapshotEcs(world) {
  return {
    nextNetId: getNextNetId(),
    mobs: snapshotMobs(world),
    animals: snapshotAnimals(world),
    drops: snapshotDrops(world),
  };
}

export function hydrateEcs(snapshot, { clearDrops, world }) {
  clearDrops(world);
  setNextNetId(snapshot?.nextNetId || 1);
  hydrateMobs(snapshot?.mobs || [], {
    world,
    radius: 0.4,
    height: 1.8,
  });
  hydrateAnimals(snapshot?.animals || [], {
    world,
    radius: 0.4,
    height: 1.8,
  });
  for (const drop of snapshot?.drops || []) {
    const eid = spawnDrop(0, 0, 0, drop.itemId, drop.id == null ? undefined : reserveNetId(drop.id));
    Position.x[eid] = drop.x;
    Position.y[eid] = drop.y;
    Position.z[eid] = drop.z;
    Velocity.x[eid] = drop.vx || 0;
    Velocity.y[eid] = drop.vy || 0;
    Velocity.z[eid] = drop.vz || 0;
    Drop.age[eid] = drop.age || 0;
    Body.onGround[eid] = drop.onGround || 0;
    const mesh = getMesh(eid);
    if (mesh) mesh.position.set(Position.x[eid], Position.y[eid], Position.z[eid]);
  }
}
