// ===== ecs/systems/animals.js =====
// Passive animal spawning, AI, combat, and network snapshot sync.

import { Animal, Body, Health, NetIdentity, Position, Velocity, getMesh } from '../components.js';
import { getAnimalTypeKey, removeEcsEntity, reserveNetId, spawnAnimal } from '../factories.js';
import { queries } from '../world.js';
import { separateEntityFromPlayer, updateCreaturePhysics } from './physics.js';

export function spawnAnimalNear(world, ctx) {
  const count = queries.animals(world).length;
  const x = 2 + Math.floor((count * 13 + ctx.gameTime * 7) % (ctx.worldW - 4));
  const z = 2 + Math.floor((count * 17 + ctx.gameTime * 11) % (ctx.worldD - 4));
  const type = ctx.animalTypeKeys[(count + Math.floor(ctx.gameTime)) % ctx.animalTypeKeys.length];
  const y = ctx.surfaceY(x, z);
  return spawnAnimal({
    type,
    x: x + 0.5,
    y: y + ctx.height,
    z: z + 0.5,
    radius: ctx.radius,
    height: ctx.height,
  });
}

export function ensureAnimals(world, ctx) {
  while (queries.animals(world).length < ctx.count) spawnAnimalNear(world, ctx);
}

export function despawnAnimal(eid) {
  removeEcsEntity(eid);
}

export function killAnimal(eid, ctx) {
  const type = getAnimalTypeKey(eid);
  const bx = Math.floor(Position.x[eid]);
  const by = Math.floor(Position.y[eid] - Body.height[eid]);
  const bz = Math.floor(Position.z[eid]);
  ctx.spawnDrop(bx, by, bz, ctx.animalTypes[type].drop);
  removeEcsEntity(eid);
}

export function clearAnimals(world) {
  for (const eid of Array.from(queries.animals(world))) removeEcsEntity(eid);
}

export function damageAnimal(eid, damage, ctx) {
  Health.hp[eid] -= damage;
  Health.hitFlash[eid] = 0.18;
  Animal.wanderDir[eid] = Math.atan2(Position.x[eid] - ctx.player.pos.x, Position.z[eid] - ctx.player.pos.z);
  Animal.wanderTimer[eid] = 3;
  if (Health.hp[eid] <= 0) {
    if (ctx.onKill) ctx.onKill(eid);
    return true;
  }
  return false;
}

export function updateAnimalsSystem(world, dt, ctx) {
  const ents = queries.animals(world);
  for (let i = ents.length - 1; i >= 0; i--) {
    const eid = ents[i];
    const type = getAnimalTypeKey(eid);
    const t = ctx.animalTypes[type];

    Animal.wanderTimer[eid] -= dt;
    if (Animal.wanderTimer[eid] <= 0) {
      Animal.wanderDir[eid] = Math.random() * Math.PI * 2;
      Animal.wanderTimer[eid] = 2 + Math.random() * 3;
    }

    const vx = Math.sin(Animal.wanderDir[eid]) * t.speed;
    const vz = Math.cos(Animal.wanderDir[eid]) * t.speed;

    if (updateCreaturePhysics(eid, dt, ctx, vx, vz)) {
      killAnimal(eid, ctx);
      continue;
    }
    separateEntityFromPlayer(eid, ctx);

  }
}

export function snapshotAnimals(world) {
  return Array.from(queries.animals(world)).map(eid => ({
    id: NetIdentity.id[eid],
    type: getAnimalTypeKey(eid),
    x: Position.x[eid],
    y: Position.y[eid],
    z: Position.z[eid],
    vx: Velocity.x[eid],
    vy: Velocity.y[eid],
    vz: Velocity.z[eid],
    h: Health.hp[eid],
    wanderDir: Animal.wanderDir[eid],
    wanderTimer: Animal.wanderTimer[eid],
  }));
}

export function hydrateAnimals(list, ctx) {
  clearAnimals(ctx.world);
  for (const d of list || []) {
    const eid = spawnAnimal({
      type: d.type,
      x: d.x,
      y: d.y,
      z: d.z,
      radius: ctx.radius,
      height: ctx.height,
      netId: d.id == null ? undefined : reserveNetId(d.id),
    });
    Velocity.x[eid] = d.vx || 0;
    Velocity.y[eid] = d.vy || 0;
    Velocity.z[eid] = d.vz || 0;
    Health.hp[eid] = d.h ?? Health.max[eid];
    Animal.wanderDir[eid] = d.wanderDir || 0;
    Animal.wanderTimer[eid] = d.wanderTimer || 0;
    const mesh = getMesh(eid);
    if (mesh) mesh.position.set(Position.x[eid], Position.y[eid] - Body.height[eid], Position.z[eid]);
  }
}

export function syncNetAnimals(world, list, ctx) {
  const byId = new Map(Array.from(queries.animals(world)).map(eid => [NetIdentity.id[eid], eid]));
  const seen = new Set();
  for (const d of list || []) {
    let eid = byId.get(d.id);
    if (eid === undefined || getAnimalTypeKey(eid) !== d.type) {
      if (eid !== undefined) removeEcsEntity(eid);
      eid = spawnAnimal({
        type: d.type,
        x: d.x,
        y: d.y,
        z: d.z,
        radius: ctx.radius,
        height: ctx.height,
        netId: d.id == null ? undefined : reserveNetId(d.id),
      });
    }
    seen.add(NetIdentity.id[eid]);
    Position.x[eid] = d.x;
    Position.y[eid] = d.y;
    Position.z[eid] = d.z;
    Health.hp[eid] = d.h ?? Health.hp[eid];
    const mesh = getMesh(eid);
    if (mesh) mesh.position.set(d.x, d.y - Body.height[eid], d.z);
  }
  for (const eid of Array.from(queries.animals(world))) {
    if (!seen.has(NetIdentity.id[eid])) removeEcsEntity(eid);
  }
}
