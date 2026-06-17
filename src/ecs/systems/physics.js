// ===== ecs/systems/physics.js =====
// Shared kinematic collision helpers for creature-like ECS entities.

import { Body, Position, Velocity } from '../components.js';

export function collidesEntity(eid, p, ctx) {
  const radius = Body.radius[eid];
  const height = Body.height[eid];
  const minX = Math.floor(p.x - radius);
  const maxX = Math.floor(p.x + radius);
  const minZ = Math.floor(p.z - radius);
  const maxZ = Math.floor(p.z + radius);
  const minY = Math.floor(p.y - height);
  const maxY = Math.floor(p.y);
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        if (ctx.isSolidAt(x, y, z)) return true;
      }
    }
  }
  return false;
}

export function moveEntityAxis(eid, axis, amount, ctx) {
  const p = {
    x: Position.x[eid],
    y: Position.y[eid],
    z: Position.z[eid],
  };
  p[axis] += amount;
  if (!collidesEntity(eid, p, ctx)) {
    Position[axis][eid] = p[axis];
    return false;
  }
  return true;
}

export function updateCreaturePhysics(eid, dt, ctx, moveX = 0, moveZ = 0) {
  const hitX = moveEntityAxis(eid, 'x', (moveX + Velocity.x[eid]) * dt, ctx);
  const hitZ = moveEntityAxis(eid, 'z', (moveZ + Velocity.z[eid]) * dt, ctx);
  if ((hitX || hitZ) && Body.onGround[eid]) Velocity.y[eid] = ctx.jumpSpeed;

  Velocity.x[eid] *= 0.8;
  Velocity.z[eid] *= 0.8;

  Velocity.y[eid] -= ctx.gravity * dt;
  const hitY = moveEntityAxis(eid, 'y', Velocity.y[eid] * dt, ctx);
  if (hitY) {
    Body.onGround[eid] = Velocity.y[eid] < 0 ? 1 : 0;
    Velocity.y[eid] = 0;
  } else {
    Body.onGround[eid] = 0;
  }

  return Position.y[eid] < -20;
}

export function verticalOverlapWithPlayer(eid, ctx) {
  const entityBottom = Position.y[eid] - Body.height[eid];
  const entityTop = Position.y[eid];
  const playerBottom = ctx.player.pos.y - ctx.playerHeight;
  const playerTop = ctx.player.pos.y;
  return Math.min(entityTop, playerTop) - Math.max(entityBottom, playerBottom);
}

export function distanceToPlayer3D(eid, ctx) {
  const dy = (Position.y[eid] - Body.height[eid] * 0.5) -
    (ctx.player.pos.y - ctx.playerHeight * 0.5);
  return Math.hypot(Position.x[eid] - ctx.player.pos.x, dy, Position.z[eid] - ctx.player.pos.z);
}

export function separateEntityFromPlayer(eid, ctx) {
  if (!ctx.player || !ctx.playerRadius || !ctx.playerHeight || ctx.player.dead) return false;
  if (verticalOverlapWithPlayer(eid, ctx) <= 0.05) return false;

  let dx = Position.x[eid] - ctx.player.pos.x;
  let dz = Position.z[eid] - ctx.player.pos.z;
  let dist = Math.hypot(dx, dz);
  if (dist < 0.001) {
    dx = Math.sin((Position.x[eid] + Position.z[eid]) * 12.9898);
    dz = Math.cos((Position.x[eid] - Position.z[eid]) * 78.233);
    dist = Math.hypot(dx, dz);
  }

  const minDist = Body.radius[eid] + ctx.playerRadius + (ctx.creaturePersonalSpace ?? 0.18);
  if (dist >= minDist) return false;

  const push = minDist - dist;
  const nx = dx / dist;
  const nz = dz / dist;
  moveEntityAxis(eid, 'x', nx * push, ctx);
  moveEntityAxis(eid, 'z', nz * push, ctx);
  Velocity.x[eid] += nx * 0.8;
  Velocity.z[eid] += nz * 0.8;
  return true;
}
