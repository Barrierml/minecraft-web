// ===== ecs/systems/mobs.js =====
// Hostile mob spawning, AI, combat, and network snapshot sync.

import { Body, Health, Mob, NetIdentity, Position, Velocity, getMesh } from '../components.js';
import { getMobTypeKey, removeEcsEntity, reserveNetId, spawnMob } from '../factories.js';
import { queries } from '../world.js';
import { updateCreaturePhysics } from './physics.js';

export function isNight(ctx) {
  return ctx.dayCycle.isNight();
}

export function spawnMobNear(world, ctx) {
  const count = queries.mobs(world).length;
  let x;
  let z;
  let tries = 0;
  do {
    x = 2 + Math.floor((count * 7 + tries * 13 + ctx.gameTime * 5) % (ctx.worldW - 4));
    z = 2 + Math.floor((count * 11 + tries * 17 + ctx.gameTime * 3) % (ctx.worldD - 4));
    tries++;
  } while (tries < 8 && Math.hypot(x - ctx.player.pos.x, z - ctx.player.pos.z) < 12);

  const type = ctx.mobTypeKeys[(count + Math.floor(ctx.gameTime)) % ctx.mobTypeKeys.length];
  const y = ctx.surfaceY(x, z);
  return spawnMob({
    type,
    x: x + 0.5,
    y: y + ctx.height,
    z: z + 0.5,
    radius: ctx.radius,
    height: ctx.height,
  });
}

export function ensureMobs(world, ctx) {
  if (!isNight(ctx)) return;
  while (queries.mobs(world).length < ctx.count) spawnMobNear(world, ctx);
}

export function despawnMob(eid) {
  removeEcsEntity(eid);
}

export function dropMobLoot(eid, ctx) {
  const type = getMobTypeKey(eid);
  const bx = Math.floor(Position.x[eid]);
  const by = Math.floor(Position.y[eid] - Body.height[eid]);
  const bz = Math.floor(Position.z[eid]);
  ctx.spawnDrop(bx, by, bz, ctx.mobTypes[type].drop);
}

export function killMob(eid, ctx) {
  dropMobLoot(eid, ctx);
  removeEcsEntity(eid);
}

export function clearMobs(world) {
  for (const eid of Array.from(queries.mobs(world))) removeEcsEntity(eid);
}

export function damageMob(eid, damage, ctx) {
  Health.hp[eid] -= damage;
  Health.hitFlash[eid] = 0.18;
  if (ctx.knockbackYaw !== undefined) {
    const kbX = -Math.sin(ctx.knockbackYaw) * 4;
    const kbZ = -Math.cos(ctx.knockbackYaw) * 4;
    Velocity.x[eid] += kbX;
    Velocity.z[eid] += kbZ;
    Velocity.y[eid] += 3;
  }
  if (Health.hp[eid] <= 0) {
    if (ctx.onKill) ctx.onKill(eid);
    return true;
  }
  return false;
}

export function updateMobsSystem(world, dt, ctx) {
  const ents = queries.mobs(world);
  for (let i = ents.length - 1; i >= 0; i--) {
    const eid = ents[i];
    const type = getMobTypeKey(eid);
    const t = ctx.mobTypes[type];
    Mob.attackCd[eid] -= dt;

    const dx = ctx.player.pos.x - Position.x[eid];
    const dz = ctx.player.pos.z - Position.z[eid];
    const dist = Math.hypot(dx, dz);
    let moveX = 0;
    let moveZ = 0;
    if (!ctx.player.dead && dist < ctx.sight && dist > 0.01) {
      const nx = dx / dist;
      const nz = dz / dist;
      moveX = nx * t.speed;
      moveZ = nz * t.speed;
    }

    if (updateCreaturePhysics(eid, dt, ctx, moveX, moveZ)) {
      removeEcsEntity(eid);
      continue;
    }

    if (!ctx.player.dead && dist < 2.2) {
      if (t.explode) {
        if (Mob.fuse[eid] < 0) {
          Mob.fuse[eid] = 1.2;
          ctx.playSound('fuse');
        }
        Mob.fuse[eid] -= dt;
        if (Mob.fuse[eid] <= 0) {
          const dmg = Math.max(2, Math.round(t.damage * (1 - dist / 3)));
          ctx.damagePlayer(dmg);
          ctx.spawnDamageText(dmg, true);
          ctx.playSound('explode');
          ctx.particles.burst(Position.x[eid], Position.y[eid] - Body.height[eid] / 2, Position.z[eid], 0xff8822, 24, 7, 0.7);
          killMob(eid, ctx);
          continue;
        }
      } else if (dist < 1.6 && Mob.attackCd[eid] <= 0) {
        Mob.attackCd[eid] = ctx.attackCooldown;
        ctx.damagePlayer(t.damage);
        ctx.spawnDamageText(t.damage, true);
        ctx.playSound('hurt');
      }
    } else if (t.explode && Mob.fuse[eid] >= 0) {
      Mob.fuse[eid] = -1;
    }

  }
}

export function snapshotMobs(world) {
  return Array.from(queries.mobs(world)).map(eid => ({
    id: NetIdentity.id[eid],
    type: getMobTypeKey(eid),
    x: Position.x[eid],
    y: Position.y[eid],
    z: Position.z[eid],
    vx: Velocity.x[eid],
    vy: Velocity.y[eid],
    vz: Velocity.z[eid],
    h: Health.hp[eid],
    attackCd: Mob.attackCd[eid],
    fuse: Mob.fuse[eid],
  }));
}

export function hydrateMobs(list, ctx) {
  clearMobs(ctx.world);
  for (const d of list || []) {
    const eid = spawnMob({
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
    Mob.attackCd[eid] = d.attackCd || 0;
    Mob.fuse[eid] = d.fuse ?? -1;
    const mesh = getMesh(eid);
    if (mesh) mesh.position.set(Position.x[eid], Position.y[eid] - Body.height[eid], Position.z[eid]);
  }
}

export function syncNetMobs(world, list, ctx) {
  const byId = new Map(Array.from(queries.mobs(world)).map(eid => [NetIdentity.id[eid], eid]));
  const seen = new Set();
  for (const d of list || []) {
    let eid = byId.get(d.id);
    if (eid === undefined || getMobTypeKey(eid) !== d.type) {
      if (eid !== undefined) removeEcsEntity(eid);
      eid = spawnMob({
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
  for (const eid of Array.from(queries.mobs(world))) {
    if (!seen.has(NetIdentity.id[eid])) removeEcsEntity(eid);
  }
}
