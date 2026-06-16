// ===== inventory.js =====
// 背包、起始物品与合成规则。DOM 渲染仍在 ui/game 层。

import { STACK_MAX } from './data.js';

export const inventory = {};

export const RECIPES = [
  { inputs: { 4: 1 },          output: 9,   count: 4, table: false, name: '木板' },
  { inputs: { 9: 2 },          output: 101, count: 4, table: false, name: '木棍' },
  { inputs: { 9: 3, 101: 2 },  output: 102, count: 1, table: true,  name: '木镐' },
  { inputs: { 8: 3, 101: 2 },  output: 103, count: 1, table: true,  name: '石镐' },
  { inputs: { 9: 4 },          output: 12,  count: 1, table: true,  name: '工作台' },
  { inputs: { 105: 1, 9: 1 },  output: 104, count: 1, table: false, name: '苹果(应急)' },
  { inputs: { 101: 1, 105: 1 },output: 14,  count: 4, table: false, name: '火把' },
  { inputs: { 9: 6 },          output: 15,  count: 1, table: true,  name: '门' },
  { inputs: { 101: 7 },        output: 16,  count: 3, table: true,  name: '梯子' },
  { inputs: { 9: 8 },          output: 17,  count: 1, table: true,  name: '箱子' },
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
  for (const [id, n] of Object.entries(recipe.inputs)) inventory[id] -= n;
  addToInventory(recipe.output, recipe.count);
  return true;
}
