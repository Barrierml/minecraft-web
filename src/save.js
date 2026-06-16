// ===== save.js =====
// localStorage 存档/读档。把世界方块、玩家状态、箱子、门、火把、时间打包成 JSON。
// 世界数组用 base64 压缩，避免 JSON 数组过大。

const SAVE_KEY = 'miniMC_save_v1';
const SEED_KEY = 'miniMC_seed_v1';

// Uint8Array -> base64 字符串
function u8ToB64(u8) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return btoa(s);
}
// base64 -> Uint8Array（写入已有数组）
function b64ToU8(b64, target) {
  const s = atob(b64);
  for (let i = 0; i < s.length && i < target.length; i++) target[i] = s.charCodeAt(i);
}

// 保存：snapshot 是一个收集了所有需持久化状态的普通对象
export function saveGame(snapshot) {
  try {
    const data = {
      v: 1,
      seed: snapshot.seed,
      world: u8ToB64(snapshot.world),
      player: snapshot.player,
      chests: snapshot.chests,
      openDoors: snapshot.openDoors,   // 数组形式的坐标键
      torches: snapshot.torches,        // 数组形式的坐标键
      inventory: snapshot.inventory,
      dayTime: snapshot.dayTime,
      gameTime: snapshot.gameTime,
      savedAt: Date.now(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('存档失败', e);
    return false;
  }
}

// 读取：返回解析后的对象，world 已写回传入的 worldArray；无存档返回 null
export function loadGame(worldArray) {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.world) b64ToU8(data.world, worldArray);
    return data;
  } catch (e) {
    console.warn('读档失败', e);
    return null;
  }
}

export function hasSave() { return !!localStorage.getItem(SAVE_KEY); }
export function clearSave() { localStorage.removeItem(SAVE_KEY); }

// 世界种子记忆（标题界面填写）
export function saveSeed(seed) { try { localStorage.setItem(SEED_KEY, String(seed)); } catch (e) {} }
export function loadSeed() { const s = localStorage.getItem(SEED_KEY); return s ? Number(s) : null; }

// 把字符串种子转成数字（支持任意文字种子）
export function seedFromString(str) {
  if (!str) return 1337;
  const n = Number(str);
  if (!Number.isNaN(n)) return n;        // 纯数字直接用
  let h = 0;                              // 文字哈希成数字
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 1000000;
}
