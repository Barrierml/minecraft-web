// ===== ecs/world.js =====
// ECS world singleton and shared query helpers.

import { createWorld, query } from 'bitecs';
import { Animal, Body, Drop, Health, Mob, Position, Velocity } from './components.js';

export const ecsWorld = createWorld();

export const queries = {
  drops: world => query(world, [Drop, Position, Velocity, Body]),
  mobs: world => query(world, [Mob, Position, Velocity, Body, Health]),
  animals: world => query(world, [Animal, Position, Velocity, Body, Health]),
  renderables: world => query(world, [Position]),
};
