// ===== data.js =====
// 纯数据层：常量、方块/物品定义、噪声、世界数据与地形生成、网格构建。
// 不依赖其他游戏模块；buildMesh 接收 THREE 作为参数以避免耦合。

// ---- 世界尺寸 ----
export const WORLD_W = 128, WORLD_H = 64, WORLD_D = 128, SEA_LEVEL = 18;

// ---- 玩家物理 ----
export const GRAVITY = 26, JUMP_SPEED = 8.5, MOVE_SPEED = 5.0, SPRINT_MULT = 1.6;
export const PLAYER_HEIGHT = 1.7, PLAYER_RADIUS = 0.3, REACH = 6;
export const SAFE_FALL_DISTANCE = 3.2, FALL_DAMAGE_PER_BLOCK = 1;

// ---- 掉落物 / 物品栏 ----
export const PICKUP_RANGE = 1.6, DROP_LIFETIME = 120, STACK_MAX = 99;
export const HOTBAR_SIZE = 9;

// ---- 战斗 / 血量 ----
export const MAX_HEALTH = 20, REGEN_DELAY = 5, REGEN_RATE = 1;
export const ATTACK_DAMAGE = 5, ATTACK_RANGE = 4, ATTACK_COOLDOWN = 0.4;

// ---- 怪物 ----
export const MOB_COUNT = 8, MOB_SIGHT = 16, MOB_RADIUS = 0.4, MOB_HEIGHT = 1.8;
export const MOB_ATTACK_CD = 1.0;
export const MOB_TYPES = {
  zombie:   { name: '僵尸',   body: 0x4a7a3a, head: 0x6a9a5a, speed: 2.2, health: 18, damage: 3, drop: 2,   explode: false },
  skeleton: { name: '骷髅',   body: 0xd8d8d0, head: 0xeeeee6, speed: 3.4, health: 12, damage: 2, drop: 101, explode: false },
  creeper:  { name: '苦力怕', body: 0x2f8f3f, head: 0x257030, speed: 2.8, health: 14, damage: 8, drop: 105, explode: true  },
};
export const MOB_TYPE_KEYS = Object.keys(MOB_TYPES);

// ---- 被动动物（游荡，不主动攻击玩家；可击杀掉肉）----
export const ANIMAL_COUNT = 6;          // 同时存在的动物数量
export const ANIMAL_TYPES = {
  pig:   { name: '猪', body: 0xe0a0a8, head: 0xe8b0b8, speed: 1.4, health: 8, drop: 107 }, // 掉生猪肉
  sheep: { name: '羊', body: 0xeeeeee, head: 0xf6f6f6, speed: 1.6, health: 8, drop: 108 }, // 掉羊肉
  cow:   { name: '牛', body: 0x5a4a3a, head: 0x6a5a48, speed: 1.2, health: 10, drop: 107 },// 掉生牛肉(复用猪肉)
};
export const ANIMAL_TYPE_KEYS = Object.keys(ANIMAL_TYPES);

// ---- 生物群系：基于温度噪声决定地表方块与植被密度 ----
// kind: 决定顶层方块；treeChance: 种树概率
export const BIOMES = {
  plains: { name: '平原', topBlock: 1, treeChance: 0.02 }, // 草
  desert: { name: '沙漠', topBlock: 6, treeChance: 0.0  }, // 沙，无树
  snow:   { name: '雪原', topBlock: 13, treeChance: 0.01 },// 雪
};

// ---- 方块与物品 ----
export const AIR = 0;
export const BLOCKS = {
  1: { name: '草',   top: 0x6aa84f, side: 0x8a6a3a, bottom: 0x6b4f2f, textures: { top: 'Tiles/grass_top.png', side: 'Tiles/dirt_grass.png', bottom: 'Tiles/dirt.png' }, mineTime: 0.65, tool: 'shovel' },
  2: { name: '泥土', top: 0x6b4f2f, side: 0x6b4f2f, bottom: 0x6b4f2f, texture: 'Tiles/dirt.png', mineTime: 0.65, tool: 'shovel' },
  3: { name: '石头', top: 0x888888, side: 0x808080, bottom: 0x787878, texture: 'Tiles/stone.png', mineTime: 2.8, tool: 'pickaxe' },
  4: { name: '木头', top: 0x9a7b4f, side: 0x6f5530, bottom: 0x9a7b4f, textures: { top: 'Tiles/trunk_top.png', side: 'Tiles/trunk_side.png', bottom: 'Tiles/trunk_bottom.png' }, mineTime: 1.5, tool: 'axe' },
  5: { name: '树叶', top: 0x3f7d2f, side: 0x357024, bottom: 0x2f6620, texture: 'Tiles/leaves.png', mineTime: 0.25 },
  6: { name: '沙子', top: 0xe2d28b, side: 0xd8c77e, bottom: 0xcdbb70, texture: 'Tiles/sand.png', mineTime: 0.55, tool: 'shovel' },
  7: { name: '水',   top: 0x3a6ea5, side: 0x3a6ea5, bottom: 0x3a6ea5, texture: 'Tiles/water.png', transparent: true, mineTime: Infinity },
  8: { name: '圆石', top: 0x9a9a9a, side: 0x8e8e8e, bottom: 0x848484, texture: 'Tiles/rock.png', mineTime: 3.0, tool: 'pickaxe' },
  9: { name: '木板', top: 0xc9a86a, side: 0xbf9d5e, bottom: 0xb59252, texture: 'Tiles/wood.png', mineTime: 1.2, tool: 'axe' },
  10:{ name: '煤矿', top: 0x4a4a4a, side: 0x444444, bottom: 0x3e3e3e, texture: 'Tiles/stone_coal.png', mineTime: 3.4, tool: 'pickaxe' },
  11:{ name: '铁矿', top: 0xd8c0a0, side: 0xcfb695, bottom: 0xc6ac8a, texture: 'Tiles/stone_iron.png', mineTime: 3.6, tool: 'pickaxe' },
  12:{ name: '工作台', top: 0xb5803a, side: 0x8a5f2a, bottom: 0x6f5530, textures: { top: 'Tiles/table.png', side: 'Tiles/table.png', bottom: 'Tiles/wood.png' }, mineTime: 1.25, tool: 'axe' },
  13:{ name: '雪',   top: 0xf4f8fc, side: 0xeaf0f6, bottom: 0xdde6ee, textures: { top: 'Tiles/snow.png', side: 'Tiles/dirt_snow.png', bottom: 'Tiles/dirt.png' }, mineTime: 0.45, tool: 'shovel' },
  14:{ name: '火把', top: 0xffcc44, side: 0xffaa22, bottom: 0x6f5530, textures: { top: 'Tiles/redstone.png', side: 'Tiles/wood_red.png', bottom: 'Tiles/wood.png' }, light: true, mineTime: 0.15 },  // 发光
  15:{ name: '门',   top: 0x8a5f2a, side: 0x9a6f3a, bottom: 0x8a5f2a, texture: 'Tiles/wood_red.png', door: true, mineTime: 1.2, tool: 'axe' },
  16:{ name: '梯子', top: 0xb59252, side: 0xa07a40, bottom: 0xb59252, texture: 'Tiles/fence_wood.png', climb: true, mineTime: 0.9, tool: 'axe' },  // 可攀爬
  17:{ name: '箱子', top: 0xa0703a, side: 0x8a5f2a, bottom: 0x6f5530, textures: { top: 'Tiles/wood.png', side: 'Tiles/table.png', bottom: 'Tiles/wood.png' }, container: true, mineTime: 1.4, tool: 'axe' }, // 存储
  18:{ name: '玻璃', top: 0xd9f4ff, side: 0xd9f4ff, bottom: 0xd9f4ff, texture: 'Tiles/glass.png', transparent: true, mineTime: 0.45 },
  19:{ name: '砖块', top: 0xb24a3a, side: 0xa84334, bottom: 0x8e3529, texture: 'Tiles/brick_red.png', mineTime: 3.2, tool: 'pickaxe' },
  20:{ name: '炉子', top: 0x8a8a8a, side: 0x767676, bottom: 0x666666, textures: { top: 'Tiles/stone.png', side: 'Tiles/oven.png', bottom: 'Tiles/stone.png' }, mineTime: 3.4, tool: 'pickaxe' },
  21:{ name: '木栅栏', top: 0xb59252, side: 0xa07a40, bottom: 0x8a6534, texture: 'Tiles/fence_wood.png', mineTime: 1.0, tool: 'axe' },
};
export const ITEMS = {
  101: { name: '木棍', color: 0x9a7b4f },
  102: { name: '木镐', color: 0xc9a86a, tool: 'pickaxe', mineSpeed: 2.2 },
  103: { name: '石镐', color: 0x9a9a9a, tool: 'pickaxe', mineSpeed: 3.2 },
  104: { name: '苹果', color: 0xd83030, food: 6 },
  105: { name: '煤炭', color: 0x2a2a2a },
  106: { name: '铁锭', color: 0xe8e8e8 },
  107: { name: '生肉', color: 0xc06868, food: 4 },  // 动物掉落，吃回 4 点饥饿
  108: { name: '羊肉', color: 0xd09090, food: 4 },
  109: { name: '木剑', color: 0xc9a86a, weaponDamage: 7 },
  110: { name: '石剑', color: 0x9a9a9a, weaponDamage: 9 },
  111: { name: '铁剑', color: 0xe0e0e0, weaponDamage: 12 },
  112: { name: '烤肉', color: 0xd98a58, food: 8 },
  113: { name: '木斧', color: 0xc9a86a, tool: 'axe', mineSpeed: 2.2, weaponDamage: 6 },
  114: { name: '石斧', color: 0x9a9a9a, tool: 'axe', mineSpeed: 3.2, weaponDamage: 8 },
  115: { name: '木铲', color: 0xc9a86a, tool: 'shovel', mineSpeed: 2.5, weaponDamage: 4 },
  116: { name: '石铲', color: 0x9a9a9a, tool: 'shovel', mineSpeed: 3.6, weaponDamage: 5 },
};
export const PLACEABLE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 14, 15, 16, 17, 18, 19, 20, 21];
export const PLACEABLE_SET = new Set(PLACEABLE);

const ITEM_TEXTURES = {
  101: 'Items/bowArrow.png',
  102: 'Items/pick_bronze.png',
  103: 'Items/pick_iron.png',
  104: 'Items/apple.png',
  105: 'Items/ore_coal.png',
  106: 'Items/ore_iron.png',
  107: 'Items/stew.png',
  108: 'Items/fish_cooked.png',
  109: 'Items/sword_bronze.png',
  110: 'Items/sword_silver.png',
  111: 'Items/sword_iron.png',
  112: 'Items/fish_cooked.png',
  113: 'Items/axe_bronze.png',
  114: 'Items/axe_iron.png',
  115: 'Items/shovel_bronze.png',
  116: 'Items/shovel_iron.png',
};

function collectTerrainTextures() {
  const out = [];
  const seen = new Set();
  for (const b of Object.values(BLOCKS)) {
    const textures = b.textures ? Object.values(b.textures) : [b.texture];
    for (const tex of textures) {
      if (tex && !seen.has(tex)) {
        seen.add(tex);
        out.push(tex);
      }
    }
  }
  return out;
}

export const TERRAIN_TEXTURES = collectTerrainTextures();
export const TERRAIN_ATLAS_SIZE = Math.ceil(Math.sqrt(TERRAIN_TEXTURES.length));
const TERRAIN_TEXTURE_INDEX = Object.fromEntries(TERRAIN_TEXTURES.map((tex, i) => [tex, i]));

// 击杀/挖矿获得的经验值
export const XP_PER_MOB = 5, XP_PER_ORE = 2;

export function itemName(id) { return BLOCKS[id]?.name ?? ITEMS[id]?.name ?? '?'; }
export function itemColor(id) { return BLOCKS[id] ? BLOCKS[id].top : (ITEMS[id]?.color ?? 0xffffff); }
export function itemDamage(id) { return ITEMS[id]?.weaponDamage ?? ATTACK_DAMAGE; }
export function miningDuration(blockId, toolId) {
  const block = BLOCKS[blockId];
  if (!block || blockId === AIR || blockId === 7) return Infinity;
  const base = block.mineTime ?? 1;
  const item = ITEMS[toolId];
  const preferred = block.tool;
  const speed = preferred && item?.tool === preferred ? (item.mineSpeed ?? 1) : 1;
  return Math.max(0.12, base / speed);
}
export function isPlaceableItem(id) { return PLACEABLE_SET.has(Number(id)); }
export function blockColor(id, face) { const b = BLOCKS[id]; return b ? (b[face] ?? b.side) : 0xffffff; }
export function blockTexture(id, face = 'top') {
  const b = BLOCKS[id];
  if (!b) return TERRAIN_TEXTURES[0];
  return b.textures?.[face] ?? b.texture ?? b.textures?.side ?? TERRAIN_TEXTURES[0];
}
export function itemTexturePath(id) {
  const tex = BLOCKS[id] ? blockTexture(id, 'top') : ITEM_TEXTURES[id];
  return tex ? `assets/textures/kenney/${tex}` : null;
}
// 火把(14)/梯子(16) 可穿过且不遮挡邻面；门(15) 默认实体(关)，开门由 game 层处理；水(7) 不算实体
const NONSOLID = new Set([AIR, 7, 14, 16]);
const NONOPAQUE = new Set([AIR, 7, 14, 15, 16, 18, 21]);
export function isSolid(id) { return !NONSOLID.has(id); }
export function isOpaque(id) { return !NONOPAQUE.has(id); }
export function isClimbable(id) { return id === 16; }       // 梯子
export function isLight(id) { return id === 14; }            // 火把
export function isContainer(id) { return id === 17; }        // 箱子
export function dropOf(id) {
  switch (id) {
    case 1: return 2; case 3: return 8; case 10: return 105; case 11: return 106;
    case 5: return null; case 7: return null; default: return id;
  }
}

// ---- 噪声 ----
export function makeNoise(seed) {
  function hash(x, y) {
    let h = x * 374761393 + y * 668265263 + seed * 1442695040888963407;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function value(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const v00 = hash(xi, yi), v10 = hash(xi + 1, yi);
    const v01 = hash(xi, yi + 1), v11 = hash(xi + 1, yi + 1);
    const u = smooth(xf), v = smooth(yf);
    return (v00 * (1 - u) + v10 * u) * (1 - v) + (v01 * (1 - u) + v11 * u) * v;
  }
  return function (x, y) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < 4; o++) { sum += value(x * freq, y * freq) * amp; norm += amp; amp *= 0.5; freq *= 2; }
    return sum / norm;
  };
}

// ---- 世界数据 ----
export const world = new Uint8Array(WORLD_W * WORLD_D * WORLD_H);
export function idx(x, y, z) { return x + z * WORLD_W + y * WORLD_W * WORLD_D; }
export function inBounds(x, y, z) { return x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H && z >= 0 && z < WORLD_D; }
export function getBlock(x, y, z) { if (!inBounds(x, y, z)) return AIR; return world[idx(x, y, z)]; }
export function setBlock(x, y, z, id) { if (!inBounds(x, y, z)) return; world[idx(x, y, z)] = id; }

// 地形生成、种树、网格构建在下方 Edit 追加

// ---- 地形生成 ----
function hashChance(x, z) {
  let h = (x * 73856093) ^ (z * 19349663);
  h = (h ^ (h >> 13)) >>> 0;
  return (h % 1000) / 1000;
}
function plantTree(x, y, z) {
  const trunk = 4;
  for (let i = 0; i < trunk; i++) setBlock(x, y + i, z, 4);
  const top = y + trunk;
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++)
      for (let dy = -1; dy <= 1; dy++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        if (getBlock(x + dx, top + dy, z + dz) === AIR) setBlock(x + dx, top + dy, z + dz, 5);
      }
  setBlock(x, top + 1, z, 5);
}
export function generateWorld(seed = 1337) {
  world.fill(AIR);
  const noise = makeNoise(seed);
  const mountain = makeNoise(seed + 222);
  const temp = makeNoise(seed + 555);  // 温度噪声，决定生物群系
  const caveA = makeNoise(seed + 99);
  const caveB = makeNoise(seed + 7);
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }
  function caveDensity(x, y, z) {
    const a = caveA((x + y * 2) / 18, (z + y * 2) / 18);
    const b = caveB((x - y * 2) / 12, (z + y * 2) / 12);
    const depth = 1 - y / WORLD_H;
    return (a + b) / 2 + depth * 0.14;
  }
  // 记录每列的群系（供动物生成/调试用）
  for (let x = 0; x < WORLD_W; x++) {
    for (let z = 0; z < WORLD_D; z++) {
      const t = temp(x / 40, z / 40);            // 0~1 温度
      const biome = t < 0.38 ? BIOMES.snow : (t > 0.66 ? BIOMES.desert : BIOMES.plains);
      const broad = noise(x / 72, z / 72);
      const hills = noise(x / 26, z / 26);
      const ridges = Math.pow(Math.abs(mountain(x / 46, z / 46) * 2 - 1), 2);
      const mountainMask = Math.max(0, broad - 0.28);
      const ridgeLift = Math.max(0, ridges - 0.05) * 52 * Math.min(1, mountainMask * 2.8);
      const mountainLift = mountainMask * 100 + ridgeLift;
      const height = Math.floor(clamp(
        SEA_LEVEL - 4 + hills * 10 + mountainLift,
        4,
        WORLD_H - 8
      ));
      for (let y = 0; y <= height; y++) {
        if (y < height - 3 && y > 2 && caveDensity(x, y, z) > 0.44) continue;
        let id;
        if (y === height) {
          // 顶层：水边一律沙，否则用群系顶层方块
          id = (height <= SEA_LEVEL + 1) ? 6 : biome.topBlock;
        } else if (y > height - 3) id = 2;
        else {
          id = 3;
          const r = ((x * 49157) ^ (y * 24593) ^ (z * 98317)) >>> 0;
          if (r % 100 < 6) id = 10;
          else if (y < SEA_LEVEL - 2 && r % 100 < 10) id = 11;
        }
        setBlock(x, y, z, id);
      }
      for (let y = height + 1; y <= SEA_LEVEL; y++) setBlock(x, y, z, 7);
      // 按群系植被密度种树
      if (height > SEA_LEVEL + 1 && hashChance(x, z) < biome.treeChance) plantTree(x, height + 1, z);
    }
  }
}

// ---- 网格构建（只渲染暴露面）----
const FACES = [
  { dir: [ 1, 0, 0], colorKey: 'side',   shade: 0.84, corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },
  { dir: [-1, 0, 0], colorKey: 'side',   shade: 0.78, corners: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]] },
  { dir: [ 0, 1, 0], colorKey: 'top',    shade: 1.00, corners: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]] },
  { dir: [ 0,-1, 0], colorKey: 'bottom', shade: 0.56, corners: [[0,0,1],[0,0,0],[1,0,0],[1,0,1]] },
  { dir: [ 0, 0, 1], colorKey: 'side',   shade: 0.88, corners: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]] },
  { dir: [ 0, 0,-1], colorKey: 'side',   shade: 0.72, corners: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] },
];
function terrainAtlasUV(texture, u, v) {
  const i = TERRAIN_TEXTURE_INDEX[texture] ?? 0;
  const tile = 1 / TERRAIN_ATLAS_SIZE;
  const tx = i % TERRAIN_ATLAS_SIZE;
  const ty = Math.floor(i / TERRAIN_ATLAS_SIZE);
  // Keep sampling safely inside the tile. One atlas pixel prevents neighboring
  // tiles from bleeding into block faces when the view is minified.
  const pad = tile / 128;
  return [
    tx * tile + pad + u * (tile - pad * 2),
    ty * tile + pad + v * (tile - pad * 2),
  ];
}
export function buildMesh(THREE, bounds = {}) {
  const x0 = Math.max(0, bounds.x0 ?? 0);
  const x1 = Math.min(WORLD_W, bounds.x1 ?? WORLD_W);
  const z0 = Math.max(0, bounds.z0 ?? 0);
  const z1 = Math.min(WORLD_D, bounds.z1 ?? WORLD_D);
  const positions = [], normals = [], colors = [], uvs = [], indices = [];
  const col = new THREE.Color();
  const faceUV = [[0,0],[0,1],[1,1],[1,0]]; // 每个面 4 角的 UV
  let v = 0;
  for (let y = 0; y < WORLD_H; y++)
    for (let z = z0; z < z1; z++)
      for (let x = x0; x < x1; x++) {
        const id = getBlock(x, y, z);
        if (id === AIR) continue;
        for (const f of FACES) {
          const [dx, dy, dz] = f.dir;
          const neighbor = getBlock(x + dx, y + dy, z + dz);
          if (isOpaque(neighbor) || (id === 7 && neighbor === 7)) continue;
          const texture = blockTexture(id, f.colorKey);
          col.setRGB(f.shade, f.shade, f.shade);
          for (let ci = 0; ci < f.corners.length; ci++) {
            const c = f.corners[ci];
            const [u, vv] = terrainAtlasUV(texture, faceUV[ci][0], faceUV[ci][1]);
            positions.push(x + c[0], y + c[1], z + c[2]);
            normals.push(dx, dy, dz);
            colors.push(col.r, col.g, col.b);
            uvs.push(u, vv);
          }
          indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
          v += 4;
        }
      }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}
