// ===== ecs/systems/render.js =====
// Visual-only ECS systems for hit flash, fuse blink, and mesh transforms.

import { Animal, Body, Health, Mob, Position, getMesh } from '../components.js';
import { getAnimalTypeKey, getMobTypeKey } from '../factories.js';
import { queries } from '../world.js';

export function updateFlashSystem(world, dt, ctx) {
  for (const eid of queries.mobs(world)) {
    const type = getMobTypeKey(eid);
    const t = ctx.mobTypes[type];
    const mat = getMesh(eid)?.userData.bodyMat;
    if (!mat) continue;
    if (Health.hitFlash[eid] > 0) {
      Health.hitFlash[eid] = Math.max(0, Health.hitFlash[eid] - dt);
      mat.color.setHex(0xff5555);
    } else {
      mat.color.setHex(t.body);
    }
    if (Mob.fuse[eid] > 0) {
      const blink = Math.sin(ctx.gameTime * 20) > 0;
      mat.color.setHex(blink ? 0xffffff : t.body);
    }
  }

  for (const eid of queries.animals(world)) {
    const type = getAnimalTypeKey(eid);
    const t = ctx.animalTypes[type];
    const mat = getMesh(eid)?.userData.bodyMat;
    if (!mat) continue;
    if (Health.hitFlash[eid] > 0) {
      Health.hitFlash[eid] = Math.max(0, Health.hitFlash[eid] - dt);
      mat.color.setHex(0xff5555);
    } else {
      mat.color.setHex(t.body);
    }
  }
}

export function syncMeshSystem(world, ctx) {
  for (const eid of queries.mobs(world)) {
    const mesh = getMesh(eid);
    if (!mesh) continue;
    mesh.position.set(Position.x[eid], Position.y[eid] - Body.height[eid], Position.z[eid]);
    const dx = ctx.player.pos.x - Position.x[eid];
    const dz = ctx.player.pos.z - Position.z[eid];
    if (dx * dx + dz * dz > 0.0001) mesh.rotation.y = Math.atan2(dx, dz);
    animateWalk(mesh, ctx.gameTime, eid, 0.38);
  }

  for (const eid of queries.animals(world)) {
    const mesh = getMesh(eid);
    if (!mesh) continue;
    mesh.position.set(Position.x[eid], Position.y[eid] - Body.height[eid], Position.z[eid]);
    mesh.rotation.y = Animal.wanderDir[eid];
    animateWalk(mesh, ctx.gameTime, eid, 0.24);
  }

  for (const eid of queries.drops(world)) {
    const mesh = getMesh(eid);
    if (!mesh) continue;
    mesh.position.set(Position.x[eid], Position.y[eid], Position.z[eid]);
    mesh.rotation.y += ctx.dt * 2;
  }
}

function animateWalk(mesh, gameTime = 0, eid = 0, amount = 0.3) {
  const parts = mesh.userData.walkParts;
  if (!parts) return;
  const s = Math.sin(gameTime * 8 + eid * 0.37) * amount;
  parts.forEach((part, i) => {
    part.rotation.x = (i % 2 === 0 ? s : -s);
  });
}
