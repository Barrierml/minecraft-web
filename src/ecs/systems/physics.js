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
