import * as THREE from 'three';
import * as D from './data.js';
import * as Save from './save.js';
import * as FX from './fx.js';
import { Net, MSG } from './net.js';
import {
  createPlayer, damagePlayer as applyPlayerDamage,
  gainPlayerXP, resetPlayer, respawnPlayer, updatePlayer,
} from './player.js';
import { initAudio, playSound } from './audio.js';
import { createDayCycle } from './daycycle.js';
import { createRemotePlayers } from './remotePlayers.js';
import { createClouds } from './clouds.js';
import { createHand } from './hand.js';
import {
  inventory, RECIPES,
  addToInventory as addItemToInventory,
  removeFromInventory, giveStartingInventory, restoreInventory,
  canCraft as canCraftRecipe, craft as craftRecipe,
} from './inventory.js';
import {
  initWorldRuntime, rebuildTerrain, updateBlockTexture,
  keyOf, isSolidAt, surfaceY,
  openDoors, chests, blockEdits,
  clearBlockState, restoreBlockState, snapshotBlockState, applyBlockEdit, applyBlockEdits,
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
  PICKUP_RANGE, DROP_LIFETIME,
  MAX_HEALTH, REGEN_DELAY, REGEN_RATE, ATTACK_DAMAGE, ATTACK_RANGE, ATTACK_COOLDOWN,
  MOB_COUNT, MOB_SIGHT, MOB_RADIUS, MOB_HEIGHT, MOB_ATTACK_CD, MOB_TYPES, MOB_TYPE_KEYS,
  ANIMAL_COUNT, ANIMAL_TYPES, ANIMAL_TYPE_KEYS,
  AIR, BLOCKS, ITEMS, PLACEABLE,
  XP_PER_MOB, XP_PER_ORE,
  itemName, itemColor, blockColor, isSolid, isClimbable, dropOf,
  world, inBounds, getBlock, generateWorld,
} = D;
// ===== 联机状态（net 层）=====
const net = new Net();
let netReady = false;       // 联机会话是否已建立（host 开房或 client 收到 WORLD）
let lastNetSync = 0;        // 上次发送同步的时间（节流）

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
    const dayCycle = createDayCycle(THREE, { scene, sun, ambient, stars, player });
    const HUNGER_DECAY = 0.06;   // 每秒自然下降
    const STARVE_DAMAGE = 1;     // 饥饿归零时每 2 秒掉血
    let gameTime = 0;       // 累计游戏时间（秒），怪物 AI 与回血用
    const keys = {};
    let locked = false;

    document.addEventListener('keydown', e => { keys[e.code] = true; });
    document.addEventListener('keyup', e => { keys[e.code] = false; });

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
      // 合成/箱子面板打开或玩家死亡时不弹"点击开始"遮罩
      if (!locked && !craftOpen && !openChestKey && !bagOpen && !player.dead) overlay.classList.remove('hidden');
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
    function raycastBlock() {
      const origin = player.pos.clone();
      const dir = new THREE.Vector3(0, 0, -1)
        .applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ')).normalize();

      let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
      const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
      // 到下一格边界的距离（避免除零用 Infinity）
      const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
      const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
      const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
      const fract = (a, s) => s > 0 ? (1 - (a - Math.floor(a))) : (a - Math.floor(a));
      let tMaxX = dir.x !== 0 ? fract(origin.x, stepX) * tDeltaX : Infinity;
      let tMaxY = dir.y !== 0 ? fract(origin.y, stepY) * tDeltaY : Infinity;
      let tMaxZ = dir.z !== 0 ? fract(origin.z, stepZ) * tDeltaZ : Infinity;

      let nx = 0, ny = 0, nz = 0; // 上一步前进的法线方向
      for (let t = 0; t < REACH * 2; t++) {
        if (getBlock(x, y, z) !== AIR && inBounds(x, y, z)) {
          return { hit: [x, y, z], normal: [nx, ny, nz] };
        }
        // 选最近的轴前进
        if (tMaxX < tMaxY && tMaxX < tMaxZ) {
          x += stepX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
        } else if (tMaxY < tMaxZ) {
          y += stepY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
        } else {
          z += stepZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
        }
        if (Math.min(tMaxX, tMaxY, tMaxZ) > REACH) break;
      }
      return null;
    }

    // ===== 破坏 / 放置 =====
    document.addEventListener('mousedown', e => {
      if (!locked || player.dead) return;
      if (e.button === 0) {
        hand.startSwing(); // 左键总是挥手
        // 左键：先看是否瞄准怪物（不依赖方块命中，这样对着天空的怪物也能打），是则攻击
        if (player.attackCd <= 0) {
          const mobEid = raycastCreature(ecsWorld, THREE, player, { kind: 'mob', range: ATTACK_RANGE });
          if (mobEid >= 0) {
            player.attackCd = ATTACK_COOLDOWN;
            triggerHitMarker();          // 准星命中标记
            spawnDamageText(ATTACK_DAMAGE, false); // 伤害飘字
            playSound('hit');            // 打击音效
            if (net.isClient()) {
              damageMob(mobEid, ATTACK_DAMAGE, { knockbackYaw: player.yaw });
              net.send(MSG.HIT, { kind: 'mob', id: netIdFor(mobEid) }); // 客户端：交给房主结算
            } else {
              damageMob(mobEid, ATTACK_DAMAGE, {
                knockbackYaw: player.yaw,
                onKill: killMobWithRewards,
              });
            }
            return; // 攻击了怪物就不破坏方块
          }
          // 没瞄到怪物，再看动物
          const animalEid = raycastCreature(ecsWorld, THREE, player, { kind: 'animal', range: ATTACK_RANGE });
          if (animalEid >= 0) {
            player.attackCd = ATTACK_COOLDOWN;
            triggerHitMarker();
            spawnDamageText(ATTACK_DAMAGE, false);
            playSound('hit');
            if (net.isClient()) {
              damageAnimal(animalEid, ATTACK_DAMAGE, { player });
              net.send(MSG.HIT, { kind: 'animal', id: netIdFor(animalEid) });
            } else {
              damageAnimal(animalEid, ATTACK_DAMAGE, {
                player,
                onKill: killAnimalWithSound,
              });
            }
            return;
          }
        }
        // 没瞄到怪物/动物：破坏方块，按掉落表产出掉落物
        const r = raycastBlock();
        if (!r) return;
        const [x, y, z] = r.hit;
        const broken = getBlock(x, y, z);
        applyBlockEdit(x, y, z, AIR);
        if (net.isMultiplayer()) net.send(MSG.BLOCK, { x, y, z, id: AIR });
        const drop = dropOf(broken);
        if (drop !== null && !net.isClient()) spawnDrop(x, y, z, drop);
        if (broken === 10 || broken === 11) gainXP(XP_PER_ORE); // 挖矿石得经验
        playSound('break');
        // 破坏碎屑粒子：用方块顶色喷一小撮
        particles.burst(x + 0.5, y + 0.5, z + 0.5, blockColor(broken, 'top'), 8, 3, 0.5);
        player.hunger = Math.max(0, player.hunger - 0.15); // 挖掘消耗饥饿
      } else if (e.button === 2) {
        const r = raycastBlock();
        if (!r) return;
        const [x, y, z] = r.hit;
        const hitId = getBlock(x, y, z);
        // 右键功能方块：箱子→开存储，门→开关
        if (hitId === 17) { openChest(x, y, z); return; }
        if (hitId === 15) {
          const k = keyOf(x, y, z);
          if (openDoors.has(k)) openDoors.delete(k); else openDoors.add(k);
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
        const placeId = PLACEABLE[selected];
        if ((inventory[placeId] || 0) <= 0) return;
        removeFromInventory(placeId, 1);
        renderHotbar();
        applyBlockEdit(px, py, pz, placeId);
        if (net.isMultiplayer()) net.send(MSG.BLOCK, { x: px, y: py, z: pz, id: placeId });
        playSound('place');
      }
    });
    // 屏蔽右键菜单，否则放置会弹出浏览器菜单
    document.addEventListener('contextmenu', e => e.preventDefault());

    // ===== UI =====
    const overlay = document.getElementById('overlay');
    const hotbarEl = document.getElementById('hotbar');
    const infoEl = document.getElementById('info');
    const healthEl = document.getElementById('health');
    const hungerEl = document.getElementById('hunger');
    const hurtEl = document.getElementById('hurt');
    const deathEl = document.getElementById('death');
    const xpFillEl = document.getElementById('xpfill');
    const xpTextEl = document.getElementById('xptext');
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
    let selected = 0; // PLACEABLE 中的索引

    // 渲染经验条：当前等级内的进度
    function renderXP() {
      const into = player.xp % 100;
      xpFillEl.style.width = into + '%';
      xpTextEl.textContent = 'Lv ' + player.level + '  (' + player.xp + ' XP)';
    }

    // ===== 箱子存储 UI =====
    let openChestKey = null;
    function openChest(x, y, z) {
      openChestKey = keyOf(x, y, z);
      if (!chests[openChestKey]) chests[openChestKey] = {};
      renderChest();
      chestEl.classList.remove('hidden');
      document.exitPointerLock();
    }
    function closeChest() {
      openChestKey = null;
      chestEl.classList.add('hidden');
      canvas.requestPointerLock();
    }
    // 渲染箱子+背包两行，点击在两者间转移一个
    function renderChest() {
      if (!openChestKey) return;
      const store = chests[openChestKey];
      const mkSlot = (id, count, onClick) => {
        const s = document.createElement('div'); s.className = 'cslot';
        const sw = document.createElement('div'); sw.className = 'sw';
        sw.style.background = '#' + itemColor(id).toString(16).padStart(6, '0');
        const c = document.createElement('span'); c.className = 'cnt'; c.textContent = count;
        s.appendChild(sw); s.appendChild(c);
        s.addEventListener('click', onClick);
        return s;
      };
      chestSlotsEl.innerHTML = '';
      for (const id of Object.keys(store)) {
        if (store[id] > 0) chestSlotsEl.appendChild(mkSlot(id, store[id], () => {
          // 从箱子取出一个到背包
          store[id]--; if (store[id] <= 0) delete store[id];
          addItemToInventory(id, 1);
          renderChest(); renderHotbar();
        }));
      }
      chestInvEl.innerHTML = '';
      for (const id of Object.keys(inventory)) {
        if (inventory[id] > 0) chestInvEl.appendChild(mkSlot(id, inventory[id], () => {
          // 从背包存入一个到箱子
          removeFromInventory(id, 1);
          store[id] = (store[id] || 0) + 1;
          renderChest(); renderHotbar();
        }));
      }
    }

    // 渲染饥饿值：10 个鸡腿，每个 2 点
    function renderHunger() {
      hungerEl.innerHTML = '';
      const drums = MAX_HUNGER / 2;
      for (let i = 0; i < drums; i++) {
        const hp = player.hunger - i * 2;
        const span = document.createElement('span');
        span.className = 'drum';
        span.textContent = hp >= 2 ? '🍗' : (hp === 1 ? '🦴' : '⬛');
        hungerEl.appendChild(span);
      }
    }

    let craftOpen = false;
    let nearTable = false; // 附近是否有工作台

    // 检查某配方当前能否合成（库存够 + 工作台条件满足）
    function canCraft(r) {
      return canCraftRecipe(r, nearTable);
    }
    // 执行合成：扣材料、加产物
    function doCraft(r) {
      if (!craftRecipe(r, nearTable)) return;
      playSound('pickup');
      renderHotbar();
      renderCraft();
    }

    // 渲染合成面板：列出所有配方，可合成的高亮、缺料的置灰
    const craftEl = document.getElementById('craft');
    const craftListEl = document.getElementById('craftList');

    // ===== 背包面板 =====
    const bagEl = document.getElementById('bag');
    const bagGridEl = document.getElementById('bagGrid');
    let bagOpen = false;
    // 渲染背包：列出所有持有物品（含非放置类如工具/肉/矿产），食物可点击食用
    function renderBag() {
      bagGridEl.innerHTML = '';
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
        sw.style.background = '#' + itemColor(id).toString(16).padStart(6, '0');
        const nm = document.createElement('div');
        nm.className = 'nm';
        const food = ITEMS[id]?.food;
        nm.textContent = itemName(id) + (food ? ' 🍽' : '');
        const cnt = document.createElement('span');
        cnt.className = 'cnt';
        cnt.textContent = inventory[id];
        slot.appendChild(sw); slot.appendChild(nm); slot.appendChild(cnt);
        // 点击：是食物则吃掉回饥饿
        if (food) {
          slot.title = '点击食用，回 ' + food + ' 点饥饿';
          slot.addEventListener('click', () => {
            if (inventory[id] > 0 && player.hunger < MAX_HUNGER) {
              removeFromInventory(id, 1);
              player.hunger = Math.min(MAX_HUNGER, player.hunger + food);
              renderHunger(); renderBag(); renderHotbar();
            }
          });
        }
        bagGridEl.appendChild(slot);
      }
    }
    function toggleBag() {
      bagOpen = !bagOpen;
      if (bagOpen) {
        renderBag();
        bagEl.classList.remove('hidden');
        document.exitPointerLock();
      } else {
        bagEl.classList.add('hidden');
        canvas.requestPointerLock();
      }
    }

    function renderCraft() {
      craftListEl.innerHTML = '';
      for (const r of RECIPES) {
        const ok = canCraft(r);
        const row = document.createElement('div');
        row.className = 'recipe ' + (ok ? 'ok' : 'no');
        const sw = document.createElement('div');
        sw.className = 'sw';
        sw.style.background = '#' + itemColor(r.output).toString(16).padStart(6, '0');
        const txt = document.createElement('div');
        txt.className = 'txt';
        const needs = Object.entries(r.inputs)
          .map(([id, n]) => `${itemName(id)}×${n}`).join(' + ');
        txt.innerHTML = `${r.name} ×${r.count}` +
          `<div class="need">需要: ${needs}${r.table ? ' · 工作台' : ''}</div>`;
        row.appendChild(sw); row.appendChild(txt);
        if (ok) row.addEventListener('click', () => doCraft(r));
        craftListEl.appendChild(row);
      }
    }
    function toggleCraft() {
      craftOpen = !craftOpen;
      if (craftOpen) {
        renderCraft();
        craftEl.classList.remove('hidden');
        document.exitPointerLock(); // 打开面板时释放鼠标以便点击
      } else {
        craftEl.classList.add('hidden');
        canvas.requestPointerLock();
      }
    }
    document.addEventListener('keydown', e => {
      // Tab 打开/关闭背包（阻止默认的焦点切换）
      if (e.code === 'Tab') {
        e.preventDefault();
        if (!player.dead) toggleBag();
        return;
      }
      if (e.code === 'KeyE' && !player.dead) {
        if (openChestKey) closeChest();   // 箱子开着时 E 先关箱子
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
    function renderHealth() {
      healthEl.innerHTML = '';
      const hearts = MAX_HEALTH / 2;
      for (let i = 0; i < hearts; i++) {
        const hp = player.health - i * 2; // 这颗心对应的血量
        const span = document.createElement('span');
        span.className = 'heart';
        span.textContent = hp >= 2 ? '❤️' : (hp === 1 ? '💔' : '🖤');
        healthEl.appendChild(span);
      }
    }

    // 死亡屏：点击复活——满血、回出生点、清空怪物重新生成
    deathEl.addEventListener('click', () => {
      respawnPlayer(player, {
        worldW: WORLD_W,
        worldH: WORLD_H,
        worldD: WORLD_D,
        maxHealth: MAX_HEALTH,
      });
      if (!net.isClient()) {
        clearMobs(ecsWorld);
        ensureMobs(ecsWorld, mobCtx());
      }
      renderHealth();
      deathEl.classList.add('hidden');
      canvas.requestPointerLock();
    });

    // 渲染热键栏：每个槽位显示方块颜色色块 + 名称 + 持有数量
    function renderHotbar() {
      hotbarEl.innerHTML = '';
      PLACEABLE.forEach((id, i) => {
        const count = inventory[id] || 0;
        const slot = document.createElement('div');
        slot.className = 'slot' + (i === selected ? ' active' : '') + (count === 0 ? ' empty' : '');
        const sw = document.createElement('div');
        sw.className = 'sw';
        sw.style.background = '#' + BLOCKS[id].top.toString(16).padStart(6, '0');
        if (count > 0) {
          const cnt = document.createElement('span');
          cnt.className = 'count';
          cnt.textContent = count;
          sw.appendChild(cnt);
        }
        const label = document.createElement('span');
        label.textContent = (i + 1) + ' ' + BLOCKS[id].name;
        slot.appendChild(sw);
        slot.appendChild(label);
        hotbarEl.appendChild(slot);
      });
    }

    // 数字键 1-7 选方块；滚轮循环切换
    document.addEventListener('keydown', e => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= PLACEABLE.length) { selected = n - 1; renderHotbar(); }
    });
    document.addEventListener('wheel', e => {
      if (!locked) return;
      selected = (selected + (e.deltaY > 0 ? 1 : -1) + PLACEABLE.length) % PLACEABLE.length;
      renderHotbar();
    });

    // 点击遮罩进入游戏（请求指针锁定 + 启动音频，需用户手势）
    // 点击遮罩进入游戏（但点种子输入框/新世界按钮时不进入）
    const seedInputEl = document.getElementById('seedInput');
    const newGameBtnEl = document.getElementById('newGameBtn');
    const hostBtnEl = document.getElementById('hostBtn');
    const joinBtnEl = document.getElementById('joinBtn');
    const roomInputEl = document.getElementById('roomInput');
    const netMsgEl = document.getElementById('netMsg');
    const netbarEl = document.getElementById('netbar');
    const noStart = new Set([seedInputEl, newGameBtnEl, hostBtnEl, joinBtnEl, roomInputEl]);
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

    hostBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof window.Peer === 'undefined') { netMsg('PeerJS 未加载，检查网络'); return; }
      netMsg('正在创建房间…');
      net.host((roomId) => {
        netReady = true;
        netMsg('房间号：' + roomId + ' （发给朋友）');
        setupHostHandlers();
        updateNetbar();
      });
    });
    joinBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof window.Peer === 'undefined') { netMsg('PeerJS 未加载，检查网络'); return; }
      const room = roomInputEl.value.trim().toUpperCase();
      if (room.length < 4) { netMsg('请输入房间号'); return; }
      netMsg('正在加入 ' + room + ' …');
      setupClientHandlers();
      net.join(room, () => { netMsg('已连接，等待世界…'); });
    });

    // 房主：注册收到客户端消息的处理器
    function setupHostHandlers() {
      net.onPeerJoin = (pid) => {
        // 新客户端：发完整世界（种子 + 累计改动 + 当前昼夜）
        net.sendTo(pid, MSG.WORLD, { seed: currentSeed, edits: blockEdits, dayTime: dayCycle.getTime(), gameTime });
        remotePlayers.ensure(pid);
        updateNetbar();
      };
      net.on(MSG.HELLO, (d, from) => { remotePlayers.ensure(from); updateNetbar(); });
      net.on(MSG.INPUT, (d, from) => {
        const rp = remotePlayers.ensure(from);
        rp.target.set(d.x, d.y, d.z); rp.yaw = d.yaw;
      });
      net.on(MSG.BLOCK, (d, from) => {
        const broken = getBlock(d.x, d.y, d.z);
        applyBlockEdit(d.x, d.y, d.z, d.id);
        if (d.id === AIR) {
          const drop = dropOf(broken);
          if (drop !== null) spawnDrop(d.x, d.y, d.z, drop);
        }
        net.broadcast(MSG.BLOCK, d, from); // 转发给其他客户端
      });
      net.on(MSG.HIT, (d, from) => {
        // 客户端攻击生物：房主按稳定实体 id 结算。
        if (d.kind === 'mob') {
          const eid = findByNetId(ecsWorld, 'mob', d.id);
          if (eid >= 0) damageMob(eid, ATTACK_DAMAGE, { onKill: e => killMob(e, mobCtx()) });
        } else if (d.kind === 'animal') {
          const eid = findByNetId(ecsWorld, 'animal', d.id);
          if (eid >= 0) damageAnimal(eid, ATTACK_DAMAGE, { player, onKill: e => killAnimal(e, animalCtx()) });
        }
      });
      net.on(MSG.PICKUP, (d) => {
        const eid = findByNetId(ecsWorld, 'drop', d.id);
        if (eid >= 0) despawnDrop(eid);
      });
    }

    // 客户端：注册收到房主消息的处理器
    function setupClientHandlers() {
      net.on(MSG.WORLD, (d) => {
        currentSeed = d.seed;
        for (let i = 0; i < world.length; i++) world[i] = 0;
        generateWorld(d.seed);
        applyBlockEdits(d.edits || {});
        clearMobs(ecsWorld);
        clearAnimals(ecsWorld);
        clearDrops(ecsWorld);
        dayCycle.setTime(d.dayTime ?? 0.15); gameTime = d.gameTime ?? 0;
        netReady = true;
        netMsg('世界已同步，点击开始');
        updateNetbar();
      });
      net.on(MSG.BLOCK, (d) => applyBlockEdit(d.x, d.y, d.z, d.id));
      net.on(MSG.STATE, (d) => applyHostState(d));
    }

    // 客户端：应用房主下发的快照（玩家/怪物/动物/昼夜）
    function applyHostState(s) {
      dayCycle.setTime(s.dayTime ?? dayCycle.getTime());
      // 远程玩家（含房主，键 'host'）
      const seen = new Set();
      for (const p of s.players) {
        if (p.id === net.selfId) continue; // 跳过自己
        seen.add(p.id);
        const rp = remotePlayers.ensure(p.id);
        rp.target.set(p.x, p.y, p.z); rp.yaw = p.yaw;
      }
      for (const pid of remotePlayers.ids()) if (!seen.has(pid)) remotePlayers.remove(pid);
      // 怪物：按下发列表重建（客户端不跑 AI）
      syncNetMobs(ecsWorld, s.mobs, mobCtx());
      syncNetAnimals(ecsWorld, s.animals, animalCtx());
      syncNetDrops(ecsWorld, s.drops);
      updateNetbar();
    }

    // 房主：把当前状态打包广播给所有客户端（10Hz）
    function broadcastState() {
      const players = [{ id: 'host', x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw }];
      for (const [pid, rp] of remotePlayers.entries()) {
        players.push({ id: pid, x: rp.target.x, y: rp.target.y, z: rp.target.z, yaw: rp.yaw });
      }
      const mobList = snapshotMobs(ecsWorld);
      const aniList = snapshotAnimals(ecsWorld);
      const dropList = snapshotDrops(ecsWorld);
      net.broadcast(MSG.STATE, { players, mobs: mobList, animals: aniList, drops: dropList, dayTime: dayCycle.getTime() });
    }

    // 每帧推进联机同步（位置上报 / 状态广播 / 远程插值）
    function netTick(dt) {
      if (!net.isMultiplayer()) return;
      remotePlayers.update(dt);
      lastNetSync += dt;
      if (lastNetSync < 0.1) return; // 10Hz
      lastNetSync = 0;
      if (net.isHost()) {
        broadcastState();
      } else if (net.isClient()) {
        net.send(MSG.INPUT, { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw });
      }
    }

    function updateInfo() {
      const p = player.pos;
      infoEl.innerHTML = `坐标 ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}<br>` +
        `当前方块: ${BLOCKS[PLACEABLE[selected]].name}`;
    }

    // ===== 主循环 =====
    // 每帧：根据按键算出水平移动方向，施加重力，分轴碰撞，更新相机，渲染。
    function update(dt) {
      gameTime += dt;

      // 死亡时停止一切移动，只保持相机
      if (player.dead) {
        camera.position.copy(player.pos);
        camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
        return;
      }

      updatePlayer(player, dt, keys, gameTime, {
        worldW: WORLD_W,
        worldH: WORLD_H,
        worldD: WORLD_D,
        playerRadius: PLAYER_RADIUS,
        playerHeight: PLAYER_HEIGHT,
        moveSpeed: MOVE_SPEED,
        sprintMult: SPRINT_MULT,
        gravity: GRAVITY,
        jumpSpeed: JUMP_SPEED,
        hungerDecay: HUNGER_DECAY,
        starveDamage: STARVE_DAMAGE,
        maxHealth: MAX_HEALTH,
        regenDelay: REGEN_DELAY,
        regenRate: REGEN_RATE,
        isSolidAt,
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
      hand.update(dt);
      updateHitMarker(dt);
      updateFlashSystem(ecsWorld, dt, {
        mobTypes: MOB_TYPES,
        animalTypes: ANIMAL_TYPES,
        gameTime,
      });
      syncMeshSystem(ecsWorld, { player, dt });

      // 3) 更新相机
      camera.position.copy(player.pos);
      camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    }

    let last = performance.now();
    let lastAutoSave = 0; // 上次自动存档的 gameTime
    function animate(now) {
      try {
        const dt = Math.min((now - last) / 1000, 0.05); // 限制最大步长，防卡顿穿墙
        last = now;
        if (locked) update(dt);
        netTick(dt); // 联机同步（即使未锁定也插值远程玩家）
        // 昼夜与云持续运转（即使玩家死亡，世界依然流动）
        dayCycle.update(dt);
        clouds.update(dt);
        particles.update(dt, GRAVITY); // 推进粒子
        // 纹理缓动：让方块表面颗粒微微流动，制造"活"的氛围
        updateBlockTexture(dt);
        updateDamageTexts(dt); // 伤害飘字淡出
        updateInfo();
        // 自动存档：每 30 秒一次（游戏进行中且未死亡）
        if (locked && !player.dead && gameTime - lastAutoSave > 30) {
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
      dayCycle.reset(0.15); gameTime = 0;
      // 清空各容器
      clearBlockState();
      clearDrops(ecsWorld);
      clearMobs(ecsWorld);
      clearAnimals(ecsWorld);
      setNextNetId(1);
      giveStartingInventory();
      rebuildTerrain();
      refreshAllUI();
    }

    // 应用读档数据：恢复世界数组与其余状态
    function applyLoadedSave(data) {
      currentSeed = data.seed ?? 1337;
      if (data.world) {
        for (let i = 0; i < world.length; i++) world[i] = data.world[i] || 0;
      }
      // 恢复玩家
      Object.assign(player, {
        health: data.player.health, hunger: data.player.hunger,
        xp: data.player.xp, level: data.player.level,
        yaw: data.player.yaw, pitch: data.player.pitch, dead: false,
      });
      player.pos.set(data.player.px, data.player.py, data.player.pz);
      player.vel.set(0, 0, 0);
      dayCycle.setTime(data.time?.dayTime ?? 0.15);
      gameTime = data.time?.gameTime ?? 0;
      restoreInventory(data.inventory || {});
      restoreBlockState(data.blockState);
      hydrateEcs(data.ecs, { clearDrops, world: ecsWorld });
      rebuildTerrain();
      refreshAllUI();
    }

    function refreshAllUI() {
      renderHotbar(); renderHealth(); renderHunger(); renderXP();
    }

    // 收集当前状态用于存档
    function makeSnapshot() {
      return {
        seed: currentSeed,
        world,
        player: {
          px: player.pos.x, py: player.pos.y, pz: player.pos.z,
          health: player.health, hunger: player.hunger,
          xp: player.xp, level: player.level, yaw: player.yaw, pitch: player.pitch,
        },
        blockState: snapshotBlockState(),
        inventory,
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
  
