// ===== player.js =====
// Local player state and non-ECS movement/survival logic.

export function createPlayer(THREE, ctx) {
  return {
    pos: new THREE.Vector3(ctx.worldW / 2, ctx.worldH, ctx.worldD / 2),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    onGround: false,
    fallStartY: ctx.worldH,
    health: ctx.maxHealth,
    lastHurt: -999,
    attackCd: 0,
    dead: false,
    hunger: ctx.maxHunger,
    xp: 0,
    level: 0,
  };
}

export function resetPlayer(player, ctx) {
  player.pos.set(ctx.worldW / 2, ctx.worldH, ctx.worldD / 2);
  player.vel.set(0, 0, 0);
  player.yaw = 0;
  player.pitch = 0;
  player.onGround = false;
  player.fallStartY = ctx.worldH;
  player.health = ctx.maxHealth;
  player.lastHurt = -999;
  player.attackCd = 0;
  player.dead = false;
  player.hunger = ctx.maxHunger;
  player.xp = 0;
  player.level = 0;
}

export function respawnPlayer(player, ctx) {
  player.health = ctx.maxHealth;
  player.dead = false;
  player.pos.set(ctx.worldW / 2, ctx.worldH, ctx.worldD / 2);
  player.vel.set(0, 0, 0);
  player.onGround = false;
  player.fallStartY = ctx.worldH;
}

export function damagePlayer(player, dmg, gameTime, ctx) {
  if (player.dead) return;
  player.health = Math.max(0, player.health - dmg);
  player.lastHurt = gameTime;
  ctx.onHurt();
  ctx.onHealthChanged();
  if (player.health <= 0) ctx.onDeath();
}

export function gainPlayerXP(player, amount, ctx) {
  player.xp += amount;
  const newLevel = Math.floor(player.xp / 100);
  if (newLevel > player.level) {
    player.level = newLevel;
    ctx.onLevelUp();
  }
  ctx.onXPChanged();
}

export function updatePlayer(player, dt, keys, gameTime, ctx) {
  updateMovement(player, dt, keys, ctx);
  updateSurvival(player, dt, gameTime, ctx);
  player.attackCd -= dt;
}

function updateMovement(player, dt, keys, ctx) {
  if (recoverIfOutOfWorld(player, ctx)) return;

  const inWater = isPlayerInWater(player, ctx);
  const forward = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  let speed = ctx.moveSpeed * (inWater ? (ctx.waterMoveMult ?? 0.62) : 1);
  if (keys.ControlLeft) speed *= ctx.sprintMult;

  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  let mx = (-sin * forward + cos * strafe);
  let mz = (-cos * forward - sin * strafe);
  const len = Math.hypot(mx, mz);
  if (len > 0) {
    mx /= len;
    mz /= len;
  }

  const desiredX = mx * speed * dt;
  const desiredZ = mz * speed * dt;
  const hitX = moveAxis(player, 'x', desiredX, ctx);
  const hitZ = moveAxis(player, 'z', desiredZ, ctx);
  if (inWater && keys.Space && len > 0 && (hitX || hitZ)) {
    tryWaterStepOut(player, desiredX, desiredZ, ctx);
  }

  const onLadder = ctx.isClimbable(ctx.getBlock(
    Math.floor(player.pos.x),
    Math.floor(player.pos.y - ctx.playerHeight + 0.5),
    Math.floor(player.pos.z)
  )) || ctx.isClimbable(ctx.getBlock(
    Math.floor(player.pos.x),
    Math.floor(player.pos.y - 0.5),
    Math.floor(player.pos.z)
  ));

  if (onLadder) {
    if (keys.Space) player.vel.y = 3.5;
    else if (keys.ShiftLeft) player.vel.y = -3.5;
    else player.vel.y = -1.0;
    moveAxis(player, 'y', player.vel.y * dt, ctx);
    player.onGround = true;
    player.fallStartY = player.pos.y;
  } else if (inWater) {
    player.fallStartY = player.pos.y;
    const swimAccel = ctx.swimAccel ?? 12;
    player.vel.y -= ctx.gravity * 0.12 * dt;
    if (keys.Space) {
      player.vel.y += swimAccel * dt;
      player.vel.y = Math.max(player.vel.y, ctx.waterRiseSpeed ?? 2.6);
    }
    if (keys.ShiftLeft) player.vel.y -= swimAccel * 0.7 * dt;
    player.vel.y = Math.max(-1.8, Math.min(ctx.waterMaxRiseSpeed ?? 4.2, player.vel.y));
    const hitY = moveAxis(player, 'y', player.vel.y * dt, ctx);
    if (hitY) player.vel.y = 0;
    player.onGround = false;
  } else {
    player.vel.y -= ctx.gravity * dt;
    if (keys.Space && player.onGround) {
      player.vel.y = ctx.jumpSpeed;
      player.onGround = false;
      player.fallStartY = player.pos.y;
    }
    if (!player.onGround) player.fallStartY = Math.max(player.fallStartY ?? player.pos.y, player.pos.y);
    const hitY = moveAxis(player, 'y', player.vel.y * dt, ctx);
    if (hitY) {
      const landed = player.vel.y < 0;
      player.onGround = landed;
      if (landed) applyFallDamage(player, ctx);
      player.vel.y = 0;
      player.fallStartY = player.pos.y;
    } else {
      player.onGround = false;
    }
  }

  recoverIfOutOfWorld(player, ctx);
}

function recoverIfOutOfWorld(player, ctx) {
  if (
    Number.isFinite(player.pos.x) &&
    Number.isFinite(player.pos.y) &&
    Number.isFinite(player.pos.z) &&
    player.pos.x >= -2 &&
    player.pos.x <= ctx.worldW + 2 &&
    player.pos.z >= -2 &&
    player.pos.z <= ctx.worldD + 2 &&
    player.pos.y >= -10 &&
    player.pos.y <= ctx.worldH + ctx.playerHeight + 8
  ) {
    return false;
  }

  const x = clamp(Math.floor(Number.isFinite(player.pos.x) ? player.pos.x : ctx.worldW / 2), 1, ctx.worldW - 2);
  const z = clamp(Math.floor(Number.isFinite(player.pos.z) ? player.pos.z : ctx.worldD / 2), 1, ctx.worldD - 2);
  const groundY = ctx.surfaceY ? ctx.surfaceY(x, z) : 1;
  player.pos.set(x + 0.5, groundY + 0.05 + ctx.playerHeight, z + 0.5);
  player.vel.set(0, 0, 0);
  player.onGround = false;
  player.fallStartY = player.pos.y;
  return true;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function tryWaterStepOut(player, dx, dz, ctx) {
  const maxLift = ctx.waterExitStep ?? 1.35;
  for (let i = 1; i <= 7; i++) {
    const p = player.pos.clone();
    p.y += maxLift * (i / 7);
    p.x += dx;
    p.z += dz;
    if (!collides(player, p, ctx)) {
      player.pos.copy(p);
      player.vel.y = Math.max(player.vel.y, 0.5);
      return true;
    }
  }
  return false;
}

function isPlayerInWater(player, ctx) {
  const x = Math.floor(player.pos.x);
  const z = Math.floor(player.pos.z);
  const chest = Math.floor(player.pos.y - ctx.playerHeight * 0.45);
  const feet = Math.floor(player.pos.y - ctx.playerHeight + 0.2);
  return ctx.getBlock(x, chest, z) === 7 || ctx.getBlock(x, feet, z) === 7;
}

function applyFallDamage(player, ctx) {
  const fallDistance = (player.fallStartY ?? player.pos.y) - player.pos.y;
  const excess = fallDistance - (ctx.safeFallDistance ?? 3);
  if (excess <= 0) return;
  const dmg = Math.ceil(excess * (ctx.fallDamagePerBlock ?? 1));
  damagePlayer(player, dmg, ctx.gameTime ?? 0, ctx);
}

function updateSurvival(player, dt, gameTime, ctx) {
  const beforeHunger = Math.ceil(player.hunger);
  player.hunger = Math.max(0, player.hunger - ctx.hungerDecay * dt);
  if (Math.ceil(player.hunger) !== beforeHunger) ctx.onHungerChanged();

  if (player.hunger <= 0) {
    if (Math.floor(gameTime * 0.5) !== Math.floor((gameTime - dt) * 0.5)) {
      damagePlayer(player, ctx.starveDamage, gameTime, ctx);
    }
  } else if (
    player.health < ctx.maxHealth &&
    player.hunger > 6 &&
    gameTime - player.lastHurt > ctx.regenDelay
  ) {
    const before = Math.floor(player.health);
    player.health = Math.min(ctx.maxHealth, player.health + ctx.regenRate * dt);
    if (Math.floor(player.health) !== before) ctx.onHealthChanged();
  }
}

function collides(player, p, ctx) {
  const eps = 1e-4;
  const minX = Math.floor(p.x - ctx.playerRadius + eps);
  const maxX = Math.floor(p.x + ctx.playerRadius - eps);
  const minZ = Math.floor(p.z - ctx.playerRadius + eps);
  const maxZ = Math.floor(p.z + ctx.playerRadius - eps);
  const minY = Math.floor(p.y - ctx.playerHeight + eps);
  const maxY = Math.floor(p.y - eps);
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        if (ctx.isSolidAt(x, y, z)) return true;
      }
    }
  }
  return false;
}

function moveAxis(player, axis, amount, ctx) {
  const p = player.pos.clone();
  p[axis] += amount;
  if (!collides(player, p, ctx)) {
    player.pos[axis] = p[axis];
    return false;
  }
  return true;
}
