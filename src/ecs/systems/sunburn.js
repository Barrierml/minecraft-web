// ===== ecs/systems/sunburn.js =====
// Daylight damage for hostile mobs.

import { Health, Position } from '../components.js';
import { queries } from '../world.js';
import { killMob } from './mobs.js';

export function updateSunburnSystem(world, dt, ctx) {
  if (ctx.dayCycle.isNight()) return;
  const ents = queries.mobs(world);
  for (let i = ents.length - 1; i >= 0; i--) {
    const eid = ents[i];
    const hx = Math.floor(Position.x[eid]);
    const hz = Math.floor(Position.z[eid]);
    const headY = Math.floor(Position.y[eid]);
    let exposed = true;
    for (let yy = headY + 1; yy < ctx.worldH; yy++) {
      if (ctx.isSolid(ctx.getBlock(hx, yy, hz))) {
        exposed = false;
        break;
      }
    }
    if (!exposed) continue;
    Health.hp[eid] -= 4 * dt;
    Health.hitFlash[eid] = 0.1;
    if (Health.hp[eid] <= 0) killMob(eid, ctx);
  }
}
