// ===== save.js =====
// 新存档 schema。旧 v1 localStorage 键只清理，不读取、不迁移。

const SAVE_KEY = 'miniMC_save_ecs';
const LEGACY_KEYS = ['miniMC_save_v1', 'miniMC_seed_v1'];

function u8ToB64(u8) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return btoa(s);
}

function b64ToU8(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function saveGame(snapshot) {
  try {
    const data = {
      v: 'ecs-2',
      seed: snapshot.seed,
      blockState: snapshot.blockState,
      player: snapshot.player,
      inventory: snapshot.inventory,
      hotbar: snapshot.hotbar,
      time: snapshot.time,
      ecs: snapshot.ecs || { nextNetId: 1, mobs: [], animals: [], drops: [] },
      savedAt: Date.now(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('存档失败', e);
    return false;
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.v === 'ecs-2') return data;
    if (data.v === 'ecs-1' && data.world) return { ...data, world: b64ToU8(data.world) };
    return null;
  } catch (e) {
    console.warn('读档失败', e);
    return null;
  }
}

export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
  clearLegacySaves();
}

export function clearLegacySaves() {
  for (const key of LEGACY_KEYS) localStorage.removeItem(key);
}

export function seedFromString(str) {
  if (!str) return 1337;
  const n = Number(str);
  if (!Number.isNaN(n)) return n;
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 1000000;
}
