import * as THREE from 'three';
import * as D from './data.js';
import * as Save from './save.js';
import * as FX from './fx.js';
import { Net, MSG } from './net.js';
import { createNetSession } from './netSession.js';
import {
  createPlayer, damagePlayer as applyPlayerDamage,
  gainPlayerXP, resetPlayer, respawnPlayer, updatePlayer,
} from './player.js';
import { initAudio, playSound } from './audio.js';
import { createDayCycle } from './daycycle.js';
import { createRemotePlayers } from './remotePlayers.js';
import { createClouds } from './clouds.js';
import { createWeather } from './weather.js';
import { createHand } from './hand.js';
import { createHud } from './hud.js';
import { createKeyState, shouldHandleGameKey } from './input.js';
import {
  inventory, RECIPES, FURNACE_RECIPES,
  addToInventory as addItemToInventory,
  removeFromInventory, giveStartingInventory, restoreInventory,
  canCraft as canCraftRecipe, craft as craftRecipe,
  canSmelt as canSmeltRecipe, smelt as smeltRecipe,
} from './inventory.js';
import {
  initWorldRuntime, rebuildTerrain, updateBlockTexture,
  keyOf, isSolidAt, surfaceY,
  openDoors, chests,
  clearBlockState, restoreBlockState, snapshotBlockState, applyBlockEdit, applyBlockEdits, updateFluidPhysics,
} from './world.js';
import { ecsWorld } from './ecs/world.js';
import { initFactories, setNextNetId, spawnDrop } from './ecs/factories.js';
import {
  clearDrops, despawnDrop, snapshotDrops, syncNetDrops, updateDropsSystem,
} from './ecs/systems/drops.js';
import {
  clearAnimals, damageAnimal, ensureAnimals, killAnimal,
  snapshotAnimals, syncNetAnimals, updateAnimalsSystem,
} from './ecs/systems/animals.js';
import {
  clearMobs, damageMob, ensureMobs, killMob,
  snapshotMobs, syncNetMobs, updateMobsSystem,
} from './ecs/systems/mobs.js';
import { syncMeshSystem, updateFlashSystem } from './ecs/systems/render.js';
import { updateSunburnSystem } from './ecs/systems/sunburn.js';
import { hydrateEcs, snapshotEcs } from './ecs/snapshot.js';
import { findByNetId, netIdFor, raycastCreature } from './combat.js';
// 把 data.js 的导出解构到本地名字，保持原代码不变
const {
  WORLD_W, WORLD_H, WORLD_D,
  GRAVITY, JUMP_SPEED, MOVE_SPEED, SPRINT_MULT, PLAYER_HEIGHT, PLAYER_RADIUS, REACH,
  PICKUP_RANGE, DROP_LIFETIME, HOTBAR_SIZE,
  SAFE_FALL_DISTANCE, FALL_DAMAGE_PER_BLOCK,
  MAX_HEALTH, REGEN_DELAY, REGEN_RATE, ATTACK_DAMAGE, ATTACK_RANGE, ATTACK_COOLDOWN,
  MOB_COUNT, MOB_SIGHT, MOB_RADIUS, MOB_HEIGHT, MOB_ATTACK_CD, MOB_TYPES, MOB_TYPE_KEYS,
  ANIMAL_COUNT, ANIMAL_TYPES, ANIMAL_TYPE_KEYS,
  AIR, BLOCKS, ITEMS,
  XP_PER_MOB, XP_PER_ORE,
  itemName, itemColor, itemDamage, blockColor, isSolid, isClimbable, dropOf,
  itemTexturePath, isPlaceableItem, miningDuration,
  world, inBounds, getBlock, generateWorld,
} = D;
// ===== 联机状态（net 层）=====
const net = new Net();

// ===== Three.js 场景 =====
    const canvas = document.getElementById('c');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    initWorldRuntime(THREE, scene);
    const remotePlayers = createRemotePlayers(THREE, { scene, playerHeight: PLAYER_HEIGHT });

    // ===== 掉落物 / 物品栏 =====
    // 破坏方块产出掉落实体，走近自动拾取累加到 inventory.js。
    const dropGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const dropMatCache = {};        // 按方块 id 缓存材质
    function dropMat(id) {
      if (!dropMatCache[id]) dropMatCache[id] = new THREE.MeshLambertMaterial({ color: itemColor(id) });
      return dropMatCache[id];
    }
    initFactories({
      THREE,
      scene,
      dropGeometry: dropGeo,
      dropMaterial: dropMat,
      mobTypeKeys: MOB_TYPE_KEYS,
      mobTypes: MOB_TYPES,
      animalTypeKeys: ANIMAL_TYPE_KEYS,
      animalTypes: ANIMAL_TYPES,
    });
    // 拾取：累加到物品栏，刷新热键栏
    function addToInventory(id, n, eid) {
      addItemToInventory(id, n);
      renderHotbar();
      playSound('pickup');
      if (net.isClient() && eid !== undefined) {
        net.send(MSG.PICKUP, { id: netIdFor(eid) });
      }
    }
    scene.background = new THREE.Color(0x88bbee);          // 天空蓝（昼夜循环会动态改）
    scene.fog = new THREE.Fog(0x88bbee, 40, 90);           // 远处雾化

    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);

    // 光照：环境光 + 方向光（太阳）
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(0.5, 1, 0.3);
    scene.add(sun);

    // ===== 星空 + 粒子系统 =====
    const stars = FX.makeStars(THREE);
    scene.add(stars);
    const particles = FX.makeParticleSystem(THREE, scene);

    // ===== 云 =====
    const clouds = createClouds(THREE, { scene, worldW: WORLD_W, worldH: WORLD_H, worldD: WORLD_D });

    // ===== 第一人称手臂 =====
    scene.add(camera); // 相机入场景，子物体（手臂）才会被渲染
    const hand = createHand(THREE, { camera });

    // 命中标记：准星短暂变红放大（crosshair 在 DOM 顶部已定义）
    const crosshair = document.getElementById('crosshair');
    const mineProgressEl = document.getElementById('mineProgress');
    const mineProgressFillEl = mineProgressEl.querySelector('div');
    let hitMarkerT = 0;
    function triggerHitMarker() { hitMarkerT = 0.12; }
    function updateHitMarker(dt) {
      if (hitMarkerT > 0) {
        hitMarkerT = Math.max(0, hitMarkerT - dt);
        crosshair.classList.add('hit');
        if (hitMarkerT === 0) crosshair.classList.remove('hit');
      }
    }

    // ===== 伤害飘字 =====
    // 在屏幕上飘出伤害数字，向上飘并淡出
    const dmgTexts = [];
    function spawnDamageText(amount, isPlayerHurt) {
      const el = document.createElement('div');
      el.className = 'dmgtext' + (isPlayerHurt ? ' hurt' : '');
      el.textContent = '-' + amount;
      // 玩家受伤显示在屏幕中央偏下；打怪显示在准星附近
      const cx = window.innerWidth / 2 + (Math.random() * 60 - 30);
      const cy = window.innerHeight / 2 + (isPlayerHurt ? 80 : -20);
      el.style.left = cx + 'px';
      el.style.top = cy + 'px';
      document.body.appendChild(el);
      dmgTexts.push({ el, age: 0 });
    }
    function updateDamageTexts(dt) {
      for (let i = dmgTexts.length - 1; i >= 0; i--) {
        const d = dmgTexts[i];
        d.age += dt;
        d.el.style.transform = `translateY(${-d.age * 50}px)`;
        d.el.style.opacity = Math.max(0, 1 - d.age * 1.3);
        if (d.age > 0.8) { d.el.remove(); dmgTexts.splice(i, 1); }
      }
    }
    function onResize() {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', onResize);

    // ===== 玩家与控制 =====
    const MAX_HUNGER = 20;
    const player = createPlayer(THREE, {
      worldW: WORLD_W,
      worldH: WORLD_H,
      worldD: WORLD_D,
      maxHealth: MAX_HEALTH,
      maxHunger: MAX_HUNGER,
    });
    const weather = createWeather(THREE, {
      scene,
      player,
      playSound,
      labelEl: document.getElementById('weather'),
    });
    const dayCycle = createDayCycle(THREE, { scene, sun, ambient, stars, player });
    const HUNGER_DECAY = 0.06;   // 每秒自然下降
    const STARVE_DAMAGE = 1;     // 饥饿归零时每 2 秒掉血
    let gameTime = 0;       // 累计游戏时间（秒），怪物 AI 与回血用
    const keys = createKeyState(document);
    let locked = false;

    // 鼠标视角（指针锁定）
    document.addEventListener('mousemove', e => {
      if (!locked) return;
      player.yaw -= e.movementX * 0.0025;
      player.pitch -= e.movementY * 0.0025;
      const lim = Math.PI / 2 - 0.01;
      player.pitch = Math.max(-lim, Math.min(lim, player.pitch));
    });
    document.addEventListener('pointerlockchange', () => {
      locked = document.pointerLockElement === canvas;
      if (!locked) {
        leftMouseDown = false;
        suppressMiningUntilMouseup = false;
        cancelMining();
      }
      // 合成/箱子面板打开或玩家死亡时不弹"点击开始"遮罩
      if (!locked && !craftOpen && !furnaceOpen && !openChestKey && !bagOpen && !player.dead) overlay.classList.remove('hidden');
      else overlay.classList.add('hidden');
    });

    // 玩家受伤：扣血、记录时刻、触发红屏闪烁、判死
    function damagePlayer(dmg) {
      applyPlayerDamage(player, dmg, gameTime, {
        onHurt: () => {
          hurtEl.classList.add('flash');
          setTimeout(() => hurtEl.classList.remove('flash'), 120);
        },
        onHealthChanged: renderHealth,
        onDeath: playerDie,
      });
    }

    function playerDie() {
      player.dead = true;
      deathEl.classList.remove('hidden');
      document.exitPointerLock();
    }
    function placePlayerAtSpawn() {
      const x = Math.floor(WORLD_W / 2);
      const z = Math.floor(WORLD_D / 2);
      player.pos.set(x + 0.5, surfaceY(x, z) + 0.05 + PLAYER_HEIGHT, z + 0.5);
      player.vel.set(0, 0, 0);
      player.onGround = false;
      player.fallStartY = player.pos.y;
    }

    // 获得经验：累加、升级、刷新经验条
    function gainXP(amount) {
      gainPlayerXP(player, amount, {
        onLevelUp: () => playSound('kill'),
        onXPChanged: renderXP,
      });
    }

    function baseCreatureCtx(extra = {}) {
      return {
        world: ecsWorld,
        player,
        gameTime,
        worldW: WORLD_W,
        worldH: WORLD_H,
        worldD: WORLD_D,
        radius: MOB_RADIUS,
        height: MOB_HEIGHT,
        playerRadius: PLAYER_RADIUS,
        playerHeight: PLAYER_HEIGHT,
        creaturePersonalSpace: 0.18,
        gravity: GRAVITY,
        jumpSpeed: JUMP_SPEED,
        surfaceY,
        isSolidAt,
        spawnDrop,
        ...extra,
      };
    }
    function mobCtx(extra = {}) {
      return baseCreatureCtx({
        count: MOB_COUNT,
        sight: MOB_SIGHT,
        attackCooldown: MOB_ATTACK_CD,
        mobTypes: MOB_TYPES,
        mobTypeKeys: MOB_TYPE_KEYS,
        dayCycle,
        getBlock,
        isSolid,
        damagePlayer,
        spawnDamageText,
        playSound,
        particles,
        ...extra,
      });
    }
    function animalCtx(extra = {}) {
      return baseCreatureCtx({
        count: ANIMAL_COUNT,
        animalTypes: ANIMAL_TYPES,
        animalTypeKeys: ANIMAL_TYPE_KEYS,
        ...extra,
      });
    }
    function killMobWithRewards(eid) {
      killMob(eid, mobCtx());
      playSound('kill');
      gainXP(XP_PER_MOB);
    }
    function killAnimalWithSound(eid) {
      killAnimal(eid, animalCtx());
      playSound('kill');
    }
    function ensureCreatures() {
      ensureMobs(ecsWorld, mobCtx());
      ensureAnimals(ecsWorld, animalCtx());
    }

    // ===== 方块选取（DDA 射线）=====
    // 从眼睛沿视线方向步进，返回命中的方块坐标和命中面的法线（用于在邻格放置）。
    function raycastBlock({ mode = 'interact' } = {}) {
      const origin = player.pos.clone();
      const dir = new THREE.Vector3(0, 0, -1)
        .applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ')).normalize();

      let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
      const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
      const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
      const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;
      // 到下一格边界的距离（避免除零用 Infinity）
      const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
      const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
      const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
      let tMaxX = dir.x > 0 ? (Math.floor(origin.x) + 1 - origin.x) / dir.x
        : dir.x < 0 ? (origin.x - Math.floor(origin.x)) / -dir.x
          : Infinity;
      let tMaxY = dir.y > 0 ? (Math.floor(origin.y) + 1 - origin.y) / dir.y
        : dir.y < 0 ? (origin.y - Math.floor(origin.y)) / -dir.y
          : Infinity;
      let tMaxZ = dir.z > 0 ? (Math.floor(origin.z) + 1 - origin.z) / dir.z
        : dir.z < 0 ? (origin.z - Math.floor(origin.z)) / -dir.z
          : Infinity;

      let nx = 0, ny = 0, nz = 0; // 上一步前进的法线方向
      let distance = 0;
      let enteredBlock = false;
      while (distance <= REACH) {
        const id = getBlock(x, y, z);
        if (id !== AIR && inBounds(x, y, z)) {
          // 挖掘时水只阻挡视线反馈，不作为可破坏目标；射线继续找水后的实心方块。
          if (!(mode === 'break' && id === 7)) {
            // 如果眼睛意外在方块内部，不把这个方块当作可挖目标。
            if (!enteredBlock) return null;
            if (mode === 'break' && !canBreakByRay(id)) return null;
            return { hit: [x, y, z], normal: [nx, ny, nz], id, distance };
          }
        }
        // 选最近的轴前进
        if (tMaxX < tMaxY && tMaxX < tMaxZ) {
          distance = tMaxX;
          x += stepX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
        } else if (tMaxY < tMaxZ) {
          distance = tMaxY;
          y += stepY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
        } else {
          distance = tMaxZ;
          z += stepZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
        }
        enteredBlock = true;
      }
      return null;
    }
    function canBreakByRay(id) {
      return id !== AIR && id !== 7;
    }
    function isPlayerInWaterNow() {
      const x = Math.floor(player.pos.x);
      const z = Math.floor(player.pos.z);
      const chest = Math.floor(player.pos.y - PLAYER_HEIGHT * 0.45);
      const feet = Math.floor(player.pos.y - PLAYER_HEIGHT + 0.2);
      return getBlock(x, chest, z) === 7 || getBlock(x, feet, z) === 7;
    }
    let underwaterBubbleT = 0;
    function spawnWaterBubbles(count = 6, spread = 0.65) {
      particles.burst(
        player.pos.x + (Math.random() - 0.5) * spread,
        player.pos.y - PLAYER_HEIGHT * 0.55,
        player.pos.z + (Math.random() - 0.5) * spread,
        0x9ee8ff,
        count,
        0.55,
        0.75,
        { opacity: 0.58, size: 0.45, gravityScale: -0.18 }
      );
    }
    function updateWaterFeedback(dt) {
      const inWater = !player.dead && isPlayerInWaterNow();
      waterOverlayEl.classList.toggle('on', inWater);
      if (!inWater) {
        underwaterBubbleT = 0;
        return;
      }
      underwaterBubbleT -= dt;
      if (underwaterBubbleT <= 0) {
        underwaterBubbleT = 0.22 + Math.random() * 0.12;
        spawnWaterBubbles(3, 0.85);
      }
    }
    const mining = {
      active: false,
      key: '',
      id: AIR,
      toolId: null,
      elapsed: 0,
      duration: 1,
      swingT: 0,
      chipT: 0,
    };
    let leftMouseDown = false;
    let suppressMiningUntilMouseup = false;
    function setMiningProgress(value, visible) {
      mineProgressEl.classList.toggle('on', visible);
      mineProgressFillEl.style.width = Math.round(Math.max(0, Math.min(1, value)) * 100) + '%';
    }
    function cancelMining() {
      mining.active = false;
      mining.key = '';
      mining.elapsed = 0;
      mining.swingT = 0;
      mining.chipT = 0;
      setMiningProgress(0, false);
    }
    function startMiningTarget(r, toolId) {
      const [x, y, z] = r.hit;
      mining.active = true;
      mining.key = keyOf(x, y, z);
      mining.id = r.id;
      mining.toolId = toolId ?? null;
      mining.elapsed = 0;
      mining.duration = miningDuration(r.id, toolId);
      mining.swingT = 0;
      mining.chipT = 0;
      setMiningProgress(0, true);
    }
    function breakMinedBlock(r) {
      const [x, y, z] = r.hit;
      const broken = getBlock(x, y, z);
      if (!canBreakByRay(broken)) return;
      applyBlockEdit(x, y, z, AIR);
      if (net.isMultiplayer()) net.send(MSG.BLOCK, { x, y, z, id: AIR });
      const drop = dropOf(broken);
      if (drop !== null && !net.isClient()) spawnDrop(x, y, z, drop);
      if (broken === 10 || broken === 11) gainXP(XP_PER_ORE); // 挖矿石得经验
      playSound('break');
      particles.burst(x + 0.5, y + 0.5, z + 0.5, blockColor(broken, 'top'), 8, 3, 0.5);
      player.hunger = Math.max(0, player.hunger - 0.15);
      renderHunger();
    }
    function updateMining(dt) {
      if (!leftMouseDown || suppressMiningUntilMouseup || !locked || player.dead) {
        if (mining.active) cancelMining();
        return;
      }
      const r = raycastBlock({ mode: 'break' });
      if (!r) {
        if (mining.active) cancelMining();
        return;
      }
      const [x, y, z] = r.hit;
      const toolId = selectedItem();
      const targetKey = keyOf(x, y, z);
      if (!mining.active || mining.key !== targetKey || mining.id !== r.id || mining.toolId !== (toolId ?? null)) {
        startMiningTarget(r, toolId);
      }
      if (!Number.isFinite(mining.duration)) {
        cancelMining();
        return;
      }
      const inWater = isPlayerInWaterNow();
      mining.elapsed += dt * (inWater ? 0.38 : 1);
      mining.swingT -= dt;
      mining.chipT -= dt;
      if (mining.swingT <= 0) {
        mining.swingT = Math.max(0.12, Math.min(0.28, mining.duration * 0.32));
        hand.startSwing();
      }
      if (mining.chipT <= 0) {
        mining.chipT = Math.max(0.08, Math.min(0.18, mining.duration * 0.08));
        particles.burst(x + 0.5, y + 0.5, z + 0.5, blockColor(r.id, 'top'), 2, 0.8, 0.25, { size: 0.45 });
        if (inWater) spawnWaterBubbles(2, 0.7);
      }
      setMiningProgress(mining.elapsed / mining.duration, true);
      if (mining.elapsed >= mining.duration) {
        breakMinedBlock(r);
        cancelMining();
      }
    }

    // ===== 破坏 / 放置 =====
    document.addEventListener('mousedown', e => {
      if (!locked || player.dead) return;
      if (e.button === 0) {
        leftMouseDown = true;
        suppressMiningUntilMouseup = false;
        hand.startSwing(); // 左键总是挥手
        if (isPlayerInWaterNow()) {
          spawnWaterBubbles(6, 0.85);
          playSound('splash');
        }
        // 左键：先看是否瞄准怪物（不依赖方块命中，这样对着天空的怪物也能打），是则攻击
        const mobEid = raycastCreature(ecsWorld, THREE, player, { kind: 'mob', range: ATTACK_RANGE });
        if (mobEid >= 0) {
          suppressMiningUntilMouseup = true;
          cancelMining();
          if (player.attackCd <= 0) {
            const damage = selectedAttackDamage();
            player.attackCd = ATTACK_COOLDOWN;
            triggerHitMarker();          // 准星命中标记
            spawnDamageText(damage, false); // 伤害飘字
            playSound('hit');            // 打击音效
            if (net.isClient()) {
              damageMob(mobEid, damage, { knockbackYaw: player.yaw });
              net.send(MSG.HIT, { kind: 'mob', id: netIdFor(mobEid), damage }); // 客户端：交给房主结算
            } else {
              damageMob(mobEid, damage, {
                knockbackYaw: player.yaw,
                onKill: killMobWithRewards,
              });
            }
          }
          return; // 攻击了怪物就不破坏方块
        }
        // 没瞄到怪物，再看动物
        const animalEid = raycastCreature(ecsWorld, THREE, player, { kind: 'animal', range: ATTACK_RANGE });
        if (animalEid >= 0) {
          suppressMiningUntilMouseup = true;
          cancelMining();
          if (player.attackCd <= 0) {
            const damage = selectedAttackDamage();
            player.attackCd = ATTACK_COOLDOWN;
            triggerHitMarker();
            spawnDamageText(damage, false);
            playSound('hit');
            if (net.isClient()) {
              damageAnimal(animalEid, damage, { player });
              net.send(MSG.HIT, { kind: 'animal', id: netIdFor(animalEid), damage });
            } else {
              damageAnimal(animalEid, damage, {
                player,
                onKill: killAnimalWithSound,
              });
            }
          }
          return;
        }
      } else if (e.button === 2) {
        cancelMining();
        const r = raycastBlock();
        if (!r) return;
        const [x, y, z] = r.hit;
        const hitId = getBlock(x, y, z);
        // 右键功能方块：箱子→开存储，门→开关
        if (hitId === 17) { openChest(x, y, z); return; }
        if (hitId === 12) { openCraft(true); return; }
        if (hitId === 20) { openFurnace(); return; }
        if (hitId === 15) {
          const k = keyOf(x, y, z);
          netSession.sendDoor(x, y, z, !openDoors.has(k));
          playSound('place');
          return;
        }
        // 否则：在命中面外侧放置当前选中方块
        const [nx, ny, nz] = r.normal;
        const px = x + nx, py = y + ny, pz = z + nz;
        if (!inBounds(px, py, pz) || getBlock(px, py, pz) !== AIR) return;
        // 不要把方块放进玩家身体里
        const feet = player.pos.y - PLAYER_HEIGHT;
        const overlapXZ = Math.abs(px + 0.5 - player.pos.x) < 0.5 + PLAYER_RADIUS &&
                          Math.abs(pz + 0.5 - player.pos.z) < 0.5 + PLAYER_RADIUS;
        const overlapY = py < player.pos.y + 0.1 && py + 1 > feet - 0.1;
        if (overlapXZ && overlapY) return;
        // 生存模式：必须有库存才能放置，放置后扣减
        const placeId = selectedItem();
        if (!isPlaceableItem(placeId)) return;
        if ((inventory[placeId] || 0) <= 0) return;
        removeFromInventory(placeId, 1);
        renderHotbar();
        applyBlockEdit(px, py, pz, placeId);
        if (net.isMultiplayer()) net.send(MSG.BLOCK, { x: px, y: py, z: pz, id: placeId });
        playSound('place');
      }
    });
    document.addEventListener('mouseup', e => {
      if (e.button !== 0) return;
      leftMouseDown = false;
      suppressMiningUntilMouseup = false;
      cancelMining();
    });
    window.addEventListener('blur', () => {
      leftMouseDown = false;
      suppressMiningUntilMouseup = false;
      cancelMining();
    });
    // 屏蔽右键菜单，否则放置会弹出浏览器菜单
    document.addEventListener('contextmenu', e => e.preventDefault());

    // ===== UI =====
    const overlay = document.getElementById('overlay');
    const hurtEl = document.getElementById('hurt');
    const waterOverlayEl = document.getElementById('waterOverlay');
    const deathEl = document.getElementById('death');
    const chestEl = document.getElementById('chest');
    const chestSlotsEl = document.getElementById('chestSlots');
    const chestInvEl = document.getElementById('chestInv');
    const hintEl = document.getElementById('hint');
    let hintTimer = null;
    function flashHint(text) {
      hintEl.textContent = text;
      hintEl.classList.add('show');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => hintEl.classList.remove('show'), 1500);
    }
    function paintItemIcon(el, id) {
      el.style.backgroundColor = '#' + itemColor(id).toString(16).padStart(6, '0');
      const texture = itemTexturePath(id);
      if (!texture) return;
      el.style.backgroundImage = `url("${texture}")`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
    }
    const hotbar = Array(HOTBAR_SIZE).fill(null);
    let selected = 0; // hotbar 中的索引
    function canHotbar(id) {
      return !!(BLOCKS[id] || ITEMS[id]);
    }
    function normalizeHotbar() {
      const seen = new Set();
      for (let i = 0; i < hotbar.length; i++) {
        const id = Number(hotbar[i]);
        if (!canHotbar(id) || (inventory[id] || 0) <= 0 || seen.has(id)) hotbar[i] = null;
        else {
          hotbar[i] = id;
          seen.add(id);
        }
      }
      const owned = Object.keys(inventory)
        .map(Number)
        .filter(id => canHotbar(id) && inventory[id] > 0 && !seen.has(id))
        .sort((a, b) => {
          const blockA = BLOCKS[a] ? 0 : 1;
          const blockB = BLOCKS[b] ? 0 : 1;
          return blockA - blockB || a - b;
        });
      for (const id of owned) {
        const slot = hotbar.indexOf(null);
        if (slot < 0) break;
        hotbar[slot] = id;
        seen.add(id);
      }
      if (selected >= HOTBAR_SIZE) selected = HOTBAR_SIZE - 1;
    }
    function selectedItem() {
      normalizeHotbar();
      return hotbar[selected] || null;
    }
    function selectedAttackDamage() {
      const id = selectedItem();
      return id ? itemDamage(id) : ATTACK_DAMAGE;
    }
    function assignSelectedHotbar(id) {
      id = Number(id);
      if (!canHotbar(id) || (inventory[id] || 0) <= 0) return;
      const existing = hotbar.indexOf(id);
      if (existing >= 0) {
        selected = existing;
      } else {
        hotbar[selected] = id;
      }
      renderHotbar();
      updateInfo(0);
    }
    function restoreHotbar(saved = []) {
      hotbar.fill(null);
      saved.slice(0, HOTBAR_SIZE).forEach((id, i) => {
        const n = Number(id);
        if (canHotbar(n)) hotbar[i] = n;
      });
      normalizeHotbar();
    }
    const hud = createHud({
      player,
      inventory,
      hotbar,
      itemName,
      itemColor,
      itemTexturePath,
      maxHealth: MAX_HEALTH,
      maxHunger: MAX_HUNGER,
    });

    // 渲染经验条：当前等级内的进度
    function renderXP() { hud.renderXP(); }

    // ===== 箱子存储 UI =====
    let openChestKey = null;
    function openChest(x, y, z) {
      if (craftOpen) closeCraft(false);
      if (furnaceOpen) closeFurnace(false);
      if (bagOpen) closeBag(false);
      openChestKey = keyOf(x, y, z);
      if (!chests[openChestKey]) chests[openChestKey] = {};
      renderChest();
      chestEl.classList.remove('hidden');
      document.exitPointerLock();
    }
    function closeChest(requestLock = true) {
      openChestKey = null;
      chestEl.classList.add('hidden');
      if (requestLock) canvas.requestPointerLock();
    }
    // 渲染箱子+背包两行，点击在两者间转移一个
    function renderChest() {
      if (!openChestKey) return;
      const store = chests[openChestKey];
      const mkSlot = (id, count, onClick) => {
        const s = document.createElement('div'); s.className = 'cslot';
        const sw = document.createElement('div'); sw.className = 'sw';
        paintItemIcon(sw, id);
        const c = document.createElement('span'); c.className = 'cnt'; c.textContent = count;
        s.appendChild(sw); s.appendChild(c);
        s.addEventListener('click', onClick);
        return s;
      };
      chestSlotsEl.textContent = '';
      for (const id of Object.keys(store)) {
        if (store[id] > 0) chestSlotsEl.appendChild(mkSlot(id, store[id], () => {
          // 从箱子取出一个到背包
          store[id]--; if (store[id] <= 0) delete store[id];
          addItemToInventory(id, 1);
          netSession.syncChest(openChestKey);
          renderChest(); renderHotbar();
        }));
      }
      chestInvEl.textContent = '';
      for (const id of Object.keys(inventory)) {
        if (inventory[id] > 0) chestInvEl.appendChild(mkSlot(id, inventory[id], () => {
          // 从背包存入一个到箱子
          removeFromInventory(id, 1);
          store[id] = (store[id] || 0) + 1;
          netSession.syncChest(openChestKey);
          renderChest(); renderHotbar();
        }));
      }
    }

    // 渲染饥饿值：10 个鸡腿，每个 2 点
    function renderHunger() { hud.renderHunger(); }

    let craftOpen = false;
    let craftOpenAtTable = false;
    let nearTable = false; // 附近是否有工作台

    // 检查某配方当前能否合成（库存够 + 工作台条件满足）
    function canCraft(r) {
      return canCraftRecipe(r, nearTable || craftOpenAtTable);
    }
    // 执行合成：扣材料、加产物
    function doCraft(r) {
      if (!craftRecipe(r, nearTable || craftOpenAtTable)) return;
      playSound('pickup');
      renderHotbar();
      renderCraft();
      if (bagOpen) renderBag();
    }

    // 渲染合成面板：列出所有配方，可合成的高亮、缺料的置灰
    const craftEl = document.getElementById('craft');
    const craftListEl = document.getElementById('craftList');
    const craftTitleEl = document.getElementById('craftTitle');
    const craftHintEl = document.getElementById('craftHint');
    const furnaceEl = document.getElementById('furnace');
    const furnaceListEl = document.getElementById('furnaceList');

    // ===== 背包面板 =====
    const bagEl = document.getElementById('bag');
    const bagGridEl = document.getElementById('bagGrid');
    let bagOpen = false;
    // 渲染背包：列出所有持有物品（含非放置类如工具/肉/矿产），食物可点击食用
    function renderBag() {
      bagGridEl.textContent = '';
      const ids = Object.keys(inventory).filter(id => inventory[id] > 0);
      if (ids.length === 0) {
        const tip = document.createElement('div');
        tip.className = 'empty-tip';
        tip.textContent = '背包空空如也 —— 去挖点东西吧';
        bagGridEl.appendChild(tip);
        return;
      }
      for (const id of ids) {
        const slot = document.createElement('div');
        slot.className = 'bslot';
        const sw = document.createElement('div');
        sw.className = 'sw';
        paintItemIcon(sw, id);
        const nm = document.createElement('div');
        nm.className = 'nm';
        const food = ITEMS[id]?.food;
        nm.textContent = itemName(id) + (food ? ' 🍽' : '');
        const cnt = document.createElement('span');
        cnt.className = 'cnt';
        cnt.textContent = inventory[id];
        slot.appendChild(sw); slot.appendChild(nm); slot.appendChild(cnt);
        slot.title = '点击放入当前快捷格';
        if (food) {
          slot.title = '饥饿未满时点击食用；否则放入当前快捷格';
          slot.addEventListener('click', () => {
            if (inventory[id] > 0 && player.hunger < MAX_HUNGER) {
              removeFromInventory(id, 1);
              player.hunger = Math.min(MAX_HUNGER, player.hunger + food);
              renderHunger(); renderBag(); renderHotbar();
            } else {
              assignSelectedHotbar(id);
            }
          });
        } else {
          slot.addEventListener('click', () => assignSelectedHotbar(id));
        }
        bagGridEl.appendChild(slot);
      }
    }
    function openBag() {
      if (craftOpen) closeCraft(false);
      if (furnaceOpen) closeFurnace(false);
      if (openChestKey) closeChest(false);
      bagOpen = true;
      renderBag();
      bagEl.classList.remove('hidden');
      document.exitPointerLock();
    }
    function closeBag(requestLock = true) {
      bagOpen = false;
      bagEl.classList.add('hidden');
      if (requestLock) canvas.requestPointerLock();
    }
    function toggleBag() {
      if (bagOpen) closeBag();
      else openBag();
    }

    let furnaceOpen = false;
    function renderFurnace() {
      furnaceListEl.textContent = '';
      for (const r of FURNACE_RECIPES) {
        const ok = canSmeltRecipe(r);
        const row = document.createElement('div');
        row.className = 'recipe ' + (ok ? 'ok' : 'no');
        const input = document.createElement('div');
        input.className = 'sw';
        paintItemIcon(input, r.input);
        const arrow = document.createElement('div');
        arrow.className = 'arrow';
        arrow.textContent = '+';
        const fuel = document.createElement('div');
        fuel.className = 'sw';
        paintItemIcon(fuel, r.fuel);
        const txt = document.createElement('div');
        txt.className = 'txt';
        txt.textContent = `${r.name} -> ${itemName(r.output)} ×${r.count}`;
        const need = document.createElement('div');
        need.className = 'need';
        need.textContent = `需要: ${itemName(r.input)}×1 + ${itemName(r.fuel)}×1`;
        txt.appendChild(need);
        row.appendChild(input);
        row.appendChild(arrow);
        row.appendChild(fuel);
        row.appendChild(txt);
        if (ok) row.addEventListener('click', () => doSmelt(r));
        furnaceListEl.appendChild(row);
      }
    }
    function doSmelt(recipe) {
      if (!smeltRecipe(recipe)) return;
      playSound('smelt');
      renderHotbar();
      renderFurnace();
      if (bagOpen) renderBag();
    }
    function openFurnace() {
      if (craftOpen) closeCraft(false);
      if (bagOpen) closeBag(false);
      if (openChestKey) closeChest(false);
      furnaceOpen = true;
      renderFurnace();
      furnaceEl.classList.remove('hidden');
      document.exitPointerLock();
    }
    function closeFurnace(requestLock = true) {
      furnaceOpen = false;
      furnaceEl.classList.add('hidden');
      if (requestLock) canvas.requestPointerLock();
    }

    function renderCraft() {
      craftListEl.textContent = '';
      for (const r of RECIPES) {
        const ok = canCraft(r);
        const row = document.createElement('div');
        row.className = 'recipe ' + (ok ? 'ok' : 'no');
        const grid = document.createElement('div');
        grid.className = 'grid';
        for (let gy = 0; gy < 3; gy++) {
          for (let gx = 0; gx < 3; gx++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            const id = r.grid?.[gy]?.[gx] || 0;
            if (id) paintItemIcon(cell, id);
            grid.appendChild(cell);
          }
        }
        const sw = document.createElement('div');
        sw.className = 'sw';
        paintItemIcon(sw, r.output);
        const txt = document.createElement('div');
        txt.className = 'txt';
        const needs = Object.entries(r.inputs)
          .map(([id, n]) => `${itemName(id)}×${n}`).join(' + ');
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = r.table ? '3×3' : '2×2';
        txt.textContent = `${r.name} ×${r.count}`;
        const need = document.createElement('div');
        need.className = 'need';
        need.textContent = `需要: ${needs}${r.table ? ' · 需要工作台' : ''}`;
        txt.appendChild(badge);
        txt.appendChild(need);
        row.appendChild(grid); row.appendChild(sw); row.appendChild(txt);
        if (ok) row.addEventListener('click', () => doCraft(r));
        craftListEl.appendChild(row);
      }
    }
    function openCraft(fromTable = false) {
      if (furnaceOpen) closeFurnace(false);
      if (bagOpen) closeBag(false);
      if (openChestKey) closeChest(false);
      craftOpen = true;
      craftOpenAtTable = fromTable;
      if (craftTitleEl) craftTitleEl.textContent = fromTable ? '工作台' : '合成';
      if (craftHintEl) craftHintEl.textContent = fromTable
        ? '工作台 3×3 配方可用 · E 关闭'
        : '随身 2×2 配方可用 · 靠近或右键工作台解锁 3×3';
      renderCraft();
      craftEl.classList.remove('hidden');
      document.exitPointerLock();
    }
    function closeCraft(requestLock = true) {
      craftOpen = false;
      craftOpenAtTable = false;
      craftEl.classList.add('hidden');
      if (requestLock) canvas.requestPointerLock();
    }
    function toggleCraft() {
      if (craftOpen) closeCraft();
      else openCraft(false);
    }
    document.addEventListener('keydown', e => {
      if (!shouldHandleGameKey(e)) return;
      // Tab 打开/关闭背包（阻止默认的焦点切换）
      if (e.code === 'Tab') {
        e.preventDefault();
        if (!player.dead) toggleBag();
        return;
      }
      if (e.code === 'KeyE' && !player.dead) {
        if (openChestKey) closeChest();   // 箱子开着时 E 先关箱子
        else if (furnaceOpen) closeFurnace();
        else if (craftOpen) closeCraft();
        else toggleCraft();
      }
      // Q 吃食物：在库存里找第一个食物吃掉，回饥饿
      if (e.code === 'KeyQ' && !player.dead) {
        for (const id of Object.keys(inventory)) {
          const food = ITEMS[id]?.food;
          if (food && inventory[id] > 0 && player.hunger < MAX_HUNGER) {
            removeFromInventory(id, 1);
            player.hunger = Math.min(MAX_HUNGER, player.hunger + food);
            renderHunger(); renderHotbar();
            break;
          }
        }
      }
      // K 手动存档
      if (e.code === 'KeyK' && !player.dead) {
        doSave();
      }
    });
    // 渲染血量：10 颗心，每颗 2 点；满/半/空三态
    function renderHealth() { hud.renderHealth(); }

    // 死亡屏：点击复活——满血、回出生点、清空怪物重新生成
    deathEl.addEventListener('click', () => {
      respawnPlayer(player, {
        worldW: WORLD_W,
        worldH: WORLD_H,
        worldD: WORLD_D,
        maxHealth: MAX_HEALTH,
      });
      placePlayerAtSpawn();
      if (!net.isClient()) {
        clearMobs(ecsWorld);
        ensureMobs(ecsWorld, mobCtx());
      }
      renderHealth();
      deathEl.classList.add('hidden');
      canvas.requestPointerLock();
    });

    // 渲染 9 格快捷栏：只显示当前拥有且可使用的物品
    function renderHotbar() {
      normalizeHotbar();
      hud.renderHotbar(selected);
    }

    // 数字键 1-9 选快捷栏；滚轮循环切换
    document.addEventListener('keydown', e => {
      if (!shouldHandleGameKey(e)) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= HOTBAR_SIZE) { selected = n - 1; renderHotbar(); updateInfo(0); }
    });
    document.addEventListener('wheel', e => {
      if (!locked || player.dead) return;
      selected = (selected + (e.deltaY > 0 ? 1 : -1) + HOTBAR_SIZE) % HOTBAR_SIZE;
      renderHotbar();
      updateInfo(0);
    });

    // 点击遮罩进入游戏（请求指针锁定 + 启动音频，需用户手势）
    // 点击遮罩进入游戏（但点种子输入框/新世界按钮时不进入）
    const seedInputEl = document.getElementById('seedInput');
    const newGameBtnEl = document.getElementById('newGameBtn');
    const hostBtnEl = document.getElementById('hostBtn');
    const joinBtnEl = document.getElementById('joinBtn');
    const nameInputEl = document.getElementById('nameInput');
    const roomInputEl = document.getElementById('roomInput');
    const netMsgEl = document.getElementById('netMsg');
    const netbarEl = document.getElementById('netbar');
    const noStart = new Set([seedInputEl, newGameBtnEl, hostBtnEl, joinBtnEl, nameInputEl, roomInputEl]);
    overlay.addEventListener('click', (e) => {
      if (noStart.has(e.target)) return; // 这些有自己的处理
      initAudio();
      canvas.requestPointerLock();
    });
    // 「新世界」按钮：用输入的种子重开（覆盖存档）
    newGameBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const seed = Save.seedFromString(seedInputEl.value.trim());
      Save.clearSave();
      startNewGame(seed);
      initAudio();
      canvas.requestPointerLock();
      flashHint('新世界 · 种子 ' + seed);
    });

    // ===== 联机 UI 与会话 =====
    function netMsg(t) { if (netMsgEl) netMsgEl.textContent = t; }
    function updateNetbar() {
      if (!net.isMultiplayer()) { netbarEl.classList.add('hidden'); return; }
      netbarEl.classList.remove('hidden');
      const role = net.isHost() ? '房主' : '客机';
      const n = net.isHost() ? (net.conns.size + 1) : (remotePlayers.count() + 1);
      netbarEl.textContent = `🌐 ${role} · 房间 ${net.roomId} · ${n} 人`;
    }
    net.onStatus = (t) => netMsg(t);
    net.onPeerLeave = (pid) => { remotePlayers.remove(pid); updateNetbar(); };

    const netSession = createNetSession({
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
      getSeed: () => currentSeed,
      setSeed: seed => { currentSeed = seed; },
      getPlayerName: () => net.displayName,
      getGameTime: () => gameTime,
      setGameTime: value => { gameTime = value; },
      attackDamage: ATTACK_DAMAGE,
      air: AIR,
    });

    hostBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof window.Peer === 'undefined') { netMsg('PeerJS 未加载，检查网络'); return; }
      net.setDisplayName(nameInputEl.value || '房主');
      netMsg('正在创建房间…');
      net.host((roomId) => {
        netSession.markReady();
        netMsg('房间号：' + roomId + ' （发给朋友）');
        netSession.setupHostHandlers();
        updateNetbar();
      });
    });
    joinBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof window.Peer === 'undefined') { netMsg('PeerJS 未加载，检查网络'); return; }
      const room = roomInputEl.value.trim().toUpperCase();
      if (room.length < 4) { netMsg('请输入房间号'); return; }
      net.setDisplayName(nameInputEl.value || '玩家');
      netMsg('正在加入 ' + room + ' …');
      netSession.setupClientHandlers(() => netMsg('世界已同步，点击开始'));
      net.join(room, () => { netMsg('已连接，等待世界…'); });
    });

    function updateInfo(dt) {
      hud.updateInfo(selected, dt);
    }
    const emptyKeys = {};

    // ===== 主循环 =====
    // 每帧：根据按键算出水平移动方向，施加重力，分轴碰撞，更新相机，渲染。
    function update(dt, controlsActive = true) {
      gameTime += dt;

      // 死亡时停止一切移动，只保持相机
      if (player.dead) {
        camera.position.copy(player.pos);
        camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
        return;
      }

      updatePlayer(player, dt, controlsActive ? keys : emptyKeys, gameTime, {
        gameTime,
        worldW: WORLD_W,
        worldH: WORLD_H,
        worldD: WORLD_D,
        playerRadius: PLAYER_RADIUS,
        playerHeight: PLAYER_HEIGHT,
        moveSpeed: MOVE_SPEED,
        sprintMult: SPRINT_MULT,
        gravity: GRAVITY,
        jumpSpeed: JUMP_SPEED,
        waterMoveMult: 0.58,
        swimAccel: 13,
        waterRiseSpeed: 2.8,
        waterMaxRiseSpeed: 4.4,
        waterExitStep: 1.45,
        safeFallDistance: SAFE_FALL_DISTANCE,
        fallDamagePerBlock: FALL_DAMAGE_PER_BLOCK,
        hungerDecay: HUNGER_DECAY,
        starveDamage: STARVE_DAMAGE,
        maxHealth: MAX_HEALTH,
        regenDelay: REGEN_DELAY,
        regenRate: REGEN_RATE,
        isSolidAt,
        surfaceY,
        getBlock,
        isClimbable,
        onHurt: () => {
          hurtEl.classList.add('flash');
          setTimeout(() => hurtEl.classList.remove('flash'), 120);
        },
        onDeath: playerDie,
        onHealthChanged: renderHealth,
        onHungerChanged: renderHunger,
      });

      // 2.55) 检测附近 3 格内是否有工作台（合成面板用）
      const px = Math.floor(player.pos.x), py = Math.floor(player.pos.y), pz = Math.floor(player.pos.z);
      let foundTable = false;
      for (let dx = -2; dx <= 2 && !foundTable; dx++)
        for (let dyy = -2; dyy <= 2 && !foundTable; dyy++)
          for (let dz = -2; dz <= 2 && !foundTable; dz++)
            if (getBlock(px + dx, py + dyy, pz + dz) === 12) foundTable = true;
      nearTable = foundTable;

      // 2.6) 推进怪物 AI（联机时仅房主跑；客户端渲染房主下发的快照）
      if (!net.isClient()) {
        updateMobsSystem(ecsWorld, dt, mobCtx());
        updateSunburnSystem(ecsWorld, dt, mobCtx());
        // 2.65) 推进被动动物
        updateAnimalsSystem(ecsWorld, dt, animalCtx());
        ensureCreatures();
      }

      // 2.7) 推进掉落物（重力/拾取/超时）
      updateDropsSystem(ecsWorld, dt, {
        player,
        playerHeight: PLAYER_HEIGHT,
        gravity: GRAVITY,
        pickupRange: PICKUP_RANGE,
        dropLifetime: DROP_LIFETIME,
        getBlock,
        isSolid,
        pickup: addToInventory,
      });

      // 2.8) 打击感：手臂挥动、命中标记、怪物受击闪红
      updateMining(dt);
      hand.update(dt);
      updateHitMarker(dt);
      updateFlashSystem(ecsWorld, dt, {
        mobTypes: MOB_TYPES,
        animalTypes: ANIMAL_TYPES,
        gameTime,
      });
      syncMeshSystem(ecsWorld, { player, dt, gameTime });

      // 3) 更新相机
      camera.position.copy(player.pos);
      camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    }

    let last = performance.now();
    let lastAutoSave = 0; // 上次自动存档的 gameTime
    let fluidTick = 0;
    function animate(now) {
      try {
        const dt = Math.min((now - last) / 1000, 0.05); // 限制最大步长，防卡顿穿墙
        last = now;
        const simulating = locked || bagOpen || craftOpen || furnaceOpen || openChestKey !== null;
        if (simulating) update(dt, locked);
        if (simulating && !net.isClient()) {
          fluidTick += dt;
          if (fluidTick > 0.35) {
            fluidTick = 0;
            const fluidChanges = updateFluidPhysics();
            if (net.isHost()) {
              for (const change of fluidChanges) net.broadcast(MSG.BLOCK, change);
            }
          }
        }
        netSession.netTick(dt); // 联机同步（即使未锁定也插值远程玩家）
        // 昼夜与云持续运转（即使玩家死亡，世界依然流动）
        dayCycle.update(dt);
        clouds.update(dt);
        const weatherState = weather.update(dt);
        if (weatherState.lightning > 0) {
          scene.background = new THREE.Color(0xddeeff);
          if (scene.fog) scene.fog.color.setHex(0xddeeff);
        }
        updateWaterFeedback(dt);
        particles.update(dt, GRAVITY); // 推进粒子
        // 纹理缓动：让方块表面颗粒微微流动，制造"活"的氛围
        updateBlockTexture(dt);
        updateDamageTexts(dt); // 伤害飘字淡出
        updateInfo(dt);
        // 自动存档：每 30 秒一次（游戏进行中且未死亡）
        if (simulating && !player.dead && gameTime - lastAutoSave > 30) {
          lastAutoSave = gameTime;
          doSave();
        }
        renderer.render(scene, camera);
      } catch (err) {
        window.__animErr = (err && err.stack) || String(err);
        document.getElementById('info').textContent = 'ERR: ' + (err && err.message);
        return; // 出错就停，避免刷屏
      }
      requestAnimationFrame(animate);
    }

    // ===== 启动 =====
    let currentSeed = 1337;

    // 开新游戏：用指定种子生成世界
    function startNewGame(seed) {
      currentSeed = seed;
      // 清空世界数组
      for (let i = 0; i < world.length; i++) world[i] = 0;
      generateWorld(seed);
      resetPlayer(player, {
        worldW: WORLD_W,
        worldH: WORLD_H,
        worldD: WORLD_D,
        maxHealth: MAX_HEALTH,
        maxHunger: MAX_HUNGER,
      });
      placePlayerAtSpawn();
      dayCycle.reset(0.15); gameTime = 0;
      // 清空各容器
      clearBlockState();
      clearDrops(ecsWorld);
      clearMobs(ecsWorld);
      clearAnimals(ecsWorld);
      setNextNetId(1);
      giveStartingInventory();
      restoreHotbar([]);
      rebuildTerrain();
      refreshAllUI();
    }

    // 应用读档数据：恢复种子世界、方块改动与其余状态
    function applyLoadedSave(data) {
      currentSeed = data.seed ?? 1337;
      if (data.world) {
        for (let i = 0; i < world.length; i++) world[i] = data.world[i] || 0;
        rebuildTerrain();
      } else {
        world.fill(0);
        generateWorld(currentSeed);
        applyBlockEdits(data.blockState?.edits || {});
      }
      // 恢复玩家
      Object.assign(player, {
        health: data.player.health, hunger: data.player.hunger,
        xp: data.player.xp, level: data.player.level,
        yaw: data.player.yaw, pitch: data.player.pitch, dead: false,
      });
      const px = Number(data.player.px);
      const py = Number(data.player.py);
      const pz = Number(data.player.pz);
      const lx = Number.isFinite(px) ? Math.max(0, Math.min(WORLD_W - 1, Math.floor(px))) : 0;
      const lz = Number.isFinite(pz) ? Math.max(0, Math.min(WORLD_D - 1, Math.floor(pz))) : 0;
      const expectedGroundPos = surfaceY(lx, lz) + PLAYER_HEIGHT + 0.05;
      let hasSupportBelow = false;
      if (Number.isFinite(py)) {
        const footY = Math.floor(py - PLAYER_HEIGHT);
        for (let yy = footY; yy >= Math.max(0, footY - 12); yy--) {
          if (isSolidAt(lx, yy, lz)) { hasSupportBelow = true; break; }
        }
      }
      if (
        Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz) &&
        px >= 0 && px < WORLD_W && pz >= 0 && pz < WORLD_D &&
        py > -5 && py < WORLD_H + PLAYER_HEIGHT + 8 &&
        (py < expectedGroundPos + 12 || hasSupportBelow)
      ) {
        player.pos.set(px, py, pz);
      } else {
        placePlayerAtSpawn();
      }
      player.vel.set(0, 0, 0);
      player.fallStartY = player.pos.y;
      dayCycle.setTime(data.time?.dayTime ?? 0.15);
      gameTime = data.time?.gameTime ?? 0;
      restoreInventory(data.inventory || {});
      restoreHotbar(data.hotbar || []);
      restoreBlockState(data.blockState);
      hydrateEcs(data.ecs, { clearDrops, world: ecsWorld });
      refreshAllUI();
    }

    function refreshAllUI() {
      normalizeHotbar();
      hud.renderAll(selected);
    }

    // 收集当前状态用于存档
    function makeSnapshot() {
      return {
        seed: currentSeed,
        player: {
          px: player.pos.x, py: player.pos.y, pz: player.pos.z,
          health: player.health, hunger: player.hunger,
          xp: player.xp, level: player.level, yaw: player.yaw, pitch: player.pitch,
        },
        blockState: snapshotBlockState(),
        inventory,
        hotbar: hotbar.slice(),
        time: { dayTime: dayCycle.getTime(), gameTime },
        ecs: snapshotEcs(ecsWorld),
      };
    }
    function doSave() {
      const ok = Save.saveGame(makeSnapshot());
      if (ok) flashHint('已保存 ✓');
    }

    // 启动决策：清理旧存档键，有新 schema 存档则读档，否则开默认新世界
    Save.clearLegacySaves();
    const loaded = Save.loadGame();
    clouds.make();
    if (loaded) {
      applyLoadedSave(loaded);
    } else {
      startNewGame(1337);
    }
    ensureCreatures();
    onResize();
    requestAnimationFrame(animate);
  
