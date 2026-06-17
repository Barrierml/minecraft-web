// ===== inventory.js =====
// 背包、起始物品与合成规则。DOM 渲染仍在 ui/game 层。

import { STACK_MAX } from './data.js';

export const inventory = {};

export const RECIPES = [
  { inputs: { 4: 1 },          output: 9,   count: 4, table: false, name: '木板', grid: [[4]] },
  { inputs: { 9: 2 },          output: 101, count: 4, table: false, name: '木棍', grid: [[9], [9]] },
  { inputs: { 9: 2, 101: 1 },  output: 109, count: 1, table: false, name: '木剑', grid: [[9], [9], [101]] },
  { inputs: { 9: 4 },          output: 12,  count: 1, table: false, name: '工作台', grid: [[9, 9], [9, 9]] },
  { inputs: { 105: 1, 9: 1 },  output: 104, count: 1, table: false, name: '苹果(应急)', grid: [[105], [9]] },
  { inputs: { 101: 1, 105: 1 },output: 14,  count: 4, table: false, name: '火把', grid: [[105], [101]] },
  { inputs: { 9: 3, 101: 2 },  output: 102, count: 1, table: true,  name: '木镐', grid: [[9, 9, 9], [0, 101, 0], [0, 101, 0]] },
  { inputs: { 9: 3, 101: 2 },  output: 113, count: 1, table: true,  name: '木斧', grid: [[9, 9, 0], [9, 101, 0], [0, 101, 0]] },
  { inputs: { 9: 1, 101: 2 },  output: 115, count: 1, table: true,  name: '木铲', grid: [[9], [101], [101]] },
  { inputs: { 8: 2, 101: 1 },  output: 110, count: 1, table: true,  name: '石剑', grid: [[8], [8], [101]] },
  { inputs: { 8: 3, 101: 2 },  output: 103, count: 1, table: true,  name: '石镐', grid: [[8, 8, 8], [0, 101, 0], [0, 101, 0]] },
  { inputs: { 8: 3, 101: 2 },  output: 114, count: 1, table: true,  name: '石斧', grid: [[8, 8, 0], [8, 101, 0], [0, 101, 0]] },
  { inputs: { 8: 1, 101: 2 },  output: 116, count: 1, table: true,  name: '石铲', grid: [[8], [101], [101]] },
  { inputs: { 106: 2, 101: 1 },output: 111, count: 1, table: true,  name: '铁剑', grid: [[106], [106], [101]] },
  { inputs: { 6: 3 },          output: 18,  count: 2, table: true,  name: '玻璃', grid: [[6, 6, 6]] },
  { inputs: { 2: 4 },          output: 19,  count: 4, table: true,  name: '砖块', grid: [[2, 2], [2, 2]] },
  { inputs: { 8: 8 },          output: 20,  count: 1, table: true,  name: '炉子', grid: [[8, 8, 8], [8, 0, 8], [8, 8, 8]] },
  { inputs: { 101: 4, 9: 2 },  output: 21,  count: 3, table: true,  name: '木栅栏', grid: [[9, 101, 9], [9, 101, 9]] },
  { inputs: { 6: 4 },          output: 7,   count: 1, table: true,  name: '水源', grid: [[6, 0, 6], [0, 0, 0], [6, 0, 6]] },
  { inputs: { 9: 6 },          output: 15,  count: 1, table: true,  name: '门', grid: [[9, 9], [9, 9], [9, 9]] },
  { inputs: { 101: 7 },        output: 16,  count: 3, table: true,  name: '梯子', grid: [[101, 0, 101], [101, 101, 101], [101, 0, 101]] },
  { inputs: { 9: 8 },          output: 17,  count: 1, table: true,  name: '箱子', grid: [[9, 9, 9], [9, 0, 9], [9, 9, 9]] },
];

export const FURNACE_RECIPES = [
  { input: 6,   fuel: 105, output: 18,  count: 2, name: '烧制玻璃' },
  { input: 2,   fuel: 105, output: 19,  count: 1, name: '烧制砖块' },
  { input: 8,   fuel: 105, output: 3,   count: 1, name: '回烧石头' },
  { input: 107, fuel: 105, output: 112, count: 1, name: '烤肉' },
  { input: 108, fuel: 105, output: 112, count: 1, name: '烤羊肉' },
];

export function clearInventory() {
  for (const k in inventory) delete inventory[k];
}

export function giveStartingInventory() {
  clearInventory();
  inventory[4] = 8;
  inventory[1] = 16;
  inventory[3] = 16;
  inventory[104] = 3;
}

export function restoreInventory(data = {}) {
  clearInventory();
  Object.assign(inventory, data);
}

export function addToInventory(id, n) {
  inventory[id] = Math.min(STACK_MAX, (inventory[id] || 0) + n);
}

export function removeFromInventory(id, n = 1) {
  if ((inventory[id] || 0) < n) return false;
  inventory[id] -= n;
  if (inventory[id] <= 0) delete inventory[id];
  return true;
}

export function canCraft(recipe, nearTable) {
  if (recipe.table && !nearTable) return false;
  for (const [id, n] of Object.entries(recipe.inputs)) {
    if ((inventory[id] || 0) < n) return false;
  }
  return true;
}

export function craft(recipe, nearTable) {
  if (!canCraft(recipe, nearTable)) return false;
  for (const [id, n] of Object.entries(recipe.inputs)) {
    inventory[id] -= n;
    if (inventory[id] <= 0) delete inventory[id];
  }
  addToInventory(recipe.output, recipe.count);
  return true;
}

export function canSmelt(recipe) {
  return (inventory[recipe.input] || 0) >= 1 && (inventory[recipe.fuel] || 0) >= 1;
}

export function smelt(recipe) {
  if (!canSmelt(recipe)) return false;
  removeFromInventory(recipe.input, 1);
  removeFromInventory(recipe.fuel, 1);
  addToInventory(recipe.output, recipe.count);
  return true;
}
