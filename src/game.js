import * as THREE from 'three';
import * as D from './data.js';
import * as Save from './save.js';
import * as FX from './fx.js';
import { Net, MSG } from './net.js';
// 把 data.js 的导出解构到本地名字，保持原代码不变
const {
  WORLD_W, WORLD_H, WORLD_D, SEA_LEVEL,
  GRAVITY, JUMP_SPEED, MOVE_SPEED, SPRINT_MULT, PLAYER_HEIGHT, PLAYER_RADIUS, REACH,
  PICKUP_RANGE, DROP_LIFETIME, STACK_MAX,
  MAX_HEALTH, REGEN_DELAY, REGEN_RATE, ATTACK_DAMAGE, ATTACK_RANGE, ATTACK_COOLDOWN,
  MOB_COUNT, MOB_SIGHT, MOB_RADIUS, MOB_HEIGHT, MOB_ATTACK_CD, MOB_TYPES, MOB_TYPE_KEYS,
  ANIMAL_COUNT, ANIMAL_TYPES, ANIMAL_TYPE_KEYS, BIOMES,
  AIR, BLOCKS, ITEMS, PLACEABLE,
  XP_PER_MOB, XP_PER_ORE,
  itemName, itemColor, blockColor, isSolid, isOpaque, isClimbable, isLight, isContainer, dropOf, makeNoise,
  world, idx, inBounds, getBlock, setBlock, generateWorld,
} = D;
// buildMesh 需要 THREE，包一层
function buildMesh() { return D.buildMesh(THREE); }

// ===== 联机状态（net 层）=====
const net = new Net();
const remotePlayers = {};   // peerId → {pos:Vector3, target:Vector3, yaw, mesh, name}
let netReady = false;       // 联机会话是否已建立（host 开房或 client 收到 WORLD）
let lastNetSync = 0;        // 上次发送同步的时间（节流）

// ===== 功能方块状态（game 层）=====
const openDoors = new Set();          // 记录已打开的门坐标键 "x,y,z"
const chests = {};                    // 箱子存储： "x,y,z" -> {blockId: count}
function keyOf(x, y, z) { return x + ',' + y + ',' + z; }
// 碰撞用：考虑开门后门可穿过
function isSolidAt(x, y, z) {
  const id = getBlock(x, y, z);
  if (id === 15 && openDoors.has(keyOf(x, y, z))) return false; // 开着的门可穿过
  return isSolid(id);
}

// ===== Three.js 场景 =====
    const canvas = document.getElementById('c');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();

    // ===== 掉落物 / 物品栏 =====
    // inventory: {blockId: count}，破坏方块产出掉落实体，走近自动拾取累加。
    const inventory = {};
    const drops = [];               // {pos,vel,id,mesh,age,onGround}
    const dropGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const dropMatCache = {};        // 按方块 id 缓存材质
    function dropMat(id) {
      if (!dropMatCache[id]) dropMatCache[id] = new THREE.MeshLambertMaterial({ color: itemColor(id) });
      return dropMatCache[id];
    }
    // 在方块中心生成一个掉落物
    function spawnDrop(x, y, z, id) {
      const mesh = new THREE.Mesh(dropGeo, dropMat(id));
      mesh.position.set(x + 0.5, y + 0.4, z + 0.5);
      scene.add(mesh);
      drops.push({
        pos: new THREE.Vector3(x + 0.5, y + 0.4, z + 0.5),
        vel: new THREE.Vector3(0, 2, 0), // 轻微上抛
        id, mesh, age: 0, onGround: false,
      });
    }
    // 拾取：累加到物品栏，刷新热键栏
    function addToInventory(id, n) {
      inventory[id] = Math.min(STACK_MAX, (inventory[id] || 0) + n);
      renderHotbar();
      playSound('pickup');
    }
    // 每帧推进掉落物：重力下落、旋转、走近拾取、超时消失
    function updateDrops(dt) {
      const feet = player.pos.y - PLAYER_HEIGHT;
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.age += dt;
        d.mesh.rotation.y += dt * 2; // 缓慢旋转

        // 重力 + 落地检测：脚下是实体方块就停住
        d.vel.y -= GRAVITY * dt;
        d.pos.y += d.vel.y * dt;
        const below = getBlock(Math.floor(d.pos.x), Math.floor(d.pos.y - 0.2), Math.floor(d.pos.z));
        if (isSolid(below) && d.vel.y < 0) {
          d.pos.y = Math.floor(d.pos.y - 0.2) + 1 + 0.2;
          d.vel.y = 0; d.onGround = true;
        }
        d.mesh.position.copy(d.pos);

        // 走近拾取（玩家脚部到掉落物的距离）
        const dist = Math.hypot(d.pos.x - player.pos.x, d.pos.y - feet, d.pos.z - player.pos.z);
        if (dist < PICKUP_RANGE) {
          addToInventory(d.id, 1);
          scene.remove(d.mesh);
          drops.splice(i, 1);
          continue;
        }
        // 超时消失，防止堆积
        if (d.age > DROP_LIFETIME) { scene.remove(d.mesh); drops.splice(i, 1); }
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

    // 火把点光源：放置火把时加一盏暖色 PointLight，破坏时移除
    const torchLights = {}; // "x,y,z" -> PointLight
    function addTorchLight(x, y, z) {
      const k = x + ',' + y + ',' + z;
      if (torchLights[k]) return;
      const light = new THREE.PointLight(0xffbb66, 0.9, 8); // 暖色，衰减距离 8
      light.position.set(x + 0.5, y + 0.5, z + 0.5);
      scene.add(light);
      torchLights[k] = light;
    }
    function removeTorchLight(x, y, z) {
      const k = x + ',' + y + ',' + z;
      if (torchLights[k]) { scene.remove(torchLights[k]); delete torchLights[k]; }
    }

    // ===== 星空 + 粒子系统 =====
    const stars = FX.makeStars(THREE);
    scene.add(stars);
    const particles = FX.makeParticleSystem(THREE, scene);

    // ===== 昼夜循环 =====
    // dayTime: 0~1 表示一整天。0=日出, 0.25=正午, 0.5=日落, 0.75=午夜。
    const DAY_LENGTH = 120; // 一整天 120 秒
    let dayTime = 0.15;     // 出生在早晨
    const skyDay = new THREE.Color(0x88bbee);
    const skyNight = new THREE.Color(0x0a0a25);
    const skyDusk = new THREE.Color(0xff7a3d);
    function updateDayCycle(dt) {
      dayTime = (dayTime + dt / DAY_LENGTH) % 1;
      // 太阳高度角：白天在上，夜里在下
      const ang = dayTime * Math.PI * 2;
      sun.position.set(Math.cos(ang) * 0.5, Math.sin(ang), 0.3);
      // 白天系数：太阳在地平线以上为正
      const day = Math.max(0, Math.sin(ang));        // 0(夜)~1(正午)
      const dusk = Math.max(0, 1 - Math.abs(Math.sin(ang)) * 2.2); // 接近地平线时的橙色
      // 天色 = 夜→日 插值，再叠加黄昏橙
      const sky = skyNight.clone().lerp(skyDay, day);
      sky.lerp(skyDusk, dusk * 0.6);
      scene.background.copy(sky);
      if (scene.fog) scene.fog.color.copy(sky);
      // 光照强度随昼夜起伏
      sun.intensity = 0.15 + day * 0.85;
      ambient.intensity = 0.25 + day * 0.5;
      // 星空：夜间显现（day 越小越亮），跟随相机位置以免走出天球
      stars.material.opacity = Math.max(0, 1 - day * 2.5);
      stars.position.copy(player.pos);
    }

    // ===== 云 =====
    // 在世界上空放一组扁平白色方块，缓慢水平飘动，循环回绕。
    const clouds = [];
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    function makeClouds() {
      for (let i = 0; i < 14; i++) {
        const w = 6 + (i * 7 % 9), d = 5 + (i * 5 % 8);
        const cloud = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, d), cloudMat);
        cloud.position.set(
          (i * 37 % WORLD_W),
          WORLD_H + 8 + (i % 3),
          (i * 53 % WORLD_D)
        );
        scene.add(cloud);
        clouds.push(cloud);
      }
    }
    function updateClouds(dt) {
      for (const c of clouds) {
        c.position.x += dt * 0.6;                 // 缓慢东移
        if (c.position.x > WORLD_W + 10) c.position.x = -10; // 回绕
      }
    }

    // ===== 第一人称手臂 =====
    // 手臂挂在相机上，始终跟随视角。挥击时播放摆动动画。
    scene.add(camera); // 相机入场景，子物体（手臂）才会被渲染
    const handGroup = new THREE.Group();
    const handMat = new THREE.MeshLambertMaterial({ color: 0xe0ac69 }); // 肤色
    const handMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.5), handMat);
    handGroup.add(handMesh);
    // 放在相机右下角（相机本地坐标：右、下、前方）
    handGroup.position.set(0.32, -0.3, -0.6);
    camera.add(handGroup);

    let swingT = 0;          // 挥击动画进度（>0 表示正在挥）
    const SWING_DUR = 0.25;  // 挥击时长（秒）
    function startSwing() { swingT = SWING_DUR; }
    // 每帧更新手臂：基础位置 + 挥击时的弧线摆动
    function updateHand(dt) {
      if (swingT > 0) swingT = Math.max(0, swingT - dt);
      const p = swingT / SWING_DUR;        // 1→0
      const swing = Math.sin(p * Math.PI); // 0→1→0 的弧线
      handGroup.rotation.x = -swing * 1.4; // 向前下挥
      handGroup.rotation.z = swing * 0.3;
      handGroup.position.y = -0.3 - swing * 0.1;
    }

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

    // 怪物受击闪红：hitFlash 期间身体材质偏红，结束后恢复各自原色
    function updateMobFlash(dt) {
      for (const m of mobs) {
        const mat = m.mesh.userData.bodyMat;
        if (!mat) continue;
        if (m.hitFlash > 0) {
          m.hitFlash = Math.max(0, m.hitFlash - dt);
          mat.color.setHex(0xff5555); // 闪红
        } else {
          mat.color.setHex(MOB_TYPES[m.type].body); // 恢复该类型原色
        }
        // 苦力怕引爆前闪白
        if (m.fuse !== undefined && m.fuse > 0) {
          const blink = Math.sin(gameTime * 20) > 0;
          mat.color.setHex(blink ? 0xffffff : MOB_TYPES[m.type].body);
        }
      }
    }

    // ===== 音效（Web Audio 合成，无需音频文件）=====
    let audioCtx = null;
    function initAudio() {
      if (!audioCtx) {
        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { audioCtx = null; }
      }
    }
    // 播放一个简单合成音：type=波形, freq=频率, dur=时长, vol=音量
    function tone(freq, dur, type = 'square', vol = 0.15) {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type; osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + dur);
    }
    // 不同事件的音效
    function playSound(kind) {
      if (!audioCtx) return;
      switch (kind) {
        case 'hit':     tone(220, 0.08, 'square', 0.12); break;       // 打中怪物
        case 'hurt':    tone(160, 0.15, 'sawtooth', 0.18); break;     // 玩家受伤
        case 'break':   tone(120, 0.06, 'square', 0.10); break;       // 破坏方块
        case 'place':   tone(330, 0.06, 'square', 0.10); break;       // 放置方块
        case 'pickup':  tone(660, 0.08, 'sine', 0.12); break;         // 拾取
        case 'kill':    tone(440, 0.12, 'triangle', 0.15); break;     // 击杀怪物
        case 'fuse':    tone(880, 0.1, 'sine', 0.1); break;           // 苦力怕点燃
        case 'explode': // 爆炸：降调噪声感
          tone(80, 0.4, 'sawtooth', 0.25);
          tone(50, 0.5, 'square', 0.2);
          break;
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
    // 顶点色材质：方块颜色直接来自 buildMesh 写入的 color 属性
    // 程序生成噪点纹理：给方块表面叠一层颗粒质感（不破坏顶点色，用 map 相乘）
    function makeNoiseTexture() {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 16;
      const ctx = cv.getContext('2d');
      const img = ctx.createImageData(16, 16);
      for (let i = 0; i < 16 * 16; i++) {
        const v = 200 + Math.floor(Math.random() * 56); // 200~255 灰度颗粒
        img.data[i*4] = v; img.data[i*4+1] = v; img.data[i*4+2] = v; img.data[i*4+3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(cv);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      return tex;
    }
    const blockTexture = makeNoiseTexture();
    const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: blockTexture });
    let terrainMesh = null;

    // 重建整张地形网格（破坏/放置后调用）
    function rebuildTerrain() {
      if (terrainMesh) {
        scene.remove(terrainMesh);
        terrainMesh.geometry.dispose();
      }
      terrainMesh = new THREE.Mesh(buildMesh(), terrainMat);
      scene.add(terrainMesh);
    }

    function onResize() {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', onResize);

    // ===== 玩家与控制 =====
    const player = {
      pos: new THREE.Vector3(WORLD_W / 2, WORLD_H, WORLD_D / 2), // 出生在世界中央上空，落下
      vel: new THREE.Vector3(),
      yaw: 0, pitch: 0,
      onGround: false,
      health: MAX_HEALTH,   // 当前血量
      lastHurt: -999,       // 上次受伤时刻（秒），用于回血延迟
      attackCd: 0,          // 玩家攻击冷却计时
      dead: false,
      hunger: 20,           // 饥饿值（满 20），随时间/动作下降
      xp: 0,                // 累计经验值
      level: 0,             // 等级（每 100 经验升一级）
    };
    const MAX_HUNGER = 20;
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

    // AABB 碰撞：玩家是一个以 pos 为顶（眼睛）的竖直胶囊，简化为方盒
    function collides(p) {
      const minX = Math.floor(p.x - PLAYER_RADIUS), maxX = Math.floor(p.x + PLAYER_RADIUS);
      const minZ = Math.floor(p.z - PLAYER_RADIUS), maxZ = Math.floor(p.z + PLAYER_RADIUS);
      const minY = Math.floor(p.y - PLAYER_HEIGHT), maxY = Math.floor(p.y);
      for (let x = minX; x <= maxX; x++)
        for (let y = minY; y <= maxY; y++)
          for (let z = minZ; z <= maxZ; z++)
            if (isSolidAt(x, y, z)) return true;
      return false;
    }

    // 按轴分别移动并检测碰撞，碰到则停在该轴
    function moveAxis(axis, amount) {
      const p = player.pos.clone();
      p[axis] += amount;
      if (!collides(p)) { player.pos[axis] = p[axis]; return false; }
      return true; // 发生碰撞
    }

    // ===== 怪物系统 =====
    // 每个怪物：一组方块（身体+头），自带位置/速度/血量/AI 状态。
    const mobs = [];
    const mobMat = new THREE.MeshLambertMaterial({ color: 0x4a7a3a }); // 苦力怕绿
    const mobHeadMat = new THREE.MeshLambertMaterial({ color: 0x3a5a2a });

    // 找一个地表落脚点的 y（从上往下扫第一个实体方块）
    function surfaceY(x, z) {
      for (let y = WORLD_H - 1; y >= 0; y--) {
        if (isSolid(getBlock(x, y, z))) return y + 1;
      }
      return SEA_LEVEL + 1;
    }

    // 创建一个怪物的网格（身体 + 头，用 Group 包起来），按类型着色。
    function makeMobMesh(type) {
      const t = MOB_TYPES[type];
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshLambertMaterial({ color: t.body });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.4), bodyMat);
      body.position.y = 0.55;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshLambertMaterial({ color: t.head }));
      head.position.y = 1.35;
      g.add(body); g.add(head);
      g.userData.bodyMat = bodyMat; // 受击闪红时用
      return g;
    }

    // ===== 远程玩家网格（联机）=====
    function makeRemotePlayerMesh() {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.0, 0.35),
        new THREE.MeshLambertMaterial({ color: 0x3a7bd5 }));
      body.position.y = 0.5;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45),
        new THREE.MeshLambertMaterial({ color: 0xe0ac69 }));
      head.position.y = 1.25;
      g.add(body); g.add(head);
      return g;
    }
    function ensureRemotePlayer(pid) {
      if (remotePlayers[pid]) return remotePlayers[pid];
      const mesh = makeRemotePlayerMesh();
      scene.add(mesh);
      const rp = { pos: new THREE.Vector3(), target: new THREE.Vector3(), yaw: 0, mesh };
      remotePlayers[pid] = rp;
      return rp;
    }
    function removeRemotePlayer(pid) {
      const rp = remotePlayers[pid];
      if (rp) { scene.remove(rp.mesh); delete remotePlayers[pid]; }
    }
    // 平滑插值远程玩家到目标位置（每帧调用）
    function updateRemotePlayers(dt) {
      for (const pid in remotePlayers) {
        const rp = remotePlayers[pid];
        rp.pos.lerp(rp.target, Math.min(1, dt * 12));
        // pos 是眼睛高度，模型脚底要下移 PLAYER_HEIGHT
        rp.mesh.position.set(rp.pos.x, rp.pos.y - PLAYER_HEIGHT, rp.pos.z);
        rp.mesh.rotation.y = rp.yaw;
      }
    }

    // 在玩家周围一定距离外随机生成一个怪物（随机类型）
    function spawnMob() {
      // 在世界内随机选一个远离玩家的水平点
      let x, z, tries = 0;
      do {
        x = 2 + Math.floor((mobs.length * 7 + tries * 13 + gameTime * 5) % (WORLD_W - 4));
        z = 2 + Math.floor((mobs.length * 11 + tries * 17 + gameTime * 3) % (WORLD_D - 4));
        tries++;
      } while (tries < 8 && Math.hypot(x - player.pos.x, z - player.pos.z) < 12);

      // 用确定性哈希选类型，保证分布均匀
      const type = MOB_TYPE_KEYS[(mobs.length + Math.floor(gameTime)) % MOB_TYPE_KEYS.length];
      const t = MOB_TYPES[type];
      const y = surfaceY(x, z);
      const mesh = makeMobMesh(type);
      scene.add(mesh);
      mobs.push({
        type,
        pos: new THREE.Vector3(x + 0.5, y + MOB_HEIGHT, z + 0.5), // pos 为头顶（与玩家一致）
        vel: new THREE.Vector3(),
        health: t.health,
        onGround: false,
        attackCd: 0,
        hitFlash: 0,   // 受击闪红剩余时间（秒）
        fuse: undefined, // 苦力怕引信计时
        mesh,
      });
    }

    // 补足怪物数量（敌对怪物仅夜间生成；白天不再补充）
    function isNight() {
      // dayTime: 0.25=正午, 0.75=午夜；太阳在地平线下(sin<0)即夜
      return Math.sin(dayTime * Math.PI * 2) < 0;
    }
    function ensureMobs() {
      if (isNight()) {
        while (mobs.length < MOB_COUNT) spawnMob();
      }
    }

    // 怪物的 AABB 碰撞（与玩家逻辑相同，参数化半径/高度）
    function mobCollides(p) {
      const minX = Math.floor(p.x - MOB_RADIUS), maxX = Math.floor(p.x + MOB_RADIUS);
      const minZ = Math.floor(p.z - MOB_RADIUS), maxZ = Math.floor(p.z + MOB_RADIUS);
      const minY = Math.floor(p.y - MOB_HEIGHT), maxY = Math.floor(p.y);
      for (let x = minX; x <= maxX; x++)
        for (let y = minY; y <= maxY; y++)
          for (let z = minZ; z <= maxZ; z++)
            if (isSolidAt(x, y, z)) return true;
      return false;
    }
    function mobMoveAxis(m, axis, amount) {
      const p = m.pos.clone();
      p[axis] += amount;
      if (!mobCollides(p)) { m.pos[axis] = p[axis]; return false; }
      return true;
    }

    // 移除怪物（死亡）
    function killMob(i) {
      scene.remove(mobs[i].mesh);
      mobs.splice(i, 1);
    }
    // 怪物死亡掉落：在其脚下生成 1~2 个掉落物
    function dropMobLoot(m) {
      const t = MOB_TYPES[m.type];
      const bx = Math.floor(m.pos.x), by = Math.floor(m.pos.y - MOB_HEIGHT), bz = Math.floor(m.pos.z);
      spawnDrop(bx, by, bz, t.drop);
    }

    // ===== 被动动物系统（游荡，不主动攻击；可击杀掉肉）=====
    const animals = [];
    function makeAnimalMesh(type) {
      const t = ANIMAL_TYPES[type];
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshLambertMaterial({ color: t.body });
      // 动物比怪物矮胖：身体横长
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 1.0), bodyMat);
      body.position.y = 0.55;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), new THREE.MeshLambertMaterial({ color: t.head }));
      head.position.set(0, 0.75, 0.6);
      g.add(body); g.add(head);
      g.userData.bodyMat = bodyMat;
      return g;
    }
    function spawnAnimal() {
      const x = 2 + Math.floor((animals.length * 13 + gameTime * 7) % (WORLD_W - 4));
      const z = 2 + Math.floor((animals.length * 17 + gameTime * 11) % (WORLD_D - 4));
      const type = ANIMAL_TYPE_KEYS[(animals.length + Math.floor(gameTime)) % ANIMAL_TYPE_KEYS.length];
      const t = ANIMAL_TYPES[type];
      const y = surfaceY(x, z);
      const mesh = makeAnimalMesh(type);
      scene.add(mesh);
      animals.push({
        type, pos: new THREE.Vector3(x + 0.5, y + MOB_HEIGHT, z + 0.5),
        vel: new THREE.Vector3(), health: t.health, onGround: false,
        hitFlash: 0, mesh,
        wanderDir: Math.random() * Math.PI * 2,
        wanderTimer: 0,
      });
    }
    function ensureAnimals() {
      while (animals.length < ANIMAL_COUNT) spawnAnimal();
    }
    function killAnimal(i) {
      const a = animals[i];
      const bx = Math.floor(a.pos.x), by = Math.floor(a.pos.y - MOB_HEIGHT), bz = Math.floor(a.pos.z);
      spawnDrop(bx, by, bz, ANIMAL_TYPES[a.type].drop); // 掉肉
      scene.remove(a.mesh);
      animals.splice(i, 1);
    }
    // 动物每帧：随机游荡 + 重力 + 同步网格（复用 mob 的碰撞函数）
    function updateAnimals(dt) {
      for (let i = animals.length - 1; i >= 0; i--) {
        const a = animals[i];
        const mat = a.mesh.userData.bodyMat;
        if (a.hitFlash > 0) { a.hitFlash = Math.max(0, a.hitFlash - dt); mat.color.setHex(0xff5555); }
        else mat.color.setHex(ANIMAL_TYPES[a.type].body);

        a.wanderTimer -= dt;
        if (a.wanderTimer <= 0) { a.wanderDir = Math.random() * Math.PI * 2; a.wanderTimer = 2 + Math.random() * 3; }
        const sp = ANIMAL_TYPES[a.type].speed;
        const vx = Math.sin(a.wanderDir) * sp, vz = Math.cos(a.wanderDir) * sp;
        const hitX = mobMoveAxis(a, 'x', vx * dt);
        const hitZ = mobMoveAxis(a, 'z', vz * dt);
        if ((hitX || hitZ) && a.onGround) a.vel.y = JUMP_SPEED;

        a.vel.y -= GRAVITY * dt;
        const hitY = mobMoveAxis(a, 'y', a.vel.y * dt);
        if (hitY) { a.onGround = a.vel.y < 0; a.vel.y = 0; } else { a.onGround = false; }
        if (a.pos.y < -20) { killAnimal(i); continue; }

        a.mesh.position.set(a.pos.x, a.pos.y - MOB_HEIGHT, a.pos.z);
        a.mesh.rotation.y = a.wanderDir;
      }
      ensureAnimals();
    }

    // 玩家受伤：扣血、记录时刻、触发红屏闪烁、判死
    function damagePlayer(dmg) {
      if (player.dead) return;
      player.health = Math.max(0, player.health - dmg);
      player.lastHurt = gameTime;
      hurtEl.classList.add('flash');
      setTimeout(() => hurtEl.classList.remove('flash'), 120);
      renderHealth();
      if (player.health <= 0) playerDie();
    }

    function playerDie() {
      player.dead = true;
      deathEl.classList.remove('hidden');
      document.exitPointerLock();
    }

    // 获得经验：累加、升级、刷新经验条
    function gainXP(amount) {
      player.xp += amount;
      const newLevel = Math.floor(player.xp / 100);
      if (newLevel > player.level) { player.level = newLevel; playSound('kill'); } // 升级提示音
      renderXP();
    }

    // 每帧推进所有怪物：追玩家、重力、攻击、同步网格
    function updateMobs(dt) {
      for (let i = mobs.length - 1; i >= 0; i--) {
        const m = mobs[i];
        const t = MOB_TYPES[m.type];
        m.attackCd -= dt;

        // 朝玩家水平方向移动（在侦测范围内且玩家未死）
        const dx = player.pos.x - m.pos.x, dz = player.pos.z - m.pos.z;
        const dist = Math.hypot(dx, dz);
        if (!player.dead && dist < MOB_SIGHT && dist > 0.01) {
          const nx = dx / dist, nz = dz / dist;
          // 速度 = 朝向 * 类型速度 + 残留击退速度（击退逐帧衰减）
          const vx = nx * t.speed + m.vel.x;
          const vz = nz * t.speed + m.vel.z;
          const hitX = mobMoveAxis(m, 'x', vx * dt);
          const hitZ = mobMoveAxis(m, 'z', vz * dt);
          // 撞墙则尝试跳跃越过
          if ((hitX || hitZ) && m.onGround) m.vel.y = JUMP_SPEED;
        }
        m.vel.x *= 0.8; m.vel.z *= 0.8; // 击退衰减

        // 重力
        m.vel.y -= GRAVITY * dt;
        const hitY = mobMoveAxis(m, 'y', m.vel.y * dt);
        if (hitY) { m.onGround = m.vel.y < 0; m.vel.y = 0; } else { m.onGround = false; }
        if (m.pos.y < -20) { killMob(i); continue; } // 掉出世界

        // 贴近玩家则攻击（苦力怕特殊：点燃引信后爆炸）
        if (!player.dead && dist < 2.2) {
          if (t.explode) {
            // 苦力怕：进入范围点燃引信，1.2 秒后爆炸
            if (m.fuse === undefined) { m.fuse = 1.2; playSound('fuse'); }
            m.fuse -= dt;
            if (m.fuse <= 0) {
              // 爆炸：范围伤害（越近越疼）+ 自毁
              const dmg = Math.max(2, Math.round(t.damage * (1 - dist / 3)));
              damagePlayer(dmg);
              spawnDamageText(dmg, true);
              playSound('explode');
              // 爆炸火花粒子：橙色一大簇
              particles.burst(m.pos.x, m.pos.y - MOB_HEIGHT / 2, m.pos.z, 0xff8822, 24, 7, 0.7);
              dropMobLoot(m);
              killMob(i);
              continue;
            }
          } else if (dist < 1.6 && m.attackCd <= 0) {
            m.attackCd = MOB_ATTACK_CD;
            damagePlayer(t.damage);
            spawnDamageText(t.damage, true);
            playSound('hurt');
          }
        } else if (t.explode && m.fuse !== undefined) {
          m.fuse = undefined; // 玩家跑远，引信熄灭
        }

        // 日照燃烧：白天且头顶直接见天（上方全是空气/非实体）则持续掉血
        if (!isNight()) {
          const hx = Math.floor(m.pos.x), hz = Math.floor(m.pos.z);
          const headY = Math.floor(m.pos.y);
          let exposed = true;
          for (let yy = headY + 1; yy < WORLD_H; yy++) {
            if (isSolid(getBlock(hx, yy, hz))) { exposed = false; break; }
          }
          if (exposed) {
            m.health -= 4 * dt;       // 每秒 4 点，约 3~4 秒烧死
            m.hitFlash = 0.1;         // 闪红表示在烧
            if (m.health <= 0) { dropMobLoot(m); killMob(i); continue; }
          }
        }

        // 同步网格位置 + 朝向玩家
        m.mesh.position.set(m.pos.x, m.pos.y - MOB_HEIGHT, m.pos.z);
        if (dist > 0.01) m.mesh.rotation.y = Math.atan2(dx, dz);
      }
      ensureMobs(); // 补足被击杀的
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

    // 视线是否瞄准某怪物：用射线与每个怪物的竖直 AABB 求交，返回最近的怪物索引。
    function raycastMob() {
      const origin = player.pos.clone();
      const dir = new THREE.Vector3(0, 0, -1)
        .applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ')).normalize();
      let best = -1, bestT = ATTACK_RANGE;
      for (let i = 0; i < mobs.length; i++) {
        const m = mobs[i];
        // 怪物 AABB：底在 pos.y-MOB_HEIGHT，顶在 pos.y
        const min = new THREE.Vector3(m.pos.x - MOB_RADIUS, m.pos.y - MOB_HEIGHT, m.pos.z - MOB_RADIUS);
        const max = new THREE.Vector3(m.pos.x + MOB_RADIUS, m.pos.y, m.pos.z + MOB_RADIUS);
        const t = rayBoxIntersect(origin, dir, min, max);
        if (t !== null && t < bestT) { bestT = t; best = i; }
      }
      return best;
    }
    // 视线是否瞄准某动物，返回最近的动物索引
    function raycastAnimal() {
      const origin = player.pos.clone();
      const dir = new THREE.Vector3(0, 0, -1)
        .applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ')).normalize();
      let best = -1, bestT = ATTACK_RANGE;
      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        const min = new THREE.Vector3(a.pos.x - MOB_RADIUS, a.pos.y - MOB_HEIGHT, a.pos.z - MOB_RADIUS);
        const max = new THREE.Vector3(a.pos.x + MOB_RADIUS, a.pos.y, a.pos.z + MOB_RADIUS);
        const t = rayBoxIntersect(origin, dir, min, max);
        if (t !== null && t < bestT) { bestT = t; best = i; }
      }
      return best;
    }
    // 标准 slab 法求射线与 AABB 交点距离，未命中返回 null
    function rayBoxIntersect(o, d, min, max) {
      let tmin = 0, tmax = Infinity;
      for (const ax of ['x', 'y', 'z']) {
        if (Math.abs(d[ax]) < 1e-8) {
          if (o[ax] < min[ax] || o[ax] > max[ax]) return null;
        } else {
          let t1 = (min[ax] - o[ax]) / d[ax];
          let t2 = (max[ax] - o[ax]) / d[ax];
          if (t1 > t2) [t1, t2] = [t2, t1];
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) return null;
        }
      }
      return tmin;
    }

    // ===== 破坏 / 放置 =====
    document.addEventListener('mousedown', e => {
      if (!locked || player.dead) return;
      if (e.button === 0) {
        startSwing(); // 左键总是挥手
        // 左键：先看是否瞄准怪物（不依赖方块命中，这样对着天空的怪物也能打），是则攻击
        if (player.attackCd <= 0) {
          const mi = raycastMob();
          if (mi >= 0) {
            player.attackCd = ATTACK_COOLDOWN;
            const m = mobs[mi];
            m.health -= ATTACK_DAMAGE;
            m.hitFlash = 0.18;           // 触发受击闪红
            triggerHitMarker();          // 准星命中标记
            spawnDamageText(ATTACK_DAMAGE, false); // 伤害飘字
            playSound('hit');            // 打击音效
            // 击退：把怪物沿玩家朝向推开
            const kb = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)).multiplyScalar(4);
            m.vel.x += kb.x; m.vel.z += kb.z; m.vel.y += 3;
            if (net.isClient()) {
              net.send(MSG.HIT, { kind: 'mob', i: mi }); // 客户端：交给房主结算
            } else if (m.health <= 0) {
              dropMobLoot(m);            // 死亡掉落
              playSound('kill');
              gainXP(XP_PER_MOB);        // 击杀得经验
              killMob(mi);
            }
            return; // 攻击了怪物就不破坏方块
          }
          // 没瞄到怪物，再看动物
          const ai = raycastAnimal();
          if (ai >= 0) {
            player.attackCd = ATTACK_COOLDOWN;
            const a = animals[ai];
            a.health -= ATTACK_DAMAGE;
            a.hitFlash = 0.18;
            triggerHitMarker();
            spawnDamageText(ATTACK_DAMAGE, false);
            playSound('hit');
            // 动物被打会朝远离玩家方向逃（改游荡朝向）
            a.wanderDir = Math.atan2(a.pos.x - player.pos.x, a.pos.z - player.pos.z);
            a.wanderTimer = 3;
            if (net.isClient()) {
              net.send(MSG.HIT, { kind: 'animal', i: ai });
            } else if (a.health <= 0) { playSound('kill'); killAnimal(ai); }
            return;
          }
        }
        // 没瞄到怪物/动物：破坏方块，按掉落表产出掉落物
        const r = raycastBlock();
        if (!r) return;
        const [x, y, z] = r.hit;
        const broken = getBlock(x, y, z);
        setBlock(x, y, z, AIR);
        if (net.isMultiplayer()) { blockEdits[keyOf(x, y, z)] = AIR; net.send(MSG.BLOCK, { x, y, z, id: AIR }); }
        // 功能方块清理：火把光源、门开启状态、箱子内容
        if (broken === 14) removeTorchLight(x, y, z);
        if (broken === 15) openDoors.delete(keyOf(x, y, z));
        if (broken === 17) delete chests[keyOf(x, y, z)];
        const drop = dropOf(broken);
        if (drop !== null) spawnDrop(x, y, z, drop);
        if (broken === 10 || broken === 11) gainXP(XP_PER_ORE); // 挖矿石得经验
        playSound('break');
        // 破坏碎屑粒子：用方块顶色喷一小撮
        particles.burst(x + 0.5, y + 0.5, z + 0.5, blockColor(broken, 'top'), 8, 3, 0.5);
        player.hunger = Math.max(0, player.hunger - 0.15); // 挖掘消耗饥饿
        rebuildTerrain();
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
        inventory[placeId]--;
        renderHotbar();
        setBlock(px, py, pz, placeId);
        if (net.isMultiplayer()) { blockEdits[keyOf(px, py, pz)] = placeId; net.send(MSG.BLOCK, { x: px, y: py, z: pz, id: placeId }); }
        if (isLight(placeId)) addTorchLight(px, py, pz); // 火把发光
        playSound('place');
        rebuildTerrain();
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
          inventory[id] = (inventory[id] || 0) + 1;
          renderChest(); renderHotbar();
        }));
      }
      chestInvEl.innerHTML = '';
      for (const id of Object.keys(inventory)) {
        if (inventory[id] > 0) chestInvEl.appendChild(mkSlot(id, inventory[id], () => {
          // 从背包存入一个到箱子
          inventory[id]--; if (inventory[id] <= 0) delete inventory[id];
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

    // ===== 合成系统 =====
    // 每条配方：inputs = {id: 数量}, output = id, count = 产出数量, table = 是否需要工作台
    const RECIPES = [
      { inputs: { 4: 1 },          output: 9,   count: 4, table: false, name: '木板' },   // 木头→4木板
      { inputs: { 9: 2 },          output: 101, count: 4, table: false, name: '木棍' },   // 2木板→4木棍
      { inputs: { 9: 3, 101: 2 },  output: 102, count: 1, table: true,  name: '木镐' },   // 3木板+2木棍→木镐
      { inputs: { 8: 3, 101: 2 },  output: 103, count: 1, table: true,  name: '石镐' },   // 3圆石+2木棍→石镐
      { inputs: { 9: 4 },          output: 12,  count: 1, table: true,  name: '工作台' }, // 4木板→工作台
      { inputs: { 105: 1, 9: 1 },  output: 104, count: 1, table: false, name: '苹果(应急)' }, // 占位食物配方
      { inputs: { 101: 1, 105: 1 },output: 14,  count: 4, table: false, name: '火把' },   // 木棍+煤炭→4火把
      { inputs: { 9: 6 },          output: 15,  count: 1, table: true,  name: '门' },     // 6木板→门
      { inputs: { 101: 7 },        output: 16,  count: 3, table: true,  name: '梯子' },   // 7木棍→3梯子
      { inputs: { 9: 8 },          output: 17,  count: 1, table: true,  name: '箱子' },   // 8木板→箱子
    ];
    let craftOpen = false;
    let nearTable = false; // 附近是否有工作台

    // 检查某配方当前能否合成（库存够 + 工作台条件满足）
    function canCraft(r) {
      if (r.table && !nearTable) return false;
      for (const [id, n] of Object.entries(r.inputs)) {
        if ((inventory[id] || 0) < n) return false;
      }
      return true;
    }
    // 执行合成：扣材料、加产物
    function doCraft(r) {
      if (!canCraft(r)) return;
      for (const [id, n] of Object.entries(r.inputs)) inventory[id] -= n;
      addToInventory(r.output, r.count);
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
              inventory[id]--;
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
            inventory[id]--;
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
      player.health = MAX_HEALTH;
      player.dead = false;
      player.pos.set(WORLD_W / 2, WORLD_H, WORLD_D / 2);
      player.vel.set(0, 0, 0);
      if (!net.isClient()) { while (mobs.length) killMob(0); ensureMobs(); }
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
      Save.saveSeed(seed);
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
      const n = net.isHost() ? (net.conns.size + 1) : (Object.keys(remotePlayers).length + 1);
      netbarEl.textContent = `🌐 ${role} · 房间 ${net.roomId} · ${n} 人`;
    }
    net.onStatus = (t) => netMsg(t);
    net.onPeerLeave = (pid) => { removeRemotePlayer(pid); updateNetbar(); };

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

    // 累计的方块改动（host 维护，新客户端加入时补发）："x,y,z" -> blockId
    const blockEdits = {};
    // 统一的方块改动应用：更新世界 + 功能方块附属状态 + 重建网格
    function applyNetBlock(x, y, z, id) {
      const prev = getBlock(x, y, z);
      setBlock(x, y, z, id);
      if (prev === 14 && id !== 14) removeTorchLight(x, y, z);
      if (id === 14) addTorchLight(x, y, z);
      if (prev === 15 && id !== 15) openDoors.delete(keyOf(x, y, z));
      if (prev === 17 && id !== 17) delete chests[keyOf(x, y, z)];
      blockEdits[keyOf(x, y, z)] = id;
      rebuildTerrain();
    }

    // 房主：注册收到客户端消息的处理器
    function setupHostHandlers() {
      net.onPeerJoin = (pid) => {
        // 新客户端：发完整世界（种子 + 累计改动 + 当前昼夜）
        net.sendTo(pid, MSG.WORLD, { seed: currentSeed, edits: blockEdits, dayTime, gameTime });
        ensureRemotePlayer(pid);
        updateNetbar();
      };
      net.on(MSG.HELLO, (d, from) => { ensureRemotePlayer(from); updateNetbar(); });
      net.on(MSG.INPUT, (d, from) => {
        const rp = ensureRemotePlayer(from);
        rp.target.set(d.x, d.y, d.z); rp.yaw = d.yaw;
      });
      net.on(MSG.BLOCK, (d, from) => {
        applyNetBlock(d.x, d.y, d.z, d.id);
        net.broadcast(MSG.BLOCK, d, from); // 转发给其他客户端
      });
      net.on(MSG.HIT, (d, from) => {
        // 客户端攻击怪物：房主结算（按 index 容错）
        if (d.kind === 'mob' && mobs[d.i]) {
          const m = mobs[d.i]; m.health -= ATTACK_DAMAGE; m.hitFlash = 0.18;
          if (m.health <= 0) { dropMobLoot(m); killMob(d.i); }
        } else if (d.kind === 'animal' && animals[d.i]) {
          const a = animals[d.i]; a.health -= ATTACK_DAMAGE;
          if (a.health <= 0) killAnimal(d.i);
        }
      });
    }

    // 客户端：注册收到房主消息的处理器
    function setupClientHandlers() {
      net.on(MSG.WORLD, (d) => {
        currentSeed = d.seed;
        for (let i = 0; i < world.length; i++) world[i] = 0;
        generateWorld(d.seed);
        for (const k in (d.edits || {})) {
          const [x, y, z] = k.split(',').map(Number);
          setBlock(x, y, z, d.edits[k]);
        }
        dayTime = d.dayTime ?? 0.15; gameTime = d.gameTime ?? 0;
        rebuildTerrain();
        netReady = true;
        netMsg('世界已同步，点击开始');
        updateNetbar();
      });
      net.on(MSG.BLOCK, (d) => applyNetBlock(d.x, d.y, d.z, d.id));
      net.on(MSG.STATE, (d) => applyHostState(d));
    }

    // 客户端：应用房主下发的快照（玩家/怪物/动物/昼夜）
    function applyHostState(s) {
      dayTime = s.dayTime;
      // 远程玩家（含房主，键 'host'）
      const seen = new Set();
      for (const p of s.players) {
        if (p.id === net.selfId) continue; // 跳过自己
        seen.add(p.id);
        const rp = ensureRemotePlayer(p.id);
        rp.target.set(p.x, p.y, p.z); rp.yaw = p.yaw;
      }
      for (const pid in remotePlayers) if (!seen.has(pid)) removeRemotePlayer(pid);
      // 怪物：按下发列表重建（客户端不跑 AI）
      syncNetMobs(s.mobs);
      syncNetAnimals(s.animals);
      updateNetbar();
    }

    // 客户端：用房主快照重建怪物/动物 mesh（不跑 AI，只渲染）。
    // 复用 mobs/animals 数组本身（mesh 在 scene 里），按下发数量增删。
    function syncNetMobs(list) {
      while (mobs.length > list.length) killMob(mobs.length - 1);
      for (let i = 0; i < list.length; i++) {
        const d = list[i];
        if (!mobs[i] || mobs[i].type !== d.type) {
          if (mobs[i]) killMob(i);
          const mesh = makeMobMesh(d.type);
          scene.add(mesh);
          mobs[i] = { type: d.type, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
            health: d.h, onGround: true, attackCd: 0, hitFlash: 0, mesh };
        }
        mobs[i].pos.set(d.x, d.y, d.z);
        mobs[i].mesh.position.set(d.x, d.y - MOB_HEIGHT, d.z);
      }
    }
    function syncNetAnimals(list) {
      while (animals.length > list.length) killAnimal(animals.length - 1);
      for (let i = 0; i < list.length; i++) {
        const d = list[i];
        if (!animals[i] || animals[i].type !== d.type) {
          if (animals[i]) killAnimal(i);
          const mesh = makeAnimalMesh(d.type);
          scene.add(mesh);
          animals[i] = { type: d.type, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
            health: d.h, onGround: true, hitFlash: 0, wanderDir: 0, wanderTimer: 0, mesh };
        }
        animals[i].pos.set(d.x, d.y, d.z);
        animals[i].mesh.position.set(d.x, d.y - MOB_HEIGHT, d.z);
      }
    }

    // 房主：把当前状态打包广播给所有客户端（10Hz）
    function broadcastState() {
      const players = [{ id: 'host', x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw }];
      for (const pid in remotePlayers) {
        const rp = remotePlayers[pid];
        players.push({ id: pid, x: rp.target.x, y: rp.target.y, z: rp.target.z, yaw: rp.yaw });
      }
      const mobList = mobs.map(m => ({ type: m.type, x: m.pos.x, y: m.pos.y, z: m.pos.z, h: m.health }));
      const aniList = animals.map(a => ({ type: a.type, x: a.pos.x, y: a.pos.y, z: a.pos.z, h: a.health }));
      net.broadcast(MSG.STATE, { players, mobs: mobList, animals: aniList, dayTime });
    }

    // 每帧推进联机同步（位置上报 / 状态广播 / 远程插值）
    function netTick(dt) {
      if (!net.isMultiplayer()) return;
      updateRemotePlayers(dt);
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

      // 1) 水平移动：把 WASD 转成相对朝向(yaw)的方向向量
      const forward = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
      const strafe  = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
      let speed = MOVE_SPEED * (keys['ShiftLeft'] ? 1 : 1);
      if (keys['ControlLeft']) speed *= SPRINT_MULT; // Ctrl 冲刺

      const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
      // 前向(yaw): (-sin, -cos)；右向: (cos, -sin)
      let mx = (-sin * forward + cos * strafe);
      let mz = (-cos * forward - sin * strafe);
      const len = Math.hypot(mx, mz);
      if (len > 0) { mx /= len; mz /= len; }

      moveAxis('x', mx * speed * dt);
      moveAxis('z', mz * speed * dt);

      // 2) 重力与跳跃（梯子上则可攀爬）
      const onLadder = isClimbable(getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y - PLAYER_HEIGHT + 0.5), Math.floor(player.pos.z)))
                    || isClimbable(getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y - 0.5), Math.floor(player.pos.z)));
      if (onLadder) {
        // 在梯子上：取消重力，用空格上爬、Shift 下爬，否则缓慢下滑
        if (keys['Space']) player.vel.y = 3.5;
        else if (keys['ShiftLeft']) player.vel.y = -3.5;
        else player.vel.y = -1.0;
        moveAxis('y', player.vel.y * dt);
        player.onGround = true; // 梯子上视作可跳
      } else {
        player.vel.y -= GRAVITY * dt;
        if (keys['Space'] && player.onGround) { player.vel.y = JUMP_SPEED; player.onGround = false; }
        const hitY = moveAxis('y', player.vel.y * dt);
        if (hitY) {
          player.onGround = player.vel.y < 0;
          player.vel.y = 0;
        } else {
          player.onGround = false;
        }
      }

      // 出生时若卡在空中，落到地面由重力解决；掉出世界则重置高度
      if (player.pos.y < -10) { player.pos.set(WORLD_W/2, WORLD_H, WORLD_D/2); player.vel.set(0,0,0); }

      // 2.5) 饥饿值：自然衰减；归零则饿掉血；饥饿充足才回血
      const beforeHunger = Math.ceil(player.hunger);
      player.hunger = Math.max(0, player.hunger - HUNGER_DECAY * dt);
      if (Math.ceil(player.hunger) !== beforeHunger) renderHunger();
      if (player.hunger <= 0) {
        // 饿死：每 2 秒掉 1 血
        if (Math.floor(gameTime * 0.5) !== Math.floor((gameTime - dt) * 0.5)) {
          damagePlayer(STARVE_DAMAGE);
        }
      } else if (player.health < MAX_HEALTH && player.hunger > 6 &&
                 gameTime - player.lastHurt > REGEN_DELAY) {
        // 脱战 + 饥饿充足才缓慢回血
        const before = Math.floor(player.health);
        player.health = Math.min(MAX_HEALTH, player.health + REGEN_RATE * dt);
        if (Math.floor(player.health) !== before) renderHealth();
      }
      player.attackCd -= dt;

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
        updateMobs(dt);
        // 2.65) 推进被动动物
        updateAnimals(dt);
      }

      // 2.7) 推进掉落物（重力/拾取/超时）
      updateDrops(dt);

      // 2.8) 打击感：手臂挥动、命中标记、怪物受击闪红
      updateHand(dt);
      updateHitMarker(dt);
      updateMobFlash(dt);

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
        updateDayCycle(dt);
        updateClouds(dt);
        particles.update(dt, GRAVITY); // 推进粒子
        // 纹理缓动：让方块表面颗粒微微流动，制造"活"的氛围
        blockTexture.offset.x = (blockTexture.offset.x + dt * 0.02) % 1;
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

    // 给玩家初始库存（新游戏用）
    function giveStartingInventory() {
      inventory[4] = 8; inventory[1] = 16; inventory[3] = 16; inventory[104] = 3;
    }

    // 开新游戏：用指定种子生成世界
    function startNewGame(seed) {
      currentSeed = seed;
      // 清空世界数组
      for (let i = 0; i < world.length; i++) world[i] = 0;
      generateWorld(seed);
      // 重置玩家
      player.pos.set(WORLD_W / 2, WORLD_H, WORLD_D / 2);
      player.vel.set(0, 0, 0);
      player.health = MAX_HEALTH; player.hunger = MAX_HUNGER;
      player.xp = 0; player.level = 0; player.dead = false;
      dayTime = 0.15; gameTime = 0;
      // 清空各容器
      for (const k in inventory) delete inventory[k];
      for (const k in chests) delete chests[k];
      openDoors.clear();
      for (const k in torchLights) { scene.remove(torchLights[k]); delete torchLights[k]; }
      giveStartingInventory();
      rebuildTerrain();
      refreshAllUI();
    }

    // 应用读档数据：世界已由 Save.loadGame 写回，恢复其余状态
    function applyLoadedSave(data) {
      currentSeed = data.seed ?? 1337;
      // 恢复玩家
      Object.assign(player, {
        health: data.player.health, hunger: data.player.hunger,
        xp: data.player.xp, level: data.player.level,
        yaw: data.player.yaw, pitch: data.player.pitch, dead: false,
      });
      player.pos.set(data.player.px, data.player.py, data.player.pz);
      player.vel.set(0, 0, 0);
      dayTime = data.dayTime ?? 0.15;
      gameTime = data.gameTime ?? 0;
      // 恢复物品栏
      for (const k in inventory) delete inventory[k];
      Object.assign(inventory, data.inventory || {});
      // 恢复箱子
      for (const k in chests) delete chests[k];
      Object.assign(chests, data.chests || {});
      // 恢复门
      openDoors.clear();
      (data.openDoors || []).forEach(k => openDoors.add(k));
      // 恢复火把光源
      for (const k in torchLights) { scene.remove(torchLights[k]); delete torchLights[k]; }
      (data.torches || []).forEach(k => { const [x, y, z] = k.split(',').map(Number); addTorchLight(x, y, z); });
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
        chests, inventory,
        openDoors: Array.from(openDoors),
        torches: Object.keys(torchLights),
        dayTime, gameTime,
      };
    }
    function doSave() {
      const ok = Save.saveGame(makeSnapshot());
      Save.saveSeed(currentSeed);
      if (ok) flashHint('已保存 ✓');
    }

    // 启动决策：有存档则读档，否则按记忆种子或默认开新游戏
    const loaded = Save.loadGame(world);
    makeClouds();
    if (loaded) {
      applyLoadedSave(loaded);
    } else {
      const savedSeed = Save.loadSeed();
      startNewGame(savedSeed ?? 1337);
    }
    ensureMobs();
    ensureAnimals();
    onResize();
    requestAnimationFrame(animate);
  