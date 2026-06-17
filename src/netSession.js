// ===== netSession.js =====
// Multiplayer session wiring around the transport layer.

import { MSG } from './net.js';
import {
  chests,
  restoreBlockState,
  setChestContents,
  setDoorOpen,
  snapshotBlockState,
  snapshotChest,
} from './world.js';

export function createNetSession(ctx) {
  const {
    net,
    remotePlayers,
    player,
    dayCycle,
    ecsWorld,
    world,
    generateWorld,
    applyBlockEdit,
    applyBlockEdits,
    clearMobs,
    clearAnimals,
    clearDrops,
    syncNetMobs,
    syncNetAnimals,
    syncNetDrops,
    snapshotMobs,
    snapshotAnimals,
    snapshotDrops,
    mobCtx,
    animalCtx,
    getBlock,
    dropOf,
    spawnDrop,
    despawnDrop,
    findByNetId,
    damageMob,
    killMob,
    damageAnimal,
    killAnimal,
    updateNetbar,
    getSeed,
    setSeed,
    getPlayerName,
    getGameTime,
    setGameTime,
    attackDamage,
    air,
  } = ctx;
  let lastNetSync = 0;
  let ready = false;
  const playerNames = new Map();

  function markReady(value = true) {
    ready = value;
  }

  function isReady() {
    return ready;
  }

  function worldPayload() {
    return {
      seed: getSeed(),
      blockState: snapshotBlockState(),
      dayTime: dayCycle.getTime(),
      gameTime: getGameTime(),
    };
  }

  function applyWorldPayload(data) {
    setSeed(data.seed);
    world.fill(0);
    generateWorld(data.seed);
    if (data.blockState) {
      applyBlockEdits(data.blockState.edits || {});
      restoreBlockState(data.blockState);
    } else {
      applyBlockEdits(data.edits || {});
    }
    clearMobs(ecsWorld);
    clearAnimals(ecsWorld);
    clearDrops(ecsWorld);
    dayCycle.setTime(data.dayTime ?? 0.15);
    setGameTime(data.gameTime ?? 0);
    markReady();
  }

  function applyDoor(data) {
    setDoorOpen(data.x, data.y, data.z, data.open);
  }

  function applyChest(data) {
    setChestContents(data.key, data.items || {});
  }

  function setupHostHandlers() {
    net.onPeerJoin = pid => {
      net.sendTo(pid, MSG.WORLD, worldPayload());
      remotePlayers.ensure(pid, playerNames.get(pid));
      updateNetbar();
    };
    net.on(MSG.HELLO, (data, from) => {
      const name = sanitizeName(data?.name, from);
      playerNames.set(from, name);
      remotePlayers.ensure(from, name);
      updateNetbar();
    });
    net.on(MSG.INPUT, (data, from) => {
      if (data.name) playerNames.set(from, sanitizeName(data.name, from));
      const rp = remotePlayers.ensure(from, playerNames.get(from));
      rp.target.set(data.x, data.y, data.z);
      rp.yaw = data.yaw;
    });
    net.on(MSG.BLOCK, (data, from) => {
      const broken = getBlock(data.x, data.y, data.z);
      applyBlockEdit(data.x, data.y, data.z, data.id);
      if (data.id === air) {
        const drop = dropOf(broken);
        if (drop !== null) spawnDrop(data.x, data.y, data.z, drop);
      }
      net.broadcast(MSG.BLOCK, data, from);
    });
    net.on(MSG.DOOR, (data, from) => {
      applyDoor(data);
      net.broadcast(MSG.DOOR, data, from);
    });
    net.on(MSG.CHEST, (data, from) => {
      applyChest(data);
      net.broadcast(MSG.CHEST, data, from);
    });
    net.on(MSG.HIT, data => {
      const damage = Math.max(1, Math.min(20, Number(data.damage) || attackDamage));
      if (data.kind === 'mob') {
        const eid = findByNetId(ecsWorld, 'mob', data.id);
        if (eid >= 0) damageMob(eid, damage, { onKill: e => killMob(e, mobCtx()) });
      } else if (data.kind === 'animal') {
        const eid = findByNetId(ecsWorld, 'animal', data.id);
        if (eid >= 0) damageAnimal(eid, damage, { player, onKill: e => killAnimal(e, animalCtx()) });
      }
    });
    net.on(MSG.PICKUP, data => {
      const eid = findByNetId(ecsWorld, 'drop', data.id);
      if (eid >= 0) despawnDrop(eid);
    });
  }

  function setupClientHandlers(onWorld) {
    net.on(MSG.WORLD, data => {
      applyWorldPayload(data);
      if (onWorld) onWorld();
      updateNetbar();
    });
    net.on(MSG.BLOCK, data => applyBlockEdit(data.x, data.y, data.z, data.id));
    net.on(MSG.DOOR, applyDoor);
    net.on(MSG.CHEST, applyChest);
    net.on(MSG.STATE, applyHostState);
  }

  function applyHostState(state) {
    dayCycle.setTime(state.dayTime ?? dayCycle.getTime());
    const seen = new Set();
    for (const p of state.players) {
      if (p.id === net.selfId) continue;
      seen.add(p.id);
      const rp = remotePlayers.ensure(p.id, p.name);
      rp.target.set(p.x, p.y, p.z);
      rp.yaw = p.yaw;
    }
    for (const pid of remotePlayers.ids()) if (!seen.has(pid)) remotePlayers.remove(pid);
    syncNetMobs(ecsWorld, state.mobs, mobCtx());
    syncNetAnimals(ecsWorld, state.animals, animalCtx());
    syncNetDrops(ecsWorld, state.drops);
    updateNetbar();
  }

  function broadcastState() {
    const players = [{ id: 'host', name: getPlayerName(), x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw }];
    for (const [pid, rp] of remotePlayers.entries()) {
      players.push({ id: pid, name: rp.name || playerNames.get(pid), x: rp.target.x, y: rp.target.y, z: rp.target.z, yaw: rp.yaw });
    }
    net.broadcast(MSG.STATE, {
      players,
      mobs: snapshotMobs(ecsWorld),
      animals: snapshotAnimals(ecsWorld),
      drops: snapshotDrops(ecsWorld),
      dayTime: dayCycle.getTime(),
    });
  }

  function netTick(dt) {
    if (!net.isMultiplayer()) return;
    remotePlayers.update(dt);
    lastNetSync += dt;
    if (lastNetSync < 0.1) return;
    lastNetSync = 0;
    if (net.isHost()) {
      broadcastState();
    } else if (net.isClient()) {
      net.send(MSG.INPUT, { name: getPlayerName(), x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw });
    }
  }

  function sanitizeName(name, fallback) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 16);
    if (clean) return clean;
    if (fallback === 'host') return '房主';
    return '玩家 ' + String(fallback || '').replace(/^minimc-/, '').slice(-4).toUpperCase();
  }

  function sendDoor(x, y, z, open) {
    const data = { x, y, z, open };
    applyDoor(data);
    if (net.isMultiplayer()) net.send(MSG.DOOR, data);
  }

  function syncChest(key) {
    if (!chests[key]) return;
    const data = { key, items: snapshotChest(key) };
    if (net.isMultiplayer()) net.send(MSG.CHEST, data);
  }

  return {
    markReady,
    isReady,
    setupHostHandlers,
    setupClientHandlers,
    netTick,
    sendDoor,
    syncChest,
  };
}
