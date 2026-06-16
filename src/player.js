// ===== player.js =====
// Local player state and non-ECS movement/survival logic.

export function createPlayer(THREE, ctx) {
  return {
    pos: new THREE.Vector3(ctx.worldW / 2, ctx.worldH, ctx.worldD / 2),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    onGround: false,
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
  const forward = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  let speed = ctx.moveSpeed * (keys.ShiftLeft ? 1 : 1);
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

  moveAxis(player, 'x', mx * speed * dt, ctx);
  moveAxis(player, 'z', mz * speed * dt, ctx);

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
  } else {
    player.vel.y -= ctx.gravity * dt;
    if (keys.Space && player.onGround) {
      player.vel.y = ctx.jumpSpeed;
      player.onGround = false;
    }
    const hitY = moveAxis(player, 'y', player.vel.y * dt, ctx);
    if (hitY) {
      player.onGround = player.vel.y < 0;
      player.vel.y = 0;
    } else {
      player.onGround = false;
    }
  }

  if (player.pos.y < -10) {
    player.pos.set(ctx.worldW / 2, ctx.worldH, ctx.worldD / 2);
    player.vel.set(0, 0, 0);
  }
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
  const minX = Math.floor(p.x - ctx.playerRadius);
  const maxX = Math.floor(p.x + ctx.playerRadius);
  const minZ = Math.floor(p.z - ctx.playerRadius);
  const maxZ = Math.floor(p.z + ctx.playerRadius);
  const minY = Math.floor(p.y - ctx.playerHeight);
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

function moveAxis(player, axis, amount, ctx) {
  const p = player.pos.clone();
  p[axis] += amount;
  if (!collides(player, p, ctx)) {
    player.pos[axis] = p[axis];
    return false;
  }
  return true;
}
